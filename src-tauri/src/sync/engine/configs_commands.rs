pub async fn enable_proxy_sync_if_needed(proxy_id: &str) -> Result<(), String> {
  let proxy_manager = &crate::proxy::proxy_manager::PROXY_MANAGER;
  let proxies = proxy_manager.get_stored_proxies();
  let proxy = proxies
    .iter()
    .find(|p| p.id == proxy_id)
    .ok_or_else(|| format!("Proxy with ID '{proxy_id}' not found"))?;

  if !proxy.sync_enabled {
    proxy_manager.set_stored_proxy_sync_state(proxy_id, true, proxy.last_sync)?;
    let _ = events::emit("stored-proxies-changed", ());
    log::info!("Auto-enabled sync for proxy {}", proxy_id);
  }

  Ok(())
}

/// Check if VPN is used by any synced profile
pub fn is_vpn_used_by_synced_profile(vpn_id: &str) -> bool {
  let profile_manager = ProfileManager::instance();
  if let Ok(profiles) = profile_manager.list_profiles() {
    profiles
      .iter()
      .any(|p| p.is_sync_enabled() && p.vpn_id.as_deref() == Some(vpn_id))
  } else {
    false
  }
}

/// Enable sync for VPN if not already enabled
pub async fn enable_vpn_sync_if_needed(vpn_id: &str) -> Result<(), String> {
  let vpn = {
    let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
    storage
      .load_config(vpn_id)
      .map_err(|e| format!("VPN with ID '{vpn_id}' not found: {e}"))?
  };

  if !vpn.sync_enabled {
    let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
    storage
      .update_sync_fields(vpn_id, true, None)
      .map_err(|e| format!("Failed to enable VPN sync: {e}"))?;

    let _ = events::emit("vpn-configs-changed", ());
    log::info!("Auto-enabled sync for VPN {}", vpn_id);
  }

  Ok(())
}

/// Enable sync for group if not already enabled
pub async fn enable_group_sync_if_needed(group_id: &str) -> Result<(), String> {
  let group = {
    let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
    let groups = group_manager.get_all_groups().unwrap_or_default();
    groups
      .iter()
      .find(|g| g.id == group_id)
      .ok_or_else(|| format!("Group with ID '{group_id}' not found"))?
      .clone()
  };

  if !group.sync_enabled {
    let mut updated_group = group.clone();
    updated_group.sync_enabled = true;

    {
      let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
      if let Err(e) = group_manager.update_group_internal(&updated_group) {
        return Err(format!("Failed to update group: {e}"));
      }
    }

    let _ = events::emit("groups-changed", ());
    log::info!("Auto-enabled sync for group {}", group_id);
  }

  Ok(())
}

/// Enable sync for extension group (and its member extensions) if not
/// already enabled. Mirrors the proxy/vpn/group helpers — call from any
/// site where a synced profile gains an `extension_group_id`.
pub async fn enable_extension_group_sync_if_needed(extension_group_id: &str) -> Result<(), String> {
  let (group_already_synced, extension_ids) = {
    let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let group = manager
      .get_group(extension_group_id)
      .map_err(|e| format!("Extension group with ID '{extension_group_id}' not found: {e}"))?;
    (group.sync_enabled, group.extension_ids.clone())
  };

  if !group_already_synced {
    let mut updated_group = {
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      manager
        .get_group(extension_group_id)
        .map_err(|e| format!("Failed to load extension group: {e}"))?
    };
    updated_group.sync_enabled = true;
    {
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      manager
        .update_group_internal(&updated_group)
        .map_err(|e| format!("Failed to update extension group sync: {e}"))?;
    }
    let _ = events::emit("extensions-changed", ());
    log::info!(
      "Auto-enabled sync for extension group {}",
      extension_group_id
    );
  }

  // Cascade to every extension referenced by the group so the other device
  // has the actual extension binaries when it pulls the group.
  for ext_id in extension_ids {
    let already_synced = {
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      manager
        .get_extension(&ext_id)
        .ok()
        .map(|e| e.sync_enabled)
        .unwrap_or(true)
    };
    if !already_synced {
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      if let Ok(mut ext) = manager.get_extension(&ext_id) {
        ext.sync_enabled = true;
        if let Err(e) = manager.update_extension_internal(&ext) {
          log::warn!("Failed to auto-enable sync for extension {}: {e}", ext_id);
        } else {
          log::info!("Auto-enabled sync for extension {}", ext_id);
        }
      }
    }
  }

  Ok(())
}

#[tauri::command]
pub async fn set_profile_sync_mode(
  app_handle: tauri::AppHandle,
  profile_id: String,
  sync_mode: String,
) -> Result<(), String> {
  let new_mode = match sync_mode.as_str() {
    "Disabled" => SyncMode::Disabled,
    "Regular" => SyncMode::Regular,
    "Encrypted" => SyncMode::Encrypted,
    _ => return Err(format!("Invalid sync mode: {sync_mode}")),
  };

  let profile_manager = ProfileManager::instance();
  let profiles = profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?;

  let profile_uuid =
    uuid::Uuid::parse_str(&profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
  let mut profile = profiles
    .into_iter()
    .find(|p| p.id == profile_uuid)
    .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

  if profile.is_cross_os() {
    return Err("Cannot modify sync settings for a cross-OS profile".to_string());
  }

  let enabling_now = new_mode != SyncMode::Disabled;
  if enabling_now && profile.process_id.is_some() {
    return Err(serde_json::json!({ "code": "PROFILE_RUNNING" }).to_string());
  }

  if profile.ephemeral {
    return Err("Cannot enable sync for an ephemeral profile".to_string());
  }

  let old_mode = profile.sync_mode;
  let enabling = new_mode != SyncMode::Disabled;

  if enabling {
    let cloud_logged_in = crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await;

    if !cloud_logged_in {
      let manager = SettingsManager::instance();
      let settings = manager
        .load_settings()
        .map_err(|e| format!("Failed to load settings: {e}"))?;

      if settings.sync_server_url.is_none() {
        let _ = events::emit(
          "profile-sync-status",
          serde_json::json!({
            "profile_id": profile_id,
            "profile_name": profile.name,
            "status": "error",
            "error": "Sync server not configured. Please configure sync settings first."
          }),
        );
        return Err(
          "Sync server not configured. Please configure sync settings first.".to_string(),
        );
      }

      let token = manager.get_sync_token(&app_handle).await.ok().flatten();
      if token.is_none() {
        let _ = events::emit(
          "profile-sync-status",
          serde_json::json!({
            "profile_id": profile_id,
            "profile_name": profile.name,
            "status": "error",
            "error": "Sync token not configured. Please configure sync settings first."
          }),
        );
        return Err("Sync token not configured. Please configure sync settings first.".to_string());
      }
    }
  }

  // If switching to Encrypted, verify password is set and generate salt
  if new_mode == SyncMode::Encrypted {
    if !encryption::has_e2e_password() {
      return Err("E2E password not set. Please set a password in Settings first.".to_string());
    }
    if profile.encryption_salt.is_none() {
      profile.encryption_salt = Some(encryption::generate_salt());
    }
  }

  // If switching between Regular<->Encrypted, delete remote manifest to force full re-upload
  let mode_switched = old_mode != SyncMode::Disabled && enabling && old_mode != new_mode;
  if mode_switched {
    if let Ok(engine) = SyncEngine::create_from_settings(&app_handle).await {
      let key_prefix = SyncEngine::get_team_key_prefix(&profile).await;
      let manifest_key = format!("{}profiles/{}/manifest.json", key_prefix, profile_id);
      let _ = engine.client.delete(&manifest_key, None).await;
      log::info!(
        "Deleted remote manifest for profile {} due to sync mode change ({:?} -> {:?})",
        profile_id,
        old_mode,
        new_mode
      );
    }
  }

  profile.sync_mode = new_mode;

  profile_manager
    .save_profile(&profile)
    .map_err(|e| format!("Failed to save profile: {e}"))?;

  let _ = events::emit("profiles-changed", ());

  // When (re-)enabling sync, clear any stale tombstone from a previous
  // disable on this device. Otherwise the next reconcile on another
  // device — or even a race on this one — would see the tombstone and
  // delete the freshly re-uploaded data.
  if enabling {
    if let Ok(engine) = SyncEngine::create_from_settings(&app_handle).await {
      let key_prefix = SyncEngine::get_team_key_prefix(&profile).await;
      let personal_tombstone = format!("tombstones/profiles/{}.json", profile_id);
      let _ = engine.client.delete(&personal_tombstone, None).await;
      if !key_prefix.is_empty() {
        let team_tombstone = format!("{}tombstones/profiles/{}.json", key_prefix, profile_id);
        let _ = engine.client.delete(&team_tombstone, None).await;
      }
    }
  }

  if enabling {
    let is_running = profile.process_id.is_some();

    let _ = events::emit(
      "profile-sync-status",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "status": if is_running { "waiting" } else { "syncing" }
      }),
    );

    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler
        .queue_profile_sync_immediate(profile_id.clone())
        .await;

      if let Some(ref proxy_id) = profile.proxy_id {
        if let Err(e) = enable_proxy_sync_if_needed(proxy_id).await {
          log::warn!("Failed to enable sync for proxy {}: {}", proxy_id, e);
        } else {
          scheduler.queue_proxy_sync(proxy_id.clone()).await;
        }
      }
      if let Some(ref group_id) = profile.group_id {
        if let Err(e) = enable_group_sync_if_needed(group_id).await {
          log::warn!("Failed to enable sync for group {}: {}", group_id, e);
        } else {
          scheduler.queue_group_sync(group_id.clone()).await;
        }
      }
      if let Some(ref vpn_id) = profile.vpn_id {
        if let Err(e) = enable_vpn_sync_if_needed(vpn_id).await {
          log::warn!("Failed to enable sync for VPN {}: {}", vpn_id, e);
        } else {
          scheduler.queue_vpn_sync(vpn_id.clone()).await;
        }
      }
      if let Some(ref ext_group_id) = profile.extension_group_id {
        if let Err(e) = enable_extension_group_sync_if_needed(ext_group_id).await {
          log::warn!(
            "Failed to enable sync for extension group {}: {}",
            ext_group_id,
            e
          );
        } else {
          scheduler
            .queue_extension_group_sync(ext_group_id.clone())
            .await;
        }
      }
    } else {
      log::warn!("Scheduler not initialized, sync will not start");
    }
  } else {
    // Delete remote data when disabling sync. Awaited (not spawned) so the
    // tombstone write completes before this command returns. A previous
    // tokio::spawn here allowed the tombstone-write to land *after* a fast
    // user-triggered re-enable's tombstone-clear, re-introducing the
    // tombstone and tripping the reconcile-pass deletion of a profile the
    // user had just re-enabled (e.g. Personal (z.ai) on 2026-05-20).
    if old_mode != SyncMode::Disabled {
      match SyncEngine::create_from_settings(&app_handle).await {
        Ok(engine) => {
          if let Err(e) = engine.delete_profile(&profile_id).await {
            log::warn!("Failed to delete profile {} from sync: {}", profile_id, e);
          } else {
            log::info!("Profile {} deleted from sync service", profile_id);
          }
        }
        Err(e) => {
          log::debug!("Sync not configured, skipping remote deletion: {}", e);
        }
      }
    }

    let _ = events::emit(
      "profile-sync-status",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "status": "disabled"
      }),
    );
  }

  if crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await {
    let sync_count = profile_manager
      .list_profiles()
      .map(|profiles| profiles.iter().filter(|p| p.is_sync_enabled()).count())
      .unwrap_or(0);

    tokio::spawn(async move {
      if let Err(e) = crate::api::cloud_auth::CLOUD_AUTH
        .report_sync_profile_count(sync_count as i64)
        .await
      {
        log::warn!("Failed to report sync profile count: {e}");
      }
    });
  }

  Ok(())
}

#[tauri::command]
pub async fn request_profile_sync(
  _app_handle: tauri::AppHandle,
  profile_id: String,
) -> Result<(), String> {
  // Validate profile exists and sync is enabled
  let profile_manager = ProfileManager::instance();
  let profiles = profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?;

  let profile_uuid =
    uuid::Uuid::parse_str(&profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
  let profile = profiles
    .into_iter()
    .find(|p| p.id == profile_uuid)
    .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

  if !profile.is_sync_enabled() {
    return Err("Sync is not enabled for this profile".to_string());
  }

  // Queue sync via scheduler
  if let Some(scheduler) = super::get_global_scheduler() {
    let is_running = profile.process_id.is_some();
    let _ = events::emit(
      "profile-sync-status",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "status": if is_running { "waiting" } else { "syncing" }
      }),
    );

    scheduler.queue_profile_sync_immediate(profile_id).await;
    Ok(())
  } else {
    Err("Sync scheduler not initialized".to_string())
  }
}

#[tauri::command]
pub async fn sync_profile(app_handle: tauri::AppHandle, profile_id: String) -> Result<(), String> {
  trigger_sync_for_profile(app_handle, profile_id).await
}

/// Ensure the device has either a cloud login or a self-hosted server URL + token.
/// Returns a JSON error code string consumable by the frontend translator.
async fn ensure_sync_configured(app_handle: &tauri::AppHandle) -> Result<(), String> {
  let cloud_logged_in = crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await;
  if cloud_logged_in {
    return Ok(());
  }
  let manager = SettingsManager::instance();
  let settings = manager.load_settings().map_err(|e| {
    serde_json::json!({ "code": "INTERNAL_ERROR", "params": { "detail": e.to_string() } })
      .to_string()
  })?;
  if settings.sync_server_url.is_none() {
    return Err(serde_json::json!({ "code": "SYNC_NOT_CONFIGURED" }).to_string());
  }
  let token = manager.get_sync_token(app_handle).await.ok().flatten();
  if token.is_none() {
    return Err(serde_json::json!({ "code": "SYNC_NOT_CONFIGURED" }).to_string());
  }
  Ok(())
}

pub async fn trigger_sync_for_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
) -> Result<(), String> {
  let engine = SyncEngine::create_from_settings(&app_handle)
    .await
    .map_err(|e| format!("Failed to create sync engine: {e}"))?;

  let profile_manager = ProfileManager::instance();
  let profiles = profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?;

  let profile_uuid =
    uuid::Uuid::parse_str(&profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
  let profile = profiles
    .into_iter()
    .find(|p| p.id == profile_uuid)
    .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

  engine
    .sync_profile(&app_handle, &profile)
    .await
    .map_err(|e| format!("Sync failed: {e}"))?;

  Ok(())
}

#[tauri::command]
pub async fn set_proxy_sync_enabled(
  app_handle: tauri::AppHandle,
  proxy_id: String,
  enabled: bool,
) -> Result<(), String> {
  let proxy_manager = &crate::proxy::proxy_manager::PROXY_MANAGER;
  let proxies = proxy_manager.get_stored_proxies();
  let proxy = proxies
    .iter()
    .find(|p| p.id == proxy_id)
    .ok_or_else(|| serde_json::json!({ "code": "PROXY_NOT_FOUND" }).to_string())?;

  // Block modifying sync for cloud-managed proxies
  if proxy.is_cloud_managed {
    return Err(serde_json::json!({ "code": "CANNOT_MODIFY_CLOUD_MANAGED_PROXY" }).to_string());
  }

  // If disabling, check if proxy is used by any synced profile
  if !enabled && is_proxy_used_by_synced_profile(&proxy_id) {
    return Err(serde_json::json!({ "code": "SYNC_LOCKED_BY_PROFILE" }).to_string());
  }

  // If enabling, check that sync settings are configured
  if enabled {
    ensure_sync_configured(&app_handle).await?;
  }

  let new_last_sync = if enabled { proxy.last_sync } else { None };
  proxy_manager
    .set_stored_proxy_sync_state(&proxy_id, enabled, new_last_sync)
    .map_err(|e| {
      serde_json::json!({ "code": "INTERNAL_ERROR", "params": { "detail": e } }).to_string()
    })?;

  let _ = events::emit("stored-proxies-changed", ());

  if enabled {
    let _ = events::emit(
      "proxy-sync-status",
      serde_json::json!({
        "id": proxy_id,
        "status": "syncing"
      }),
    );

    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_proxy_sync(proxy_id).await;
    }
  } else {
    let _ = events::emit(
      "proxy-sync-status",
      serde_json::json!({
        "id": proxy_id,
        "status": "disabled"
      }),
    );
  }

  Ok(())
}

#[tauri::command]
pub async fn set_group_sync_enabled(
  app_handle: tauri::AppHandle,
  group_id: String,
  enabled: bool,
) -> Result<(), String> {
  let group = {
    let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
    let groups = group_manager.get_all_groups().unwrap_or_default();
    groups
      .iter()
      .find(|g| g.id == group_id)
      .ok_or_else(|| serde_json::json!({ "code": "GROUP_NOT_FOUND" }).to_string())?
      .clone()
  };

  // If disabling, check if group is used by any synced profile
  if !enabled && is_group_used_by_synced_profile(&group_id) {
    return Err(serde_json::json!({ "code": "SYNC_LOCKED_BY_PROFILE" }).to_string());
  }

  // If enabling, check that sync settings are configured
  if enabled {
    ensure_sync_configured(&app_handle).await?;
  }

  let mut updated_group = group.clone();
  updated_group.sync_enabled = enabled;

  if !enabled {
    updated_group.last_sync = None;
  }

  {
    let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
    if let Err(e) = group_manager.update_group_internal(&updated_group) {
      return Err(
        serde_json::json!({ "code": "INTERNAL_ERROR", "params": { "detail": e.to_string() } })
          .to_string(),
      );
    }
  }

  let _ = events::emit("groups-changed", ());

  if enabled {
    let _ = events::emit(
      "group-sync-status",
      serde_json::json!({
        "id": group_id,
        "status": "syncing"
      }),
    );

    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_group_sync(group_id).await;
    }
  } else {
    let _ = events::emit(
      "group-sync-status",
      serde_json::json!({
        "id": group_id,
        "status": "disabled"
      }),
    );
  }

  Ok(())
}

