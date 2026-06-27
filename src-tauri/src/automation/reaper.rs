// Startup crash reaper — Phase 3 (red-team #3).
//
// The proxy self-reaper keys on browser PID and only fires when the browser
// dies; nothing reaps the sidecar, and nothing reaps either when the APP
// crashes mid-run. On every startup we read every automation/runs/<runId>/
// pids.json and kill any still-alive PIDs from a previous session, then clear
// the file. Called once during app setup, after app_dirs is usable.

use crate::automation::pids::{all_persisted, clear_run};
use crate::automation::process_kill::{is_pid_alive, kill_pid_tree};
use std::collections::HashSet;

/// Kill leftover automation processes from a previous (crashed) session.
/// Best-effort: logs but never panics.
pub async fn reap_orphans_on_startup() {
  let persisted = all_persisted();
  if persisted.is_empty() {
    return;
  }
  log::info!(
    "automation reaper: found {} persisted profile PID record(s) from a prior session",
    persisted.len()
  );

  let mut run_ids = HashSet::new();
  for (run_id, profile_id, pair) in persisted {
    run_ids.insert(run_id.clone());
    for pid in [pair.sidecar_pid, pair.browser_pid].into_iter().flatten() {
      if is_pid_alive(pid) {
        log::warn!(
          "automation reaper: killing orphaned pid {pid} (run {run_id}, profile {profile_id})"
        );
        if let Err(e) = kill_pid_tree(pid).await {
          log::warn!("automation reaper: failed to kill orphaned pid {pid}: {e}");
        }
      }
    }
  }

  // Clear pid files for every run we touched — the processes are gone (or were
  // never alive), and the in-memory run state did not survive the crash.
  for run_id in run_ids {
    clear_run(&run_id);
  }
}
