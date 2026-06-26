impl SyncEngine {
  pub async fn sync_profile(
    &self,
    app_handle: &tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> SyncResult<()> {
    if profile.is_cross_os() {
      log::info!(
        "Cross-OS profile: {} ({}) — syncing metadata only",
        profile.name,
        profile.id
      );
      return self.sync_cross_os_metadata(app_handle, profile).await;
    }

    // Skip team profiles for self-hosted sync
    if Self::is_self_hosted_sync().await && profile.created_by_id.is_some() {
      log::info!(
        "Skipping team profile for self-hosted sync: {} ({})",
        profile.name,
        profile.id
      );
      return Ok(());
    }

    // Skip if profile is currently running locally
    if profile.process_id.is_some() {
      log::info!(
        "Skipping sync for running profile: {} ({})",
        profile.name,
        profile.id
      );
      return Ok(());
    }

    // Skip if profile is locked by another team member
    if crate::profile::team_lock::TEAM_LOCK
      .is_locked_by_another(&profile.id.to_string())
      .await
    {
      log::info!(
        "Skipping sync for profile locked by another team member: {} ({})",
        profile.name,
        profile.id
      );
      return Ok(());
    }

    // Derive encryption key if encrypted sync
    let encryption_key = if profile.is_encrypted_sync() {
      let password = encryption::load_e2e_password()
        .map_err(|e| SyncError::InvalidData(format!("Failed to load E2E password: {e}")))?
        .ok_or_else(|| {
          let _ = events::emit("profile-sync-e2e-password-required", ());
          SyncError::InvalidData("E2E password not set".to_string())
        })?;
      let salt = profile.encryption_salt.as_deref().ok_or_else(|| {
        SyncError::InvalidData("Encryption salt missing on encrypted profile".to_string())
      })?;
      let key = encryption::derive_profile_key(&password, salt)
        .map_err(|e| SyncError::InvalidData(format!("Key derivation failed: {e}")))?;
      Some(key)
    } else {
      None
    };

    let profile_manager = ProfileManager::instance();
    let profiles_dir = profile_manager.get_profiles_dir();
    let profile_dir = profiles_dir.join(profile.id.to_string());
    let profile_id = profile.id.to_string();

    let cancel_flag = register_sync_cancel(&profile_id);
    let _cancel_guard = SyncCancelGuard(profile_id.clone());

    // Determine team key prefix for team profiles
    let key_prefix = Self::get_team_key_prefix(profile).await;

    log::info!(
      "Starting delta sync for profile: {} ({}){}",
      profile.name,
      profile_id,
      if key_prefix.is_empty() {
        String::new()
      } else {
        format!(" [team prefix: {}]", key_prefix)
      }
    );

    let _ = events::emit(
      "profile-sync-status",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "status": "syncing"
      }),
    );

    // Ensure profile directory exists
    fs::create_dir_all(&profile_dir).map_err(|e| {
      SyncError::IoError(format!(
        "Failed to create profile directory {}: {e}",
        profile_dir.display()
      ))
    })?;

    // Checkpoint any SQLite WAL files to ensure all data is in the main DB
    // before we generate the manifest (WAL files are excluded from sync)
    checkpoint_sqlite_wal_files(&profile_dir);

    // Load or create hash cache
    let cache_path = get_cache_path(&profile_dir);
    let mut hash_cache = HashCache::load(&cache_path);

    // Generate local manifest
    let local_manifest = generate_manifest(&profile_id, &profile_dir, &mut hash_cache)?;

    let total_size: u64 = local_manifest.files.iter().map(|f| f.size).sum();
    let has_cookies = local_manifest
      .files
      .iter()
      .any(|f| f.path.contains("Cookies") || f.path.contains("cookies"));
    let has_local_state = local_manifest
      .files
      .iter()
      .any(|f| f.path.contains("Local State"));
    log::info!(
      "Profile {} manifest: {} files, {} bytes total, cookies={}, local_state={}",
      profile_id,
      local_manifest.files.len(),
      total_size,
      has_cookies,
      has_local_state
    );

    // Save the hash cache for future runs
    hash_cache.save(&cache_path)?;

    // Try to download remote manifest
    let remote_manifest_key = format!("{}profiles/{}/manifest.json", key_prefix, profile_id);
    let remote_manifest = self
      .download_manifest(&remote_manifest_key, encryption_key.as_ref())
      .await?;

    // Compute diff
    let diff = compute_diff(&local_manifest, remote_manifest.as_ref());

    if diff.is_empty() {
      log::info!("Profile {} is already in sync", profile_id);
      let _ = events::emit(
        "profile-sync-status",
        serde_json::json!({
          "profile_id": profile_id,
          "profile_name": profile.name,
          "status": "synced"
        }),
      );
      return Ok(());
    }

    let upload_bytes: u64 = diff.files_to_upload.iter().map(|f| f.size).sum();
    let download_bytes: u64 = diff.files_to_download.iter().map(|f| f.size).sum();
    let total_files = diff.files_to_upload.len()
      + diff.files_to_download.len()
      + diff.files_to_delete_local.len()
      + diff.files_to_delete_remote.len();

    log::info!(
      "Profile {} diff: {} to upload, {} to download, {} to delete local, {} to delete remote",
      profile_id,
      diff.files_to_upload.len(),
      diff.files_to_download.len(),
      diff.files_to_delete_local.len(),
      diff.files_to_delete_remote.len()
    );

    let _ = events::emit(
      "profile-sync-progress",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "phase": "started",
        "total_files": total_files,
        "total_bytes": upload_bytes + download_bytes
      }),
    );

    // Perform uploads
    if !diff.files_to_upload.is_empty() {
      self
        .upload_profile_files(
          app_handle,
          &profile_id,
          &profile.name,
          &profile_dir,
          &diff.files_to_upload,
          encryption_key.as_ref(),
          &key_prefix,
          &cancel_flag,
        )
        .await?;
    }

    if cancel_flag.load(Ordering::Relaxed) {
      log::info!("Sync cancelled for profile {} after uploads", profile_id);
      return Err(SyncError::Cancelled);
    }

    // Perform downloads
    if !diff.files_to_download.is_empty() {
      self
        .download_profile_files(
          app_handle,
          &profile_id,
          &profile.name,
          &profile_dir,
          &diff.files_to_download,
          encryption_key.as_ref(),
          &key_prefix,
          &cancel_flag,
        )
        .await?;
    }

    if cancel_flag.load(Ordering::Relaxed) {
      log::info!("Sync cancelled for profile {} after downloads", profile_id);
      return Err(SyncError::Cancelled);
    }

    // Delete local files that don't exist remotely (when remote is newer)
    for path in &diff.files_to_delete_local {
      let file_path = profile_dir.join(path);
      if file_path.exists() {
        let _ = fs::remove_file(&file_path);
        log::debug!("Deleted local file: {}", path);
      }
    }

    // Delete remote files that don't exist locally (when local is newer)
    for path in &diff.files_to_delete_remote {
      let remote_key = format!("{}profiles/{}/files/{}", key_prefix, profile_id, path);
      let _ = self.client.delete(&remote_key, None).await;
      log::debug!("Deleted remote file: {}", path);
    }

    // Upload metadata.json (sanitized profile)
    self
      .upload_profile_metadata(&profile_id, profile, &key_prefix)
      .await?;

    // If we recovered from an empty local state (downloaded everything from remote),
    // regenerate the manifest from the actual files now on disk so we don't
    // overwrite the remote manifest with an empty one.
    let final_manifest = if local_manifest.files.is_empty() && !diff.files_to_download.is_empty() {
      let mut new_cache = HashCache::load(&cache_path);
      let mut regenerated = generate_manifest(&profile_id, &profile_dir, &mut new_cache)?;
      new_cache.save(&cache_path)?;
      regenerated.encrypted = encryption_key.is_some();
      regenerated
    } else {
      let mut m = local_manifest;
      m.encrypted = encryption_key.is_some();
      m
    };

    // Upload manifest.json last for atomicity
    self
      .upload_manifest(
        &profile_id,
        &final_manifest,
        encryption_key.as_ref(),
        &key_prefix,
      )
      .await?;

    // Sync completed successfully — clean up resume state
    SyncResumeState::delete(&profile_dir);

    // Sync associated proxy, group, and VPN
    if let Some(proxy_id) = &profile.proxy_id {
      let _ = self.sync_proxy(proxy_id, Some(app_handle)).await;
    }
    if let Some(group_id) = &profile.group_id {
      let _ = self.sync_group(group_id, Some(app_handle)).await;
    }
    if let Some(vpn_id) = &profile.vpn_id {
      let _ = self.sync_vpn(vpn_id, Some(app_handle)).await;
    }

    // Download remote metadata and merge changes (name, tags, notes, etc.)
    let remote_metadata_key = format!("{}profiles/{}/metadata.json", key_prefix, profile_id);
    if let Ok(remote_meta) = self.download_profile_metadata(&remote_metadata_key).await {
      let mut updated_profile = profile.clone();
      // Merge fields that can be changed on other devices
      updated_profile.name = remote_meta.name;
      updated_profile.tags = remote_meta.tags;
      updated_profile.note = remote_meta.note;
      updated_profile.proxy_id = remote_meta.proxy_id;
      updated_profile.vpn_id = remote_meta.vpn_id;
      updated_profile.group_id = remote_meta.group_id;
      updated_profile.last_sync = Some(
        std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap()
          .as_secs(),
      );
      let _ = profile_manager.save_profile(&updated_profile);
    } else {
      // Fallback: just update last_sync
      let mut updated_profile = profile.clone();
      updated_profile.last_sync = Some(
        std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap()
          .as_secs(),
      );
      let _ = profile_manager.save_profile(&updated_profile);
    }
    let _ = events::emit("profiles-changed", ());

    let _ = events::emit(
      "profile-sync-status",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "status": "synced"
      }),
    );

    log::info!("Profile {} synced successfully", profile_id);
    Ok(())
  }

  async fn download_manifest(
    &self,
    key: &str,
    encryption_key: Option<&[u8; 32]>,
  ) -> SyncResult<Option<SyncManifest>> {
    let stat = self.client.stat(key).await?;
    if !stat.exists {
      return Ok(None);
    }

    let presign = self.client.presign_download(key).await?;
    let data = self.client.download_bytes(&presign.url).await?;

    // Try parsing as plaintext JSON first (unencrypted or backwards-compatible)
    if let Ok(manifest) = serde_json::from_slice::<SyncManifest>(&data) {
      return Ok(Some(manifest));
    }

    // If plaintext parse failed and we have an encryption key, try decrypting
    if let Some(key) = encryption_key {
      let decrypted = encryption::decrypt_bytes(key, &data)
        .map_err(|e| SyncError::InvalidData(format!("Failed to decrypt manifest: {e}")))?;
      let manifest: SyncManifest = serde_json::from_slice(&decrypted).map_err(|e| {
        SyncError::SerializationError(format!("Failed to parse decrypted manifest: {e}"))
      })?;
      return Ok(Some(manifest));
    }

    Err(SyncError::SerializationError(
      "Failed to parse manifest (not valid JSON and no encryption key available)".to_string(),
    ))
  }

  async fn upload_manifest(
    &self,
    profile_id: &str,
    manifest: &SyncManifest,
    encryption_key: Option<&[u8; 32]>,
    key_prefix: &str,
  ) -> SyncResult<()> {
    let json = serde_json::to_string_pretty(manifest)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize manifest: {e}")))?;

    let upload_data = if let Some(key) = encryption_key {
      encryption::encrypt_bytes(key, json.as_bytes())
        .map_err(|e| SyncError::InvalidData(format!("Failed to encrypt manifest: {e}")))?
    } else {
      json.into_bytes()
    };

    let content_type = if encryption_key.is_some() {
      "application/octet-stream"
    } else {
      "application/json"
    };

    let remote_key = format!("{}profiles/{}/manifest.json", key_prefix, profile_id);
    let presign = self
      .client
      .presign_upload(&remote_key, Some(content_type))
      .await?;

    self
      .client
      .upload_bytes(&presign.url, &upload_data, Some(content_type))
      .await?;

    Ok(())
  }

  async fn download_profile_metadata(&self, key: &str) -> SyncResult<BrowserProfile> {
    let stat = self.client.stat(key).await?;
    if !stat.exists {
      return Err(SyncError::InvalidData(
        "Remote metadata not found".to_string(),
      ));
    }

    let presign = self.client.presign_download(key).await?;
    let raw = self.client.download_bytes(&presign.url).await?;
    let data = encryption::maybe_unseal_after_download(&raw)
      .map_err(|e| SyncError::InvalidData(format!("Failed to unseal profile metadata: {e}")))?;
    let profile: BrowserProfile = serde_json::from_slice(&data)
      .map_err(|e| SyncError::SerializationError(format!("Failed to parse metadata: {e}")))?;

    Ok(profile)
  }

  /// Sync only metadata for cross-OS profiles (tags, notes, proxies, groups).
  /// No browser files are synced.
  async fn sync_cross_os_metadata(
    &self,
    app_handle: &tauri::AppHandle,
    profile: &BrowserProfile,
  ) -> SyncResult<()> {
    let profile_id = profile.id.to_string();
    let key_prefix = Self::get_team_key_prefix(profile).await;
    let profile_manager = ProfileManager::instance();

    // Upload our metadata
    self
      .upload_profile_metadata(&profile_id, profile, &key_prefix)
      .await?;

    // Download remote metadata and merge if remote has changes
    let remote_metadata_key = format!("{}profiles/{}/metadata.json", key_prefix, profile_id);
    if let Ok(remote_meta) = self.download_profile_metadata(&remote_metadata_key).await {
      let mut updated = profile.clone();
      updated.name = remote_meta.name;
      updated.tags = remote_meta.tags;
      updated.note = remote_meta.note;
      updated.proxy_id = remote_meta.proxy_id;
      updated.vpn_id = remote_meta.vpn_id;
      updated.group_id = remote_meta.group_id;
      updated.last_sync = Some(
        std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap()
          .as_secs(),
      );
      let _ = profile_manager.save_profile(&updated);
    }

    // Sync associated entities
    if let Some(proxy_id) = &profile.proxy_id {
      let _ = self.sync_proxy(proxy_id, Some(app_handle)).await;
    }
    if let Some(group_id) = &profile.group_id {
      let _ = self.sync_group(group_id, Some(app_handle)).await;
    }

    let _ = events::emit("profiles-changed", ());
    let _ = events::emit(
      "profile-sync-status",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "status": "synced"
      }),
    );

    log::info!("Cross-OS profile {} metadata synced", profile_id);
    Ok(())
  }

  async fn upload_profile_metadata(
    &self,
    profile_id: &str,
    profile: &BrowserProfile,
    key_prefix: &str,
  ) -> SyncResult<()> {
    let mut sanitized = profile.clone();
    sanitized.process_id = None;
    sanitized.last_launch = None;
    sanitized.last_sync = None; // Avoid triggering sync loop on timestamp change

    let json = serde_json::to_string_pretty(&sanitized)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize profile: {e}")))?;

    let (payload, content_type) = encryption::maybe_seal_for_upload(json.as_bytes())
      .map_err(|e| SyncError::InvalidData(format!("Failed to seal profile metadata: {e}")))?;

    let remote_key = format!("{}profiles/{}/metadata.json", key_prefix, profile_id);
    let presign = self
      .client
      .presign_upload(&remote_key, Some(content_type))
      .await?;

    self
      .client
      .upload_bytes(&presign.url, &payload, Some(content_type))
      .await?;

    Ok(())
  }

}
