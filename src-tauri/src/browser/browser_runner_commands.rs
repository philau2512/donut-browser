
#[tauri::command]
pub async fn launch_browser_profile(
  app_handle: tauri::AppHandle,
  profile: BrowserProfile,
  url: Option<String>,
) -> Result<BrowserProfile, String> {
  launch_browser_profile_impl(app_handle, profile, url, None, false, false).await
}

pub async fn launch_browser_profile_impl(
  app_handle: tauri::AppHandle,
  profile: BrowserProfile,
  url: Option<String>,
  remote_debugging_port: Option<u16>,
  headless: bool,
  force_new: bool,
) -> Result<BrowserProfile, String> {
  log::info!(
    "Launch request received for profile: {} (ID: {})",
    profile.name,
    profile.id
  );

  if profile.is_cross_os() {
    return Err(format!(
      "Cannot launch profile '{}': this profile was created on {} and cannot be launched on a different operating system",
      profile.name,
      profile.host_os.as_deref().unwrap_or("another OS"),
    ));
  }

  // Team lock check: if profile is sync-enabled and user is on a team, acquire lock
  crate::profile::team_lock::acquire_team_lock_if_needed(&profile).await?;

  // Notify sync scheduler that profile is now running and queue sync for when it stops
  if let Some(scheduler) = crate::sync::get_global_scheduler() {
    let pid = profile.id.to_string();
    scheduler.mark_profile_running(&pid).await;
    if profile.is_sync_enabled() {
      scheduler.queue_profile_sync(pid).await;
    }
  }

  let browser_runner = BrowserRunner::instance();

  // Resolve the most up-to-date profile from disk by ID to avoid using stale proxy_id/browser state
  let mut profile_for_launch = match browser_runner
    .profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))
  {
    Ok(profiles) => profiles
      .into_iter()
      .find(|p| p.id == profile.id)
      .unwrap_or_else(|| profile.clone()),
    Err(e) => {
      return Err(e);
    }
  };

  // Apply active launch overrides from LAUNCH_OVERRIDES if present
  let profile_id_str = profile_for_launch.id.to_string();
  if let Ok(guard) = LAUNCH_OVERRIDES.lock() {
    if let Some(overrides) = guard.get(&profile_id_str) {
      log::info!(
        "[AUTOMATION] [LAUNCH] Applying active launch overrides for profile {}: {:?}",
        profile_for_launch.name,
        overrides
      );

      // Overwrite dns blocklist
      if let Some(ref dns_opt) = overrides.dns_blocklist {
        profile_for_launch.dns_blocklist = dns_opt.clone();
      }

      // Overwrite proxy/VPN fields so they don't overwrite or conflict
      if overrides.proxy.is_some() {
        profile_for_launch.proxy_id = None;
        profile_for_launch.vpn_id = None;
      }

      // Overwrite Wayfern config fields
      if let Some(ref mut wayfern_config) = profile_for_launch.wayfern_config {
        if let Some(block) = overrides.block_webrtc {
          wayfern_config.block_webrtc = Some(block);
        }
        if let Some(ref mode) = overrides.webrtc_mode {
          wayfern_config.webrtc_mode = Some(mode.clone());
        }
        if let Some(ref geo) = overrides.change_geolocation {
          if geo == "false" {
            wayfern_config.geoip = Some(serde_json::Value::Bool(false));
          } else if geo != "true" {
            wayfern_config.geoip = Some(serde_json::Value::String(geo.clone()));
          } else {
            wayfern_config.geoip = Some(serde_json::Value::Bool(true));
          }
        }
      }

      // Overwrite Camoufox config fields
      if let Some(ref mut camoufox_config) = profile_for_launch.camoufox_config {
        if let Some(block) = overrides.block_webrtc {
          camoufox_config.block_webrtc = Some(block);
        }
        if let Some(ref mode) = overrides.webrtc_mode {
          camoufox_config.webrtc_mode = Some(mode.clone());
        }
        if let Some(ref geo) = overrides.change_geolocation {
          if geo == "false" {
            camoufox_config.geoip = Some(serde_json::Value::Bool(false));
          } else if geo != "true" {
            camoufox_config.geoip = Some(serde_json::Value::String(geo.clone()));
          } else {
            camoufox_config.geoip = Some(serde_json::Value::Bool(true));
          }
        }
      }
    }
  }

  log::info!(
    "Resolved profile for launch: {} (ID: {})",
    profile_for_launch.name,
    profile_for_launch.id
  );

  log::info!(
    "Starting browser launch for profile: {} (ID: {})",
    profile_for_launch.name,
    profile_for_launch.id
  );

  // Check proxy connectivity before launch if check_before_start is enabled on the proxy.
  // Skips the cloud proxy (its only failure mode is 402 at request time, not a pre-check).
  if let Some(ref proxy_id) = profile_for_launch.proxy_id {
    if proxy_id != crate::proxy::proxy_manager::CLOUD_PROXY_ID {
      let check_before_start = {
        let stored_proxies = PROXY_MANAGER.get_stored_proxies();
        stored_proxies
          .into_iter()
          .find(|p| p.id == *proxy_id)
          .map(|p| p.check_before_start.unwrap_or(true))
          .unwrap_or(true)
      };

      if check_before_start {
        if let Some(settings) = PROXY_MANAGER.get_proxy_settings_by_id(proxy_id) {
          log::info!(
            "Checking proxy before launch for profile: {} (proxy: {})",
            profile_for_launch.name,
            proxy_id
          );
          let check_result = PROXY_MANAGER.check_proxy_validity(proxy_id, &settings).await;
          let is_valid = matches!(&check_result, Ok(res) if res.is_valid);
          if !is_valid {
            log::error!(
              "Proxy check failed before launch for profile: {}",
              profile_for_launch.name
            );
            // Clear the launching state in the frontend
            #[derive(serde::Serialize)]
            struct RunningChangedPayload {
              id: String,
              is_running: bool,
            }
            let _ = events::emit(
              "profile-running-changed",
              &RunningChangedPayload {
                id: profile_for_launch.id.to_string(),
                is_running: false,
              },
            );
            return Err(serde_json::json!({ "code": "PROXY_NOT_WORKING_LAUNCH" }).to_string());
          }
        }
      }
    }
  }

  // Launch browser or open URL in existing instance. Camoufox and Wayfern
  // start their own local proxies inside `launch_browser_internal`; any
  // other browser type is rejected there (we only support those for import,
  // not launch), so no proxy needs to be staged here.
  //
  // `force_new` callers (API/MCP) always start a fresh instance with the
  // requested debug port and headless mode, bypassing the "open URL in the
  // existing window" path which would otherwise ignore both.
  let launch_result = if force_new {
    browser_runner
      .launch_browser_with_debugging(
        app_handle.clone(),
        &profile_for_launch,
        url,
        remote_debugging_port,
        headless,
      )
      .await
  } else {
    browser_runner
      .launch_or_open_url(app_handle.clone(), &profile_for_launch, url, None)
      .await
  };
  let updated_profile = launch_result.map_err(|e| {
    log::info!("Browser launch failed for profile: {}, error: {}", profile_for_launch.name, e);

    // Emit a failure event to clear loading states in the frontend
    #[derive(serde::Serialize)]
    struct RunningChangedPayload {
      id: String,
      is_running: bool,
    }
    let payload = RunningChangedPayload {
      id: profile_for_launch.id.to_string(),
      is_running: false,
    };

    if let Err(e) = events::emit("profile-running-changed", &payload) {
      log::warn!("Warning: Failed to emit profile running changed event: {e}");
    }

    // Check if this is an architecture compatibility issue
    if let Some(io_error) = e.downcast_ref::<std::io::Error>() {
      if io_error.kind() == std::io::ErrorKind::Other && io_error.to_string().contains("Exec format error") {
        return format!("Failed to launch browser: Executable format error. This browser version is not compatible with your system architecture ({}). Please try a different browser or version that supports your platform.", std::env::consts::ARCH);
      }
    }
    format!("Failed to launch browser or open URL: {e}")
  })?;

  log::info!(
    "Browser launch completed for profile: {} (ID: {})",
    updated_profile.name,
    updated_profile.id
  );

  // Now update the proxy with the correct PID if we have one
  if let Some(actual_pid) = updated_profile.process_id {
    // Update the proxy manager with the correct PID (we always started with temp pid 1 for non-Camoufox)
    let _ = PROXY_MANAGER.update_proxy_pid(1u32, actual_pid);
  }

  Ok(updated_profile)
}

#[tauri::command]
pub fn check_browser_exists(browser_str: String, version: String) -> bool {
  // This is an alias for is_browser_downloaded to provide clearer semantics for auto-updates
  let runner = BrowserRunner::instance();
  runner
    .downloaded_browsers_registry
    .is_browser_downloaded(&browser_str, &version)
}

#[tauri::command]
pub async fn kill_browser_profile(
  app_handle: tauri::AppHandle,
  profile: BrowserProfile,
) -> Result<(), String> {
  log::info!(
    "Kill request received for profile: {} (ID: {})",
    profile.name,
    profile.id
  );

  let browser_runner = BrowserRunner::instance();

  match browser_runner
    .kill_browser_process(app_handle.clone(), &profile)
    .await
  {
    Ok(()) => {
      log::info!(
        "Successfully killed browser profile: {} (ID: {})",
        profile.name,
        profile.id
      );

      // Release team lock if applicable
      crate::profile::team_lock::release_team_lock_if_needed(&profile).await;

      // Notify sync scheduler that profile stopped (sync was queued at launch)
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        scheduler
          .mark_profile_stopped(&profile.id.to_string())
          .await;
      }

      // Auto-update non-running profiles and cleanup unused binaries
      let browser_for_update = profile.browser.clone();
      let app_handle_for_update = app_handle.clone();
      tauri::async_runtime::spawn(async move {
        let registry =
          crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance();
        let mut versions = registry.get_downloaded_versions(&browser_for_update);
        if !versions.is_empty() {
          versions.sort_by(|a, b| crate::api::api_client::compare_versions(b, a));
          let latest_version = &versions[0];

          let auto_updater = crate::updater::auto_updater::AutoUpdater::instance();
          match auto_updater
            .auto_update_profile_versions(
              &app_handle_for_update,
              &browser_for_update,
              latest_version,
            )
            .await
          {
            Ok(updated) => {
              if !updated.is_empty() {
                log::info!(
                  "Auto-updated {} profiles after stop: {:?}",
                  updated.len(),
                  updated
                );
              }
            }
            Err(e) => {
              log::error!("Failed to auto-update profile versions after stop: {e}");
            }
          }
        }

        match registry.cleanup_unused_binaries() {
          Ok(cleaned) => {
            if !cleaned.is_empty() {
              log::info!("Cleaned up unused binaries after stop: {:?}", cleaned);
            }
          }
          Err(e) => {
            log::error!("Failed to cleanup unused binaries after stop: {e}");
          }
        }
      });

      Ok(())
    }
    Err(e) => {
      log::info!("Failed to kill browser profile {}: {}", profile.name, e);

      // Emit a failure event to clear loading states in the frontend
      #[derive(serde::Serialize)]
      struct RunningChangedPayload {
        id: String,
        is_running: bool,
      }
      // On kill failure, we assume the process is still running
      let payload = RunningChangedPayload {
        id: profile.id.to_string(),
        is_running: true,
      };

      if let Err(e) = events::emit("profile-running-changed", &payload) {
        log::warn!("Warning: Failed to emit profile running changed event: {e}");
      }

      Err(format!("Failed to kill browser: {e}"))
    }
  }
}

#[tauri::command]
pub async fn open_url_with_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
  url: String,
) -> Result<(), String> {
  let browser_runner = BrowserRunner::instance();
  browser_runner
    .open_url_with_profile(app_handle, profile_id, url)
    .await
}

#[derive(Debug, Clone, Default)]
pub struct LaunchOverrides {
  pub proxy: Option<Option<ProxySettings>>, // Some(None) = Direct/No proxy, Some(Some(p)) = Override proxy, None = No override (use db/original)
  pub block_webrtc: Option<bool>,
  pub webrtc_mode: Option<String>,
  pub change_timezone: Option<String>,
  pub change_geolocation: Option<String>,
  pub change_language: Option<String>,
  pub dns_blocklist: Option<Option<String>>, // Some(None) = Disable blocklist, Some(Some(d)) = Override blocklist, None = No override
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref BROWSER_RUNNER: BrowserRunner = BrowserRunner::new();
  pub static ref ACTIVE_RUNNING_STATES: std::sync::Mutex<std::collections::HashMap<String, bool>> =
    std::sync::Mutex::new(std::collections::HashMap::new());
  pub static ref EXPECTED_PROFILE_STOPS: std::sync::Mutex<std::collections::HashSet<String>> =
    std::sync::Mutex::new(std::collections::HashSet::new());
  pub static ref LAUNCH_OVERRIDES: std::sync::Mutex<std::collections::HashMap<String, LaunchOverrides>> =
    std::sync::Mutex::new(std::collections::HashMap::new());
}

