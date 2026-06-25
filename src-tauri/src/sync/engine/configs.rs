impl SyncEngine {
  async fn sync_proxy(
    &self,
    proxy_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let proxy_manager = &crate::proxy::proxy_manager::PROXY_MANAGER;
    let proxies = proxy_manager.get_stored_proxies();
    let local_proxy = proxies.iter().find(|p| p.id == proxy_id).cloned();

    let remote_key = format!("proxies/{}.json", proxy_id);
    let stat = self.client.stat(&remote_key).await?;

    match (local_proxy, stat.exists) {
      (Some(proxy), true) => {
        // Both exist - resolve by user-edit timestamp (last-write-wins).
        let local_updated = proxy.updated_at.unwrap_or(0);
        let remote_updated = self.remote_updated_at(&stat, &remote_key).await;

        if remote_updated > local_updated {
          self.download_proxy(proxy_id, app_handle).await?;
        } else if local_updated > remote_updated {
          self.upload_proxy(&proxy).await?;
        }
      }
      (Some(proxy), false) => {
        // Only local exists - upload
        self.upload_proxy(&proxy).await?;
      }
      (None, true) => {
        // Only remote exists - download
        self.download_proxy(proxy_id, app_handle).await?;
      }
      (None, false) => {
        // Neither exists - nothing to do
        log::debug!("Proxy {} not found locally or remotely", proxy_id);
      }
    }

    Ok(())
  }

  async fn upload_proxy(&self, proxy: &crate::proxy::proxy_manager::StoredProxy) -> SyncResult<()> {
    let mut updated_proxy = proxy.clone();
    updated_proxy.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );

    let json = serde_json::to_string_pretty(&updated_proxy)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize proxy: {e}")))?;

    let remote_key = format!("proxies/{}.json", proxy.id);
    self
      .upload_config_json(&remote_key, &json, updated_proxy.updated_at.unwrap_or(0))
      .await?;

    // Update local proxy with new last_sync (always write plaintext locally)
    let proxy_manager = &crate::proxy::proxy_manager::PROXY_MANAGER;
    let proxy_file = proxy_manager.get_proxy_file_path(&proxy.id);
    fs::write(&proxy_file, &json).map_err(|e| {
      SyncError::IoError(format!(
        "Failed to update proxy file {}: {e}",
        proxy_file.display()
      ))
    })?;

    log::info!("Proxy {} uploaded", proxy.id);
    Ok(())
  }

  async fn download_proxy(
    &self,
    proxy_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let remote_key = format!("proxies/{}.json", proxy_id);
    let presign = self.client.presign_download(&remote_key).await?;
    let raw = self.client.download_bytes(&presign.url).await?;

    let data = encryption::maybe_unseal_after_download(&raw)
      .map_err(|e| SyncError::InvalidData(format!("Failed to unseal proxy: {e}")))?;

    let mut proxy: crate::proxy::proxy_manager::StoredProxy = serde_json::from_slice(&data)
      .map_err(|e| SyncError::SerializationError(format!("Failed to parse proxy JSON: {e}")))?;

    proxy.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );

    let proxy_manager = &crate::proxy::proxy_manager::PROXY_MANAGER;
    let proxy_file = proxy_manager.get_proxy_file_path(&proxy.id);
    if let Some(parent) = proxy_file.parent() {
      fs::create_dir_all(parent).map_err(|e| {
        SyncError::IoError(format!(
          "Failed to create proxy directory {}: {e}",
          parent.display()
        ))
      })?;
    }

    let json = serde_json::to_string_pretty(&proxy)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize proxy: {e}")))?;
    fs::write(&proxy_file, &json).map_err(|e| {
      SyncError::IoError(format!(
        "Failed to write proxy file {}: {e}",
        proxy_file.display()
      ))
    })?;

    // Keep the in-memory cache in sync with disk. Without this, get_stored_proxies
    // (which reads only the in-memory map) never sees the downloaded proxy until
    // restart, so check_for_missing_synced_entities/sync_proxy treat it as
    // missing every pass and re-download it forever. Mirrors download_group/
    // download_vpn/download_extension.
    proxy_manager.upsert_stored_proxy(proxy.clone());

    // Emit event for UI update
    if let Some(_handle) = app_handle {
      let _ = events::emit("stored-proxies-changed", ());
      let _ = events::emit(
        "proxy-sync-status",
        serde_json::json!({
          "id": proxy_id,
          "status": "synced"
        }),
      );
    }

    log::info!("Proxy {} downloaded", proxy_id);
    Ok(())
  }

  async fn sync_group(
    &self,
    group_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let local_group = {
      let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
      let groups = group_manager.get_all_groups().unwrap_or_default();
      groups.into_iter().find(|g| g.id == group_id)
    };

    let remote_key = format!("groups/{}.json", group_id);
    let stat = self.client.stat(&remote_key).await?;

    match (local_group, stat.exists) {
      (Some(group), true) => {
        // Both exist - resolve by user-edit timestamp (last-write-wins).
        let local_updated = group.updated_at.unwrap_or(0);
        let remote_updated = self.remote_updated_at(&stat, &remote_key).await;

        if remote_updated > local_updated {
          self.download_group(group_id, app_handle).await?;
        } else if local_updated > remote_updated {
          self.upload_group(&group).await?;
        }
      }
      (Some(group), false) => {
        // Only local exists - upload
        self.upload_group(&group).await?;
      }
      (None, true) => {
        // Only remote exists - download
        self.download_group(group_id, app_handle).await?;
      }
      (None, false) => {
        // Neither exists - nothing to do
        log::debug!("Group {} not found locally or remotely", group_id);
      }
    }

    Ok(())
  }

  async fn upload_group(&self, group: &crate::group_manager::ProfileGroup) -> SyncResult<()> {
    let mut updated_group = group.clone();
    updated_group.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );

    let json = serde_json::to_string_pretty(&updated_group)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize group: {e}")))?;

    let remote_key = format!("groups/{}.json", group.id);
    self
      .upload_config_json(&remote_key, &json, updated_group.updated_at.unwrap_or(0))
      .await?;

    // Update local group with new last_sync
    {
      let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
      if let Err(e) = group_manager.update_group_internal(&updated_group) {
        log::warn!("Failed to update group last_sync: {}", e);
      }
    }

    log::info!("Group {} uploaded", group.id);
    Ok(())
  }

  async fn download_group(
    &self,
    group_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let remote_key = format!("groups/{}.json", group_id);
    let presign = self.client.presign_download(&remote_key).await?;
    let raw = self.client.download_bytes(&presign.url).await?;

    let data = encryption::maybe_unseal_after_download(&raw)
      .map_err(|e| SyncError::InvalidData(format!("Failed to unseal group: {e}")))?;

    let mut group: crate::group_manager::ProfileGroup = serde_json::from_slice(&data)
      .map_err(|e| SyncError::SerializationError(format!("Failed to parse group JSON: {e}")))?;

    group.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );

    // Save or update local group
    {
      let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
      if let Err(e) = group_manager.upsert_group_internal(&group) {
        log::warn!("Failed to save downloaded group: {}", e);
      }
    }

    // Emit event for UI update
    if let Some(_handle) = app_handle {
      let _ = events::emit("groups-changed", ());
      let _ = events::emit(
        "group-sync-status",
        serde_json::json!({
          "id": group_id,
          "status": "synced"
        }),
      );
    }

    log::info!("Group {} downloaded", group_id);
    Ok(())
  }

  pub async fn sync_proxy_by_id(&self, proxy_id: &str) -> SyncResult<()> {
    self.sync_proxy(proxy_id, None).await
  }

  pub async fn sync_proxy_by_id_with_handle(
    &self,
    proxy_id: &str,
    app_handle: &tauri::AppHandle,
  ) -> SyncResult<()> {
    self.sync_proxy(proxy_id, Some(app_handle)).await
  }

  pub async fn sync_group_by_id(&self, group_id: &str) -> SyncResult<()> {
    self.sync_group(group_id, None).await
  }

  pub async fn sync_group_by_id_with_handle(
    &self,
    group_id: &str,
    app_handle: &tauri::AppHandle,
  ) -> SyncResult<()> {
    self.sync_group(group_id, Some(app_handle)).await
  }

  pub async fn delete_profile(&self, profile_id: &str) -> SyncResult<()> {
    let prefix = format!("profiles/{}/", profile_id);
    let tombstone_key = format!("tombstones/profiles/{}.json", profile_id);

    let result = self
      .client
      .delete_prefix(&prefix, Some(&tombstone_key))
      .await?;

    log::info!(
      "Profile {} deleted from sync ({} objects removed)",
      profile_id,
      result.deleted_count
    );

    // Also delete from team path if user is on a team
    if let Some(auth) = crate::api::cloud_auth::CLOUD_AUTH.get_user().await {
      if let Some(team_id) = &auth.user.team_id {
        let team_prefix = format!("teams/{}/profiles/{}/", team_id, profile_id);
        let team_tombstone = format!("teams/{}/tombstones/profiles/{}.json", team_id, profile_id);
        let team_result = self
          .client
          .delete_prefix(&team_prefix, Some(&team_tombstone))
          .await?;
        if team_result.deleted_count > 0 {
          log::info!(
            "Profile {} deleted from team sync ({} objects removed)",
            profile_id,
            team_result.deleted_count
          );
        }
      }
    }

    Ok(())
  }

  pub async fn delete_proxy(&self, proxy_id: &str) -> SyncResult<()> {
    let remote_key = format!("proxies/{}.json", proxy_id);
    let tombstone_key = format!("tombstones/proxies/{}.json", proxy_id);

    self
      .client
      .delete(&remote_key, Some(&tombstone_key))
      .await?;

    log::info!("Proxy {} deleted from sync", proxy_id);
    Ok(())
  }

  pub async fn delete_group(&self, group_id: &str) -> SyncResult<()> {
    let remote_key = format!("groups/{}.json", group_id);
    let tombstone_key = format!("tombstones/groups/{}.json", group_id);

    self
      .client
      .delete(&remote_key, Some(&tombstone_key))
      .await?;

    log::info!("Group {} deleted from sync", group_id);
    Ok(())
  }

  async fn sync_vpn(&self, vpn_id: &str, app_handle: Option<&tauri::AppHandle>) -> SyncResult<()> {
    let local_vpn = {
      let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
      storage.load_config(vpn_id).ok()
    };

    let remote_key = format!("vpns/{}.json", vpn_id);
    let stat = self.client.stat(&remote_key).await?;

    match (local_vpn, stat.exists) {
      (Some(vpn), true) => {
        // Both exist - resolve by user-edit timestamp (last-write-wins).
        let local_updated = vpn.updated_at.unwrap_or(0);
        let remote_updated = self.remote_updated_at(&stat, &remote_key).await;

        if remote_updated > local_updated {
          self.download_vpn(vpn_id, app_handle).await?;
        } else if local_updated > remote_updated {
          self.upload_vpn(&vpn).await?;
        }
      }
      (Some(vpn), false) => {
        self.upload_vpn(&vpn).await?;
      }
      (None, true) => {
        self.download_vpn(vpn_id, app_handle).await?;
      }
      (None, false) => {
        log::debug!("VPN {} not found locally or remotely", vpn_id);
      }
    }

    Ok(())
  }

  async fn upload_vpn(&self, vpn: &crate::vpn::VpnConfig) -> SyncResult<()> {
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs();

    let mut updated_vpn = vpn.clone();
    updated_vpn.last_sync = Some(now);

    let json = serde_json::to_string_pretty(&updated_vpn)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize VPN: {e}")))?;

    let remote_key = format!("vpns/{}.json", vpn.id);
    self
      .upload_config_json(&remote_key, &json, updated_vpn.updated_at.unwrap_or(0))
      .await?;

    // Update local VPN with new last_sync
    {
      let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
      if let Err(e) = storage.update_sync_fields(&vpn.id, vpn.sync_enabled, Some(now)) {
        log::warn!("Failed to update VPN last_sync: {}", e);
      }
    }

    log::info!("VPN {} uploaded", vpn.id);
    Ok(())
  }

  async fn download_vpn(
    &self,
    vpn_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let remote_key = format!("vpns/{}.json", vpn_id);
    let presign = self.client.presign_download(&remote_key).await?;
    let raw = self.client.download_bytes(&presign.url).await?;

    let data = encryption::maybe_unseal_after_download(&raw)
      .map_err(|e| SyncError::InvalidData(format!("Failed to unseal VPN: {e}")))?;

    let mut vpn: crate::vpn::VpnConfig = serde_json::from_slice(&data)
      .map_err(|e| SyncError::SerializationError(format!("Failed to parse VPN JSON: {e}")))?;

    vpn.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );
    vpn.sync_enabled = true;

    // Save via VPN storage (handles encryption)
    {
      let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
      if let Err(e) = storage.save_config(&vpn) {
        log::warn!("Failed to save downloaded VPN: {}", e);
      }
    }

    // Emit event for UI update
    if let Some(_handle) = app_handle {
      let _ = events::emit("vpn-configs-changed", ());
      let _ = events::emit(
        "vpn-sync-status",
        serde_json::json!({
          "id": vpn_id,
          "status": "synced"
        }),
      );
    }

    log::info!("VPN {} downloaded", vpn_id);
    Ok(())
  }

  pub async fn sync_vpn_by_id_with_handle(
    &self,
    vpn_id: &str,
    app_handle: &tauri::AppHandle,
  ) -> SyncResult<()> {
    self.sync_vpn(vpn_id, Some(app_handle)).await
  }

  pub async fn delete_vpn(&self, vpn_id: &str) -> SyncResult<()> {
    let remote_key = format!("vpns/{}.json", vpn_id);
    let tombstone_key = format!("tombstones/vpns/{}.json", vpn_id);

    self
      .client
      .delete(&remote_key, Some(&tombstone_key))
      .await?;

    log::info!("VPN {} deleted from sync", vpn_id);
    Ok(())
  }

  // Extension sync

  async fn sync_extension(
    &self,
    ext_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let local_ext = {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      manager.get_extension(ext_id).ok()
    };

    let remote_key = format!("extensions/{}.json", ext_id);
    let stat = self.client.stat(&remote_key).await?;

    match (local_ext, stat.exists) {
      (Some(ext), true) => {
        // Both exist - resolve by user-edit timestamp (last-write-wins).
        let local_updated = ext.updated_at;
        let remote_updated = self.remote_updated_at(&stat, &remote_key).await;

        if remote_updated > local_updated {
          self.download_extension(ext_id, app_handle).await?;
        } else if local_updated > remote_updated {
          self.upload_extension(&ext).await?;
        }
      }
      (Some(ext), false) => {
        self.upload_extension(&ext).await?;
      }
      (None, true) => {
        self.download_extension(ext_id, app_handle).await?;
      }
      (None, false) => {
        log::debug!("Extension {} not found locally or remotely", ext_id);
      }
    }

    Ok(())
  }

  async fn upload_extension(&self, ext: &crate::extension_manager::Extension) -> SyncResult<()> {
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs();

    let mut updated_ext = ext.clone();
    updated_ext.last_sync = Some(now);

    let json = serde_json::to_string_pretty(&updated_ext)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize extension: {e}")))?;

    let remote_key = format!("extensions/{}.json", ext.id);
    self
      .upload_config_json(&remote_key, &json, updated_ext.updated_at)
      .await?;

    // Also upload the extension file data — encrypted as a sealed envelope
    // when E2E is on (the binary is the secret here, not just the metadata).
    let file_path = {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      let file_dir = manager.get_file_dir_public(&ext.id);
      file_dir.join(&ext.file_name)
    };

    if file_path.exists() {
      let file_data = fs::read(&file_path).map_err(|e| {
        SyncError::IoError(format!(
          "Failed to read extension file {}: {e}",
          file_path.display()
        ))
      })?;

      let (file_payload, file_content_type) = encryption::maybe_seal_for_upload(&file_data)
        .map_err(|e| SyncError::InvalidData(format!("Failed to seal extension file: {e}")))?;

      let file_remote_key = format!("extensions/{}/file/{}", ext.id, ext.file_name);
      let file_presign = self
        .client
        .presign_upload(&file_remote_key, Some(file_content_type))
        .await?;
      self
        .client
        .upload_bytes(&file_presign.url, &file_payload, Some(file_content_type))
        .await?;
    }

    // Update local extension with new last_sync
    {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      if let Err(e) = manager.update_extension_internal(&updated_ext) {
        log::warn!("Failed to update extension last_sync: {}", e);
      }
    }

    log::info!("Extension {} uploaded", ext.id);
    Ok(())
  }

  async fn download_extension(
    &self,
    ext_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let remote_key = format!("extensions/{}.json", ext_id);
    let presign = self.client.presign_download(&remote_key).await?;
    let raw = self.client.download_bytes(&presign.url).await?;
    let data = encryption::maybe_unseal_after_download(&raw)
      .map_err(|e| SyncError::InvalidData(format!("Failed to unseal extension: {e}")))?;

    let mut ext: crate::extension_manager::Extension = serde_json::from_slice(&data)
      .map_err(|e| SyncError::SerializationError(format!("Failed to parse extension JSON: {e}")))?;

    ext.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );
    ext.sync_enabled = true;

    // Download the extension file
    let file_remote_key = format!("extensions/{}/file/{}", ext.id, ext.file_name);
    let file_stat = self.client.stat(&file_remote_key).await?;
    if file_stat.exists {
      let file_presign = self.client.presign_download(&file_remote_key).await?;
      let file_raw = self.client.download_bytes(&file_presign.url).await?;
      let file_data = encryption::maybe_unseal_after_download(&file_raw)
        .map_err(|e| SyncError::InvalidData(format!("Failed to unseal extension file: {e}")))?;

      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      let file_dir = manager.get_file_dir_public(&ext.id);
      drop(manager);

      fs::create_dir_all(&file_dir).map_err(|e| {
        SyncError::IoError(format!(
          "Failed to create extension file dir {}: {e}",
          file_dir.display()
        ))
      })?;
      let file_path = file_dir.join(&ext.file_name);
      fs::write(&file_path, &file_data).map_err(|e| {
        SyncError::IoError(format!(
          "Failed to write extension file {}: {e}",
          file_path.display()
        ))
      })?;
    }

    // Save or update local extension
    {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      if let Err(e) = manager.upsert_extension_internal(&ext) {
        log::warn!("Failed to save downloaded extension: {}", e);
      }
    }

    if let Some(_handle) = app_handle {
      let _ = events::emit("extensions-changed", ());
    }

    log::info!("Extension {} downloaded", ext_id);
    Ok(())
  }

  pub async fn sync_extension_by_id_with_handle(
    &self,
    ext_id: &str,
    app_handle: &tauri::AppHandle,
  ) -> SyncResult<()> {
    self.sync_extension(ext_id, Some(app_handle)).await
  }

  pub async fn delete_extension(&self, ext_id: &str) -> SyncResult<()> {
    let remote_key = format!("extensions/{}.json", ext_id);
    let file_prefix = format!("extensions/{}/file/", ext_id);
    let tombstone_key = format!("tombstones/extensions/{}.json", ext_id);

    // Delete metadata
    self
      .client
      .delete(&remote_key, Some(&tombstone_key))
      .await?;

    // Delete file data
    let _ = self.client.delete_prefix(&file_prefix, None).await;

    log::info!("Extension {} deleted from sync", ext_id);
    Ok(())
  }

  // Extension group sync

  async fn sync_extension_group(
    &self,
    group_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let local_group = {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      manager.get_group(group_id).ok()
    };

    let remote_key = format!("extension_groups/{}.json", group_id);
    let stat = self.client.stat(&remote_key).await?;

    match (local_group, stat.exists) {
      (Some(group), true) => {
        // Both exist - resolve by user-edit timestamp (last-write-wins).
        let local_updated = group.updated_at;
        let remote_updated = self.remote_updated_at(&stat, &remote_key).await;

        if remote_updated > local_updated {
          self.download_extension_group(group_id, app_handle).await?;
        } else if local_updated > remote_updated {
          self.upload_extension_group(&group).await?;
        }
      }
      (Some(group), false) => {
        self.upload_extension_group(&group).await?;
      }
      (None, true) => {
        self.download_extension_group(group_id, app_handle).await?;
      }
      (None, false) => {
        log::debug!("Extension group {} not found locally or remotely", group_id);
      }
    }

    Ok(())
  }

  async fn upload_extension_group(
    &self,
    group: &crate::extension_manager::ExtensionGroup,
  ) -> SyncResult<()> {
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs();

    let mut updated_group = group.clone();
    updated_group.last_sync = Some(now);

    let json = serde_json::to_string_pretty(&updated_group).map_err(|e| {
      SyncError::SerializationError(format!("Failed to serialize extension group: {e}"))
    })?;

    let remote_key = format!("extension_groups/{}.json", group.id);
    self
      .upload_config_json(&remote_key, &json, updated_group.updated_at)
      .await?;

    // Update local group with new last_sync
    {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      if let Err(e) = manager.update_group_internal(&updated_group) {
        log::warn!("Failed to update extension group last_sync: {}", e);
      }
    }

    log::info!("Extension group {} uploaded", group.id);
    Ok(())
  }

  async fn download_extension_group(
    &self,
    group_id: &str,
    app_handle: Option<&tauri::AppHandle>,
  ) -> SyncResult<()> {
    let remote_key = format!("extension_groups/{}.json", group_id);
    let presign = self.client.presign_download(&remote_key).await?;
    let raw = self.client.download_bytes(&presign.url).await?;

    let data = encryption::maybe_unseal_after_download(&raw)
      .map_err(|e| SyncError::InvalidData(format!("Failed to unseal extension group: {e}")))?;

    let mut group: crate::extension_manager::ExtensionGroup = serde_json::from_slice(&data)
      .map_err(|e| {
        SyncError::SerializationError(format!("Failed to parse extension group JSON: {e}"))
      })?;

    group.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );
    group.sync_enabled = true;

    // Save or update local group
    {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      if let Err(e) = manager.upsert_group_internal(&group) {
        log::warn!("Failed to save downloaded extension group: {}", e);
      }
    }

    if let Some(_handle) = app_handle {
      let _ = events::emit("extensions-changed", ());
    }

    log::info!("Extension group {} downloaded", group_id);
    Ok(())
  }

  pub async fn sync_extension_group_by_id_with_handle(
    &self,
    group_id: &str,
    app_handle: &tauri::AppHandle,
  ) -> SyncResult<()> {
    self.sync_extension_group(group_id, Some(app_handle)).await
  }

  pub async fn delete_extension_group(&self, group_id: &str) -> SyncResult<()> {
    let remote_key = format!("extension_groups/{}.json", group_id);
    let tombstone_key = format!("tombstones/extension_groups/{}.json", group_id);

    self
      .client
      .delete(&remote_key, Some(&tombstone_key))
      .await?;

    log::info!("Extension group {} deleted from sync", group_id);
    Ok(())
  }

  // Download a profile from S3 if it exists remotely but not locally
}

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
    let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
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
      let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
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
    let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let group = manager
      .get_group(extension_group_id)
      .map_err(|e| format!("Extension group with ID '{extension_group_id}' not found: {e}"))?;
    (group.sync_enabled, group.extension_ids.clone())
  };

  if !group_already_synced {
    let mut updated_group = {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      manager
        .get_group(extension_group_id)
        .map_err(|e| format!("Failed to load extension group: {e}"))?
    };
    updated_group.sync_enabled = true;
    {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      manager
        .get_extension(&ext_id)
        .ok()
        .map(|e| e.sync_enabled)
        .unwrap_or(true)
    };
    if !already_synced {
      let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
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
    let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
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
    let gm = crate::group_manager::GROUP_MANAGER.lock().unwrap();
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
    let em = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let exts = em
      .list_extensions()
      .map_err(|e| format!("Failed to list extensions: {e}"))?;
    exts.iter().filter(|e| !e.sync_enabled).count()
  };

  let extension_group_count = {
    let em = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
      let gm = crate::group_manager::GROUP_MANAGER.lock().unwrap();
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
      let em = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
      let em = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    let manager = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    let gm = crate::group_manager::GROUP_MANAGER.lock().unwrap();
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
    let em = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    let em = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
