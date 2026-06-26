impl BrowserRunner {
  pub async fn kill_browser_process(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if profile.browser == "camoufox" {
      return self.kill_camoufox_process_internal(app_handle, profile).await;
    }
    if profile.browser == "wayfern" {
      return self.kill_wayfern_process_internal(app_handle, profile).await;
    }
    self.kill_legacy_browser_process(app_handle, profile).await
  }

  async fn kill_camoufox_process_internal(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Search by profile path to find the running Camoufox instance
    let profiles_dir = self.profile_manager.get_profiles_dir();
    let profile_data_path =
      crate::browser::ephemeral_dirs::get_effective_profile_path(profile, &profiles_dir);
    let profile_path_str = profile_data_path.to_string_lossy();

    log::info!(
      "Attempting to kill Camoufox process for profile: {} (ID: {})",
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
      .camoufox_manager
      .find_camoufox_by_profile(&profile_path_str)
      .await
    {
      Ok(Some(camoufox_process)) => {
        log::info!(
          "Found Camoufox process: {} (PID: {:?})",
          camoufox_process.id,
          camoufox_process.processId
        );

        match self
          .camoufox_manager
          .stop_camoufox(&app_handle, &camoufox_process.id)
          .await
        {
          Ok(stopped) => {
            if let Some(pid) = camoufox_process.processId {
              if stopped {
                // Verify the process actually died by checking after a short delay
                use tokio::time::{sleep, Duration};
                sleep(Duration::from_millis(500)).await;

                use sysinfo::{Pid, System};
                let system = System::new_all();
                process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();

                if process_actually_stopped {
                  log::info!(
                    "Successfully stopped Camoufox process: {} (PID: {:?}) - verified process is dead",
                    camoufox_process.id,
                    pid
                  );
                } else {
                  log::warn!(
                    "Camoufox stop command returned success but process {} (PID: {:?}) is still running - forcing kill",
                    camoufox_process.id,
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
                      log::error!("Failed to force kill Camoufox process {}: {}", pid, e);
                    } else {
                      // Verify the process is actually dead after force kill
                      use tokio::time::{sleep, Duration};
                      sleep(Duration::from_millis(500)).await;
                      use sysinfo::{Pid, System};
                      let system = System::new_all();
                      process_actually_stopped =
                        system.process(Pid::from(pid as usize)).is_none();
                      if process_actually_stopped {
                        log::info!(
                          "Successfully force killed Camoufox process {} (PID: {:?})",
                          camoufox_process.id,
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
                      log::error!("Failed to force kill Camoufox process {}: {}", pid, e);
                    } else {
                      // Verify the process is actually dead after force kill
                      use tokio::time::{sleep, Duration};
                      sleep(Duration::from_millis(500)).await;
                      use sysinfo::{Pid, System};
                      let system = System::new_all();
                      process_actually_stopped =
                        system.process(Pid::from(pid as usize)).is_none();
                      if process_actually_stopped {
                        log::info!(
                          "Successfully force killed Camoufox process {} (PID: {:?})",
                          camoufox_process.id,
                          pid
                        );
                      }
                    }
                  }
                  #[cfg(target_os = "windows")]
                  {
                    use crate::browser::platform_browser;
                    if let Err(e) =
                      platform_browser::windows::kill_browser_process_impl(pid).await
                    {
                      log::error!("Failed to force kill Camoufox process {}: {}", pid, e);
                    } else {
                      // Verify the process is actually dead after force kill
                      use tokio::time::{sleep, Duration};
                      sleep(Duration::from_millis(500)).await;
                      use sysinfo::{Pid, System};
                      let system = System::new_all();
                      process_actually_stopped =
                        system.process(Pid::from(pid as usize)).is_none();
                      if process_actually_stopped {
                        log::info!(
                          "Successfully force killed Camoufox process {} (PID: {:?})",
                          camoufox_process.id,
                          pid
                        );
                      }
                    }
                  }
                }
              } else {
                // stop_camoufox returned false, try to force kill the process
                log::warn!(
                  "Camoufox stop command returned false for process {} (PID: {:?}) - attempting force kill",
                  camoufox_process.id,
                  pid
                );
                #[cfg(target_os = "macos")]
                {
                  use crate::browser::platform_browser;
                  if let Err(e) = platform_browser::macos::kill_browser_process_impl(
                    pid,
                    Some(&profile_path_str),
                  )
                  .await
                  {
                    log::error!("Failed to force kill Camoufox process {}: {}", pid, e);
                  } else {
                    // Verify the process is actually dead after force kill
                    use tokio::time::{sleep, Duration};
                    sleep(Duration::from_millis(500)).await;
                    use sysinfo::{Pid, System};
                    let system = System::new_all();
                    process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                    if process_actually_stopped {
                      log::info!(
                        "Successfully force killed Camoufox process {} (PID: {:?})",
                        camoufox_process.id,
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
                    log::error!("Failed to force kill Camoufox process {}: {}", pid, e);
                  } else {
                    // Verify the process is actually dead after force kill
                    use tokio::time::{sleep, Duration};
                    sleep(Duration::from_millis(500)).await;
                    use sysinfo::{Pid, System};
                    let system = System::new_all();
                    process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                    if process_actually_stopped {
                      log::info!(
                        "Successfully force killed Camoufox process {} (PID: {:?})",
                        camoufox_process.id,
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
                    log::error!("Failed to force kill Camoufox process {}: {}", pid, e);
                  } else {
                    // Verify the process is actually dead after force kill
                    use tokio::time::{sleep, Duration};
                    sleep(Duration::from_millis(500)).await;
                    use sysinfo::{Pid, System};
                    let system = System::new_all();
                    process_actually_stopped = system.process(Pid::from(pid as usize)).is_none();
                    if process_actually_stopped {
                      log::info!(
                        "Successfully force killed Camoufox process {} (PID: {:?})",
                        camoufox_process.id,
                        pid
                      );
                    }
                  }
                }
              }
            } else {
              // No PID available, assume stopped if stop_camoufox returned true
              process_actually_stopped = stopped;
              if !stopped {
                log::warn!(
                  "Failed to stop Camoufox process {} but no PID available for force kill",
                  camoufox_process.id
                );
              }
            }
          }
          Err(e) => {
            log::error!(
              "Error stopping Camoufox process {}: {}",
              camoufox_process.id,
              e
            );
            // Try to force kill if we have a PID
            if let Some(pid) = camoufox_process.processId {
              log::info!(
                "Attempting force kill after stop_camoufox error for PID: {}",
                pid
              );
              #[cfg(target_os = "macos")]
              {
                use crate::browser::platform_browser;
                if let Err(kill_err) =
                  platform_browser::macos::kill_browser_process_impl(pid, Some(&profile_path_str))
                    .await
                {
                  log::error!(
                    "Failed to force kill Camoufox process {}: {}",
                    pid,
                    kill_err
                  );
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
                  log::error!(
                    "Failed to force kill Camoufox process {}: {}",
                    pid,
                    kill_err
                  );
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
                  log::error!(
                    "Failed to force kill Camoufox process {}: {}",
                    pid,
                    kill_err
                  );
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
      Ok(None) => {
        log::info!(
          "No running Camoufox process found for profile: {} (ID: {})",
          profile.name,
          profile.id
        );
        process_actually_stopped = true; // No process found, consider it stopped
      }
      Err(e) => {
        log::error!(
          "Error finding Camoufox process for profile {}: {}",
          profile.name,
          e
        );
      }
    }

    // If process wasn't confirmed stopped, return an error
    if !process_actually_stopped {
      log::error!(
        "Failed to stop Camoufox process for profile: {} (ID: {}) - process may still be running",
        profile.name,
        profile.id
      );
      return Err(
        format!(
          "Failed to stop Camoufox process for profile {} - process may still be running",
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

    // Check for pending updates and apply them for Camoufox profiles too
    if let Ok(Some(pending_update)) = self
      .auto_updater
      .get_pending_update(&profile.browser, &profile.version)
    {
      log::info!(
        "Found pending update for Camoufox profile {}: {} -> {}",
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
            "Successfully updated Camoufox profile {} from version {} to {}",
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
            "Failed to apply pending update for Camoufox profile {}: {}",
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
      "Emitting profile events for successful Camoufox kill: {}",
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
        "Successfully emitted profile-running-changed event for Camoufox {}: running={}",
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
      "Camoufox process cleanup completed for profile: {} (ID: {})",
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

}
