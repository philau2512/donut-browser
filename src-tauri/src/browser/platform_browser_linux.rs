#[cfg(target_os = "linux")]
#[allow(dead_code)]
pub mod linux {
  use super::*;

  pub async fn launch_browser_process(
    executable_path: &std::path::Path,
    args: &[String],
  ) -> Result<std::process::Child, Box<dyn std::error::Error + Send + Sync>> {
    log::info!(
      "Launching browser on Linux: {:?} with args: {:?}",
      executable_path,
      args
    );

    // Check if the executable exists and is executable
    if !executable_path.exists() {
      return Err(format!("Browser executable not found: {:?}", executable_path).into());
    }

    // Check if we can read the executable to detect architecture issues early
    if let Err(e) = std::fs::File::open(executable_path) {
      return Err(format!("Cannot access browser executable: {}", e).into());
    }

    // Ensure the executable has proper permissions
    if let Err(e) = std::fs::metadata(executable_path) {
      return Err(format!("Cannot get executable metadata: {}", e).into());
    }

    // On Linux, we might need to set LD_LIBRARY_PATH for some browsers
    let mut cmd = Command::new(executable_path);
    cmd.args(args);

    // For Firefox-based browsers, ensure library path includes the installation directory
    if let Some(install_dir) = executable_path.parent() {
      let mut ld_library_path = Vec::new();

      // Add multiple potential library directories
      let lib_dirs = [
        install_dir.join("lib"),
        install_dir.join("../lib"),    // Parent directory lib
        install_dir.join("../../lib"), // Grandparent directory lib
        install_dir.to_path_buf(),     // Installation directory itself
      ];

      for lib_dir in &lib_dirs {
        if lib_dir.exists() {
          ld_library_path.push(lib_dir.to_string_lossy().to_string());
        }
      }

      // For Firefox specifically, add common system library paths that might be needed
      let firefox_lib_paths = [
        "/usr/lib/firefox",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu",
        "/lib/x86_64-linux-gnu",
        "/lib/aarch64-linux-gnu",
      ];

      for lib_path in &firefox_lib_paths {
        let path = std::path::Path::new(lib_path);
        if path.exists() {
          ld_library_path.push(lib_path.to_string());
        }
      }

      // Preserve existing LD_LIBRARY_PATH
      if let Ok(existing_path) = std::env::var("LD_LIBRARY_PATH") {
        ld_library_path.push(existing_path);
      }

      // Set the combined LD_LIBRARY_PATH
      if !ld_library_path.is_empty() {
        cmd.env("LD_LIBRARY_PATH", ld_library_path.join(":"));
        log::info!("Set LD_LIBRARY_PATH to: {}", ld_library_path.join(":"));
      }
    }

    // Propagate DISPLAY only when this session actually has an X11 display.
    // Forcing DISPLAY=:0 breaks Wayland-only sessions (there is no X server on
    // :0, so any X11 client launched with it set will fail to connect). When
    // DISPLAY is set the child already inherits it from our environment, so
    // setting it explicitly here is purely defensive; when it's unset we leave
    // it unset and let the browser use Wayland.
    if let Ok(display) = std::env::var("DISPLAY") {
      cmd.env("DISPLAY", display);
    }

    // Set MOZ_ENABLE_WAYLAND for better Wayland support
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
      cmd.env("MOZ_ENABLE_WAYLAND", "1");
    }

    // Warn only when running truly headless — i.e. NEITHER X11 nor Wayland is
    // available. Using OR here would fire on every normal Wayland-only session
    // (DISPLAY unset) or X11-only session (WAYLAND_DISPLAY unset).
    if std::env::var("DISPLAY").is_err() && std::env::var("WAYLAND_DISPLAY").is_err() {
      log::info!("No display detected, browser may fail to start");
    }

    // Attempt to spawn with better error handling for architecture issues
    match cmd.spawn() {
      Ok(child) => Ok(child),
      Err(e) => {
        // Detect architecture mismatch errors
        if e.kind() == std::io::ErrorKind::Other {
          let error_msg = e.to_string();
          if error_msg.contains("Exec format error") {
            return Err(format!(
              "Architecture mismatch: The browser executable is not compatible with your system architecture ({}). \
              This typically happens when trying to run x86_64 binaries on ARM64 systems. \
              Please use a browser that supports your architecture, such as Zen Browser or Brave. \
              Executable: {:?}",
              std::env::consts::ARCH,
              executable_path
            ).into());
          } else if error_msg.contains("No such file or directory") {
            return Err(format!(
              "Executable or required library not found. This might be due to missing dependencies or incorrect executable path. \
              Try installing missing libraries or verify the browser installation. \
              Executable: {:?}, Error: {}",
              executable_path, error_msg
            ).into());
          }
        }
        Err(format!("Failed to launch browser: {}", e).into())
      }
    }
  }

  pub async fn open_url_in_existing_browser_firefox_like(
    profile: &BrowserProfile,
    url: &str,
    browser_type: BrowserType,
    browser_dir: &Path,
    profiles_dir: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let browser = create_browser(browser_type);
    let executable_path = browser
      .get_executable_path(browser_dir)
      .map_err(|e| format!("Failed to get executable path: {}", e))?;

    let profile_data_path = profile.get_profile_data_path(profiles_dir);
    let output = Command::new(executable_path)
      .args([
        "-profile",
        &profile_data_path.to_string_lossy(),
        "-new-tab",
        url,
      ])
      .output()?;

    if !output.status.success() {
      return Err(
        format!(
          "Failed to open URL in existing browser: {}",
          String::from_utf8_lossy(&output.stderr)
        )
        .into(),
      );
    }

    Ok(())
  }

  pub async fn open_url_in_existing_browser_chromium(
    profile: &BrowserProfile,
    url: &str,
    browser_type: BrowserType,
    browser_dir: &Path,
    profiles_dir: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let browser = create_browser(browser_type);
    let executable_path = browser
      .get_executable_path(browser_dir)
      .map_err(|e| format!("Failed to get executable path: {}", e))?;

    let profile_data_path = profile.get_profile_data_path(profiles_dir);
    let output = Command::new(executable_path)
      .args([
        &format!("--user-data-dir={}", profile_data_path.to_string_lossy()),
        url,
      ])
      .output()?;

    if !output.status.success() {
      return Err(
        format!(
          "Failed to open URL in existing Chromium-based browser: {}",
          String::from_utf8_lossy(&output.stderr)
        )
        .into(),
      );
    }

    Ok(())
  }

  pub async fn kill_browser_process_impl(
    pid: u32,
    profile_data_path: Option<&str>,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

    log::info!("Attempting to kill browser process with PID: {pid}");

    let mut pids_to_kill = vec![pid];

    // Find all descendant processes
    let descendants = get_all_descendant_pids(pid);
    pids_to_kill.extend(descendants);

    // Find additional processes using the same profile path
    if let Some(profile_path) = profile_data_path {
      let additional_pids = find_processes_by_profile_path(profile_path);
      for p in additional_pids {
        if !pids_to_kill.contains(&p) {
          log::info!("Found additional process {} using profile path", p);
          pids_to_kill.push(p);
        }
      }
    }

    log::info!("Total processes to kill: {:?}", pids_to_kill);

    // Send SIGKILL to all identified processes
    for &p in &pids_to_kill {
      log::info!("Sending SIGKILL to PID: {p}");
      let _ = Command::new("kill")
        .args(["-KILL", &p.to_string()])
        .output();
    }

    // Also kill by process group and parent PID
    let pid_str = pid.to_string();
    let _ = Command::new("pkill")
      .args(["-KILL", "-P", &pid_str])
      .output();

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Verify processes are dead
    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
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
        let _ = Command::new("kill")
          .args(["-KILL", &p.to_string()])
          .output();
      }

      tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

      let system = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
      );
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

  fn find_processes_by_profile_path(profile_path: &str) -> Vec<u32> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let mut pids = Vec::new();
    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );

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

  fn get_all_descendant_pids(parent_pid: u32) -> Vec<u32> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
    let mut descendants = Vec::new();
    let mut to_check = vec![parent_pid];
    let mut checked = std::collections::HashSet::new();

    while let Some(current_pid) = to_check.pop() {
      if checked.contains(&current_pid) {
        continue;
      }
      checked.insert(current_pid);

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
}
