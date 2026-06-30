#[tauri::command]
async fn connect_vpn(vpn_id: String) -> Result<(), String> {
  // Start VPN worker process (detached, survives GUI shutdown)
  vpn_worker_runner::start_vpn_worker(&vpn_id)
    .await
    .map_err(|e| format!("Failed to connect VPN: {e}"))?;

  // Update last_used timestamp
  {
    let storage = vpn::VPN_STORAGE
      .lock()
      .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;
    let _ = storage.update_last_used(&vpn_id);
  }

  Ok(())
}

#[tauri::command]
async fn disconnect_vpn(vpn_id: String) -> Result<(), String> {
  vpn_worker_runner::stop_vpn_worker_by_vpn_id(&vpn_id)
    .await
    .map_err(|e| format!("Failed to disconnect VPN: {e}"))?;
  Ok(())
}

#[tauri::command]
async fn get_vpn_status(vpn_id: String) -> Result<vpn::VpnStatus, String> {
  use crate::proxy::proxy_storage::is_process_running;

  if let Some(worker) = vpn_worker_storage::find_vpn_worker_by_vpn_id(&vpn_id) {
    let connected = worker.pid.map(is_process_running).unwrap_or(false);
    Ok(vpn::VpnStatus {
      connected,
      vpn_id,
      connected_at: None,
      bytes_sent: None,
      bytes_received: None,
      last_handshake: None,
    })
  } else {
    Ok(vpn::VpnStatus {
      connected: false,
      vpn_id,
      connected_at: None,
      bytes_sent: None,
      bytes_received: None,
      last_handshake: None,
    })
  }
}

#[tauri::command]
async fn list_active_vpn_connections() -> Result<Vec<vpn::VpnStatus>, String> {
  use crate::proxy::proxy_storage::is_process_running;

  let workers = vpn_worker_storage::list_vpn_worker_configs();
  Ok(
    workers
      .into_iter()
      .filter(|w| w.pid.map(is_process_running).unwrap_or(false))
      .map(|w| vpn::VpnStatus {
        connected: true,
        vpn_id: w.vpn_id,
        connected_at: None,
        bytes_sent: None,
        bytes_received: None,
        last_handshake: None,
      })
      .collect(),
  )
}

#[tauri::command]
async fn generate_sample_fingerprint(
  app_handle: tauri::AppHandle,
  browser: String,
  version: String,
  config_json: String,
) -> Result<String, String> {
  let temp_profile = crate::profile::BrowserProfile {
    id: uuid::Uuid::new_v4(),
    name: "temp_fingerprint_gen".to_string(),
    browser: browser.clone(),
    version: version.clone(),
    process_id: None,
    proxy_id: None,
    vpn_id: None,
    launch_hook: None,
    automation: None,
    last_launch: None,
    release_type: "stable".to_string(),
    camoufox_config: None,
    wayfern_config: None,
    group_id: None,
    tags: Vec::new(),
    note: None,
    sync_mode: crate::profile::types::SyncMode::Disabled,
    encryption_salt: None,
    last_sync: None,
    host_os: None,
    ephemeral: false,
    extension_group_id: None,
    proxy_bypass_rules: Vec::new(),
    created_by_id: None,
    created_by_email: None,
    dns_blocklist: None,
    password_protected: false,
    created_at: None,
    updated_at: None,
    profile_status: None,
  };

  if browser == "camoufox" {
    let config: crate::browser::camoufox_manager::CamoufoxConfig =
      serde_json::from_str(&config_json).map_err(|e| format!("Failed to parse config: {e}"))?;
    let manager = crate::browser::camoufox_manager::CamoufoxManager::instance();
    manager
      .generate_fingerprint_config(&app_handle, &temp_profile, &config)
      .await
      .map_err(|e| format!("Failed to generate fingerprint: {e}"))
  } else if browser == "wayfern" {
    let config: crate::browser::wayfern_manager::WayfernConfig =
      serde_json::from_str(&config_json).map_err(|e| format!("Failed to parse config: {e}"))?;
    let manager = crate::browser::wayfern_manager::WayfernManager::instance();
    manager
      .generate_fingerprint_config(&app_handle, &temp_profile, &config)
      .await
      .map_err(|e| format!("Failed to generate fingerprint: {e}"))
  } else {
    Err(format!(
      "Unsupported browser for fingerprint generation: {browser}"
    ))
  }
}

/// Confirm a quit chosen from the close-confirmation dialog and exit the app.
#[tauri::command]
fn confirm_quit(app_handle: tauri::AppHandle) {
  QUIT_CONFIRMED.store(true, Ordering::SeqCst);
  app_handle.exit(0);
}

/// Hide the main window so the app keeps running behind its tray icon.
#[tauri::command]
fn hide_to_tray(app_handle: tauri::AppHandle) -> Result<(), String> {
  if let Some(window) = app_handle.get_webview_window("main") {
    window.hide().map_err(|e| e.to_string())?;
  }
  Ok(())
}

fn show_main_window(app_handle: &tauri::AppHandle) {
  if let Some(window) = app_handle.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

