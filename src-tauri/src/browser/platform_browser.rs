use crate::browser::{create_browser, BrowserType};
use crate::profile::BrowserProfile;
use std::path::Path;
use std::process::Command;

/// True if a process command line refers to `profile_path` as a real browser
/// profile/data-dir argument, NOT merely a substring. A bare `contains` match
/// force-killed unrelated processes that happened to mention the path (editors,
/// `tail`, a terminal that `cd`'d there, or another profile whose path has this
/// one as a prefix). Mirrors the precise matching in browser_runner/wayfern_manager.
///
/// Only the macOS and Linux process-kill paths use this; Windows has no
/// `find_processes_by_profile_path`, so gate it to avoid a dead-code error there.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn cmd_matches_profile_path(cmd: &[std::ffi::OsString], profile_path: &str) -> bool {
  let args: Vec<&str> = cmd.iter().filter_map(|a| a.to_str()).collect();
  for (i, arg) in args.iter().enumerate() {
    // Exact argument equality (Firefox/Camoufox: `-profile <path>`; some launchers
    // pass the path as its own arg).
    if *arg == profile_path {
      return true;
    }
    // `--user-data-dir=<path>` (Chromium/Wayfern) or `-profile=<path>`.
    if let Some(val) = arg
      .strip_prefix("--user-data-dir=")
      .or_else(|| arg.strip_prefix("-profile="))
    {
      if val == profile_path {
        return true;
      }
    }
    // Flag followed by the path as the next argument.
    if (*arg == "-profile" || *arg == "--user-data-dir")
      && args.get(i + 1).is_some_and(|next| *next == profile_path)
    {
      return true;
    }
  }
  false
}

// Platform-specific modules
#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub mod macos {
  use super::*;
  use sysinfo::{Pid, System};

  pub async fn launch_browser_process(
    executable_path: &std::path::Path,
    args: &[String],
  ) -> Result<std::process::Child, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Launching browser on macOS: {executable_path:?} with args: {args:?}");
    // If the executable is inside an app bundle, launch via Launch Services so
    // macOS recognizes the real application for privacy permissions (e.g. Screen Recording).
    // This ensures TCC prompts are attributed to the browser app, not our launcher.
    let mut current = Some(executable_path);
    let mut app_bundle: Option<std::path::PathBuf> = None;
    while let Some(path) = current {
      if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
        if file_name.ends_with(".app") {
          app_bundle = Some(path.to_path_buf());
          break;
        }
      }
      current = path.parent();
    }

    if let Some(app_path) = app_bundle {
      // Use `open -n -a <App>.app --args ...` to launch the app bundle.
      // Note: The returned child PID will belong to `open`, not the browser.
      // The caller should resolve the actual browser PID after launch.
      let mut cmd = Command::new("open");
      cmd.arg("-n");
      cmd.arg("-a");
      cmd.arg(app_path);
      cmd.arg("--args");
      for a in args {
        cmd.arg(a);
      }
      Ok(cmd.spawn()?)
    } else {
      // Fallback: direct spawn if this is not an app bundle
      Ok(Command::new(executable_path).args(args).spawn()?)
    }
  }

  pub async fn open_url_in_existing_browser_firefox_like(
    profile: &BrowserProfile,
    url: &str,
    browser_type: BrowserType,
    browser_dir: &Path,
    profiles_dir: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let pid = profile.process_id.unwrap();
    let profile_data_path = profile.get_profile_data_path(profiles_dir);

    // First try: Use Firefox remote command
    log::info!("Trying Firefox remote command for PID: {pid}");
    let browser = create_browser(browser_type);
    if let Ok(executable_path) = browser.get_executable_path(browser_dir) {
      let remote_args = vec![
        "-profile".to_string(),
        profile_data_path.to_string_lossy().to_string(),
        "-new-tab".to_string(),
        url.to_string(),
      ];

      let remote_output = Command::new(executable_path).args(&remote_args).output();

      match remote_output {
        Ok(output) if output.status.success() => {
          log::info!("Firefox remote command succeeded");
          return Ok(());
        }
        Ok(output) => {
          let stderr = String::from_utf8_lossy(&output.stderr);
          log::info!(
            "Firefox remote command failed with stderr: {stderr}, trying AppleScript fallback"
          );
        }
        Err(e) => {
          log::info!("Firefox remote command error: {e}, trying AppleScript fallback");
        }
      }
    }

    // The Firefox `-new-tab` remote command failed. We intentionally do NOT
    // fall back to an AppleScript `System Events` keystroke path: that would
    // send Apple Events to another application and trigger the macOS TCC
    // "<Donut> wants control of <Browser>" / "prevented from modifying other
    // apps" prompts. Donut must never touch other apps on the user's Mac.
    Err(
      format!(
        "Firefox remote command failed for PID {pid}; cannot open URL in existing window without touching other apps"
      )
      .into(),
    )
  }

  pub async fn kill_browser_process_impl(
    pid: u32,
    profile_data_path: Option<&str>,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Attempting to kill browser process with PID: {pid}");

    let mut pids_to_kill = vec![pid];

    let descendants = get_all_descendant_pids(pid).await;
    pids_to_kill.extend(descendants);

    if let Some(profile_path) = profile_data_path {
      let additional_pids = find_processes_by_profile_path(profile_path).await;
      for p in additional_pids {
        if !pids_to_kill.contains(&p) {
          log::info!("Found additional process {} using profile path", p);
          pids_to_kill.push(p);
        }
      }
    }

    log::info!("Total processes to kill: {:?}", pids_to_kill);

    for &p in &pids_to_kill {
      log::info!("Sending SIGKILL to PID: {p}");
      let _ = Command::new("kill")
        .args(["-KILL", &p.to_string()])
        .output();
    }

    let pid_str = pid.to_string();

    let _ = Command::new("pkill")
      .args(["-KILL", "-P", &pid_str])
      .output();

    let _ = Command::new("pkill")
      .args(["-KILL", "-g", &pid_str])
      .output();

    for &p in &pids_to_kill {
      let system = System::new_all();
      if system.process(Pid::from(p as usize)).is_some() {
        log::info!("Process {p} still running, retrying kill");
        let _ = Command::new("kill")
          .args(["-KILL", &p.to_string()])
          .output();
      }
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let system = System::new_all();
    let mut still_running = Vec::new();
    for &p in &pids_to_kill {
      if system.process(Pid::from(p as usize)).is_some() {
        still_running.push(p);
      }
    }

    if !still_running.is_empty() {
      log::info!(
        "Processes {:?} still running, trying final termination",
        still_running
      );

      for p in &still_running {
        let _ = Command::new("/bin/kill")
          .args(["-KILL", &p.to_string()])
          .output();
      }

      tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

      let system = System::new_all();
      let mut final_still_running = Vec::new();
      for &p in &pids_to_kill {
        if system.process(Pid::from(p as usize)).is_some() {
          final_still_running.push(p);
        }
      }

      if !final_still_running.is_empty() {
        log::error!(
          "ERROR: Processes {:?} could not be terminated despite aggressive attempts",
          final_still_running
        );
        return Err(
          format!(
            "Failed to terminate browser processes {:?} - still running",
            final_still_running
          )
          .into(),
        );
      }
    }

    log::info!("Browser termination completed for PID: {pid}");
    Ok(())
  }

  async fn find_processes_by_profile_path(profile_path: &str) -> Vec<u32> {
    use sysinfo::System;

    let mut pids = Vec::new();
    let system = System::new_all();

    for (pid, process) in system.processes() {
      let cmd = process.cmd();
      if cmd.is_empty() {
        continue;
      }

      if cmd_matches_profile_path(cmd, profile_path) {
        pids.push(pid.as_u32());
      }
    }

    pids
  }

  // Recursively find all descendant processes
  async fn get_all_descendant_pids(parent_pid: u32) -> Vec<u32> {
    use sysinfo::System;

    let system = System::new_all();
    let mut descendants = Vec::new();
    let mut to_check = vec![parent_pid];
    let mut checked = std::collections::HashSet::new();

    while let Some(current_pid) = to_check.pop() {
      if checked.contains(&current_pid) {
        continue;
      }
      checked.insert(current_pid);

      // Find direct children of current_pid
      for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();
        if let Some(parent) = process.parent() {
          if parent.as_u32() == current_pid && !checked.contains(&pid_u32) {
            descendants.push(pid_u32);
            to_check.push(pid_u32);
          }
        }
      }
    }

    descendants
  }

  pub async fn open_url_in_existing_browser_chromium(
    profile: &BrowserProfile,
    url: &str,
    browser_type: BrowserType,
    browser_dir: &Path,
    _profiles_dir: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let pid = profile.process_id.unwrap();

    // First, try using the browser's built-in URL opening capability
    log::info!("Trying Chromium URL opening for PID: {pid}");

    let browser = create_browser(browser_type);
    if let Ok(executable_path) = browser.get_executable_path(browser_dir) {
      let profile_data_path = profile.get_profile_data_path(_profiles_dir);
      let remote_output = Command::new(executable_path)
        .args([
          &format!("--user-data-dir={}", profile_data_path.to_string_lossy()),
          url,
        ])
        .output();

      match remote_output {
        Ok(output) if output.status.success() => {
          log::info!("Chromium URL opening succeeded");
          return Ok(());
        }
        Ok(output) => {
          let stderr = String::from_utf8_lossy(&output.stderr);
          log::info!("Chromium URL opening failed: {stderr}, trying AppleScript");
        }
        Err(e) => {
          log::info!("Chromium URL opening error: {e}, trying AppleScript");
        }
      }
    }

    // The Chromium `--user-data-dir=<path> <url>` remote command failed.
    // We intentionally do NOT fall back to an AppleScript `System Events`
    // keystroke path: that would send Apple Events to another application
    // and trigger the macOS TCC "<Donut> wants control of <Browser>" /
    // "prevented from modifying other apps" prompts. Donut must never touch
    // other apps on the user's Mac.
    Err(
      format!(
        "Chromium remote command failed for PID {pid}; cannot open URL in existing window without touching other apps"
      )
      .into(),
    )
  }
}

include!("platform_browser_windows.rs");
include!("platform_browser_linux.rs");
