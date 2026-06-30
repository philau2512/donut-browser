// Automation run state types — Phase 3.
//
// A "run" applies one flow to N profiles. Each profile gets a ProfileRunState
// tracked under the run. RunSettings mirrors Hidemium's Campaign Settings (the
// 5 MVP fields; window-tiling deferred to Phase 5).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Lifecycle status of a single profile within a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
  /// Reserved, not yet launching.
  Idle,
  /// Browser launch in progress.
  Launching,
  /// Sidecar engine running the flow.
  Running,
  /// Flow finished, every node ok.
  Done,
  /// Flow finished, but ≥1 node failed-but-skipped (continueOnError).
  DoneWithErrors,
  /// Flow stopped on a node error (continueOnError=false) or setup failure.
  Error,
  /// Skipped because the profile was already running (no_overlapping).
  Skipped,
  /// Cancelled via stop_automation_run.
  Stopped,
}

impl RunStatus {
  /// Terminal states no longer change without a new run.
  pub fn is_terminal(self) -> bool {
    matches!(
      self,
      RunStatus::Done
        | RunStatus::DoneWithErrors
        | RunStatus::Error
        | RunStatus::Skipped
        | RunStatus::Stopped
    )
  }
}

/// Per-profile run state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileRunState {
  pub profile_id: String,
  pub profile_name: String,
  pub status: RunStatus,
  /// Browser PID for this automation launch (kill target — red-team #4: kill by
  /// THIS pid, never by profile-path, so we never touch a user's GUI instance).
  pub browser_pid: Option<u32>,
  /// Sidecar engine PID.
  pub sidecar_pid: Option<u32>,
  /// CDP port verified live before the sidecar was spawned.
  pub cdp_port: Option<u16>,
  /// Epoch millis when this profile entered a terminal state (for eviction).
  pub finished_at_ms: Option<u64>,
  /// Last error message, when status is Error.
  pub error: Option<String>,
}

impl ProfileRunState {
  pub fn new(profile_id: String, profile_name: String) -> Self {
    Self {
      profile_id,
      profile_name,
      status: RunStatus::Idle,
      browser_pid: None,
      sidecar_pid: None,
      cdp_port: None,
      finished_at_ms: None,
      error: None,
    }
  }
}

/// Run-level settings, mirroring Hidemium Campaign Settings (MVP subset).
/// Window-tiling (Screen arrangement / Auto scale / Set size) is Phase 5.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSettings {
  /// "Automation processing" — max profiles in parallel.
  pub concurrency: u32,
  /// "Delay open" — seconds to stagger between launches.
  pub delay_open_secs: u32,
  /// Run headless (no visible window).
  pub headless: bool,
  /// "Close Profile On Complete" — kill the browser after the flow finishes.
  pub close_on_complete: bool,
  /// "Write logs" — append per-profile log files. The realtime event is emitted
  /// regardless of this flag.
  pub write_logs: bool,
  /// "No overlapping profiles" — skip a profile that is already running.
  pub no_overlapping: bool,
}

impl Default for RunSettings {
  fn default() -> Self {
    Self {
      concurrency: 5,
      delay_open_secs: 0,
      headless: false,
      close_on_complete: true,
      write_logs: true,
      no_overlapping: true,
    }
  }
}

/// State for one run (one flow across N profiles).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunState {
  pub run_id: String,
  pub flow_name: String,
  pub settings: RunSettings,
  pub profiles: HashMap<String, ProfileRunState>,
  /// Epoch millis when the whole run reached a terminal state (all profiles
  /// terminal). Used by the eviction sweep.
  pub finished_at_ms: Option<u64>,
}

impl RunState {
  pub fn new(run_id: String, flow_name: String, settings: RunSettings) -> Self {
    Self {
      run_id,
      flow_name,
      settings,
      profiles: HashMap::new(),
      finished_at_ms: None,
    }
  }

  /// True when every tracked profile is in a terminal state.
  pub fn all_terminal(&self) -> bool {
    !self.profiles.is_empty() && self.profiles.values().all(|p| p.status.is_terminal())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_settings_match_plan() {
    let s = RunSettings::default();
    assert_eq!(s.concurrency, 5);
    assert_eq!(s.delay_open_secs, 0);
    assert!(!s.headless);
    assert!(s.close_on_complete);
    assert!(s.write_logs);
    assert!(s.no_overlapping);
  }

  #[test]
  fn terminal_states() {
    assert!(RunStatus::Done.is_terminal());
    assert!(RunStatus::DoneWithErrors.is_terminal());
    assert!(RunStatus::Error.is_terminal());
    assert!(RunStatus::Skipped.is_terminal());
    assert!(RunStatus::Stopped.is_terminal());
    assert!(!RunStatus::Running.is_terminal());
    assert!(!RunStatus::Launching.is_terminal());
    assert!(!RunStatus::Idle.is_terminal());
  }

  #[test]
  fn all_terminal_requires_nonempty() {
    let mut run = RunState::new("r1".into(), "flow".into(), RunSettings::default());
    assert!(!run.all_terminal());
    run.profiles.insert(
      "p1".into(),
      ProfileRunState {
        status: RunStatus::Done,
        ..ProfileRunState::new("p1".into(), "P1".into())
      },
    );
    assert!(run.all_terminal());
    run.profiles.insert(
      "p2".into(),
      ProfileRunState {
        status: RunStatus::Running,
        ..ProfileRunState::new("p2".into(), "P2".into())
      },
    );
    assert!(!run.all_terminal());
  }

  #[test]
  fn run_status_serializes_kebab() {
    let json = serde_json::to_string(&RunStatus::DoneWithErrors).unwrap();
    assert_eq!(json, "\"done-with-errors\"");
  }
}
