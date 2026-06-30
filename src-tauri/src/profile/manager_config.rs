impl ProfileManager {
  pub async fn update_profile_vpn(
    &self,
    _app_handle: tauri::AppHandle,
    profile_id: &str,
    vpn_id: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
    let profile_uuid = uuid::Uuid::parse_str(profile_id).map_err(
      |_| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Invalid profile ID: {profile_id}").into()
      },
    )?;
    let profiles =
      self
        .list_profiles()
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
          format!("Failed to list profiles: {e}").into()
        })?;

    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Profile with ID '{profile_id}' not found").into()
      })?;

    // Update VPN and clear proxy (mutual exclusion)
    profile.vpn_id = vpn_id.clone();
    profile.proxy_id = None;
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    self
      .save_profile(&profile)
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Failed to save profile: {e}").into()
      })?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    // Auto-enable sync for the new VPN if profile has sync enabled.
    if profile.is_sync_enabled() {
      if let Some(ref new_vpn_id) = vpn_id {
        let _ = crate::sync::enable_vpn_sync_if_needed(new_vpn_id).await;
        if let Some(scheduler) = crate::sync::get_global_scheduler() {
          scheduler.queue_vpn_sync(new_vpn_id.clone()).await;
        }
      }
    }

    if let Err(e) = events::emit("profile-updated", &profile) {
      log::warn!("Warning: Failed to emit profile update event: {e}");
    }

    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn update_profile_extension_group(
    &self,
    profile_id: &str,
    extension_group_id: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    profile.extension_group_id = extension_group_id.clone();
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());
    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    // Auto-enable sync for the new extension group if profile has sync
    // enabled. The helper is sync internally; we fire-and-forget through
    // the async runtime so any I/O doesn't block this caller.
    if profile.is_sync_enabled() {
      if let Some(new_group_id) = extension_group_id {
        tauri::async_runtime::spawn(async move {
          let _ = crate::sync::enable_extension_group_sync_if_needed(&new_group_id).await;
          if let Some(scheduler) = crate::sync::get_global_scheduler() {
            scheduler.queue_extension_group_sync(new_group_id).await;
          }
        });
      }
    }

    if let Err(e) = events::emit("profile-updated", &profile) {
      log::warn!("Failed to emit profile update event: {e}");
    }
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub async fn check_browser_status(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    // Handle Camoufox profiles using CamoufoxManager-based status checking
    if profile.browser == "camoufox" {
      return self.check_camoufox_status(&app_handle, profile).await;
    }

    // Handle Wayfern profiles using WayfernManager-based status checking
    if profile.browser == "wayfern" {
      return self.check_wayfern_status(&app_handle, profile).await;
    }

    // For non-camoufox browsers, use the existing PID-based logic
    let inner_profile = profile.clone();
    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
    let mut is_running = false;
    let mut found_pid: Option<u32> = None;

    // First check if the stored PID is still valid
    if let Some(pid) = profile.process_id {
      if let Some(process) = system.process(Pid::from(pid as usize)) {
        let cmd = process.cmd();
        // Verify this process is actually our browser with the correct profile
        let profiles_dir = self.get_profiles_dir();
        let profile_data_path = profile.get_profile_data_path(&profiles_dir);
        let profile_data_path_str = profile_data_path.to_string_lossy();
        let profile_path_match = cmd.iter().any(|s| {
          let arg = s.to_str().unwrap_or("");
          // For Firefox-based browsers, check for exact profile path match
          if profile.browser == "camoufox" {
            arg == profile_data_path_str
              || arg == format!("-profile={profile_data_path_str}")
              || (arg == "-profile"
                && cmd
                  .iter()
                  .any(|s2| s2.to_str().unwrap_or("") == profile_data_path_str))
          } else {
            // For Chromium-based browsers (Wayfern), check for user-data-dir
            arg.contains(&format!("--user-data-dir={profile_data_path_str}"))
              || arg == profile_data_path_str
          }
        });

        if profile_path_match {
          is_running = true;
          found_pid = Some(pid);
        }
      }
    }

    // If we didn't find the browser with the stored PID, search all processes
    if !is_running {
      for (pid, process) in system.processes() {
        let cmd = process.cmd();
        if cmd.len() >= 2 {
          // Check if this is the right browser executable first
          let exe_name = process.name().to_string_lossy().to_lowercase();
          let is_correct_browser = match profile.browser.as_str() {
            "camoufox" => exe_name.contains("camoufox") || exe_name.contains("firefox"),
            "wayfern" => {
              exe_name.contains("wayfern")
                || exe_name.contains("chromium")
                || exe_name.contains("chrome")
            }
            _ => false,
          };

          if !is_correct_browser {
            continue;
          }

          // Check for profile path match
          let profiles_dir = self.get_profiles_dir();
          let profile_data_path = profile.get_profile_data_path(&profiles_dir);
          let profile_data_path_str = profile_data_path.to_string_lossy();
          let profile_path_match = cmd.iter().any(|s| {
            let arg = s.to_str().unwrap_or("");
            // For Firefox-based browsers, check for exact profile path match
            if profile.browser == "camoufox" {
              arg == profile_data_path_str
                || arg == format!("-profile={profile_data_path_str}")
                || (arg == "-profile"
                  && cmd
                    .iter()
                    .any(|s2| s2.to_str().unwrap_or("") == profile_data_path_str))
            } else {
              // For Chromium-based browsers (Wayfern), check for user-data-dir
              arg.contains(&format!("--user-data-dir={profile_data_path_str}"))
                || arg == profile_data_path_str
            }
          });

          if profile_path_match {
            // Found a matching process
            found_pid = Some(pid.as_u32());
            is_running = true;
            log::info!(
              "Found browser process with PID: {} for profile: {}",
              pid.as_u32(),
              profile.name
            );
            break;
          }
        }
      }
    }

    // Only persist status changes if the profile metadata still exists on disk
    let profiles_dir = self.get_profiles_dir();
    let profile_uuid_dir = profiles_dir.join(profile.id.to_string());
    let metadata_file = profile_uuid_dir.join("metadata.json");
    let metadata_exists = metadata_file.exists();

    if metadata_exists {
      // Load the latest profile from disk to avoid overwriting fields like proxy_id
      let latest_profile: BrowserProfile = match std::fs::read_to_string(&metadata_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
      {
        Some(p) => p,
        None => inner_profile.clone(),
      };

      let mut merged = latest_profile.clone();
      let mut detected_stop = false;

      if let Some(pid) = found_pid {
        if merged.process_id != Some(pid) {
          let old_pid = merged.process_id;
          merged.process_id = Some(pid);
          if let Err(e) = self.save_profile(&merged) {
            log::warn!("Warning: Failed to update profile with new PID: {e}");
          }
          if let Some(prev) = old_pid {
            let _ = crate::proxy::proxy_manager::PROXY_MANAGER.update_proxy_pid(prev, pid);
          }
        }
      } else if merged.process_id.is_some() {
        // Clear the PID if no process found
        merged.process_id = None;
        if let Err(e) = self.save_profile(&merged) {
          log::warn!("Warning: Failed to clear profile PID: {e}");
        }
        detected_stop = true;
      }

      if detected_stop {
        if let Some(updated) = crate::updater::auto_updater::AutoUpdater::instance()
          .update_profile_to_latest_installed(&app_handle, &merged)
        {
          merged = updated;
        }
      }

      // Emit profile update event to frontend
      if let Err(e) = events::emit("profile-updated", &merged) {
        log::warn!("Warning: Failed to emit profile update event: {e}");
      }
    }

    Ok(is_running)
  }

  // Check Camoufox status using CamoufoxManager
  async fn check_camoufox_status(
    &self,
    app_handle: &tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let launcher = self.camoufox_manager;
    let profiles_dir = self.get_profiles_dir();
    let profile_data_path =
      crate::browser::ephemeral_dirs::get_effective_profile_path(profile, &profiles_dir);
    let profile_path_str = profile_data_path.to_string_lossy();

    // Check if there's a running Camoufox instance for this profile
    match launcher.find_camoufox_by_profile(&profile_path_str).await {
      Ok(Some(camoufox_process)) => {
        // Found a running instance, update profile with process info if changed
        let profiles_dir = self.get_profiles_dir();
        let profile_uuid_dir = profiles_dir.join(profile.id.to_string());
        let metadata_file = profile_uuid_dir.join("metadata.json");
        let metadata_exists = metadata_file.exists();

        if metadata_exists {
          // Load latest to avoid overwriting other fields
          let mut latest: BrowserProfile = match std::fs::read_to_string(&metadata_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
          {
            Some(p) => p,
            None => profile.clone(),
          };

          if latest.process_id != camoufox_process.processId {
            let old_pid = latest.process_id;
            latest.process_id = camoufox_process.processId;
            if let Err(e) = self.save_profile(&latest) {
              log::warn!("Warning: Failed to update Camoufox profile with process info: {e}");
            }
            if let (Some(prev), Some(new)) = (old_pid, camoufox_process.processId) {
              let _ = crate::proxy::proxy_manager::PROXY_MANAGER.update_proxy_pid(prev, new);
            }

            // Emit profile update event to frontend
            if let Err(e) = events::emit("profile-updated", &latest) {
              log::warn!("Warning: Failed to emit profile update event: {e}");
            }

            log::info!(
              "Camoufox process has started for profile '{}' with PID: {:?}",
              profile.name,
              camoufox_process.processId
            );
          }
        }
        Ok(true)
      }
      Ok(None) => {
        // No running instance found, clear process ID if set and stop proxy
        if profile.ephemeral {
          crate::browser::ephemeral_dirs::remove_ephemeral_dir(&profile.id.to_string());
        }

        let profiles_dir = self.get_profiles_dir();
        let profile_uuid_dir = profiles_dir.join(profile.id.to_string());
        let metadata_file = profile_uuid_dir.join("metadata.json");
        let metadata_exists = metadata_file.exists();

        if metadata_exists {
          let mut latest: BrowserProfile = match std::fs::read_to_string(&metadata_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
          {
            Some(p) => p,
            None => profile.clone(),
          };

          if latest.process_id.is_some() {
            latest.process_id = None;
            if let Err(e) = self.save_profile(&latest) {
              log::warn!("Warning: Failed to clear Camoufox profile process info: {e}");
            }

            if let Some(updated) = crate::updater::auto_updater::AutoUpdater::instance()
              .update_profile_to_latest_installed(app_handle, &latest)
            {
              latest = updated;
            }

            if let Err(e) = events::emit("profile-updated", &latest) {
              log::warn!("Warning: Failed to emit profile update event: {e}");
            }
          }
        }
        Ok(false)
      }
      Err(e) => {
        // Error checking status, assume not running and clear process ID
        log::warn!("Warning: Failed to check Camoufox status: {e}");
        if profile.ephemeral {
          crate::browser::ephemeral_dirs::remove_ephemeral_dir(&profile.id.to_string());
        }

        let profiles_dir = self.get_profiles_dir();
        let profile_uuid_dir = profiles_dir.join(profile.id.to_string());
        let metadata_file = profile_uuid_dir.join("metadata.json");
        let metadata_exists = metadata_file.exists();

        if metadata_exists {
          let mut latest: BrowserProfile = match std::fs::read_to_string(&metadata_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
          {
            Some(p) => p,
            None => profile.clone(),
          };

          if latest.process_id.is_some() {
            latest.process_id = None;
            if let Err(e2) = self.save_profile(&latest) {
              log::warn!(
                "Warning: Failed to clear Camoufox profile process info after error: {e2}"
              );
            }

            if let Some(updated) = crate::updater::auto_updater::AutoUpdater::instance()
              .update_profile_to_latest_installed(app_handle, &latest)
            {
              latest = updated;
            }

            // Emit profile update event to frontend
            if let Err(e3) = events::emit("profile-updated", &latest) {
              log::warn!("Warning: Failed to emit profile update event: {e3}");
            }
          }
        }
        Ok(false)
      }
    }
  }

  // Check Wayfern status using WayfernManager
  async fn check_wayfern_status(
    &self,
    app_handle: &tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let manager = self.wayfern_manager;
    let profiles_dir = self.get_profiles_dir();
    let profile_data_path =
      crate::browser::ephemeral_dirs::get_effective_profile_path(profile, &profiles_dir);
    let profile_path_str = profile_data_path.to_string_lossy();

    // Check if there's a running Wayfern instance for this profile
    match manager.find_wayfern_by_profile(&profile_path_str).await {
      Some(wayfern_process) => {
        // Found a running instance, update profile with process info if changed
        let profiles_dir = self.get_profiles_dir();
        let profile_uuid_dir = profiles_dir.join(profile.id.to_string());
        let metadata_file = profile_uuid_dir.join("metadata.json");
        let metadata_exists = metadata_file.exists();

        if metadata_exists {
          // Load latest to avoid overwriting other fields
          let mut latest: BrowserProfile = match std::fs::read_to_string(&metadata_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
          {
            Some(p) => p,
            None => profile.clone(),
          };

          if latest.process_id != wayfern_process.processId {
            let old_pid = latest.process_id;
            latest.process_id = wayfern_process.processId;
            if let Err(e) = self.save_profile(&latest) {
              log::warn!("Warning: Failed to update Wayfern profile with process info: {e}");
            }
            if let (Some(prev), Some(new)) = (old_pid, wayfern_process.processId) {
              let _ = crate::proxy::proxy_manager::PROXY_MANAGER.update_proxy_pid(prev, new);
            }

            // Emit profile update event to frontend
            if let Err(e) = events::emit("profile-updated", &latest) {
              log::warn!("Warning: Failed to emit profile update event: {e}");
            }

            log::info!(
              "Wayfern process has started for profile '{}' with PID: {:?}",
              profile.name,
              wayfern_process.processId
            );
          }
        }
        Ok(true)
      }
      None => {
        // No running instance found, clear process ID if set
        if profile.ephemeral {
          crate::browser::ephemeral_dirs::remove_ephemeral_dir(&profile.id.to_string());
        }

        let profiles_dir = self.get_profiles_dir();
        let profile_uuid_dir = profiles_dir.join(profile.id.to_string());
        let metadata_file = profile_uuid_dir.join("metadata.json");
        let metadata_exists = metadata_file.exists();

        if metadata_exists {
          let mut latest: BrowserProfile = match std::fs::read_to_string(&metadata_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
          {
            Some(p) => p,
            None => profile.clone(),
          };

          if latest.process_id.is_some() {
            latest.process_id = None;
            if let Err(e) = self.save_profile(&latest) {
              log::warn!("Warning: Failed to clear Wayfern profile process info: {e}");
            }

            if let Some(updated) = crate::updater::auto_updater::AutoUpdater::instance()
              .update_profile_to_latest_installed(app_handle, &latest)
            {
              latest = updated;
            }

            if let Err(e) = events::emit("profile-updated", &latest) {
              log::warn!("Warning: Failed to emit profile update event: {e}");
            }
          }
        }
        Ok(false)
      }
    }
  }

}
