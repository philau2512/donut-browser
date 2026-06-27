// Tauri command wrappers for automation — Phase 3.
//
// In-app, NOT gated (deliberate user decision, plan.md #13): these commands do
// not go through the REST /run path, so they bypass can_use_browser_automation
// and the primary-device lock. Accepted trade-off.

use crate::automation::run_state::{RunSettings, RunState};
use crate::automation::runner;
use crate::automation::sidecar::EngineInvocation;
use crate::automation::AUTOMATION_RUNNER;
use crate::profile::BrowserProfile;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

/// Start a run: apply `flow_json` (a .donutflow) to `profiles` with `settings`.
/// Returns the runId; profiles execute asynchronously.
#[tauri::command]
pub async fn start_automation_run(
  app_handle: tauri::AppHandle,
  flow_json: String,
  profiles: Vec<BrowserProfile>,
  settings: RunSettings,
) -> Result<String, String> {
  if profiles.is_empty() {
    return Err("no profiles selected".into());
  }
  runner::start_automation_run(app_handle, flow_json, profiles, settings).await
}

/// Stop a run: cancel pending launches, kill sidecars + browsers by PID.
#[tauri::command]
pub async fn stop_automation_run(
  app_handle: tauri::AppHandle,
  run_id: String,
) -> Result<(), String> {
  runner::stop_automation_run(app_handle, run_id).await
}

/// List current run states (for the grid). Evicts old terminal runs first.
#[tauri::command]
pub fn list_automation_runs() -> Result<Vec<RunState>, String> {
  evict_finished_runs();
  let runs = AUTOMATION_RUNNER
    .runs
    .lock()
    .map_err(|_| "automation runner lock poisoned".to_string())?;
  Ok(runs.values().cloned().collect())
}

/// Resolve the on-disk log file path for one profile in a run (so the UI can
/// "open log file").
#[tauri::command]
pub fn get_run_log_path(run_id: String, profile_id: String) -> Result<String, String> {
  let path = crate::automation::log_sink::profile_log_path(&run_id, &profile_id);
  Ok(path.to_string_lossy().to_string())
}

/// List `.donutflow` files available in the flows dir (for the flow picker).
#[tauri::command]
pub fn list_automation_flows() -> Result<Vec<String>, String> {
  let dir = crate::settings::app_dirs::automation_flows_dir();
  let mut out = Vec::new();
  if let Ok(entries) = std::fs::read_dir(&dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().map(|e| e == "donutflow").unwrap_or(false) {
        out.push(path.to_string_lossy().to_string());
      }
    }
  }
  out.sort();
  Ok(out)
}

/// One flow's display metadata for the script-management grid.
#[derive(serde::Serialize)]
pub struct FlowMeta {
  /// Absolute path (the stable id the FE passes back to run/edit/delete).
  pub path: String,
  /// File stem without the `.donutflow` extension (display name).
  pub name: String,
  /// Last-modified time in epoch milliseconds, or null if unavailable.
  pub modified_ms: Option<u64>,
}

/// List `.donutflow` files with display metadata (name + mtime) for the grid.
/// Separate from `list_automation_flows` (which the run picker still uses) so
/// neither caller pays for the other's shape.
#[tauri::command]
pub fn list_automation_flow_meta() -> Result<Vec<FlowMeta>, String> {
  let dir = crate::settings::app_dirs::automation_flows_dir();
  let mut out = Vec::new();
  if let Ok(entries) = std::fs::read_dir(&dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().map(|e| e == "donutflow").unwrap_or(false) {
        let name = path
          .file_stem()
          .map(|s| s.to_string_lossy().to_string())
          .unwrap_or_default();
        let modified_ms = entry
          .metadata()
          .and_then(|m| m.modified())
          .ok()
          .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
          .map(|d| d.as_millis() as u64);
        out.push(FlowMeta {
          path: path.to_string_lossy().to_string(),
          name,
          modified_ms,
        });
      }
    }
  }
  out.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(out)
}

/// Read the contents of one `.donutflow` file for the picker. The path MUST
/// resolve inside the flows dir (canonicalized prefix check) — this refuses any
/// caller-supplied path that escapes the flows dir (path-traversal guard, mirrors
/// the engine-side containment in safe-path.mjs).
#[tauri::command]
pub fn read_automation_flow(path: String) -> Result<String, String> {
  let flows_dir = crate::settings::app_dirs::automation_flows_dir();
  let flows_canon = flows_dir
    .canonicalize()
    .map_err(|e| format!("flows dir unavailable: {e}"))?;
  let requested = std::path::Path::new(&path)
    .canonicalize()
    .map_err(|e| format!("flow not found: {e}"))?;
  if !requested.starts_with(&flows_canon) {
    return Err("flow path escapes the flows directory".into());
  }
  if requested
    .extension()
    .map(|e| e == "donutflow")
    .unwrap_or(false)
  {
    std::fs::read_to_string(&requested).map_err(|e| format!("failed to read flow: {e}"))
  } else {
    Err("not a .donutflow file".into())
  }
}

/// Validate a flow JSON through the engine's shared validator (single source of
/// truth — no parallel TS validator). Spawns the engine with `--validate`,
/// piping the JSON to STDIN (HIGH-2: large flows would overflow the OS
/// command-line length limit on Windows if passed as an argv). The engine path
/// is resolved via `EngineInvocation::resolve()` so dev (`node engine.mjs`) and
/// prod (SEA binary) both work (HIGH-3: never re-derive the path here).
#[tauri::command]
pub async fn validate_automation_flow(json: String) -> Result<(), String> {
  let inv = EngineInvocation::resolve()?;

  let mut cmd = tokio::process::Command::new(&inv.program);
  cmd.args(&inv.prefix_args);
  cmd.arg("--validate");
  cmd.stdin(Stdio::piped());
  cmd.stdout(Stdio::null());
  cmd.stderr(Stdio::piped());
  cmd.env("DEBUG", "");

  #[cfg(windows)]
  {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("failed to spawn validator: {e}"))?;

  // Write the JSON to stdin, then close it so the engine sees EOF.
  {
    let mut stdin = child
      .stdin
      .take()
      .ok_or_else(|| "validator stdin unavailable".to_string())?;
    stdin
      .write_all(json.as_bytes())
      .await
      .map_err(|e| format!("failed to write flow to validator: {e}"))?;
    stdin
      .shutdown()
      .await
      .map_err(|e| format!("failed to close validator stdin: {e}"))?;
  }

  let output = child
    .wait_with_output()
    .await
    .map_err(|e| format!("validator wait failed: {e}"))?;

  if output.status.success() {
    Ok(())
  } else {
    let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if msg.is_empty() {
      "flow validation failed".to_string()
    } else {
      msg
    })
  }
}

/// Sanitize a user-supplied flow name into a safe `<name>.donutflow` filename.
/// Rejects path separators, parent-dir tokens, and anything outside
/// `[A-Za-z0-9 _-]`. Returns the filename (with extension), never a path.
fn sanitize_flow_name(name: &str) -> Result<String, String> {
  let trimmed = name.trim();
  // Drop a trailing .donutflow the caller may have included, validate the stem.
  let stem = trimmed.strip_suffix(".donutflow").unwrap_or(trimmed).trim();
  if stem.is_empty() {
    return Err("flow name is empty".into());
  }
  if stem.contains('/') || stem.contains('\\') || stem.contains("..") {
    return Err("flow name must not contain path separators or '..'".into());
  }
  if !stem
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_' || c == '-')
  {
    return Err("flow name may only contain letters, digits, space, '_' or '-'".into());
  }
  Ok(format!("{stem}.donutflow"))
}

/// Write a `.donutflow` to the flows dir. Server-side validates via the engine
/// before writing (never trusts the FE). Refuses to silently overwrite: when the
/// target exists and `overwrite` is false, returns Err("exists") so the FE can
/// prompt (MEDIUM-6). Writes atomically (temp file in the same dir + rename).
/// Returns the absolute path written.
#[tauri::command]
pub async fn write_automation_flow(
  name: String,
  json: String,
  overwrite: bool,
) -> Result<String, String> {
  let filename = sanitize_flow_name(&name)?;

  // Server-side validation gate — the FE result is not trusted.
  validate_automation_flow(json.clone()).await?;

  let flows_dir = crate::settings::app_dirs::automation_flows_dir();
  std::fs::create_dir_all(&flows_dir).map_err(|e| format!("failed to create flows dir: {e}"))?;

  // Containment: the sanitized filename has no separators, but assert the joined
  // parent still resolves to the flows dir (defense in depth, mirrors read guard).
  let target = flows_dir.join(&filename);
  let parent = target
    .parent()
    .ok_or_else(|| "invalid target path".to_string())?;
  let parent_canon = parent
    .canonicalize()
    .map_err(|e| format!("flows dir unavailable: {e}"))?;
  let flows_canon = flows_dir
    .canonicalize()
    .map_err(|e| format!("flows dir unavailable: {e}"))?;
  if parent_canon != flows_canon {
    return Err("flow path escapes the flows directory".into());
  }

  if target.exists() && !overwrite {
    return Err("exists".into());
  }

  // Atomic write: temp file in the SAME dir, then rename (same filesystem).
  let tmp = flows_dir.join(format!(".{filename}.tmp"));
  std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("failed to write temp flow: {e}"))?;
  std::fs::rename(&tmp, &target).map_err(|e| {
    let _ = std::fs::remove_file(&tmp);
    format!("failed to commit flow: {e}")
  })?;

  Ok(target.to_string_lossy().to_string())
}

/// Delete a `.donutflow` (same path-traversal guard as `read_automation_flow`)
/// and clean up its UI-only sidecars (`<name>.layout.json`, `<name>.reviewed`)
/// so a later flow that reuses the name can't inherit a stale layout or a stale
/// "reviewed" flag (HIGH-4).
#[tauri::command]
pub fn delete_automation_flow(path: String) -> Result<(), String> {
  let flows_dir = crate::settings::app_dirs::automation_flows_dir();
  let flows_canon = flows_dir
    .canonicalize()
    .map_err(|e| format!("flows dir unavailable: {e}"))?;
  let requested = std::path::Path::new(&path)
    .canonicalize()
    .map_err(|e| format!("flow not found: {e}"))?;
  if !requested.starts_with(&flows_canon) {
    return Err("flow path escapes the flows directory".into());
  }
  if requested
    .extension()
    .map(|e| e == "donutflow")
    .unwrap_or(false)
  {
    std::fs::remove_file(&requested).map_err(|e| format!("failed to delete flow: {e}"))?;
    // Best-effort sidecar cleanup (their absence is not an error).
    for suffix in ["layout.json", "reviewed"] {
      let sidecar = requested.with_extension(suffix);
      let _ = std::fs::remove_file(&sidecar);
    }
    Ok(())
  } else {
    Err("not a .donutflow file".into())
  }
}

/// Drop run states that reached a terminal state more than RETAIN_MS ago, so the
/// in-memory map can't grow unbounded over a long-lived process (red-team #5-FMA).
const RETAIN_MS: u64 = 10 * 60 * 1000;

fn evict_finished_runs() {
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0);
  if let Ok(mut runs) = AUTOMATION_RUNNER.runs.lock() {
    runs.retain(|_, run| match run.finished_at_ms {
      Some(ts) => now.saturating_sub(ts) < RETAIN_MS,
      None => true,
    });
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // ---- sanitize_flow_name (pure, no engine) -------------------------------

  #[test]
  fn sanitize_accepts_plain_name_and_appends_ext() {
    assert_eq!(sanitize_flow_name("my flow").unwrap(), "my flow.donutflow");
    assert_eq!(sanitize_flow_name("login_1").unwrap(), "login_1.donutflow");
    assert_eq!(sanitize_flow_name("a-b_c 9").unwrap(), "a-b_c 9.donutflow");
  }

  #[test]
  fn sanitize_strips_caller_supplied_ext() {
    assert_eq!(
      sanitize_flow_name("flow.donutflow").unwrap(),
      "flow.donutflow"
    );
  }

  #[test]
  fn sanitize_rejects_path_separators() {
    assert!(sanitize_flow_name("../evil").is_err());
    assert!(sanitize_flow_name("a/b").is_err());
    assert!(sanitize_flow_name("a\\b").is_err());
    assert!(sanitize_flow_name("..").is_err());
  }

  #[test]
  fn sanitize_rejects_disallowed_chars() {
    // A foreign extension collapses to a disallowed '.' in the stem.
    assert!(sanitize_flow_name("flow.exe").is_err());
    assert!(sanitize_flow_name("flow$").is_err());
    assert!(sanitize_flow_name("flow:name").is_err());
    assert!(sanitize_flow_name("").is_err());
    assert!(sanitize_flow_name("   ").is_err());
  }

  // ---- validate_automation_flow (spawns engine via `node`) ----------------
  //
  // These require `node` on PATH and the dev engine.mjs (EngineInvocation
  // dev fallback). They are integration-flavored unit tests.

  const GOOD_FLOW: &str = r#"{"version":1,"name":"t","nodes":[{"id":"n1","type":"openUrl","params":{"url":"https://example.com"}}],"edges":[]}"#;

  #[tokio::test]
  async fn validate_accepts_good_flow() {
    validate_automation_flow(GOOD_FLOW.to_string())
      .await
      .expect("well-formed flow should validate");
  }

  #[tokio::test]
  async fn validate_rejects_unknown_node_type() {
    let bad =
      r#"{"version":1,"name":"t","nodes":[{"id":"n1","type":"evilEval","params":{}}],"edges":[]}"#;
    let err = validate_automation_flow(bad.to_string())
      .await
      .expect_err("unknown node type must be rejected");
    assert!(!err.is_empty(), "rejection should carry a message");
  }

  #[tokio::test]
  async fn validate_rejects_non_json() {
    assert!(validate_automation_flow("not json".to_string())
      .await
      .is_err());
  }

  // ---- write_automation_flow collision (MEDIUM-6) -------------------------

  #[tokio::test]
  async fn write_refuses_silent_overwrite() {
    let tmp = std::env::temp_dir().join(format!("donut-write-test-{}", uuid::Uuid::new_v4()));
    let _guard = crate::settings::app_dirs::set_test_data_dir(tmp.clone());

    let first = write_automation_flow("collide".to_string(), GOOD_FLOW.to_string(), false)
      .await
      .expect("first write should succeed");
    assert!(first.ends_with("collide.donutflow"));

    // Second write without overwrite must report the collision, not clobber.
    let err = write_automation_flow("collide".to_string(), GOOD_FLOW.to_string(), false)
      .await
      .expect_err("second write must refuse");
    assert_eq!(err, "exists");

    // With overwrite=true it succeeds.
    write_automation_flow("collide".to_string(), GOOD_FLOW.to_string(), true)
      .await
      .expect("overwrite=true should succeed");

    std::fs::remove_dir_all(&tmp).ok();
  }

  #[tokio::test]
  async fn write_rejects_bad_name_before_validate() {
    let err = write_automation_flow("../escape".to_string(), GOOD_FLOW.to_string(), false)
      .await
      .expect_err("path-separator name must be rejected");
    assert!(err.contains("separator") || err.contains("path"));
  }
}
