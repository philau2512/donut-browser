impl SyncScheduler {
  async fn process_pending(&self, app_handle: &tauri::AppHandle) {
    self.process_pending_profiles(app_handle).await;
    self.process_pending_proxies(app_handle).await;
    self.process_pending_groups(app_handle).await;
    self.process_pending_vpns(app_handle).await;
    self.process_pending_extensions(app_handle).await;
    self.process_pending_extension_groups(app_handle).await;
    self.process_pending_tombstones(app_handle).await;
  }

  async fn process_pending_profiles(&self, app_handle: &tauri::AppHandle) {
    let profiles_to_sync: Vec<String> = {
      let mut pending = self.pending_profiles.lock().await;
      let running = self.running_profiles.lock().await;
      let in_flight = self.in_flight_profiles.lock().await;

      // Sync immediately if not running and not in-flight (no delay check)
      let ready: Vec<String> = pending
        .iter()
        .filter(|(id, stop_time)| {
          !running.contains(*id) && !in_flight.contains(*id) && stop_time.queued
        })
        .map(|(id, _)| id.clone())
        .collect();

      for id in &ready {
        pending.remove(id);
      }

      ready
    };

    // Mark all profiles as in-flight and filter out duplicates
    let mut to_sync = Vec::new();
    for profile_id in profiles_to_sync {
      let mut in_flight = self.in_flight_profiles.lock().await;
      if in_flight.contains(&profile_id) {
        log::debug!("Profile {} already in-flight, skipping", profile_id);
        continue;
      }
      in_flight.insert(profile_id.clone());
      to_sync.push(profile_id);
    }

    // Sync all profiles in parallel
    let mut sync_set = tokio::task::JoinSet::new();
    for profile_id in to_sync {
      let app = app_handle.clone();
      let in_flight = self.in_flight_profiles.clone();
      sync_set.spawn(async move {
        log::info!("Executing queued sync for profile {}", profile_id);
        let _ = events::emit(
          "profile-sync-status",
          serde_json::json!({
            "profile_id": profile_id,
            "status": "syncing"
          }),
        );

        let profile_to_sync = {
          let profile_manager = ProfileManager::instance();
          profile_manager.list_profiles().ok().and_then(|profiles| {
            profiles
              .into_iter()
              .find(|p| p.id.to_string() == profile_id && p.is_sync_enabled())
          })
        };

        let Some(profile) = profile_to_sync else {
          let mut inf = in_flight.lock().await;
          inf.remove(&profile_id);
          return;
        };

        let result = match SyncEngine::create_from_settings(&app).await {
          Ok(engine) => engine.sync_profile(&app, &profile).await,
          Err(e) => {
            log::error!("Failed to create sync engine: {}", e);
            Err(super::types::SyncError::NotConfigured)
          }
        };

        {
          let mut inf = in_flight.lock().await;
          inf.remove(&profile_id);
        }

        match result {
          Ok(()) => {
            log::info!("Profile {} synced successfully", profile_id);
            let _ = events::emit(
              "profile-sync-status",
              serde_json::json!({
                "profile_id": profile_id,
                "status": "synced"
              }),
            );
          }
          Err(e) => {
            log::error!("Failed to sync profile {}: {}", profile_id, e);
            let _ = events::emit(
              "profile-sync-status",
              serde_json::json!({
                "profile_id": profile_id,
                "status": "error",
                "error": e.to_string()
              }),
            );
          }
        }
      });
    }

    // Wait for all parallel syncs to finish (only if we actually spawned any)
    if !sync_set.is_empty() {
      while let Some(result) = sync_set.join_next().await {
        if let Err(e) = result {
          log::error!("Profile sync task panicked: {e}");
        }
      }
    }
  }

  async fn process_pending_proxies(&self, app_handle: &tauri::AppHandle) {
    let proxies_to_sync: Vec<String> = {
      let mut pending = self.pending_proxies.lock().await;
      let list: Vec<String> = pending.drain().collect();
      list
    };

    if proxies_to_sync.is_empty() {
      return;
    }

    match SyncEngine::create_from_settings(app_handle).await {
      Ok(engine) => {
        for proxy_id in proxies_to_sync {
          log::info!("Syncing proxy {}", proxy_id);
          let _ = events::emit(
            "proxy-sync-status",
            serde_json::json!({
              "id": proxy_id,
              "status": "syncing"
            }),
          );
          match engine
            .sync_proxy_by_id_with_handle(&proxy_id, app_handle)
            .await
          {
            Ok(()) => {
              let _ = events::emit(
                "proxy-sync-status",
                serde_json::json!({
                  "id": proxy_id,
                  "status": "synced"
                }),
              );
            }
            Err(e) => {
              log::error!("Failed to sync proxy {}: {}", proxy_id, e);
              let _ = events::emit(
                "proxy-sync-status",
                serde_json::json!({
                  "id": proxy_id,
                  "status": "error",
                  "error": e.to_string()
                }),
              );
            }
          }
        }

        // Check if all sync work is complete after proxies finish
      }
      Err(e) => {
        log::error!("Failed to create sync engine: {}", e);
      }
    }
  }

  async fn process_pending_groups(&self, app_handle: &tauri::AppHandle) {
    let groups_to_sync: Vec<String> = {
      let mut pending = self.pending_groups.lock().await;
      let list: Vec<String> = pending.drain().collect();
      list
    };

    if groups_to_sync.is_empty() {
      return;
    }

    match SyncEngine::create_from_settings(app_handle).await {
      Ok(engine) => {
        for group_id in groups_to_sync {
          log::info!("Syncing group {}", group_id);
          let _ = events::emit(
            "group-sync-status",
            serde_json::json!({
              "id": group_id,
              "status": "syncing"
            }),
          );
          match engine
            .sync_group_by_id_with_handle(&group_id, app_handle)
            .await
          {
            Ok(()) => {
              let _ = events::emit(
                "group-sync-status",
                serde_json::json!({
                  "id": group_id,
                  "status": "synced"
                }),
              );
            }
            Err(e) => {
              log::error!("Failed to sync group {}: {}", group_id, e);
              let _ = events::emit(
                "group-sync-status",
                serde_json::json!({
                  "id": group_id,
                  "status": "error",
                  "error": e.to_string()
                }),
              );
            }
          }
        }

        // Check if all sync work is complete after groups finish
      }
      Err(e) => {
        log::error!("Failed to create sync engine: {}", e);
      }
    }
  }

  async fn process_pending_vpns(&self, app_handle: &tauri::AppHandle) {
    let vpns_to_sync: Vec<String> = {
      let mut pending = self.pending_vpns.lock().await;
      let list: Vec<String> = pending.drain().collect();
      list
    };

    if vpns_to_sync.is_empty() {
      return;
    }

    match SyncEngine::create_from_settings(app_handle).await {
      Ok(engine) => {
        for vpn_id in vpns_to_sync {
          log::info!("Syncing VPN {}", vpn_id);
          let _ = events::emit(
            "vpn-sync-status",
            serde_json::json!({
              "id": vpn_id,
              "status": "syncing"
            }),
          );
          match engine.sync_vpn_by_id_with_handle(&vpn_id, app_handle).await {
            Ok(()) => {
              let _ = events::emit(
                "vpn-sync-status",
                serde_json::json!({
                  "id": vpn_id,
                  "status": "synced"
                }),
              );
            }
            Err(e) => {
              log::error!("Failed to sync VPN {}: {}", vpn_id, e);
              let _ = events::emit(
                "vpn-sync-status",
                serde_json::json!({
                  "id": vpn_id,
                  "status": "error",
                  "error": e.to_string()
                }),
              );
            }
          }
        }
      }
      Err(e) => {
        log::error!("Failed to create sync engine: {}", e);
      }
    }
  }

  async fn process_pending_extensions(&self, app_handle: &tauri::AppHandle) {
    let extensions_to_sync: Vec<String> = {
      let mut pending = self.pending_extensions.lock().await;
      let list: Vec<String> = pending.drain().collect();
      list
    };

    if extensions_to_sync.is_empty() {
      return;
    }

    match SyncEngine::create_from_settings(app_handle).await {
      Ok(engine) => {
        for ext_id in extensions_to_sync {
          log::info!("Syncing extension {}", ext_id);
          if let Err(e) = engine
            .sync_extension_by_id_with_handle(&ext_id, app_handle)
            .await
          {
            log::error!("Failed to sync extension {}: {}", ext_id, e);
          }
        }
      }
      Err(e) => {
        log::error!("Failed to create sync engine: {}", e);
      }
    }
  }

  async fn process_pending_extension_groups(&self, app_handle: &tauri::AppHandle) {
    let groups_to_sync: Vec<String> = {
      let mut pending = self.pending_extension_groups.lock().await;
      let list: Vec<String> = pending.drain().collect();
      list
    };

    if groups_to_sync.is_empty() {
      return;
    }

    match SyncEngine::create_from_settings(app_handle).await {
      Ok(engine) => {
        for group_id in groups_to_sync {
          log::info!("Syncing extension group {}", group_id);
          if let Err(e) = engine
            .sync_extension_group_by_id_with_handle(&group_id, app_handle)
            .await
          {
            log::error!("Failed to sync extension group {}: {}", group_id, e);
          }
        }
      }
      Err(e) => {
        log::error!("Failed to create sync engine: {}", e);
      }
    }
  }

  async fn process_pending_tombstones(&self, _app_handle: &tauri::AppHandle) {
    let tombstones: Vec<(String, String)> = {
      let mut pending = self.pending_tombstones.lock().await;
      std::mem::take(&mut *pending)
    };

    if tombstones.is_empty() {
      return;
    }

    for (entity_type, entity_id) in tombstones {
      log::info!("Processing tombstone for {} {}", entity_type, entity_id);
      match entity_type.as_str() {
        "profile" => {
          let profile_manager = ProfileManager::instance();
          let local_sync_enabled = {
            if let Ok(profiles) = profile_manager.list_profiles() {
              let profile_uuid = uuid::Uuid::parse_str(&entity_id).ok();
              profile_uuid
                .and_then(|uuid| profiles.into_iter().find(|p| p.id == uuid))
                .is_some_and(|p| p.is_sync_enabled())
            } else {
              false
            }
          };

          if local_sync_enabled {
            log::info!(
              "Profile {} was deleted remotely, deleting locally",
              entity_id
            );
            if let Err(e) = profile_manager.delete_profile_local_only(&entity_id) {
              log::warn!("Failed to delete tombstoned profile {}: {}", entity_id, e);
            }
          } else {
            log::info!(
              "Profile {} has a tombstone but sync is no longer enabled locally — keeping local copy",
              entity_id
            );
          }
        }
        "proxy" => {
          let proxy_manager = &crate::proxy::proxy_manager::PROXY_MANAGER;
          let proxies = proxy_manager.get_stored_proxies();
          if let Some(proxy) = proxies.iter().find(|p| p.id == entity_id) {
            if proxy.sync_enabled {
              log::info!("Proxy {} was deleted remotely, deleting locally", entity_id);
              let proxy_file = proxy_manager.get_proxy_file_path(&entity_id);
              if proxy_file.exists() {
                let _ = std::fs::remove_file(&proxy_file);
              }
              proxy_manager.remove_from_memory(&entity_id);
              let _ = events::emit("stored-proxies-changed", ());
            }
          }
        }
        "group" => {
          let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
          let groups = group_manager.get_all_groups().unwrap_or_default();
          if let Some(group) = groups.iter().find(|g| g.id == entity_id) {
            if group.sync_enabled {
              log::info!("Group {} was deleted remotely, deleting locally", entity_id);
              let _ = group_manager.delete_group_internal(&entity_id);
              let _ = events::emit("groups-changed", ());
            }
          }
        }
        "vpn" => {
          let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
          if let Ok(vpn) = storage.load_config(&entity_id) {
            if vpn.sync_enabled {
              log::info!("VPN {} was deleted remotely, deleting locally", entity_id);
              let _ = storage.delete_config(&entity_id);
              let _ = events::emit("vpn-configs-changed", ());
            }
          }
        }
        "extension" => {
          let manager = crate::browser::extension_manager::EXTENSION_MANAGER
            .lock()
            .unwrap();
          if let Ok(ext) = manager.get_extension(&entity_id) {
            if ext.sync_enabled {
              log::info!(
                "Extension {} was deleted remotely, deleting locally",
                entity_id
              );
              let _ = manager.delete_extension_internal(&entity_id);
              let _ = events::emit("extensions-changed", ());
            }
          }
        }
        "extension_group" => {
          let manager = crate::browser::extension_manager::EXTENSION_MANAGER
            .lock()
            .unwrap();
          if let Ok(group) = manager.get_group(&entity_id) {
            if group.sync_enabled {
              log::info!(
                "Extension group {} was deleted remotely, deleting locally",
                entity_id
              );
              let _ = manager.delete_group_internal(&entity_id);
              let _ = events::emit("extensions-changed", ());
            }
          }
        }
        _ => {}
      }
    }
  }
}
