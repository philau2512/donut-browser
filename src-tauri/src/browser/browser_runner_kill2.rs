impl BrowserRunner {
  async fn kill_wayfern_process_internal(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let profiles_dir = self.profile_manager.get_profiles_dir();
    let profile_data_path =
      crate::browser::ephemeral_dirs::get_effective_profile_path(profile, &profiles_dir);
    let profile_path_str = profile_data_path.to_string_lossy();

    log::info!(
      "Attempting to kill Wayfern process for profile: {} (ID: {})",
      profile.name,
      profile.id
    );

    // Stop the proxy associated with this profile first
    let profile_id_str = profile.id.to_string();
    if let Err(e) = PROXY_MANAGER
      .stop_proxy_by_profile_id(app_handle.clone(), &profile_id_str)
      .await
    {
      log::warn!(
        "Warning: Failed to stop proxy for profile {}: {e}",
        profile_id_str
      );
    }

    let mut process_actually_stopped = false;
    match self
      .wayfern_manager
      .find_wayfern_by_profile(&profile_path_str)
      .await
    {
      Some(wayfern_process) => {
        log::info!(
          "Found Wayfern process: {} (PID: {:?})",
          wayfern_process.id,
          wayfern_process.processId
        );

        match self.wayfern_manager.stop_wayfern(&wayfern_process.id).await {
          Ok(_) => {
            if let Some(pid) = wayfern_process.processId {
              // Verify the process actually died by checking after a short delay
              use tokio::time::{sleep, Duration};
              sleep(Duration::from_millis(500)).await;

              use sysinfo::{Pid, System};
              let system = System::new_all();
              process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();

              if process_actually_stopped {
                log::info!(
                  "Successfully stopped Wayfern process: {} (PID: {:?}) - verified process is dead",
                  wayfern_process.id,
                  pid
                );
                
                // Run after_close automation pipeline (non-blocking)
                if let Some(ref automation) = profile.automation {
                  if !automation.after_close.is_empty() {
                    let profile_id = profile.id.to_string();
                    let profile_name = profile.name.clone();
                    let after_close_nodes = automation.after_close.clone();
                    
                    tokio::spawn(async move {
                      log::info!(
                        "[AUTOMATION] Running after_close pipeline for profile {} ({})",
                        profile_name,
                        profile_id
                      );
                      
                      let mut context = ExecutionContext::new(profile_id.clone(), profile_name.clone());
                      
                      match AutomationEngine::run_pipeline(
                        "AFTER_CLOSE",
                        &after_close_nodes,
                        &mut context,
                        false, // Don't stop on failure for after_close
                      ).await {
                        Ok(()) => {
                          log::info!(
                            "[AUTOMATION] after_close pipeline completed for profile {}",
                            profile_name
                          );
                        }
                        Err(e) => {
                          log::error!(
                            "[AUTOMATION] after_close pipeline failed for profile {}: {}",
                            profile_name,
                            e
                          );
                        }
                      }
                    });
                  }
                }
              } else {
                log::warn!(
                  "Wayfern stop command returned success but process {} (PID: {:?}) is still running - forcing kill",
                  wayfern_process.id,
                  pid
                );
                // Force kill the process
                #[cfg(target_os = "macos")]
                {
                  use crate::browser::platform_browser;
                  if let Err(e) = platform_browser::macos::kill_browser_process_impl(
                    pid,
                    Some(&profile_path_str),
                  )
                  .await
                  {
                    log::error!("Failed to force kill Wayfern process {}: {}", pid, e);
                  } else {
                    sleep(Duration::from_millis(500)).await;
                    let system = System::new_all();
                    process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                    if process_actually_stopped {
                      log::info!(
                        "Successfully force killed Wayfern process {} (PID: {:?})",
                        wayfern_process.id,
                        pid
                      );
                    }
                  }
                }
                #[cfg(target_os = "linux")]
                {
                  use crate::browser::platform_browser;
                  if let Err(e) = platform_browser::linux::kill_browser_process_impl(
                    pid,
                    Some(&profile_path_str),
                  )
                  .await
                  {
                    log::error!("Failed to force kill Wayfern process {}: {}", pid, e);
                  } else {
                    sleep(Duration::from_millis(500)).await;
                    let system = System::new_all();
                    process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                    if process_actually_stopped {
                      log::info!(
                        "Successfully force killed Wayfern process {} (PID: {:?})",
                        wayfern_process.id,
                        pid
                      );
                    }
                  }
                }
                #[cfg(target_os = "windows")]
                {
                  use crate::browser::platform_browser;
                  if let Err(e) = platform_browser::windows::kill_browser_process_impl(pid).await
                  {
                    log::error!("Failed to force kill Wayfern process {}: {}", pid, e);
                  } else {
                    sleep(Duration::from_millis(500)).await;
                    let system = System::new_all();
                    process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                    if process_actually_stopped {
                      log::info!(
                        "Successfully force killed Wayfern process {} (PID: {:?})",
                        wayfern_process.id,
                        pid
                      );
                    }
                  }
                }
              }
            } else {
              process_actually_stopped = true;
            }
          }
          Err(e) => {
            log::error!(
              "Error stopping Wayfern process {}: {}",
              wayfern_process.id,
              e
            );
            // Try to force kill if we have a PID
            if let Some(pid) = wayfern_process.processId {
              log::info!(
                "Attempting force kill after stop_wayfern error for PID: {}",
                pid
              );
              #[cfg(target_os = "macos")]
              {
                use crate::browser::platform_browser;
                if let Err(kill_err) =
                  platform_browser::macos::kill_browser_process_impl(pid, Some(&profile_path_str))
                    .await
                {
                  log::error!("Failed to force kill Wayfern process {}: {}", pid, kill_err);
                } else {
                  use tokio::time::{sleep, Duration};
                  sleep(Duration::from_millis(500)).await;
                  use sysinfo::{Pid, System};
                  let system = System::new_all();
                  process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                }
              }
              #[cfg(target_os = "linux")]
              {
                use crate::browser::platform_browser;
                if let Err(kill_err) =
                  platform_browser::linux::kill_browser_process_impl(pid, Some(&profile_path_str))
                    .await
                {
                  log::error!("Failed to force kill Wayfern process {}: {}", pid, kill_err);
                } else {
                  use tokio::time::{sleep, Duration};
                  sleep(Duration::from_millis(500)).await;
                  use sysinfo::{Pid, System};
                  let system = System::new_all();
                  process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                }
              }
              #[cfg(target_os = "windows")]
              {
                use crate::browser::platform_browser;
                if let Err(kill_err) =
                  platform_browser::windows::kill_browser_process_impl(pid).await
                {
                  log::error!("Failed to force kill Wayfern process {}: {}", pid, kill_err);
                } else {
                  use tokio::time::{sleep, Duration};
                  sleep(Duration::from_millis(500)).await;
                  use sysinfo::{Pid, System};
                  let system = System::new_all();
                  process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                }
              }
            }
          }
        }
      }
      None => {
        log::info!(
          "No running Wayfern process found for profile: {} (ID: {})",
          profile.name,
          profile.id
        );
        process_actually_stopped = true;
      }
    }

    // If process wasn't confirmed stopped, return an error
    if !process_actually_stopped {
      log::error!(
        "Failed to stop Wayfern process for profile: {} (ID: {}) - process may still be running",
        profile.name,
        profile.id
      );
      return Err(
        format!(
          "Failed to stop Wayfern process for profile {} - process may still be running",
          profile.name
        )
        .into(),
      );
    }

    // Clear the process ID from the profile and save immediately so that
    // subsequent calls to update_profile_version (which re-reads from disk)
    // see the cleared process_id.
    let mut updated_profile = profile.clone();
    updated_profile.process_id = None;
    self
      .save_process_info(&updated_profile)
      .map_err(|e| format!("Failed to update profile: {e}"))?;

    // Check for pending updates and apply them
    if let Ok(Some(pending_update)) = self
      .auto_updater
      .get_pending_update(&profile.browser, &profile.version)
    {
      log::info!(
        "Found pending update for Wayfern profile {}: {} -> {}",
        profile.name,
        profile.version,
        pending_update.new_version
      );

      match self.profile_manager.update_profile_version(
        &app_handle,
        &profile.id.to_string(),
        &pending_update.new_version,
      ) {
        Ok(updated_profile_after_update) => {
          log::info!(
            "Successfully updated Wayfern profile {} from version {} to {}",
            profile.name,
            profile.version,
            pending_update.new_version
          );
          updated_profile = updated_profile_after_update;

          if let Err(e) = self
            .auto_updater
            .dismiss_update_notification(&pending_update.id)
          {
            log::warn!("Warning: Failed to dismiss pending update notification: {e}");
          }
        }
        Err(e) => {
          log::error!(
            "Failed to apply pending update for Wayfern profile {}: {}",
            profile.name,
            e
          );
        }
      }
    }

    // If no pending update was applied, check if a newer installed version exists
    if updated_profile.version == profile.version {
      if let Some(p) = self
        .auto_updater
        .update_profile_to_latest_installed(&app_handle, &updated_profile)
      {
        updated_profile = p;
      }
    }

    log::info!(
      "Emitting profile events for successful Wayfern kill: {}",
      updated_profile.name
    );

    // Emit profile update event to frontend
    if let Err(e) = events::emit("profile-updated", &updated_profile) {
      log::warn!("Warning: Failed to emit profile update event: {e}");
    }

    // Emit minimal running changed event
    #[derive(Serialize)]
    struct RunningChangedPayload {
      id: String,
      is_running: bool,
    }
    let payload = RunningChangedPayload {
      id: updated_profile.id.to_string(),
      is_running: false,
    };

    if let Err(e) = events::emit("profile-running-changed", &payload) {
      log::warn!("Warning: Failed to emit profile running changed event: {e}");
    } else {
      log::info!(
        "Successfully emitted profile-running-changed event for Wayfern {}: running={}",
        updated_profile.name,
        payload.is_running
      );
    }

    if profile.password_protected {
      // Await the re-encryption so the queued sync (released later by
      // `mark_profile_stopped` in `kill_browser`) sees fresh ciphertext on
      // disk instead of the previous snapshot.
      crate::profile::password::complete_after_quit_and_wait(profile).await;
    } else if profile.ephemeral {
      crate::browser::ephemeral_dirs::remove_ephemeral_dir(&profile.id.to_string());
    }

    log::info!(
      "Wayfern process cleanup completed for profile: {} (ID: {})",
      profile.name,
      profile.id
    );

    // Consolidate browser versions after stopping a browser
    if let Ok(consolidated) = self
      .downloaded_browsers_registry
      .consolidate_browser_versions(&app_handle)
    {
      if !consolidated.is_empty() {
        log::info!("Post-stop version consolidation results:");
        for action in &consolidated {
          log::info!("  {action}");
        }
      }
    }

    Ok(())
  }

  async fn kill_legacy_browser_process(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // For non-camoufox/wayfern browsers, use the existing logic
    let pid = if let Some(pid) = profile.process_id {
      // First verify the stored PID is still valid and belongs to our profile
      let system = System::new_all();
      if let Some(process) = system.process(sysinfo::Pid::from(pid as usize)) {
        let cmd = process.cmd();
        let exe_name = process.name().to_string_lossy();

        // Verify this process is actually our browser
        let is_correct_browser = match profile.browser.as_str() {
          "firefox" => {
            exe_name.contains("firefox")
              && !exe_name.contains("developer")
              && !exe_name.contains("camoufox")
          }
          "firefox-developer" => {
            // More flexible detection for Firefox Developer Edition
            (exe_name.contains("firefox") && exe_name.contains("developer"))
              || (exe_name.contains("firefox")
                && cmd.iter().any(|arg| {
                  let arg_str = arg.to_str().unwrap_or("");
                  arg_str.contains("Developer")
                    || arg_str.contains("developer")
                    || arg_str.contains("FirefoxDeveloperEdition")
                    || arg_str.contains("firefox-developer")
                }))
              || exe_name == "firefox" // Firefox Developer might just show as "firefox"
          }
          "zen" => exe_name.contains("zen"),
          "chromium" => exe_name.contains("chromium") || exe_name.contains("chrome"),
          "brave" => exe_name.contains("brave") || exe_name.contains("Brave"),
          _ => false,
        };

        if is_correct_browser {
          // Verify profile path match
          let profiles_dir = self.profile_manager.get_profiles_dir();
          let profile_data_path = profile.get_profile_data_path(&profiles_dir);
          let profile_data_path_str = profile_data_path.to_string_lossy();

          let profile_path_match = if matches!(
            profile.browser.as_str(),
            "firefox" | "firefox-developer" | "zen"
          ) {
            // Firefox-based browsers: look for -profile argument followed by path
            let mut found_profile_arg = false;
            for (i, arg) in cmd.iter().enumerate() {
              if let Some(arg_str) = arg.to_str() {
                if arg_str == "-profile" && i + 1 < cmd.len() {
                  if let Some(next_arg) = cmd.get(i + 1).and_then(|a| a.to_str()) {
                    if next_arg == profile_data_path_str {
                      found_profile_arg = true;
                      break;
                    }
                  }
                }
                // Also check for combined -profile=path format
                if arg_str == format!("-profile={profile_data_path_str}") {
                  found_profile_arg = true;
                  break;
                }
                // Check if the argument is the profile path directly
                if arg_str == profile_data_path_str {
                  found_profile_arg = true;
                  break;
                }
              }
            }
            found_profile_arg
          } else {
            // Chromium-based browsers: look for --user-data-dir argument
            cmd.iter().any(|s| {
              if let Some(arg) = s.to_str() {
                arg == format!("--user-data-dir={profile_data_path_str}")
                  || arg == profile_data_path_str
              } else {
                false
              }
            })
          };

          if profile_path_match {
            log::info!(
              "Verified stored PID {} is valid for profile {} (ID: {})",
              pid,
              profile.name,
              profile.id
            );
            pid
          } else {
            log::info!("Stored PID {} doesn't match profile path for {} (ID: {}), searching for correct process", pid, profile.name, profile.id);
            // Fall through to search for correct process
            self.find_browser_process_by_profile(profile)?
          }
        } else {
          log::info!("Stored PID {} doesn't match browser type for {} (ID: {}), searching for correct process", pid, profile.name, profile.id);
          // Fall through to search for correct process
          self.find_browser_process_by_profile(profile)?
        }
      } else {
        log::info!(
          "Stored PID {} is no longer valid for profile {} (ID: {}), searching for correct process",
          pid,
          profile.name,
          profile.id
        );
        // Fall through to search for correct process
        self.find_browser_process_by_profile(profile)?
      }
    } else {
      // No stored PID, search for the process
      self.find_browser_process_by_profile(profile)?
    };

    log::info!("Attempting to kill browser process with PID: {pid}");

    // Stop any associated proxy first
    if let Err(e) = PROXY_MANAGER.stop_proxy(app_handle.clone(), pid).await {
      log::warn!("Warning: Failed to stop proxy for PID {pid}: {e}");
    }

    #[cfg(target_os = "macos")]
    {
      let profiles_dir = self.profile_manager.get_profiles_dir();
      let profile_data_path = profile.get_profile_data_path(&profiles_dir);
      let profile_path_str = profile_data_path.to_string_lossy().to_string();
      platform_browser::macos::kill_browser_process_impl(pid, Some(&profile_path_str)).await?;
    }

    #[cfg(target_os = "windows")]
    platform_browser::windows::kill_browser_process_impl(pid).await?;

    #[cfg(target_os = "linux")]
    {
      let profiles_dir = self.profile_manager.get_profiles_dir();
      let profile_data_path = profile.get_profile_data_path(&profiles_dir);
      let profile_path_str = profile_data_path.to_string_lossy().to_string();
      platform_browser::linux::kill_browser_process_impl(pid, Some(&profile_path_str)).await?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("Unsupported platform".into());

    let system = System::new_all();
    if system.process(sysinfo::Pid::from(pid as usize)).is_some() {
      log::error!(
        "Browser process {} is still running after kill attempt for profile: {} (ID: {})",
        pid,
        profile.name,
        profile.id
      );
      return Err(
        format!(
          "Browser process {} is still running after kill attempt",
          pid
        )
        .into(),
      );
    }

    log::info!(
      "Verified browser process {} is terminated for profile: {} (ID: {})",
      pid,
      profile.name,
      profile.id
    );

    // Clear the process ID from the profile and save immediately so that
    // subsequent calls to update_profile_version (which re-reads from disk)
    // see the cleared process_id.
    let mut updated_profile = profile.clone();
    updated_profile.process_id = None;
    self
      .save_process_info(&updated_profile)
      .map_err(|e| format!("Failed to update profile: {e}"))?;

    // Check for pending updates and apply them
    if let Ok(Some(pending_update)) = self
      .auto_updater
      .get_pending_update(&profile.browser, &profile.version)
    {
      log::info!(
        "Found pending update for profile {}: {} -> {}",
        profile.name,
        profile.version,
        pending_update.new_version
      );

      match self.profile_manager.update_profile_version(
        &app_handle,
        &profile.id.to_string(),
        &pending_update.new_version,
      ) {
        Ok(updated_profile_after_update) => {
          log::info!(
            "Successfully updated profile {} from version {} to {}",
            profile.name,
            profile.version,
            pending_update.new_version
          );
          updated_profile = updated_profile_after_update;

          if let Err(e) = self
            .auto_updater
            .dismiss_update_notification(&pending_update.id)
          {
            log::warn!("Warning: Failed to dismiss pending update notification: {e}");
          }
        }
        Err(e) => {
          log::error!(
            "Failed to apply pending update for profile {}: {}",
            profile.name,
            e
          );
        }
      }
    }

    // If no pending update was applied, check if a newer installed version exists
    if updated_profile.version == profile.version {
      if let Some(p) = self
        .auto_updater
        .update_profile_to_latest_installed(&app_handle, &updated_profile)
      {
        updated_profile = p;
      }
    }

    log::info!(
      "Emitting profile events for successful kill: {}",
      updated_profile.name
    );

    // Emit profile update event to frontend
    if let Err(e) = events::emit("profile-updated", &updated_profile) {
      log::warn!("Warning: Failed to emit profile update event: {e}");
    }

    // Emit minimal running changed event to frontend immediately
    #[derive(Serialize)]
    struct RunningChangedPayload {
      id: String,
      is_running: bool,
    }
    let payload = RunningChangedPayload {
      id: updated_profile.id.to_string(),
      is_running: false, // Explicitly set to false since we just killed it
    };

    if let Err(e) = events::emit("profile-running-changed", &payload) {
      log::warn!("Warning: Failed to emit profile running changed event: {e}");
    } else {
      log::info!(
        "Successfully emitted profile-running-changed event for {}: running={}",
        updated_profile.name,
        payload.is_running
      );
    }

    // Consolidate browser versions after stopping a browser
    if let Ok(consolidated) = self
      .downloaded_browsers_registry
      .consolidate_browser_versions(&app_handle)
    {
      if !consolidated.is_empty() {
        log::info!("Post-stop version consolidation results:");
        for action in &consolidated {
          log::info!("  {action}");
        }
      }
    }

    Ok(())
  }
}
