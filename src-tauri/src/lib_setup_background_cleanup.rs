// lib_setup_background_cleanup.rs
// Background cleanup tasks: stale processes, orphaned workers, automation reapers, Camoufox/proxy cleanup
// Extracted from lib_setup.rs to improve maintainability and follow SRP

use tauri::AppHandle;

/// Spawn all cleanup-related background tasks.
/// Call this from setup_tauri_app to initialize cleanup infrastructure.
pub fn spawn_cleanup_tasks(app: &AppHandle) {
  spawn_stale_process_cleanup(app);
  spawn_orphaned_worker_cleanup(app);
  spawn_automation_reaper(app);
  spawn_camoufox_cleanup(app);
  spawn_proxy_cleanup(app);
}

// Cleanup stale process IDs from profiles (processes that died while app was closed)
fn spawn_stale_process_cleanup(_app: &AppHandle) {
  // Clear stale process IDs from profiles (processes that died while app was closed)
  {
    let profile_manager = crate::profile::ProfileManager::instance();
    if let Ok(profiles) = profile_manager.list_profiles() {
      let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_processes(sysinfo::ProcessRefreshKind::everything()),
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
fn spawn_orphaned_worker_cleanup(_app: &AppHandle) {
  tauri::async_runtime::spawn(async move {
    use crate::proxy::proxy_storage::{
      delete_proxy_config, is_process_running, list_proxy_configs,
    };
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
}

// Reap automation browser/sidecar PIDs left behind by a previous crash.
// Persisted pid files outlive the process; on a clean start no run is active,
// so every persisted PID is an orphan from a hard kill and must be cleaned up.
fn spawn_automation_reaper(_app: &AppHandle) {
  tauri::async_runtime::spawn(async move {
    crate::automation::reaper::reap_orphans_on_startup().await;
  });
}

// Start Camoufox cleanup task for dead instances
fn spawn_camoufox_cleanup(_app: &AppHandle) {
  // Start Camoufox cleanup task
  let _app_handle_cleanup = _app.clone();
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
}

// Start proxy cleanup task for dead browser processes
fn spawn_proxy_cleanup(_app: &AppHandle) {
  // Start proxy cleanup task for dead browser processes
  let app_handle_proxy_cleanup = _app.clone();
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
}
