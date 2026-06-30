// Automation module — Phase 3.
//
// Visual-node automation: applies a `.donutflow` to N profiles in parallel via
// a Node sidecar engine that drives each profile's Wayfern over CDP. This module
// owns run lifecycle, log fan-out, and crash-safe process reaping.
//
// In-app, NOT gated (deliberate user decision): the orchestrator calls
// launch_browser_profile_impl directly rather than the REST /run path, so it
// bypasses can_use_browser_automation. See plan.md finding #13.

pub mod commands;
pub mod log_sink;
pub mod pids;
pub mod pipeline;
pub mod process_kill;
pub mod reaper;
pub mod run_state;
pub mod runner;
pub mod sidecar;

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::automation::run_state::RunState;

/// Global orchestrator state (lazy static, mirrors BROWSER_RUNNER/PROXY_MANAGER).
pub struct AutomationRunner {
  /// runId → RunState. Evicted some time after the run reaches a terminal state
  /// (see commands::evict_finished_runs) so the map doesn't grow unbounded.
  pub runs: Mutex<HashMap<String, RunState>>,
  /// runIds that have been asked to stop; tasks consult this before launching.
  pub cancelled: Mutex<HashSet<String>>,
}

impl AutomationRunner {
  fn new() -> Self {
    Self {
      runs: Mutex::new(HashMap::new()),
      cancelled: Mutex::new(HashSet::new()),
    }
  }
}

lazy_static::lazy_static! {
  pub static ref AUTOMATION_RUNNER: AutomationRunner = AutomationRunner::new();
}
