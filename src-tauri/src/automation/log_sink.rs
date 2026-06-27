// Log sink for automation runs — Phase 3.
//
// Receives each JSON-line emitted by the sidecar engine's stdout. When
// `write_logs` is on, appends to `automation/runs/<runId>/<profileId>.log`.
// Regardless of `write_logs`, emits an `automation-log` Tauri event so the
// realtime panel always updates (red-team #12 note: the engine already redacts
// secrets before the line reaches us, so we forward as-is).

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use crate::events;

/// Resolve the per-profile log file path for a run.
pub fn profile_log_path(run_id: &str, profile_id: &str) -> PathBuf {
  crate::settings::app_dirs::automation_runs_dir()
    .join(run_id)
    .join(format!("{profile_id}.log"))
}

/// Handle one log line from the sidecar: append to file (if enabled) + emit.
/// `line` is a single JSON object (already redacted by the engine).
pub fn handle_log_line(run_id: &str, profile_id: &str, line: &str, write_logs: bool) {
  if write_logs {
    if let Err(e) = append_line(run_id, profile_id, line) {
      log::warn!("automation: failed to append log for {run_id}/{profile_id}: {e}");
    }
  }

  // Always emit for the realtime panel. Parse into a value so the frontend gets
  // structured fields; fall back to a wrapper if the line is not valid JSON.
  let payload = serde_json::from_str::<serde_json::Value>(line).unwrap_or_else(|_| {
    serde_json::json!({
      "runId": run_id,
      "profileId": profile_id,
      "level": "info",
      "msg": line,
    })
  });
  if let Err(e) = events::emit("automation-log", &payload) {
    log::warn!("automation: failed to emit automation-log: {e}");
  }
}

fn append_line(run_id: &str, profile_id: &str, line: &str) -> std::io::Result<()> {
  let path = profile_log_path(run_id, profile_id);
  if let Some(parent) = path.parent() {
    create_dir_all(parent)?;
  }
  let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
  f.write_all(line.as_bytes())?;
  f.write_all(b"\n")?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  #[test]
  fn log_path_layout() {
    let _g =
      crate::settings::app_dirs::set_test_data_dir(std::env::temp_dir().join("donut-log-test"));
    let p = profile_log_path("run1", "prof1");
    assert!(p.ends_with("run1/prof1.log") || p.ends_with("run1\\prof1.log"));
  }

  #[test]
  fn append_writes_lines() {
    let tmp = std::env::temp_dir().join(format!("donut-log-append-{}", std::process::id()));
    let _g = crate::settings::app_dirs::set_test_data_dir(tmp.clone());

    append_line("runA", "profA", "{\"msg\":\"one\"}").unwrap();
    append_line("runA", "profA", "{\"msg\":\"two\"}").unwrap();

    let content = fs::read_to_string(profile_log_path("runA", "profA")).unwrap();
    let lines: Vec<&str> = content.lines().collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].contains("one"));
    assert!(lines[1].contains("two"));

    let _ = fs::remove_dir_all(&tmp);
  }
}
