// lib_setup_background_services.rs
// Background service tasks: MCP auto-start, status broadcast, API server, sync subscription, cloud auth refresh
// Extracted from lib_setup.rs to improve maintainability and follow SRP

use tauri::AppHandle;

/// Spawn all service-related background tasks.
/// Call this from setup_tauri_app to initialize service infrastructure.
///
/// # Arguments
/// * `app` - The Tauri app handle for accessing app resources
/// * `startup_url` - Optional startup URL from command line arguments
pub fn spawn_service_tasks(app: &AppHandle, _startup_url: Option<String>) {
    spawn_mcp_autostart(app);
    spawn_status_broadcast(app);
    spawn_api_server_startup(app);
    spawn_sync_subscription(app);
    spawn_cloud_auth_refresh(app);
}

// Auto-start MCP server if it was previously enabled in settings.
// Always log the decision so customer logs reveal whether MCP is actually running —
// "automation features don't work" is otherwise indistinguishable from
// "MCP server isn't enabled" without this line.
fn spawn_mcp_autostart(_app: &AppHandle) {
    let mcp_handle = _app.clone();
    let settings_mgr = crate::settings::settings_manager::SettingsManager::instance();
    match settings_mgr.load_settings() {
        Ok(settings) => {
            if settings.mcp_enabled {
                log::info!("MCP server is enabled in settings, attempting auto-start");
                tauri::async_runtime::spawn(async move {
                    match crate::mcp::mcp_server::McpServer::instance().start(mcp_handle).await {
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

// Periodically broadcast browser running status to the frontend.
// When no profiles have stored PIDs (nothing was ever launched this
// session), we use a long interval (30s) to avoid burning CPU on
// full process-table scans via sysinfo. Once any profile is running
// we switch to the fast interval (5s) for responsive UI updates.
fn spawn_status_broadcast(_app: &AppHandle) {
    let app_handle_status = _app.clone();
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

                                if let Err(e) = crate::events::emit("profile-running-changed", &payload) {
                                    log::warn!("Failed to emit profile running changed event: {e}");
                                }

                                if let Some(scheduler) = crate::sync::get_global_scheduler() {
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
}

// Start API server if enabled in settings
fn spawn_api_server_startup(_app: &AppHandle) {
    let app_handle_api = _app.clone();
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
                            if let Err(e) = crate::events::emit(
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
                            if let Err(toast_err) = crate::events::emit(
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
}

// Start sync subscription for cloud profile synchronization
fn spawn_sync_subscription(_app: &AppHandle) {
    let app_handle_sync = _app.clone();
    tauri::async_runtime::spawn(async move {
        use std::sync::Arc;

        let mut subscription_manager = crate::sync::SubscriptionManager::new();
        let work_rx = subscription_manager.take_work_receiver();

        if let Err(e) = subscription_manager.start(app_handle_sync.clone()).await {
            log::warn!("Failed to start sync subscription: {e}");
        }

        if let Some(work_rx) = work_rx {
            let scheduler = Arc::new(crate::sync::SyncScheduler::new());

            // Set the global scheduler so commands can access it
            crate::sync::set_global_scheduler(scheduler.clone());

            // Start initial sync for all enabled profiles
            scheduler.sync_all_enabled_profiles(&app_handle_sync).await;

            // Check for missing synced profiles (deleted locally but exist remotely)
            match crate::sync::SyncEngine::create_from_settings(&app_handle_sync).await {
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
}

// Periodically refresh cloud authentication token
fn spawn_cloud_auth_refresh(_app: &AppHandle) {
    // Start cloud auth background refresh loop
    let app_handle_cloud = _app.clone();
    tauri::async_runtime::spawn(async move {
        // On startup, refresh sync token, proxy config, and wayfern token in
        // PARALLEL. Previously they were awaited sequentially, so the wayfern
        // token request didn't even start until the earlier two API calls had
        // finished. Wayfern launch can race with this task — a few seconds of
        // serialized API calls translates directly into a slow first launch
        // because launch_wayfern blocks waiting for the token to land.
        // api_call_with_retry handles 401/refresh internally — no direct
        // refresh_access_token call needed.
        if crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await {
            let sync_token_fut = async {
                if let Err(e) = crate::api::cloud_auth::CLOUD_AUTH.get_or_refresh_sync_token().await {
                    log::warn!("Failed to refresh cloud sync token on startup: {e}");
                }
            };
            let proxy_fut = async {
                crate::api::cloud_auth::CLOUD_AUTH.sync_cloud_proxy().await;
            };
            let wayfern_fut = async {
                if crate::api::cloud_auth::CLOUD_AUTH.has_active_paid_subscription().await {
                    if let Err(e) = crate::api::cloud_auth::CLOUD_AUTH.request_wayfern_token().await {
                        log::warn!("Failed to request wayfern token on startup: {e}");
                    }
                }
            };
            tokio::join!(sync_token_fut, proxy_fut, wayfern_fut);
        }
        crate::api::cloud_auth::CloudAuthManager::start_sync_token_refresh_loop(app_handle_cloud).await;
    });
}
