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
      let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
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

  async fn upload_group(&self, group: &crate::profile::group_manager::ProfileGroup) -> SyncResult<()> {
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
      let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
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

    let mut group: crate::profile::group_manager::ProfileGroup = serde_json::from_slice(&data)
      .map_err(|e| SyncError::SerializationError(format!("Failed to parse group JSON: {e}")))?;

    group.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );

    // Save or update local group
    {
      let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
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
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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

  async fn upload_extension(&self, ext: &crate::browser::extension_manager::Extension) -> SyncResult<()> {
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
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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

    let mut ext: crate::browser::extension_manager::Extension = serde_json::from_slice(&data)
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

      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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
    group: &crate::browser::extension_manager::ExtensionGroup,
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
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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

    let mut group: crate::browser::extension_manager::ExtensionGroup = serde_json::from_slice(&data)
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
      let manager = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
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

