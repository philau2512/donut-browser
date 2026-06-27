// PID persistence for crash reaping — Phase 3 (red-team #3).
//
// The proxy self-reaper keys on the BROWSER pid and only fires when the browser
// dies; it knows nothing about our sidecar, and nothing reaps either when the
// APP itself crashes mid-run. AUTOMATION_RUNNER state is in-memory, so a crash
// loses it. We persist per-profile PIDs to
//   automation/runs/<runId>/pids.json
// at launch and a startup reaper (see reaper.rs) kills leftovers next boot.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RunPids {
  /// profileId → (browser_pid, sidecar_pid)
  pub entries: HashMap<String, PidPair>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PidPair {
  pub browser_pid: Option<u32>,
  pub sidecar_pid: Option<u32>,
}

fn pids_path(run_id: &str) -> PathBuf {
  crate::settings::app_dirs::automation_runs_dir()
    .join(run_id)
    .join("pids.json")
}

fn load(run_id: &str) -> RunPids {
  let path = pids_path(run_id);
  std::fs::read_to_string(&path)
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}

fn save(run_id: &str, pids: &RunPids) {
  let path = pids_path(run_id);
  if let Some(parent) = path.parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  if let Ok(json) = serde_json::to_string_pretty(pids) {
    let _ = std::fs::write(&path, json);
  }
}

pub fn persist_pids(
  run_id: &str,
  profile_id: &str,
  browser_pid: Option<u32>,
  sidecar_pid: Option<u32>,
) {
  let mut pids = load(run_id);
  pids.entries.insert(
    profile_id.to_string(),
    PidPair {
      browser_pid,
      sidecar_pid,
    },
  );
  save(run_id, &pids);
}

pub fn remove_pids(run_id: &str, profile_id: &str) {
  let mut pids = load(run_id);
  pids.entries.remove(profile_id);
  if pids.entries.is_empty() {
    let _ = std::fs::remove_file(pids_path(run_id));
  } else {
    save(run_id, &pids);
  }
}

/// Enumerate all persisted (runId, profileId, PidPair) across runs — used by the
/// startup reaper.
pub fn all_persisted() -> Vec<(String, String, PidPair)> {
  let runs_dir = crate::settings::app_dirs::automation_runs_dir();
  let mut out = Vec::new();
  let Ok(entries) = std::fs::read_dir(&runs_dir) else {
    return out;
  };
  for entry in entries.flatten() {
    if !entry.path().is_dir() {
      continue;
    }
    let run_id = entry.file_name().to_string_lossy().to_string();
    let pids = load(&run_id);
    for (profile_id, pair) in pids.entries {
      out.push((run_id.clone(), profile_id, pair));
    }
  }
  out
}

/// Delete the whole pids.json for a run (reaper cleanup after killing).
pub fn clear_run(run_id: &str) {
  let _ = std::fs::remove_file(pids_path(run_id));
}
