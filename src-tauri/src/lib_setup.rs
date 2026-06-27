fn setup_tauri_app(app: &mut tauri::App, startup_url: Option<String>) -> Result<(), Box<dyn std::error::Error>> {
  // Recover ephemeral dir mappings from RAM-backed storage (tmpfs/ramdisk)
    browser::ephemeral_dirs::recover_ephemeral_dirs();

    // Extract icons and metadata for existing extensions that don't have them yet
    {
      let mgr = extension_manager::ExtensionManager::new();
      mgr.ensure_icons_extracted();
    }

    // Create the main window programmatically
    #[allow(unused_variables)]
    let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
      .title("Donut Browser")
      .inner_size(880.0, 500.0)
      .min_inner_size(640.0, 400.0)
      .resizable(true)
      .fullscreen(false)
      .center()
      .focused(true)
      .visible(true);

    #[cfg(target_os = "windows")]
    let win_builder = win_builder.decorations(false);

    #[allow(unused_variables)]
    let window = win_builder.build().unwrap();

    // System tray so the user can keep the app running after the close
    // dialog's "Minimize" action hides the window. Best-effort: a tray
    // failure (e.g. missing libayatana-appindicator on Linux) must never
    // prevent the app from launching, so we log and continue without it.
    if let Err(e) = setup_system_tray(app.handle()) {
      log::warn!("System tray unavailable, continuing without it: {e}");
    }

    // Intercept the window close so the frontend can ask the user whether
    // to minimize or quit. The app exits when `confirm_quit` flips
    // QUIT_CONFIRMED — until then, every CloseRequested is held back.
    {
      let app_handle = app.handle().clone();
      window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          if QUIT_CONFIRMED.load(Ordering::SeqCst) {
            return;
          }
          api.prevent_close();
          if let Err(e) = app_handle.emit("close-confirm-requested", ()) {
            log::warn!("Failed to emit close-confirm-requested: {e}");
          }
        }
      });
    }

    // Set transparent titlebar for macOS
    #[cfg(target_os = "macos")]
    {
      if let Err(e) = window.set_transparent_titlebar(true) {
        log::warn!("Failed to set transparent titlebar: {e}");
      }
      // Green title-bar button maximizes (zoom) the window rather than
      // entering immersive native fullscreen.
      if let Err(e) = window.disable_native_fullscreen() {
        log::warn!("Failed to disable native fullscreen: {e}");
      }
    }

    // Set up deep link handler
    let handle = app.handle().clone();

    // Initialize the global event emitter for the events module
    let emitter = std::sync::Arc::new(events::TauriEmitter::new(handle.clone()));
    if let Err(e) = events::set_global_emitter(emitter) {
      log::warn!("Failed to set global event emitter: {e}");
    }

    #[cfg(windows)]
    {
      // For Windows, register all deep links at runtime
      if let Err(e) = app.deep_link().register_all() {
        log::warn!("Failed to register deep links: {e}");
      }
    }

    #[cfg(target_os = "macos")]
    {
      // On macOS, try to register deep links for development builds
      if let Err(e) = app.deep_link().register_all() {
        log::debug!(
          "Note: Deep link registration failed on macOS (this is normal for production): {e}"
        );
      }
    }

    app.deep_link().on_open_url({
      let handle = handle.clone();
      move |event| {
        let urls = event.urls();
        log::info!("Deep link event received with {} URLs", urls.len());

        for url in urls {
          let url_string = url.to_string();
          log::info!("Deep link received: {url_string}");

          // Clone the handle for each async task
          let handle_clone = handle.clone();

          // Handle the URL asynchronously
          tauri::async_runtime::spawn(async move {
            if let Err(e) = handle_url_open(handle_clone, url_string.clone()).await {
              log::error!("Failed to handle deep link URL: {e}");
            }
          });
        }
      }
    });

    if let Some(startup_url) = startup_url {
      let handle_clone = handle.clone();
      tauri::async_runtime::spawn(async move {
        log::info!("Processing startup URL from command line: {startup_url}");
        if let Err(e) = handle_url_open(handle_clone, startup_url.clone()).await {
          log::error!("Failed to handle startup URL: {e}");
        }
      });
    }

    // Initialize and start background version updater
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      let version_updater = get_version_updater();

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
      version_updater::VersionUpdater::run_background_task().await;
    });

    // Auto-start MCP server if it was previously enabled. Always log the
    // decision so customer logs reveal whether MCP is actually running —
    // "automation features don't work" is otherwise indistinguishable from
    // "MCP server isn't enabled" without this line.
    {
      let mcp_handle = app.handle().clone();
      let settings_mgr = settings_manager::SettingsManager::instance();
      match settings_mgr.load_settings() {
        Ok(settings) => {
          if settings.mcp_enabled {
            log::info!("MCP server is enabled in settings, attempting auto-start");
            tauri::async_runtime::spawn(async move {
              match mcp_server::McpServer::instance().start(mcp_handle).await {
                Ok(port) => log::info!("MCP server auto-started on port {port}"),
                Err(e) => log::warn!("Failed to auto-start MCP server: {e}"),
              }
            });
          } else {
            log::info!(
              "MCP server is DISABLED in settings (mcp_enabled=false). Browser automation tools will not be available until it's enabled in Settings → Integrations."
            );
          }
        }
        Err(e) => {
          log::warn!("Could not read settings to determine MCP state: {e}");
        }
      }
    }

    // Clear stale process IDs from profiles (processes that died while app was closed)
    {
      let profile_manager = crate::profile::ProfileManager::instance();
      if let Ok(profiles) = profile_manager.list_profiles() {
        let system = sysinfo::System::new_with_specifics(
          sysinfo::RefreshKind::nothing()
            .with_processes(sysinfo::ProcessRefreshKind::everything()),
        );
        for profile in profiles {
          if let Some(pid) = profile.process_id {
            let sysinfo_pid = sysinfo::Pid::from_u32(pid);
            if system.process(sysinfo_pid).is_none() {
              log::info!(
                "Clearing stale process_id {} for profile {}",
                pid,
                profile.name
              );
              let mut updated = profile.clone();
              updated.process_id = None;
              let _ = profile_manager.save_profile(&updated);
            }
          }
        }
      }
    }

    // Kill orphaned proxy and VPN worker processes from previous app runs.
    // Since active_proxies is an in-memory map that starts empty, any running
    // donut-proxy workers on disk must be orphans the current app can't track.
    // Without this cleanup, users on Windows accumulate dozens of idle workers
    // (one per profile launch) that the periodic cleanup won't touch because
    // profile-associated workers are deliberately skipped to avoid regressions.
    //
    // Preserves workers whose associated profile still has a running browser
    // process — if the app crashed while a browser was running, its detached
    // browser keeps going and needs the proxy/VPN worker to stay alive.
    tauri::async_runtime::spawn(async move {
      use crate::proxy::proxy_storage::{delete_proxy_config, is_process_running, list_proxy_configs};
      use crate::vpn::vpn_worker_storage::{delete_vpn_worker_config, list_vpn_worker_configs};

      // Build sets of (profile_id, vpn_id) whose browsers are still running
      let profile_manager = crate::profile::ProfileManager::instance();
      let profiles = profile_manager.list_profiles().unwrap_or_default();

      let running_profile_ids: std::collections::HashSet<String> = profiles
        .iter()
        .filter(|p| p.process_id.is_some_and(is_process_running))
        .map(|p| p.id.to_string())
        .collect();

      let running_vpn_ids: std::collections::HashSet<String> = profiles
        .iter()
        .filter(|p| p.process_id.is_some_and(is_process_running))
        .filter_map(|p| p.vpn_id.clone())
        .collect();

      for config in list_proxy_configs() {
        let has_running_browser = config
          .profile_id
          .as_ref()
          .is_some_and(|pid| running_profile_ids.contains(pid));
        if has_running_browser {
          log::info!(
            "Startup: preserving proxy worker {} (profile browser still running)",
            config.id
          );
          continue;
        }

        if let Some(pid) = config.pid {
          if is_process_running(pid) {
            log::info!(
              "Startup: killing orphaned proxy worker {} (PID {})",
              config.id,
              pid
            );
            let _ = crate::proxy::proxy_runner::stop_proxy_process(&config.id).await;
            continue;
          }
        }
        delete_proxy_config(&config.id);
      }

      for worker in list_vpn_worker_configs() {
        if running_vpn_ids.contains(&worker.vpn_id) {
          log::info!(
            "Startup: preserving VPN worker {} (profile browser using vpn_id {} still running)",
            worker.id,
            worker.vpn_id
          );
          continue;
        }

        if let Some(pid) = worker.pid {
          if is_process_running(pid) {
            log::info!(
              "Startup: killing orphaned VPN worker {} (PID {})",
              worker.id,
              pid
            );
            let _ = crate::vpn::vpn_worker_runner::stop_vpn_worker(&worker.id).await;
            continue;
          }
        }
        delete_vpn_worker_config(&worker.id);
      }
    });

    // Reap automation browser/sidecar PIDs left behind by a previous crash.
    // Persisted pid files outlive the process; on a clean start no run is active,
    // so every persisted PID is an orphan from a hard kill and must be cleaned up.
    tauri::async_runtime::spawn(async move {
      crate::automation::reaper::reap_orphans_on_startup().await;
    });

    // Immediately bump non-running profiles to the latest installed browser version.
    // This runs synchronously before any network calls so profiles are updated on launch.
    {
      let app_handle_bump = app.handle().clone();
      match auto_updater::AutoUpdater::instance()
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

    let app_handle_auto_updater = app.handle().clone();

    // Start the auto-update check task separately
    tauri::async_runtime::spawn(async move {
      auto_updater::check_for_updates_with_progress(app_handle_auto_updater).await;
    });

    // Handle any pending URLs that were received before the window was ready
    let handle_pending = handle.clone();
    tauri::async_runtime::spawn(async move {
      // Wait a bit for the window to be fully ready
      tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

      let pending_urls = {
        let mut pending = PENDING_URLS.lock().unwrap();
        let urls = pending.clone();
        pending.clear();
        urls
      };

      for url in pending_urls {
        log::info!("Processing pending URL: {url}");
        if let Err(e) = handle_url_open(handle_pending.clone(), url).await {
          log::error!("Failed to handle pending URL: {e}");
        }
      }
    });

    // Start periodic cleanup task for unused binaries
    // Only runs when sync is not in progress to avoid deleting browsers
    // that might be needed for profiles being synced from the cloud
    tauri::async_runtime::spawn(async move {
      let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(43200)); // Every 12 hours

      loop {
        interval.tick().await;

        // Check if sync is in progress before running cleanup
        if let Some(scheduler) = sync::get_global_scheduler() {
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

    // DNS blocklist refresh task (every 12 hours)
    tauri::async_runtime::spawn(async move {
      let manager = dns_blocklist::BlocklistManager::instance();
      let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(43200));
      interval.tick().await; // Skip the immediate first tick
      loop {
        interval.tick().await;
        manager.refresh_all_stale().await;
      }
    });

    tauri::async_runtime::spawn(async move {
      let updater = app_auto_updater::AppAutoUpdater::instance();
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
            if let Err(e) = events::emit("app-update-available", &update_info) {
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

    // Start Camoufox cleanup task
    let _app_handle_cleanup = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      let camoufox_manager = crate::browser::camoufox_manager::CamoufoxManager::instance();
      let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));

      loop {
        interval.tick().await;

        match camoufox_manager.cleanup_dead_instances().await {
          Ok(_) => {
            // Cleanup completed silently
          }
          Err(e) => {
            log::error!("Error during Camoufox cleanup: {e}");
          }
        }
      }
    });

    // Check and download GeoIP database at startup if needed
    let app_handle_geoip = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      // Wait a bit for the app to fully initialize
      tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

      let geoip_downloader = crate::updater::geoip_downloader::GeoIPDownloader::instance();
      match geoip_downloader.check_missing_geoip_database() {
        Ok(true) => {
          log::info!(
            "GeoIP database is missing for Camoufox profiles, downloading at startup..."
          );
          let geoip_downloader = GeoIPDownloader::instance();
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

    // Start proxy cleanup task for dead browser processes
    let app_handle_proxy_cleanup = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));

      loop {
        interval.tick().await;

        match crate::proxy::proxy_manager::PROXY_MANAGER
          .cleanup_dead_proxies(app_handle_proxy_cleanup.clone())
          .await
        {
          Ok(dead_pids) => {
            if !dead_pids.is_empty() {
              log::info!(
                "Cleaned up proxies for {} dead browser processes",
                dead_pids.len()
              );
            }
          }
          Err(e) => {
            log::error!("Error during proxy cleanup: {e}");
          }
        }
      }
    });

    // Periodically broadcast browser running status to the frontend.
    // When no profiles have stored PIDs (nothing was ever launched this
    // session), we use a long interval (30s) to avoid burning CPU on
    // full process-table scans via sysinfo. Once any profile is running
    // we switch to the fast interval (5s) for responsive UI updates.
    let app_handle_status = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      const FAST_INTERVAL_SECS: u64 = 5;
      const IDLE_INTERVAL_SECS: u64 = 30;

      let mut interval =
        tokio::time::interval(tokio::time::Duration::from_secs(FAST_INTERVAL_SECS));
      interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
      let mut last_running_states: std::collections::HashMap<String, bool> =
        std::collections::HashMap::new();
      let mut current_interval_secs = FAST_INTERVAL_SECS;

      loop {
        interval.tick().await;

        let runner = crate::browser::browser_runner::BrowserRunner::instance();

        // Sync local states with global active running states
        if let Ok(states) = crate::browser::browser_runner::ACTIVE_RUNNING_STATES.lock() {
          for (k, v) in states.iter() {
            last_running_states.insert(k.clone(), *v);
          }
        }

        let profiles = match runner.profile_manager.list_profiles() {
          Ok(p) => p,
          Err(e) => {
            log::warn!("Failed to list profiles in status checker: {e}");
            continue;
          }
        };

        // If no profile has a stored PID and we have no previously-known
        // running states, there's nothing to check — skip the expensive
        // process scan entirely.
        let any_has_pid = profiles.iter().any(|p| p.process_id.is_some());
        let any_was_running = last_running_states.values().any(|&v| v);

        if !any_has_pid && !any_was_running {
          // Switch to the idle interval to reduce CPU
          if current_interval_secs != IDLE_INTERVAL_SECS {
            current_interval_secs = IDLE_INTERVAL_SECS;
            interval =
              tokio::time::interval(tokio::time::Duration::from_secs(IDLE_INTERVAL_SECS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
          }
          continue;
        }

        // At least one profile might be running — use the fast interval
        if current_interval_secs != FAST_INTERVAL_SECS {
          current_interval_secs = FAST_INTERVAL_SECS;
          interval = tokio::time::interval(tokio::time::Duration::from_secs(FAST_INTERVAL_SECS));
          interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        }

        // Only walk profiles that either have a stored PID or that we last
        // saw as running — for users with hundreds of idle profiles this
        // turns an O(N) sysinfo scan into an O(running) scan. The Rust
        // launch path always emits profile-running-changed when a profile
        // STARTS, so newly-running profiles still get tracked here.
        let profiles_to_check: Vec<_> = profiles
          .into_iter()
          .filter(|p| {
            p.process_id.is_some()
              || last_running_states
                .get(&p.id.to_string())
                .copied()
                .unwrap_or(false)
          })
          .collect();

        for profile in profiles_to_check {
          // Check browser status and track changes
          match runner
            .check_browser_status(app_handle_status.clone(), &profile)
            .await
          {
            Ok(is_running) => {
              let profile_id = profile.id.to_string();
              let last_state = last_running_states
                .get(&profile_id)
                .copied()
                .unwrap_or(false);

              // Only emit event if state actually changed
              if last_state != is_running {
                log::debug!(
                  "Status checker detected change for profile {}: {} -> {}",
                  profile.name,
                  last_state,
                  is_running
                );

                if is_running {
                  if let Ok(mut states) = crate::browser::browser_runner::ACTIVE_RUNNING_STATES.lock() {
                    states.insert(profile_id.clone(), true);
                  }

                  #[derive(serde::Serialize)]
                  struct RunningChangedPayload {
                    id: String,
                    is_running: bool,
                  }

                  let payload = RunningChangedPayload {
                    id: profile_id.clone(),
                    is_running: true,
                  };

                  if let Err(e) = events::emit("profile-running-changed", &payload) {
                    log::warn!("Failed to emit profile running changed event: {e}");
                  }

                  if let Some(scheduler) = sync::get_global_scheduler() {
                    scheduler.mark_profile_running(&profile_id).await;
                  }

                  last_running_states.insert(profile_id.clone(), true);
                } else {
                  // Centralized stopped cleanup
                  let _ = runner.handle_profile_stopped(&app_handle_status, &profile_id, Some("Detected by Status Checker poll"), false).await;
                  last_running_states.insert(profile_id.clone(), false);
                }
              } else {
                // Update the state even if unchanged to ensure we have it tracked
                last_running_states.insert(profile_id, is_running);
              }
            }
            Err(e) => {
              log::warn!("Status check failed for profile {}: {}", profile.name, e);
              continue;
            }
          }
        }
      }
    });

    // Nodecar warm-up is now triggered from the frontend to allow UI blocking overlay

    // Start API server if enabled in settings
    let app_handle_api = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      match crate::settings::settings_manager::get_app_settings(app_handle_api.clone()).await {
        Ok(settings) => {
          if settings.api_enabled {
            log::info!("API is enabled in settings, starting API server...");
            match crate::api::api_server::start_api_server_internal(settings.api_port, &app_handle_api)
              .await
            {
              Ok(port) => {
                log::info!("API server started successfully on port {port}");
                // Emit success toast to frontend
                if let Err(e) = events::emit(
                  "show-toast",
                  crate::api::api_server::ToastPayload {
                    message: "API server started successfully".to_string(),
                    variant: "success".to_string(),
                    title: "Local API Started".to_string(),
                    description: Some(format!("API server running on port {port}")),
                  },
                ) {
                  log::error!("Failed to emit API start toast: {e}");
                }
              }
              Err(e) => {
                log::error!("Failed to start API server at startup: {e}");
                // Emit error toast to frontend
                if let Err(toast_err) = events::emit(
                  "show-toast",
                  crate::api::api_server::ToastPayload {
                    message: "Failed to start API server".to_string(),
                    variant: "error".to_string(),
                    title: "Failed to Start Local API".to_string(),
                    description: Some(format!("Error: {e}")),
                  },
                ) {
                  log::error!("Failed to emit API error toast: {toast_err}");
                }
              }
            }
          }
        }
        Err(e) => {
          log::error!("Failed to load app settings for API startup: {e}");
        }
      }
    });

    // Start sync subscription and scheduler if configured
    let app_handle_sync = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      use std::sync::Arc;

      let mut subscription_manager = sync::SubscriptionManager::new();
      let work_rx = subscription_manager.take_work_receiver();

      if let Err(e) = subscription_manager.start(app_handle_sync.clone()).await {
        log::warn!("Failed to start sync subscription: {e}");
      }

      if let Some(work_rx) = work_rx {
        let scheduler = Arc::new(sync::SyncScheduler::new());

        // Set the global scheduler so commands can access it
        sync::set_global_scheduler(scheduler.clone());

        // Start initial sync for all enabled profiles
        scheduler.sync_all_enabled_profiles(&app_handle_sync).await;

        // Check for missing synced profiles (deleted locally but exist remotely)
        match sync::SyncEngine::create_from_settings(&app_handle_sync).await {
          Ok(engine) => {
            if let Err(e) = engine
              .check_for_missing_synced_profiles(&app_handle_sync)
              .await
            {
              log::warn!("Failed to check for missing profiles: {}", e);
            }
            if let Err(e) = engine
              .check_for_missing_synced_entities(&app_handle_sync)
              .await
            {
              log::warn!("Failed to check for missing entities: {}", e);
            }
          }
          Err(e) => {
            log::warn!("Sync not configured, skipping missing profile check: {}", e);
          }
        }

        scheduler
          .clone()
          .start(app_handle_sync.clone(), work_rx)
          .await;
        log::info!("Sync scheduler started");
      }
    });

    // Start cloud auth background refresh loop
    let app_handle_cloud = app.handle().clone();
    tauri::async_runtime::spawn(async move {
      // On startup, refresh sync token, proxy config, and wayfern token in
      // PARALLEL. Previously they were awaited sequentially, so the wayfern
      // token request didn't even start until the earlier two API calls had
      // finished. Wayfern launch can race with this task — a few seconds of
      // serialized API calls translates directly into a slow first launch
      // because launch_wayfern blocks waiting for the token to land.
      // api_call_with_retry handles 401/refresh internally — no direct
      // refresh_access_token call needed.
      if cloud_auth::CLOUD_AUTH.is_logged_in().await {
        let sync_token_fut = async {
          if let Err(e) = cloud_auth::CLOUD_AUTH.get_or_refresh_sync_token().await {
            log::warn!("Failed to refresh cloud sync token on startup: {e}");
          }
        };
        let proxy_fut = async {
          cloud_auth::CLOUD_AUTH.sync_cloud_proxy().await;
        };
        let wayfern_fut = async {
          if cloud_auth::CLOUD_AUTH.has_active_paid_subscription().await {
            if let Err(e) = cloud_auth::CLOUD_AUTH.request_wayfern_token().await {
              log::warn!("Failed to request wayfern token on startup: {e}");
            }
          }
        };
        tokio::join!(sync_token_fut, proxy_fut, wayfern_fut);
      }
      cloud_auth::CloudAuthManager::start_sync_token_refresh_loop(app_handle_cloud).await;
    });

    Ok(())
}
