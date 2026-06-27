// Tauri command wrappers for automation — Phase 3.
//
// In-app, NOT gated (deliberate user decision, plan.md #13): these commands do
// not go through the REST /run path, so they bypass can_use_browser_automation
// and the primary-device lock. Accepted trade-off.

use crate::automation::run_state::{RunSettings, RunState};
use crate::automation::runner;
use crate::automation::AUTOMATION_RUNNER;
use crate::profile::BrowserProfile;

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
