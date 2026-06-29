// ═══════════════════════════════════════════════════════════════════════════════
// browser_runner_cleanup.rs
// ═══════════════════════════════════════════════════════════════════════════════
//
// Post-exit cleanup and profile lifecycle management.
// This file is included via include!() in browser_runner.rs.
//
// Responsibilities:
// - Handle browser process exit (natural or crash)
// - Clean up ephemeral directories
// - Clear process tracking state
// - Run after_close automation pipeline
// - Trigger auto-updater
// - Emit frontend events
//
// ═══════════════════════════════════════════════════════════════════════════════

impl BrowserRunner {
  pub async fn handle_profile_stopped(
  &self,
  app_handle: &tauri::AppHandle,
  profile_id: &str,
  exit_status: Option<&str>,
  is_crash: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
  log::info!("Handling profile stop immediately for ID: {profile_id}");

  // 1. Cập nhật ACTIVE_RUNNING_STATES thành false
  {
    if let Ok(mut states) = ACTIVE_RUNNING_STATES.lock() {
      states.insert(profile_id.to_string(), false);
    }
  }

  // 2. Lấy profile từ đĩa
  let profiles_dir = self.profile_manager.get_profiles_dir();
  let profile_uuid_dir = profiles_dir.join(profile_id);

  // Stop and clean up WayfernManager tracking for this profile (especially the fingerprint watcher)
  let profile_path_str = profile_uuid_dir.to_string_lossy();
  if let Some(existing) = self
    .wayfern_manager
    .find_wayfern_by_profile(&profile_path_str)
    .await
  {
    log::info!(
      "Cleaning up Wayfern instance for stopped profile: {}",
      existing.id
    );
    let _ = self.wayfern_manager.stop_wayfern(&existing.id).await;
  }

  let metadata_file = profile_uuid_dir.join("metadata.json");

  if !metadata_file.exists() {
    log::warn!("Profile metadata not found for stop handler: {profile_id}");
    return Ok(());
  }

  // Write diagnostic exit log (keep last 50 lines max)
  {
    let log_file = profile_uuid_dir.join("browser_exit.log");
    let time_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let details = exit_status.unwrap_or("Unknown/Naturally");
    let log_line = format!("[{}] Browser exited. Details: {}", time_str, details);

    let mut lines = Vec::new();
    if log_file.exists() {
      if let Ok(content) = std::fs::read_to_string(&log_file) {
        lines = content.lines().map(|s| s.to_string()).collect();
      }
    }
    lines.push(log_line);

    if lines.len() > 50 {
      let skip_count = lines.len() - 50;
      lines = lines.into_iter().skip(skip_count).collect();
    }

    let new_content = lines.join("\n") + "\n";
    let _ = std::fs::write(&log_file, new_content);
  }

  let content = std::fs::read_to_string(&metadata_file)?;
  let mut profile: BrowserProfile = serde_json::from_str(&content)?;

  // Emit crash event if is_crash is true
  if is_crash {
    #[derive(serde::Serialize, Clone)]
    struct ProfileCrashPayload {
      id: String,
      name: String,
      exit_status: String,
    }
    let payload = ProfileCrashPayload {
      id: profile_id.to_string(),
      name: profile.name.clone(),
      exit_status: exit_status.unwrap_or("Unknown").to_string(),
    };
    if let Err(e) = events::emit("profile-crash", &payload) {
      log::warn!("Warning: Failed to emit profile crash event: {e}");
    }
  }

  // Ephemeral cleanup
  if profile.ephemeral {
    crate::browser::ephemeral_dirs::remove_ephemeral_dir(profile_id);
  }

  let mut profile_updated = false;

  // 3. Clear process_id nếu có
  if profile.process_id.is_some() {
    profile.process_id = None;
    if let Err(e) = self.profile_manager.save_profile(&profile) {
      log::warn!("Warning: Failed to clear profile process info: {e}");
    }
    profile_updated = true;
  }

  // 4. Run auto-updater nếu cần
  let mut final_profile = profile.clone();
  if profile_updated {
    if let Some(updated) = self
      .auto_updater
      .update_profile_to_latest_installed(app_handle, &profile)
    {
      final_profile = updated;
    }
    // Emit profile-updated
    if let Err(e) = events::emit("profile-updated", &final_profile) {
      log::warn!("Warning: Failed to emit profile update event: {e}");
    }
  }

  // 5. Password protected complete
  if final_profile.password_protected {
    crate::profile::password::complete_after_quit_and_wait(&final_profile).await;
  }

  // 6. Notify sync scheduler
  if let Some(scheduler) = crate::sync::get_global_scheduler() {
    scheduler.mark_profile_stopped(profile_id).await;
  }

  // Stop proxy worker instantly for this profile
  PROXY_MANAGER.stop_proxy_for_profile(profile_id).await;

  // 7. Emit profile-running-changed
  #[derive(serde::Serialize)]
  struct RunningChangedPayload {
    id: String,
    is_running: bool,
  }

  let payload = RunningChangedPayload {
    id: profile_id.to_string(),
    is_running: false,
  };

  if let Err(e) = events::emit("profile-running-changed", &payload) {
    log::warn!("Warning: Failed to emit profile running changed event: {e}");
  } else {
    log::info!(
      "Successfully emitted profile-running-changed event for stopped profile {}: running=false",
      final_profile.name
    );
  }

  Ok(())
}
}
