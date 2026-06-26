#[tauri::command]
pub fn is_proxy_in_use_by_synced_profile(proxy_id: String) -> bool {
  is_proxy_used_by_synced_profile(&proxy_id)
}

#[tauri::command]
pub fn is_group_in_use_by_synced_profile(group_id: String) -> bool {
  is_group_used_by_synced_profile(&group_id)
}

#[tauri::command]
pub async fn set_vpn_sync_enabled(
  app_handle: tauri::AppHandle,
  vpn_id: String,
  enabled: bool,
) -> Result<(), String> {
  let vpn = {
    let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
    storage
      .load_config(&vpn_id)
      .map_err(|_| serde_json::json!({ "code": "VPN_NOT_FOUND" }).to_string())?
  };

  // If disabling, check if VPN is used by any synced profile
  if !enabled && is_vpn_used_by_synced_profile(&vpn_id) {
    return Err(serde_json::json!({ "code": "SYNC_LOCKED_BY_PROFILE" }).to_string());
  }

  // If enabling, check that sync settings are configured
  if enabled {
    ensure_sync_configured(&app_handle).await?;
  }

  let last_sync = if enabled { vpn.last_sync } else { None };

  {
    let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
    storage
      .update_sync_fields(&vpn_id, enabled, last_sync)
      .map_err(|e| {
        serde_json::json!({ "code": "INTERNAL_ERROR", "params": { "detail": e.to_string() } })
          .to_string()
      })?;
  }

  let _ = events::emit("vpn-configs-changed", ());

  if enabled {
    let _ = events::emit(
      "vpn-sync-status",
      serde_json::json!({
        "id": vpn_id,
        "status": "syncing"
      }),
    );

    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_vpn_sync(vpn_id).await;
    }
  } else {
    let _ = events::emit(
      "vpn-sync-status",
      serde_json::json!({
        "id": vpn_id,
        "status": "disabled"
      }),
    );
  }

  Ok(())
}

#[tauri::command]
pub fn is_vpn_in_use_by_synced_profile(vpn_id: String) -> bool {
  is_vpn_used_by_synced_profile(&vpn_id)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UnsyncedEntityCounts {
  pub proxies: usize,
  pub groups: usize,
  pub vpns: usize,
  pub extensions: usize,
  pub extension_groups: usize,
}

#[tauri::command]
pub fn get_unsynced_entity_counts() -> Result<UnsyncedEntityCounts, String> {
  let proxy_count = {
    let proxies = crate::proxy::proxy_manager::PROXY_MANAGER.get_stored_proxies();
    proxies
      .iter()
      .filter(|p| !p.sync_enabled && !p.is_cloud_managed)
      .count()
  };

  let group_count = {
    let gm = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
    let groups = gm
      .get_all_groups()
      .map_err(|e| format!("Failed to get groups: {e}"))?;
    groups.iter().filter(|g| !g.sync_enabled).count()
  };

  let vpn_count = {
    let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
    let configs = storage
      .list_configs()
      .map_err(|e| format!("Failed to list VPN configs: {e}"))?;
    configs.iter().filter(|c| !c.sync_enabled).count()
  };

  let extension_count = {
    let em = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let exts = em
      .list_extensions()
      .map_err(|e| format!("Failed to list extensions: {e}"))?;
    exts.iter().filter(|e| !e.sync_enabled).count()
  };

  let extension_group_count = {
    let em = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let groups = em
      .list_groups()
      .map_err(|e| format!("Failed to list extension groups: {e}"))?;
    groups.iter().filter(|g| !g.sync_enabled).count()
  };

  Ok(UnsyncedEntityCounts {
    proxies: proxy_count,
    groups: group_count,
    vpns: vpn_count,
    extensions: extension_count,
    extension_groups: extension_group_count,
  })
}

#[tauri::command]
pub async fn enable_sync_for_all_entities(app_handle: tauri::AppHandle) -> Result<(), String> {
  // Intentionally excludes profiles: enabling profile sync uploads the entire
  // browser data dir per profile, which is destructive if the user expected
  // an opt-in. Profile sync stays under explicit per-profile control via
  // set_profile_sync_mode. This command only touches metadata-sized entities.

  // Enable sync for all unsynced proxies
  {
    let proxies = crate::proxy::proxy_manager::PROXY_MANAGER.get_stored_proxies();
    for proxy in &proxies {
      if !proxy.sync_enabled && !proxy.is_cloud_managed {
        if let Err(e) = set_proxy_sync_enabled(app_handle.clone(), proxy.id.clone(), true).await {
          log::warn!("Failed to enable sync for proxy {}: {e}", proxy.id);
        }
      }
    }
  }

  // Enable sync for all unsynced groups
  {
    let groups = {
      let gm = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
      gm.get_all_groups()
        .map_err(|e| format!("Failed to get groups: {e}"))?
    };
    for group in &groups {
      if !group.sync_enabled {
        if let Err(e) = set_group_sync_enabled(app_handle.clone(), group.id.clone(), true).await {
          log::warn!("Failed to enable sync for group {}: {e}", group.id);
        }
      }
    }
  }

  // Enable sync for all unsynced VPNs
  {
    let configs = {
      let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
      storage
        .list_configs()
        .map_err(|e| format!("Failed to list VPN configs: {e}"))?
    };
    for config in &configs {
      if !config.sync_enabled {
        if let Err(e) = set_vpn_sync_enabled(app_handle.clone(), config.id.clone(), true).await {
          log::warn!("Failed to enable sync for VPN {}: {e}", config.id);
        }
      }
    }
  }

  // Enable sync for all unsynced extensions
  {
    let exts = {
      let em = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      em.list_extensions()
        .map_err(|e| format!("Failed to list extensions: {e}"))?
    };
    for ext in &exts {
      if !ext.sync_enabled {
        if let Err(e) = set_extension_sync_enabled(app_handle.clone(), ext.id.clone(), true).await {
          log::warn!("Failed to enable sync for extension {}: {e}", ext.id);
        }
      }
    }
  }

  // Enable sync for all unsynced extension groups
  {
    let groups = {
      let em = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      em.list_groups()
        .map_err(|e| format!("Failed to list extension groups: {e}"))?
    };
    for group in &groups {
      if !group.sync_enabled {
        if let Err(e) =
          set_extension_group_sync_enabled(app_handle.clone(), group.id.clone(), true).await
        {
          log::warn!(
            "Failed to enable sync for extension group {}: {e}",
            group.id
          );
        }
      }
    }
  }

  Ok(())
}

#[tauri::command]
pub async fn set_extension_sync_enabled(
  app_handle: tauri::AppHandle,
  extension_id: String,
  enabled: bool,
) -> Result<(), String> {
  let ext = {
    let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    manager
      .get_extension(&extension_id)
      .map_err(|_| serde_json::json!({ "code": "EXTENSION_NOT_FOUND" }).to_string())?
  };

  if enabled {
    ensure_sync_configured(&app_handle).await?;
  }

  let mut updated_ext = ext;
  updated_ext.sync_enabled = enabled;
  if !enabled {
    updated_ext.last_sync = None;
  }

  {
    let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    manager
      .update_extension_internal(&updated_ext)
      .map_err(|e| {
        serde_json::json!({ "code": "INTERNAL_ERROR", "params": { "detail": e.to_string() } })
          .to_string()
      })?;
  }

  let _ = events::emit("extensions-changed", ());

  if enabled {
    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_extension_sync(extension_id).await;
    }
  }

  Ok(())
}

#[tauri::command]
pub async fn set_extension_group_sync_enabled(
  app_handle: tauri::AppHandle,
  extension_group_id: String,
  enabled: bool,
) -> Result<(), String> {
  let group = {
    let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    manager
      .get_group(&extension_group_id)
      .map_err(|_| serde_json::json!({ "code": "EXTENSION_GROUP_NOT_FOUND" }).to_string())?
  };

  if enabled {
    ensure_sync_configured(&app_handle).await?;
  }

  let mut updated_group = group;
  updated_group.sync_enabled = enabled;
  if !enabled {
    updated_group.last_sync = None;
  }

  {
    let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    manager.update_group_internal(&updated_group).map_err(|e| {
      serde_json::json!({ "code": "INTERNAL_ERROR", "params": { "detail": e.to_string() } })
        .to_string()
    })?;
  }

  let _ = events::emit("extensions-changed", ());

  if enabled {
    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler
        .queue_extension_group_sync(extension_group_id)
        .await;
    }
  }

  Ok(())
}

/// Re-upload every sync-enabled entity under the current encryption state.
/// Called after the user sets, changes, or clears their E2E password —
/// existing remote bytes are still in the prior state, so without this they'd
/// remain plaintext (or worse, undecryptable) until the next per-entity edit.
///
/// Order: profiles first (so the user can resume work as soon as profile sync
/// completes), then proxies, groups, VPNs, extensions, extension groups.
/// Running profiles' associated entities are deferred by 5s so the active
/// browser session isn't disrupted mid-keystroke.
///
/// Progress is emitted via `e2e-rollover-progress` events with `{ stage, done, total }`.
#[tauri::command]
pub async fn rollover_encryption_for_all_entities(
  app_handle: tauri::AppHandle,
) -> Result<(), String> {
  let _ = events::emit("e2e-rollover-started", ());

  let profile_manager = ProfileManager::instance();
  let profiles = profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?;

  let synced_profiles: Vec<_> = profiles
    .iter()
    .filter(|p| p.sync_mode != SyncMode::Disabled)
    .collect();

  let total_profiles = synced_profiles.len();
  let mut running_profile_ids: std::collections::HashSet<uuid::Uuid> =
    std::collections::HashSet::new();

  for (i, profile) in synced_profiles.iter().enumerate() {
    if profile.process_id.is_some() {
      running_profile_ids.insert(profile.id);
    }
    let id_str = profile.id.to_string();
    if let Err(e) = trigger_sync_for_profile(app_handle.clone(), id_str.clone()).await {
      log::warn!("Rollover: profile {} re-sync failed: {e}", id_str);
    }
    let _ = events::emit(
      "e2e-rollover-progress",
      serde_json::json!({
        "stage": "profiles",
        "done": i + 1,
        "total": total_profiles,
      }),
    );
  }

  // Determine which entity ids are referenced by running profiles, so we can
  // defer their re-upload (changing their files mid-session would cause the
  // running browser to see a different proxy/extension config than what it
  // launched with).
  let mut deferred_proxy_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
  let mut deferred_vpn_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
  let mut deferred_group_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
  for p in &profiles {
    if running_profile_ids.contains(&p.id) {
      if let Some(id) = &p.proxy_id {
        deferred_proxy_ids.insert(id.clone());
      }
      if let Some(id) = &p.vpn_id {
        deferred_vpn_ids.insert(id.clone());
      }
      if let Some(id) = &p.group_id {
        deferred_group_ids.insert(id.clone());
      }
    }
  }

  let proxies = crate::proxy::proxy_manager::PROXY_MANAGER.get_stored_proxies();
  let synced_proxies: Vec<_> = proxies.iter().filter(|p| p.sync_enabled).collect();
  let total_proxies = synced_proxies.len();
  let mut deferred = Vec::new();
  for (i, proxy) in synced_proxies.iter().enumerate() {
    if deferred_proxy_ids.contains(&proxy.id) {
      deferred.push(proxy.id.clone());
    } else if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_proxy_sync(proxy.id.clone()).await;
    }
    let _ = events::emit(
      "e2e-rollover-progress",
      serde_json::json!({"stage": "proxies", "done": i + 1, "total": total_proxies}),
    );
  }

  let groups = {
    let gm = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
    gm.get_all_groups()
      .map_err(|e| format!("Failed to get groups: {e}"))?
  };
  let synced_groups: Vec<_> = groups.iter().filter(|g| g.sync_enabled).collect();
  let total_groups = synced_groups.len();
  let mut deferred_groups = Vec::new();
  for (i, group) in synced_groups.iter().enumerate() {
    if deferred_group_ids.contains(&group.id) {
      deferred_groups.push(group.id.clone());
    } else if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_group_sync(group.id.clone()).await;
    }
    let _ = events::emit(
      "e2e-rollover-progress",
      serde_json::json!({"stage": "groups", "done": i + 1, "total": total_groups}),
    );
  }

  let vpns = {
    let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
    storage
      .list_configs()
      .map_err(|e| format!("Failed to list VPN configs: {e}"))?
  };
  let synced_vpns: Vec<_> = vpns.iter().filter(|v| v.sync_enabled).collect();
  let total_vpns = synced_vpns.len();
  let mut deferred_vpns = Vec::new();
  for (i, config) in synced_vpns.iter().enumerate() {
    if deferred_vpn_ids.contains(&config.id) {
      deferred_vpns.push(config.id.clone());
    } else if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_vpn_sync(config.id.clone()).await;
    }
    let _ = events::emit(
      "e2e-rollover-progress",
      serde_json::json!({"stage": "vpns", "done": i + 1, "total": total_vpns}),
    );
  }

  let extensions = {
    let em = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    em.list_extensions()
      .map_err(|e| format!("Failed to list extensions: {e}"))?
  };
  let synced_exts: Vec<_> = extensions.iter().filter(|e| e.sync_enabled).collect();
  let total_exts = synced_exts.len();
  for (i, ext) in synced_exts.iter().enumerate() {
    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_extension_sync(ext.id.clone()).await;
    }
    let _ = events::emit(
      "e2e-rollover-progress",
      serde_json::json!({"stage": "extensions", "done": i + 1, "total": total_exts}),
    );
  }

  let ext_groups = {
    let em = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    em.list_groups()
      .map_err(|e| format!("Failed to list extension groups: {e}"))?
  };
  let synced_ext_groups: Vec<_> = ext_groups.iter().filter(|g| g.sync_enabled).collect();
  let total_eg = synced_ext_groups.len();
  for (i, group) in synced_ext_groups.iter().enumerate() {
    if let Some(scheduler) = super::get_global_scheduler() {
      scheduler.queue_extension_group_sync(group.id.clone()).await;
    }
    let _ = events::emit(
      "e2e-rollover-progress",
      serde_json::json!({"stage": "extension_groups", "done": i + 1, "total": total_eg}),
    );
  }

  if !deferred.is_empty() || !deferred_groups.is_empty() || !deferred_vpns.is_empty() {
    tauri::async_runtime::spawn(async move {
      tokio::time::sleep(std::time::Duration::from_secs(5)).await;
      if let Some(scheduler) = super::get_global_scheduler() {
        for id in deferred {
          scheduler.queue_proxy_sync(id).await;
        }
        for id in deferred_groups {
          scheduler.queue_group_sync(id).await;
        }
        for id in deferred_vpns {
          scheduler.queue_vpn_sync(id).await;
        }
      }
    });
  }

  let _ = events::emit("e2e-rollover-completed", ());
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_checkpoint_sqlite_wal_files() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");

    // Create a SQLite database in WAL mode and insert data.
    // Use std::mem::forget to prevent the connection destructor from running,
    // which simulates a browser crash where WAL is not checkpointed.
    {
      let conn = rusqlite::Connection::open(&db_path).unwrap();
      conn.pragma_update(None, "journal_mode", "WAL").unwrap();
      conn.pragma_update(None, "wal_autocheckpoint", "0").unwrap();
      conn
        .execute(
          "CREATE TABLE cookies (id INTEGER PRIMARY KEY, value TEXT)",
          [],
        )
        .unwrap();
      conn
        .execute(
          "INSERT INTO cookies (value) VALUES ('session_token_123')",
          [],
        )
        .unwrap();
      // Leak the connection to prevent auto-checkpoint on drop
      std::mem::forget(conn);
    }

    // Verify WAL file exists and has data
    let wal_path = temp_dir.path().join("test.db-wal");
    assert!(wal_path.exists(), "WAL file should exist");
    let wal_size = fs::metadata(&wal_path).unwrap().len();
    assert!(wal_size > 0, "WAL file should be non-empty");

    // Run checkpoint
    checkpoint_sqlite_wal_files(temp_dir.path());

    // After checkpoint, WAL should be truncated (empty)
    let wal_size_after = fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);
    assert_eq!(
      wal_size_after, 0,
      "WAL should be truncated after checkpoint"
    );

    // Verify data is still accessible from the main database
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let value: String = conn
      .query_row("SELECT value FROM cookies WHERE id = 1", [], |row| {
        row.get(0)
      })
      .unwrap();
    assert_eq!(value, "session_token_123");
  }

  #[test]
  fn test_checkpoint_handles_missing_db() {
    let temp_dir = tempfile::TempDir::new().unwrap();

    // Create a WAL file without a corresponding database
    let wal_path = temp_dir.path().join("missing.db-wal");
    fs::write(&wal_path, b"fake wal data").unwrap();

    // Should not panic
    checkpoint_sqlite_wal_files(temp_dir.path());
  }

  #[test]
  fn test_checkpoint_skips_empty_wal() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");

    // Create a database and checkpoint immediately (WAL is empty)
    {
      let conn = rusqlite::Connection::open(&db_path).unwrap();
      conn.pragma_update(None, "journal_mode", "WAL").unwrap();
      conn
        .execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", [])
        .unwrap();
    }

    // Create an empty WAL file
    let wal_path = temp_dir.path().join("test.db-wal");
    fs::write(&wal_path, b"").unwrap();

    // Should skip empty WAL without error
    checkpoint_sqlite_wal_files(temp_dir.path());
  }

  #[test]
  fn test_checkpoint_nested_directories() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let nested_dir = temp_dir.path().join("profile").join("Default");
    fs::create_dir_all(&nested_dir).unwrap();

    let db_path = nested_dir.join("Cookies");

    // Create a database with WAL data, leak connection to simulate crash
    {
      let conn = rusqlite::Connection::open(&db_path).unwrap();
      conn.pragma_update(None, "journal_mode", "WAL").unwrap();
      conn.pragma_update(None, "wal_autocheckpoint", "0").unwrap();
      conn
        .execute(
          "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT)",
          [],
        )
        .unwrap();
      conn
        .execute(
          "INSERT INTO cookies VALUES ('.example.com', 'session', 'abc')",
          [],
        )
        .unwrap();
      std::mem::forget(conn);
    }

    let wal_path = nested_dir.join("Cookies-wal");
    assert!(wal_path.exists());

    // Checkpoint from the top-level directory
    checkpoint_sqlite_wal_files(temp_dir.path());

    // Verify data is in the main database
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let count: i64 = conn
      .query_row("SELECT COUNT(*) FROM cookies", [], |row| row.get(0))
      .unwrap();
    assert_eq!(count, 1);
  }
}
