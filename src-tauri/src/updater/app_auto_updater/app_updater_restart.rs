use super::app_updater_types::{AppAutoUpdater, PENDING_INSTALLER_PATH};
use std::fs;
use std::process::Command;

impl AppAutoUpdater {
  #[cfg(any(target_os = "windows", test))]
  async fn prepare_windows_installer(
    &self,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let profiles = match crate::profile::manager::ProfileManager::instance().list_profiles() {
      Ok(profiles) => profiles,
      Err(error) => {
        log::error!("Failed to inspect running profiles before app update: {error}");
        return Err(crate::backend_error("UPDATE_PREPARATION_FAILED").into());
      }
    };

    if profiles.into_iter().any(|profile| {
      profile
        .process_id
        .is_some_and(|pid| pid != 0 && crate::proxy::proxy_storage::is_process_running(pid))
    }) {
      return Err(crate::backend_error("UPDATE_PROFILES_RUNNING").into());
    }

    let proxy_configs = crate::proxy::proxy_storage::list_proxy_configs();
    let vpn_configs = crate::vpn::vpn_worker_storage::list_vpn_worker_configs();
    let mut worker_pids: Vec<u32> = proxy_configs
      .iter()
      .filter_map(|config| config.pid)
      .chain(vpn_configs.iter().filter_map(|config| config.pid))
      .collect();
    worker_pids.sort_unstable();
    worker_pids.dedup();

    let proxy_ids = proxy_configs
      .into_iter()
      .map(|config| config.id)
      .collect::<Vec<_>>();
    let vpn_ids = vpn_configs
      .into_iter()
      .map(|config| config.id)
      .collect::<Vec<_>>();
    for id in proxy_ids {
      if let Err(error) = crate::proxy::proxy_runner::stop_proxy_process(&id).await {
        log::warn!("Failed to stop a proxy worker before app update: {error}");
      }
    }
    for id in vpn_ids {
      if let Err(error) = crate::vpn::vpn_worker_runner::stop_vpn_worker(&id).await {
        log::warn!("Failed to stop a VPN worker before app update: {error}");
      }
    }

    for _ in 0..20 {
      if worker_pids
        .iter()
        .all(|pid| !crate::proxy::proxy_storage::is_process_running(*pid))
      {
        return Ok(());
      }
      tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    log::error!("App update aborted because network workers are still running: {worker_pids:?}");
    Err(crate::backend_error("UPDATE_PREPARATION_FAILED").into())
  }

  pub(crate) async fn restart_application(
    &self,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(target_os = "macos")]
    {
      let app_path = self.get_current_app_path()?;
      let current_pid = std::process::id();

      // Create a temporary restart script
      let temp_dir = std::env::temp_dir();
      let script_path = temp_dir.join("donut_restart.sh");

      // Create the restart script content
      let script_content = format!(
        r#"#!/bin/sh
# Wait for the current process to exit
while kill -0 {} 2>/dev/null; do
  sleep 0.5
done

# Wait a bit more to ensure clean exit
sleep 1

# Start the new application
open "{}"

# Clean up this script
rm "{}"
"#,
        current_pid,
        app_path.to_str().unwrap(),
        script_path.to_str().unwrap()
      );

      // Write the script to file
      fs::write(&script_path, script_content)?;

      // Make the script executable
      let _ = Command::new("chmod")
        .args(["+x", script_path.to_str().unwrap()])
        .output();

      // Execute the restart script in the background
      let mut cmd = Command::new("sh");
      cmd.arg(script_path.to_str().unwrap());

      // Detach the process completely
      use std::os::unix::process::CommandExt;
      cmd.process_group(0);

      let _child = cmd.spawn()?;

      // Give the script a moment to start
      tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

      // Exit the current process
      std::process::exit(0);
    }

    #[cfg(target_os = "windows")]
    {
      use std::ffi::OsStr;
      use std::os::windows::ffi::OsStrExt;

      let pending = PENDING_INSTALLER_PATH.lock().unwrap().take();

      if let Some(installer_path) = pending {
        if let Err(error) = self.prepare_windows_installer().await {
          *PENDING_INSTALLER_PATH.lock().unwrap() = Some(installer_path);
          return Err(error);
        }

        // Use ShellExecuteW to run the installer directly — no batch script,
        // no cmd.exe console window. The NSIS/MSI installer handles killing the
        // old process and restarting the app natively (via /UPDATE and
        // AUTOLAUNCHAPP flags).
        let ext = installer_path
          .extension()
          .and_then(|e| e.to_str())
          .unwrap_or("")
          .to_lowercase();

        let (file, parameters) = match ext.as_str() {
          "exe" => {
            // NSIS installer: /S for silent, /UPDATE tells it this is an update
            let file = installer_path.as_os_str().to_os_string();
            let params = std::ffi::OsString::from("/S /UPDATE");
            (file, params)
          }
          "msi" => {
            // MSI: run msiexec.exe with the package
            let msiexec = std::env::var("SYSTEMROOT")
              .map(|p| format!("{p}\\System32\\msiexec.exe"))
              .unwrap_or_else(|_| "msiexec.exe".to_string());
            let file = std::ffi::OsString::from(msiexec);
            let params = std::ffi::OsString::from(format!(
              "/i {} /quiet /norestart /promptrestart AUTOLAUNCHAPP=True",
              installer_path
                .to_str()
                .map(|p| format!("\"{p}\""))
                .unwrap_or_default()
            ));
            (file, params)
          }
          _ => {
            return Err("Unsupported Windows installer format for restart".into());
          }
        };

        fn encode_wide(s: impl AsRef<OsStr>) -> Vec<u16> {
          s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
        }

        let file_w = encode_wide(&file);
        let params_w = encode_wide(&parameters);

        log::info!(
          "Running installer via ShellExecuteW: {:?} {:?}",
          file,
          parameters
        );

        // windows-sys is not a direct dep, so use the raw FFI via the
        // windows crate that Tauri pulls in. ShellExecuteW returns an
        // HINSTANCE > 32 on success.
        #[link(name = "shell32")]
        extern "system" {
          fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_cmd: i32,
          ) -> isize;
        }
        const SW_SHOWNORMAL: i32 = 1;
        let open: Vec<u16> = "open\0".encode_utf16().collect();

        let result = unsafe {
          ShellExecuteW(
            std::ptr::null_mut(),
            open.as_ptr(),
            file_w.as_ptr(),
            params_w.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
          )
        };

        if result as usize <= 32 {
          return Err(format!("ShellExecuteW failed with code {result}").into());
        }
      } else {
        // No pending installer — just restart the app. Use a minimal
        // detached process to relaunch after we exit.
        let app_path = self.get_current_app_path()?;
        let current_pid = std::process::id();
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("donut_restart.bat");

        let script_content = format!(
          "@echo off\n\
           :w\n\
           tasklist /fi \"PID eq {current_pid}\" 2>nul | find \"{current_pid}\" >nul && (timeout /t 1 /nobreak >nul & goto w)\n\
           timeout /t 1 /nobreak >nul\n\
           start \"\" \"{app}\"\n\
           del \"%~f0\"\n",
          app = app_path.to_str().unwrap(),
        );
        fs::write(&script_path, script_content)?;

        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _child = Command::new("cmd")
          .args(["/C", script_path.to_str().unwrap()])
          .creation_flags(CREATE_NO_WINDOW)
          .spawn()?;
      }

      tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
      std::process::exit(0);
    }

    #[cfg(target_os = "linux")]
    {
      let app_path = self.get_current_app_path()?;
      let current_pid = std::process::id();

      // Create a temporary restart script
      let temp_dir = std::env::temp_dir();
      let script_path = temp_dir.join("donut_restart.sh");

      // Create the restart script content
      let script_content = format!(
        r#"#!/bin/sh
# Wait for the current process to exit
while kill -0 {} 2>/dev/null; do
  sleep 0.5
done

# Wait a bit more to ensure clean exit
sleep 1

# Start the new application
"{}" &

# Clean up this script
rm "{}"
"#,
        current_pid,
        app_path.to_str().unwrap(),
        script_path.to_str().unwrap()
      );

      // Write the script to file
      fs::write(&script_path, script_content)?;

      // Make the script executable
      let _ = Command::new("chmod")
        .args(["+x", script_path.to_str().unwrap()])
        .output();

      // Execute the restart script in the background
      let mut cmd = Command::new("sh");
      cmd.arg(script_path.to_str().unwrap());

      // Detach the process completely
      use std::os::unix::process::CommandExt;
      cmd.process_group(0);

      let _child = cmd.spawn()?;

      // Give the script a moment to start
      tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

      // Exit the current process
      std::process::exit(0);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
      Err("Application restart not supported on this platform".into())
    }
  }
}
