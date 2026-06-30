#[tauri::command]
async fn list_mcp_agents() -> Result<Vec<mcp_integrations::McpAgentInfo>, String> {
  let claude_desktop_connected = is_mcp_in_claude_desktop_internal();
  Ok(mcp_integrations::list_agents_with_status(&[(
    "claude-desktop",
    claude_desktop_connected,
  )]))
}

#[tauri::command]
async fn add_mcp_to_agent(app_handle: tauri::AppHandle, agent_id: String) -> Result<(), String> {
  if !mcp_integrations::agent_exists(&agent_id) {
    return Err(format!("Unknown agent: {agent_id}"));
  }
  if agent_id == "claude-desktop" {
    return add_mcp_to_claude_desktop_internal(&app_handle).await;
  }
  let url = current_mcp_url(&app_handle).await?;
  mcp_integrations::install_generic(&agent_id, &url)
}

#[tauri::command]
async fn remove_mcp_from_agent(agent_id: String) -> Result<(), String> {
  if !mcp_integrations::agent_exists(&agent_id) {
    return Err(format!("Unknown agent: {agent_id}"));
  }
  if agent_id == "claude-desktop" {
    return remove_mcp_from_claude_desktop_internal();
  }
  mcp_integrations::uninstall_generic(&agent_id)
}

#[tauri::command]
async fn is_geoip_database_available() -> Result<bool, String> {
  Ok(GeoIPDownloader::is_geoip_database_available())
}

#[tauri::command]
async fn get_all_traffic_snapshots(
) -> Result<Vec<crate::proxy::traffic_stats::TrafficSnapshot>, String> {
  // Use real-time snapshots that merge in-memory data with disk data
  Ok(crate::proxy::traffic_stats::get_all_traffic_snapshots_realtime())
}

#[tauri::command]
async fn get_profile_traffic_snapshot(
  profile_id: String,
) -> Result<Option<crate::proxy::traffic_stats::TrafficSnapshot>, String> {
  Ok(crate::proxy::traffic_stats::get_traffic_snapshot_for_profile(&profile_id))
}

#[tauri::command]
async fn clear_all_traffic_stats() -> Result<(), String> {
  crate::proxy::traffic_stats::clear_all_traffic_stats()
    .map_err(|e| format!("Failed to clear traffic stats: {e}"))
}

#[tauri::command]
async fn get_traffic_stats_for_period(
  profile_id: String,
  seconds: u64,
) -> Result<Option<crate::proxy::traffic_stats::FilteredTrafficStats>, String> {
  Ok(crate::proxy::traffic_stats::get_traffic_stats_for_period(
    &profile_id,
    seconds,
  ))
}

#[tauri::command]
async fn download_geoip_database(app_handle: tauri::AppHandle) -> Result<(), String> {
  let downloader = GeoIPDownloader::instance();
  downloader
    .download_geoip_database(&app_handle)
    .await
    .map_err(|e| format!("Failed to download GeoIP database: {e}"))
}

// VPN commands
#[tauri::command]
async fn import_vpn_config(
  content: String,
  filename: String,
  name: Option<String>,
) -> Result<vpn::VpnImportResult, String> {
  let storage = vpn::VPN_STORAGE
    .lock()
    .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;

  match storage.import_config(&content, &filename, name.clone()) {
    Ok(config) => {
      if config.sync_enabled {
        if let Some(scheduler) = sync::get_global_scheduler() {
          let id = config.id.clone();
          tauri::async_runtime::spawn(async move {
            scheduler.queue_vpn_sync(id).await;
          });
        }
      }
      Ok(vpn::VpnImportResult {
        success: true,
        vpn_id: Some(config.id),
        vpn_type: Some(config.vpn_type),
        name: config.name,
        error: None,
      })
    }
    Err(e) => Ok(vpn::VpnImportResult {
      success: false,
      vpn_id: None,
      vpn_type: None,
      name: name.unwrap_or_else(|| filename.clone()),
      error: Some(e.to_string()),
    }),
  }
}

#[tauri::command]
async fn list_vpn_configs() -> Result<Vec<vpn::VpnConfig>, String> {
  let storage = vpn::VPN_STORAGE
    .lock()
    .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;

  storage
    .list_configs()
    .map_err(|e| format!("Failed to list VPN configs: {e}"))
}

#[tauri::command]
async fn get_vpn_config(vpn_id: String) -> Result<vpn::VpnConfig, String> {
  let storage = vpn::VPN_STORAGE
    .lock()
    .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;

  storage
    .load_config(&vpn_id)
    .map_err(|e| format!("Failed to load VPN config: {e}"))
}

#[tauri::command]
async fn delete_vpn_config(app_handle: tauri::AppHandle, vpn_id: String) -> Result<(), String> {
  // First disconnect if connected (stop VPN worker)
  let _ = vpn_worker_runner::stop_vpn_worker_by_vpn_id(&vpn_id).await;

  // Check if sync was enabled before deleting
  let was_sync_enabled = {
    let storage = vpn::VPN_STORAGE
      .lock()
      .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;
    storage
      .load_config(&vpn_id)
      .map(|c| c.sync_enabled)
      .unwrap_or(false)
  };

  // Delete from storage
  {
    let storage = vpn::VPN_STORAGE
      .lock()
      .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;

    storage
      .delete_config(&vpn_id)
      .map_err(|e| format!("Failed to delete VPN config: {e}"))?;
  }

  // If sync was enabled, also delete from remote
  if was_sync_enabled {
    let vpn_id_clone = vpn_id.clone();
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
      match sync::SyncEngine::create_from_settings(&app_handle_clone).await {
        Ok(engine) => {
          if let Err(e) = engine.delete_vpn(&vpn_id_clone).await {
            log::warn!("Failed to delete VPN {} from sync: {}", vpn_id_clone, e);
          } else {
            log::info!("VPN {} deleted from sync storage", vpn_id_clone);
          }
        }
        Err(e) => {
          log::debug!("Sync not configured, skipping remote VPN deletion: {}", e);
        }
      }
    });
  }

  let _ = events::emit("vpn-configs-changed", ());

  Ok(())
}

#[tauri::command]
async fn create_vpn_config_manual(
  name: String,
  vpn_type: vpn::VpnType,
  config_data: String,
) -> Result<vpn::VpnConfig, String> {
  let config = {
    let storage = vpn::VPN_STORAGE
      .lock()
      .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;

    storage
      .create_config_manual(&name, vpn_type, &config_data)
      .map_err(|e| format!("Failed to create VPN config: {e}"))?
  };

  if config.sync_enabled {
    if let Some(scheduler) = sync::get_global_scheduler() {
      let id = config.id.clone();
      tauri::async_runtime::spawn(async move {
        scheduler.queue_vpn_sync(id).await;
      });
    }
  }

  Ok(config)
}

#[tauri::command]
async fn update_vpn_config(vpn_id: String, name: String) -> Result<vpn::VpnConfig, String> {
  let config = {
    let storage = vpn::VPN_STORAGE
      .lock()
      .map_err(|e| format!("Failed to lock VPN storage: {e}"))?;

    storage
      .update_config_name(&vpn_id, &name)
      .map_err(|e| format!("Failed to update VPN config: {e}"))?
  };

  if config.sync_enabled {
    if let Some(scheduler) = sync::get_global_scheduler() {
      let id = config.id.clone();
      tauri::async_runtime::spawn(async move {
        scheduler.queue_vpn_sync(id).await;
      });
    }
  }

  Ok(config)
}

#[tauri::command]
async fn check_vpn_validity(
  vpn_id: String,
) -> Result<crate::proxy::proxy_manager::ProxyCheckResult, String> {
  check_vpn_validity_core(&vpn_id).await
}

pub async fn check_vpn_validity_core(
  vpn_id: &str,
) -> Result<crate::proxy::proxy_manager::ProxyCheckResult, String> {
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs();

  let had_existing_worker = vpn_worker_storage::find_vpn_worker_by_vpn_id(vpn_id).is_some();

  let vpn_worker = vpn_worker_runner::start_vpn_worker(vpn_id)
    .await
    .map_err(|e| format!("Failed to start VPN worker: {e}"))?;

  let socks_url = format!(
    "socks5://127.0.0.1:{}",
    vpn_worker.local_port.unwrap_or_default()
  );

  let local_proxy = crate::proxy::proxy_runner::start_proxy_process(Some(socks_url), None)
    .await
    .map_err(|error| error.to_string());
  let local_proxy = match local_proxy {
    Ok(proxy) => proxy,
    Err(error_message) => {
      if !had_existing_worker {
        let _ = vpn_worker_runner::stop_vpn_worker(&vpn_worker.id).await;
      }
      return Err(format!("Failed to start validation proxy: {error_message}"));
    }
  };

  let local_proxy_url = format!(
    "http://127.0.0.1:{}",
    local_proxy.local_port.unwrap_or_default()
  );

  let mut result = None;
  for attempt in 0..3 {
    if attempt > 0 {
      tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    match ip_utils::fetch_public_ip(Some(&local_proxy_url)).await {
      Ok(ip) => {
        let (city, country, country_code, loc, timezone, zip_code, name, asn, country_text) =
          crate::proxy::proxy_manager::ProxyManager::get_ip_geolocation(&ip)
            .await
            .unwrap_or_default();

        result = Some(crate::proxy::proxy_manager::ProxyCheckResult {
          ip,
          city,
          country,
          country_code,
          timestamp: now,
          is_valid: true,
          loc,
          timezone,
          zip_code,
          name,
          asn,
          country_text,
        });
        break;
      }
      Err(error) => {
        log::warn!(
          "VPN validation attempt {} failed to fetch public IP through donut-proxy: {}",
          attempt + 1,
          error
        );
      }
    }
  }

  let _ = crate::proxy::proxy_runner::stop_proxy_process(&local_proxy.id).await;
  if !had_existing_worker {
    let _ = vpn_worker_runner::stop_vpn_worker(&vpn_worker.id).await;
  }

  let result = result.unwrap_or(crate::proxy::proxy_manager::ProxyCheckResult {
    ip: String::new(),
    city: None,
    country: None,
    country_code: None,
    timestamp: now,
    is_valid: false,
    loc: None,
    timezone: None,
    zip_code: None,
    name: None,
    asn: None,
    country_text: None,
  });

  Ok(result)
}

/// Validate that a profile's selected proxy or VPN actually works before the
/// profile is created. Shared by the Tauri command, REST API, and MCP create
/// paths so a dead/unreachable proxy or VPN (or a 402 from an expired proxy
/// subscription) fails creation identically everywhere. Returns structured
/// `{ "code": ... }` error strings the frontend translates via backend-errors.ts.
pub async fn validate_profile_network(
  proxy_id: Option<&str>,
  vpn_id: Option<&str>,
) -> Result<(), String> {
  if let Some(vpn_id) = vpn_id.filter(|s| !s.is_empty()) {
    let result = check_vpn_validity_core(vpn_id).await?;
    if !result.is_valid {
      return Err(serde_json::json!({ "code": "VPN_NOT_WORKING" }).to_string());
    }
    return Ok(());
  }

  if let Some(proxy_id) = proxy_id.filter(|s| !s.is_empty()) {
    // The cloud-included proxy is managed infrastructure; its only failure mode
    // is the user hitting their usage limit, which surfaces as a 402 at request
    // time. There's nothing to pre-validate here.
    if proxy_id == crate::proxy::proxy_manager::CLOUD_PROXY_ID {
      return Ok(());
    }
    let settings = crate::proxy::proxy_manager::PROXY_MANAGER
      .get_proxy_settings_by_id(proxy_id)
      .ok_or_else(|| format!("Proxy '{proxy_id}' not found"))?;
    match crate::proxy::proxy_manager::PROXY_MANAGER
      .check_proxy_validity(proxy_id, &settings)
      .await
    {
      Ok(result) if result.is_valid => {}
      Ok(_) => {
        return Err(serde_json::json!({ "code": "PROXY_NOT_WORKING" }).to_string());
      }
      Err(err) if err.contains("402") => {
        return Err(serde_json::json!({ "code": "PROXY_PAYMENT_REQUIRED" }).to_string());
      }
      Err(_) => {
        return Err(serde_json::json!({ "code": "PROXY_NOT_WORKING" }).to_string());
      }
    }
  }

  Ok(())
}

