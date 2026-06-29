// lib_setup_background_updaters.rs
// Background updater tasks: version updates, profile bumps, auto-updates, binary cleanup, DNS/GeoIP refreshes
// Extracted from lib_setup.rs to improve maintainability and follow SRP

use tauri::AppHandle;

/// Spawn all updater-related background tasks.
/// Call this from setup_tauri_app to initialize update infrastructure.
pub fn spawn_updater_tasks(app: &AppHandle) {
  spawn_version_updater_tasks(app);
  spawn_profile_version_bump(app);
  spawn_auto_updater_check(app);
  spawn_binary_cleanup(app);
  spawn_dns_blocklist_refresh(app);
  spawn_app_auto_updater(app);
  spawn_geoip_download(app);
}

// Initialize and start background version updater (initialization + background runner)
fn spawn_version_updater_tasks(_app: &AppHandle) {
  // Initialize and start background version updater
  let app_handle = _app.clone();
  tauri::async_runtime::spawn(async move {
    let version_updater = crate::updater::version_updater::get_version_updater();

    // Set the app handle
    {
      let mut updater_guard = version_updater.lock().await;
      updater_guard.set_app_handle(app_handle);
    }

    // Run startup check without holding the lock
    {
      let updater_guard = version_updater.lock().await;
      if let Err(e) = updater_guard.start_background_updates().await {
        log::error!("Failed to start background updates: {e}");
      }
    }
  });

  // Start the background update task separately
  tauri::async_runtime::spawn(async move {
    crate::updater::version_updater::VersionUpdater::run_background_task().await;
  });
}

// Immediately bump non-running profiles to the latest installed browser version.
// This runs synchronously before any network calls so profiles are updated on launch.
fn spawn_profile_version_bump(_app: &AppHandle) {
  let app_handle_bump = _app.clone();
  match crate::updater::auto_updater::AutoUpdater::instance()
    .update_profiles_to_latest_installed(&app_handle_bump)
  {
    Ok(updated) => {
      if !updated.is_empty() {
        log::info!(
          "Startup: bumped {} profiles to latest installed versions: {:?}",
          updated.len(),
          updated
        );
      }
    }
    Err(e) => {
      log::error!("Startup: failed to bump profiles to latest installed versions: {e}");
    }
  }
}

// Start the auto-update check task
fn spawn_auto_updater_check(_app: &AppHandle) {
  let app_handle_auto_updater = _app.clone();

  // Start the auto-update check task separately
  tauri::async_runtime::spawn(async move {
    crate::updater::auto_updater::check_for_updates_with_progress(app_handle_auto_updater).await;
  });
}

// Start periodic cleanup task for unused binaries (every 12 hours).
// Only runs when sync is not in progress to avoid deleting browsers
// that might be needed for profiles being synced from the cloud.
fn spawn_binary_cleanup(_app: &AppHandle) {
  tauri::async_runtime::spawn(async move {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(43200)); // Every 12 hours

    loop {
      interval.tick().await;

      // Check if sync is in progress before running cleanup
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        if scheduler.is_sync_in_progress().await {
          log::debug!("Skipping cleanup: sync is in progress");
          continue;
        }
      }

      let registry =
        crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance();
      if let Err(e) = registry.cleanup_unused_binaries() {
        log::error!("Periodic cleanup failed: {e}");
      } else {
        log::debug!("Periodic cleanup completed successfully");
      }
    }
  });
}

// DNS blocklist refresh task (every 12 hours)
fn spawn_dns_blocklist_refresh(_app: &AppHandle) {
  tauri::async_runtime::spawn(async move {
    let manager = crate::profile::dns_blocklist::BlocklistManager::instance();
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(43200));
    interval.tick().await; // Skip the immediate first tick
    loop {
      interval.tick().await;
      manager.refresh_all_stale().await;
    }
  });
}

// App auto-updater task (every 3 hours) with frontend event emission
fn spawn_app_auto_updater(_app: &AppHandle) {
  tauri::async_runtime::spawn(async move {
    let updater = crate::updater::app_auto_updater::AppAutoUpdater::instance();
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3 * 60 * 60));

    loop {
      interval.tick().await;

      log::info!("Checking for app updates...");
      match updater.check_for_updates().await {
        Ok(Some(update_info)) => {
          log::info!(
            "App update available: {} -> {}",
            update_info.current_version,
            update_info.new_version
          );
          if let Err(e) = crate::events::emit("app-update-available", &update_info) {
            log::error!("Failed to emit app update event: {e}");
          }
        }
        Ok(None) => {
          log::debug!("No app updates available");
        }
        Err(e) => {
          log::error!("Failed to check for app updates: {e}");
        }
      }
    }
  });
}

// Check and download GeoIP database at startup if needed
fn spawn_geoip_download(_app: &AppHandle) {
  // Check and download GeoIP database at startup if needed
  let app_handle_geoip = _app.clone();
  tauri::async_runtime::spawn(async move {
    // Wait a bit for the app to fully initialize
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    let geoip_downloader = crate::updater::geoip_downloader::GeoIPDownloader::instance();
    match geoip_downloader.check_missing_geoip_database() {
      Ok(true) => {
        log::info!("GeoIP database is missing for Camoufox profiles, downloading at startup...");
        let geoip_downloader = crate::updater::geoip_downloader::GeoIPDownloader::instance();
        if let Err(e) = geoip_downloader
          .download_geoip_database(&app_handle_geoip)
          .await
        {
          log::error!("Failed to download GeoIP database at startup: {e}");
        } else {
          log::info!("GeoIP database downloaded successfully at startup");
        }
      }
      Ok(false) => {
        // No Camoufox profiles or GeoIP database already available
      }
      Err(e) => {
        log::error!("Failed to check GeoIP database status at startup: {e}");
      }
    }
  });
}
