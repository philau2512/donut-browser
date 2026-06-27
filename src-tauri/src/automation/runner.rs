// Run orchestrator — Phase 3. The heart of automation.
//
// start_automation_run: applies one flow to N profiles, bounded by a semaphore
// (settings.concurrency). For each profile it:
//   0. RESERVES atomically (red-team #6): under a single lock, refuses to launch
//      a profile already running/reserved when no_overlapping is on. The check
//      and the claim are not separable, so two tasks can't both see "free".
//   0b. staggers via delay_open_secs.
//   1. launches Wayfern with a debugging port (reuses launch_browser_profile_impl).
//   1b. resolves the REAL CDP port from WayfernManager (red-team #1 — the launch
//       result does not hand back the port) and verifies /json/version is live
//       before trusting it (TOCTOU: never trust a pre-bound port).
//   1c. persists browser+sidecar PIDs to pids.json (red-team #3 — crash reaper).
//   2. spawns the sidecar engine, draining stdout (protocol) AND stderr (#5).
//   3. waits for exit → maps exit code to status.
//   4. if close_on_complete, kills by THIS browser PID (red-team #4, never by
//      path) and releases the team lock after the kill (red-team #2).
//
// stop_automation_run: cancels, kills sidecar + browser by PID, releases locks.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::automation::log_sink::handle_log_line;
use crate::automation::pids::{persist_pids, remove_pids};
use crate::automation::run_state::{ProfileRunState, RunSettings, RunState, RunStatus};
use crate::automation::sidecar::{spawn_engine, EngineInvocation, SidecarArgs};
use crate::automation::AUTOMATION_RUNNER;
use crate::browser::browser_runner::launch_browser_profile_impl;
use crate::browser::browser_runner::ACTIVE_RUNNING_STATES;
use crate::profile::BrowserProfile;

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

/// Emit an automation-status event for one profile.
fn emit_status(state: &ProfileRunState) {
  if let Err(e) = crate::events::emit("automation-status", state) {
    log::warn!("automation: failed to emit automation-status: {e}");
  }
}

/// Atomically reserve a profile for this run. Returns false when no_overlapping
/// is on and the profile is already running (in the GUI poll map) or already
/// reserved by another automation task. The check+claim is under one lock.
fn try_reserve(profile_id: &str, no_overlapping: bool) -> bool {
  // RESERVATIONS is the automation-owned set; ACTIVE_RUNNING_STATES is the GUI
  // advisory map. We claim under the reservations lock and ALSO consult the GUI
  // map inside the same critical section so a GUI-running profile is refused.
  let mut reserved = RESERVATIONS.lock().unwrap();
  if no_overlapping {
    if reserved.contains(profile_id) {
      return false;
    }
    let gui_running = ACTIVE_RUNNING_STATES
      .lock()
      .map(|m| m.get(profile_id).copied().unwrap_or(false))
      .unwrap_or(false);
    if gui_running {
      return false;
    }
  }
  reserved.insert(profile_id.to_string());
  true
}

fn release_reservation(profile_id: &str) {
  if let Ok(mut reserved) = RESERVATIONS.lock() {
    reserved.remove(profile_id);
  }
}

use std::sync::Mutex;
lazy_static::lazy_static! {
  /// Profiles currently claimed by an automation run (red-team #6 reservation set).
  static ref RESERVATIONS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

/// Start a run. Returns the runId immediately; profiles execute in spawned tasks.
pub async fn start_automation_run(
  app_handle: tauri::AppHandle,
  flow_json: String,
  profiles: Vec<BrowserProfile>,
  settings: RunSettings,
) -> Result<String, String> {
  // Parse + snapshot the flow up front so every profile shares one frozen copy.
  let flow_value: serde_json::Value =
    serde_json::from_str(&flow_json).map_err(|e| format!("flow is not valid JSON: {e}"))?;
  let flow_name = flow_value
    .get("name")
    .and_then(|v| v.as_str())
    .unwrap_or("flow")
    .to_string();

  let run_id = Uuid::new_v4().to_string();
  let run_dir = crate::settings::app_dirs::automation_runs_dir().join(&run_id);
  std::fs::create_dir_all(&run_dir).map_err(|e| format!("failed to create run dir: {e}"))?;
  let flow_path = run_dir.join("flow.json");
  std::fs::write(&flow_path, &flow_json).map_err(|e| format!("failed to snapshot flow: {e}"))?;

  // Resolve the engine once; fail fast if missing.
  let invocation = EngineInvocation::resolve()?;

  // Register the run state.
  {
    let mut runs = AUTOMATION_RUNNER.runs.lock().unwrap();
    let mut state = RunState::new(run_id.clone(), flow_name.clone(), settings.clone());
    for p in &profiles {
      state.profiles.insert(
        p.id.to_string(),
        ProfileRunState::new(p.id.to_string(), p.name.clone()),
      );
    }
    runs.insert(run_id.clone(), state);
  }

  let semaphore = Arc::new(Semaphore::new(settings.concurrency.max(1) as usize));
  let run_id_for_tasks = run_id.clone();

  for (idx, profile) in profiles.into_iter().enumerate() {
    let app = app_handle.clone();
    let sem = semaphore.clone();
    let rid = run_id_for_tasks.clone();
    let inv = invocation.clone();
    let fpath = flow_path.clone();
    let set = settings.clone();

    tokio::spawn(async move {
      let _permit = match sem.acquire_owned().await {
        Ok(p) => p,
        Err(_) => return,
      };
      run_one_profile(app, rid, inv, fpath, profile, set, idx).await;
    });
  }

  Ok(run_id)
}

#[allow(clippy::too_many_arguments)]
async fn run_one_profile(
  app_handle: tauri::AppHandle,
  run_id: String,
  invocation: EngineInvocation,
  flow_path: std::path::PathBuf,
  profile: BrowserProfile,
  settings: RunSettings,
  index: usize,
) {
  let profile_id = profile.id.to_string();

  // 0. Atomic reserve / no-overlap (red-team #6).
  if !try_reserve(&profile_id, settings.no_overlapping) {
    set_status(&run_id, &profile_id, RunStatus::Skipped, |s| {
      s.finished_at_ms = Some(now_ms());
    });
    return;
  }

  // Ensure the reservation is always freed.
  let _guard = ReservationGuard(profile_id.clone());

  // 0b. Stagger.
  if settings.delay_open_secs > 0 && index > 0 {
    tokio::time::sleep(Duration::from_secs(settings.delay_open_secs as u64)).await;
  }

  // Check cancellation before launching.
  if is_cancelled(&run_id) {
    set_status(&run_id, &profile_id, RunStatus::Stopped, |s| {
      s.finished_at_ms = Some(now_ms());
    });
    return;
  }

  set_status(&run_id, &profile_id, RunStatus::Launching, |_| {});

  // 1. Launch with a debugging port. force_new=true → fresh headed/headless
  //    instance with the requested debug port.
  let launched = match launch_browser_profile_impl(
    app_handle.clone(),
    profile.clone(),
    None,
    None, // let the launcher pick a free port; we read the REAL one back next
    settings.headless,
    true,
  )
  .await
  {
    Ok(p) => p,
    Err(e) => {
      set_status(&run_id, &profile_id, RunStatus::Error, |s| {
        s.error = Some(format!("launch failed: {e}"));
        s.finished_at_ms = Some(now_ms());
      });
      return;
    }
  };

  let browser_pid = launched.process_id;

  // 1b. Resolve the REAL CDP port (red-team #1) + verify it is live.
  let port = match resolve_and_verify_port(&profile).await {
    Some(p) => p,
    None => {
      // Couldn't get a live CDP port — kill what we launched and bail.
      kill_and_release(&profile, browser_pid).await;
      set_status(&run_id, &profile_id, RunStatus::Error, |s| {
        s.error = Some("CDP port not live after launch".into());
        s.finished_at_ms = Some(now_ms());
      });
      return;
    }
  };

  set_status(&run_id, &profile_id, RunStatus::Running, |s| {
    s.browser_pid = browser_pid;
    s.cdp_port = Some(port);
  });

  // 2. Spawn the sidecar engine.
  let vars = serde_json::json!({
    "PROFILE_ID": profile_id,
    "PROFILE_NAME": profile.name,
  })
  .to_string();

  let args = SidecarArgs {
    flow_path: flow_path.clone(),
    cdp_port: port,
    vars_json: vars,
    run_id: run_id.clone(),
    profile_id: profile_id.clone(),
    artifacts_dir: crate::settings::app_dirs::automation_runs_dir().join(&run_id),
    continue_default: false,
  };

  let mut child = match spawn_engine(&invocation, &args) {
    Ok(c) => c,
    Err(e) => {
      kill_and_release(&profile, browser_pid).await;
      set_status(&run_id, &profile_id, RunStatus::Error, |s| {
        s.error = Some(format!("sidecar spawn failed: {e}"));
        s.finished_at_ms = Some(now_ms());
      });
      return;
    }
  };

  let sidecar_pid = child.id();
  set_status(&run_id, &profile_id, RunStatus::Running, |s| {
    s.sidecar_pid = sidecar_pid;
  });

  // 1c. Persist PIDs for crash reaping (red-team #3).
  persist_pids(&run_id, &profile_id, browser_pid, sidecar_pid);

  // 3. Drain stdout (protocol) + stderr (#5), concurrently with the wait.
  crate::automation::sidecar::drain_stderr(&mut child, run_id.clone(), profile_id.clone());

  let write_logs = settings.write_logs;
  let saw_error = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
  if let Some(stdout) = child.stdout.take() {
    let rid = run_id.clone();
    let pid_s = profile_id.clone();
    let saw = saw_error.clone();
    let stdout_task = tokio::spawn(async move {
      let mut lines = BufReader::new(stdout).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        if line.contains("\"level\":\"error\"") {
          saw.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        handle_log_line(&rid, &pid_s, &line, write_logs);
      }
    });
    // Wait for the engine to exit (with a wall-clock cap to avoid a hung sidecar
    // pinning a semaphore permit forever).
    let exit = wait_with_timeout(&mut child, Duration::from_secs(60 * 30)).await;
    let _ = stdout_task.await;
    finalize_profile(
      &run_id,
      &profile,
      browser_pid,
      exit,
      saw_error.load(std::sync::atomic::Ordering::Relaxed),
      &settings,
    )
    .await;
  } else {
    let exit = wait_with_timeout(&mut child, Duration::from_secs(60 * 30)).await;
    finalize_profile(&run_id, &profile, browser_pid, exit, false, &settings).await;
  }

  remove_pids(&run_id, &profile_id);
}

/// Exit outcome of the sidecar.
enum ExitOutcome {
  Code(i32),
  TimedOut,
  Killed,
}

async fn wait_with_timeout(child: &mut tokio::process::Child, dur: Duration) -> ExitOutcome {
  match tokio::time::timeout(dur, child.wait()).await {
    Ok(Ok(status)) => ExitOutcome::Code(status.code().unwrap_or(-1)),
    Ok(Err(_)) => ExitOutcome::Killed,
    Err(_) => {
      let _ = child.start_kill();
      ExitOutcome::TimedOut
    }
  }
}

async fn finalize_profile(
  run_id: &str,
  profile: &BrowserProfile,
  browser_pid: Option<u32>,
  exit: ExitOutcome,
  saw_error: bool,
  settings: &RunSettings,
) {
  let profile_id = profile.id.to_string();

  let status = match exit {
    ExitOutcome::Code(0) => {
      if saw_error {
        RunStatus::DoneWithErrors
      } else {
        RunStatus::Done
      }
    }
    ExitOutcome::Code(_) => RunStatus::Error,
    ExitOutcome::TimedOut => RunStatus::Error,
    ExitOutcome::Killed => RunStatus::Error,
  };

  // 4/5. Close the browser if requested — by PID (red-team #4), then release the
  // team lock after the kill (red-team #2). When close_on_complete=false we still
  // release the lock so a sync-enabled profile isn't stuck locked.
  if settings.close_on_complete {
    kill_and_release(profile, browser_pid).await;
  } else {
    crate::profile::team_lock::release_team_lock_if_needed(profile).await;
  }

  set_status(run_id, &profile_id, status, |s| {
    s.finished_at_ms = Some(now_ms());
    if status == RunStatus::Error && s.error.is_none() {
      s.error = Some(match exit {
        ExitOutcome::TimedOut => "sidecar timed out".into(),
        _ => "flow stopped on error".into(),
      });
    }
  });

  maybe_mark_run_finished(run_id);
}

/// Kill the browser by THIS automation launch's PID (red-team #4 — never by
/// profile-path, which could match a user's GUI instance) and release the team
/// lock afterward (red-team #2). Falls back to the path-based kill only when we
/// have no PID (best effort), since that is the only handle available.
async fn kill_and_release(profile: &BrowserProfile, browser_pid: Option<u32>) {
  if let Some(pid) = browser_pid {
    if let Err(e) = crate::automation::process_kill::kill_pid_tree(pid).await {
      log::warn!(
        "automation: kill pid {pid} failed: {e}; falling back to nothing (avoid path-kill)"
      );
    }
    // Mark stopped in the sync scheduler so it doesn't think the profile is live.
    if let Some(scheduler) = crate::sync::get_global_scheduler() {
      scheduler
        .mark_profile_stopped(&profile.id.to_string())
        .await;
    }
    // Clear the GUI advisory running flag for this profile.
    if let Ok(mut states) = ACTIVE_RUNNING_STATES.lock() {
      states.insert(profile.id.to_string(), false);
    }
  } else {
    log::warn!(
      "automation: no browser PID for profile {} — cannot kill safely by PID; leaving browser (avoids killing a user GUI instance by path)",
      profile.id
    );
  }
  // Always release the team lock (red-team #2).
  crate::profile::team_lock::release_team_lock_if_needed(profile).await;
}

/// Resolve the real CDP port from WayfernManager and verify /json/version.
async fn resolve_and_verify_port(profile: &BrowserProfile) -> Option<u16> {
  let profiles_dir = crate::settings::app_dirs::profiles_dir();
  let profile_path = profile.get_profile_data_path(&profiles_dir);
  let profile_path_str = profile_path.to_string_lossy().to_string();

  // Retry: the port may not be registered the instant launch returns.
  for attempt in 0..20 {
    let port = crate::browser::wayfern_manager::WayfernManager::instance()
      .get_cdp_port(&profile_path_str)
      .await;
    if let Some(p) = port {
      if verify_cdp_live(p).await {
        return Some(p);
      }
    }
    tokio::time::sleep(Duration::from_millis(250)).await;
    let _ = attempt;
  }
  None
}

async fn verify_cdp_live(port: u16) -> bool {
  let url = format!("http://127.0.0.1:{port}/json/version");
  match reqwest::Client::new()
    .get(&url)
    .timeout(Duration::from_secs(2))
    .send()
    .await
  {
    Ok(resp) => resp.status().is_success(),
    Err(_) => false,
  }
}

// ---- run-state mutation helpers -------------------------------------------

fn set_status(
  run_id: &str,
  profile_id: &str,
  status: RunStatus,
  mutate: impl FnOnce(&mut ProfileRunState),
) {
  let snapshot = {
    let mut runs = AUTOMATION_RUNNER.runs.lock().unwrap();
    let Some(run) = runs.get_mut(run_id) else {
      return;
    };
    let Some(p) = run.profiles.get_mut(profile_id) else {
      return;
    };
    p.status = status;
    mutate(p);
    p.clone()
  };
  emit_status(&snapshot);
}

fn is_cancelled(run_id: &str) -> bool {
  AUTOMATION_RUNNER
    .cancelled
    .lock()
    .map(|c| c.contains(run_id))
    .unwrap_or(false)
}

fn maybe_mark_run_finished(run_id: &str) {
  let mut runs = AUTOMATION_RUNNER.runs.lock().unwrap();
  if let Some(run) = runs.get_mut(run_id) {
    if run.all_terminal() && run.finished_at_ms.is_none() {
      run.finished_at_ms = Some(now_ms());
    }
  }
}

struct ReservationGuard(String);
impl Drop for ReservationGuard {
  fn drop(&mut self) {
    release_reservation(&self.0);
  }
}

/// Stop a run: cancel, kill every sidecar + browser by PID, release locks.
pub async fn stop_automation_run(
  app_handle: tauri::AppHandle,
  run_id: String,
) -> Result<(), String> {
  // Mark cancelled so any not-yet-launched tasks bail.
  if let Ok(mut c) = AUTOMATION_RUNNER.cancelled.lock() {
    c.insert(run_id.clone());
  }

  // Snapshot the profiles we need to kill.
  let profiles: Vec<ProfileRunState> = {
    let runs = AUTOMATION_RUNNER.runs.lock().unwrap();
    match runs.get(&run_id) {
      Some(run) => run.profiles.values().cloned().collect(),
      None => return Err(format!("unknown run: {run_id}")),
    }
  };

  for p in profiles {
    if p.status.is_terminal() {
      continue;
    }
    // Kill sidecar first, then browser, both by PID.
    if let Some(spid) = p.sidecar_pid {
      let _ = crate::automation::process_kill::kill_pid_tree(spid).await;
    }
    if let Some(bpid) = p.browser_pid {
      let _ = crate::automation::process_kill::kill_pid_tree(bpid).await;
    }
    // Release team lock for this profile (red-team #2). We need a BrowserProfile;
    // reload from disk by id so is_sync_enabled is accurate. Resolve the profile in
    // a synchronous scope so the non-Send `Box<dyn StdError>` from list_profiles() is
    // dropped before any await (keeps this future Send for tauri::command).
    let bp_opt = {
      crate::browser::browser_runner::BrowserRunner::instance()
        .profile_manager
        .list_profiles()
        .ok()
        .and_then(|profiles| {
          profiles
            .into_iter()
            .find(|x| x.id.to_string() == p.profile_id)
        })
    };
    if let Some(bp) = bp_opt {
      crate::profile::team_lock::release_team_lock_if_needed(&bp).await;
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        scheduler.mark_profile_stopped(&bp.id.to_string()).await;
      }
    }
    if let Ok(mut states) = ACTIVE_RUNNING_STATES.lock() {
      states.insert(p.profile_id.clone(), false);
    }
    remove_pids(&run_id, &p.profile_id);
    release_reservation(&p.profile_id);

    set_status(&run_id, &p.profile_id, RunStatus::Stopped, |s| {
      s.finished_at_ms = Some(now_ms());
    });
  }

  let _ = app_handle;
  maybe_mark_run_finished(&run_id);
  Ok(())
}
