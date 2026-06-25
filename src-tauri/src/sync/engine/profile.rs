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
    if crate::team_lock::TEAM_LOCK
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

  #[allow(clippy::too_many_arguments)]
  async fn upload_profile_files(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    profile_name: &str,
    profile_dir: &Path,
    files: &[super::manifest::ManifestFileEntry],
    encryption_key: Option<&[u8; 32]>,
    key_prefix: &str,
    cancel_flag: &Arc<AtomicBool>,
  ) -> SyncResult<()> {
    if files.is_empty() {
      return Ok(());
    }

    // Load resume state to skip already-uploaded files
    let mut resume_state = SyncResumeState::load(profile_dir)
      .filter(|s| s.profile_id == profile_id && s.direction == "upload");

    let already_done: HashSet<String> = resume_state
      .as_ref()
      .map(|s| s.completed_files.clone())
      .unwrap_or_default();

    let files_to_process: Vec<_> = files
      .iter()
      .filter(|f| !already_done.contains(&f.path))
      .collect();
    let skipped = files.len() - files_to_process.len();

    if skipped > 0 {
      log::info!(
        "Resume: skipping {} already-uploaded files, processing {} remaining for profile {}",
        skipped,
        files_to_process.len(),
        profile_id
      );
    }

    log::info!(
      "Uploading {} files for profile {}",
      files_to_process.len(),
      profile_id
    );

    if files_to_process.is_empty() {
      return Ok(());
    }

    // Initialize resume state if not resuming
    if resume_state.is_none() {
      resume_state = Some(SyncResumeState {
        profile_id: profile_id.to_string(),
        direction: "upload".to_string(),
        started_at: Utc::now().to_rfc3339(),
        completed_files: HashSet::new(),
      });
    }
    let resume_state = Arc::new(TokioMutex::new(resume_state.unwrap()));

    // Get batch presigned URLs
    let items: Vec<(String, Option<String>)> = files_to_process
      .iter()
      .map(|f| {
        let key = format!("{}profiles/{}/files/{}", key_prefix, profile_id, f.path);
        let content_type = mime_guess::from_path(&f.path)
          .first()
          .map(|m| m.to_string());
        (key, content_type)
      })
      .collect();

    let batch_response = self.client.presign_upload_batch(items).await?;

    // Build URL map
    let url_map: HashMap<String, String> = batch_response
      .items
      .into_iter()
      .map(|item| (item.key, item.url))
      .collect();

    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let already_bytes: u64 = files
      .iter()
      .filter(|f| already_done.contains(&f.path))
      .map(|f| f.size)
      .sum();

    let tracker = Arc::new(SyncProgressTracker::new(
      profile_id.to_string(),
      profile_name.to_string(),
      "uploading",
      files.len() as u64,
      total_bytes,
    ));
    // Pre-populate tracker with resumed progress
    tracker
      .completed_files
      .store(skipped as u64, Ordering::Relaxed);
    tracker
      .completed_bytes
      .store(already_bytes, Ordering::Relaxed);
    tracker.emit_final();

    let semaphore = Arc::new(Semaphore::new(SYNC_CONCURRENCY));
    let client = self.client.clone();
    let profile_dir = profile_dir.to_path_buf();
    let profile_id_owned = profile_id.to_string();
    let enc_key = encryption_key.copied();

    type FileResult = Result<String, (String, String, bool)>;
    let mut handles: Vec<tokio::task::JoinHandle<FileResult>> = Vec::new();

    // Counter for batching resume state saves
    let save_counter = Arc::new(AtomicU64::new(0));

    for file in &files_to_process {
      if cancel_flag.load(Ordering::Relaxed) {
        log::info!(
          "Upload cancelled for profile {} before scheduling more files",
          profile_id_owned
        );
        break;
      }
      let sem = semaphore.clone();
      let file_path = profile_dir.join(&file.path);
      let relative_path = file.path.clone();
      let file_size = file.size;
      let remote_key = format!(
        "{}profiles/{}/files/{}",
        key_prefix, profile_id_owned, file.path
      );
      let url = url_map.get(&remote_key).cloned();
      let critical = is_critical_file(&file.path);

      if url.is_none() {
        log::warn!("No presigned URL for {}", remote_key);
        if critical {
          return Err(SyncError::NetworkError(format!(
            "No presigned URL for critical file: {}",
            file.path
          )));
        }
        continue;
      }

      let url = url.unwrap();
      let client = client.clone();
      let tracker = tracker.clone();
      let resume_state = resume_state.clone();
      let save_counter = save_counter.clone();
      let profile_dir_clone = profile_dir.clone();
      let cancel_flag_task = cancel_flag.clone();
      let content_type = mime_guess::from_path(&file.path)
        .first()
        .map(|m| m.to_string());

      handles.push(tokio::spawn(async move {
        let _permit = sem.acquire().await.unwrap();

        if cancel_flag_task.load(Ordering::Relaxed) {
          return Err((relative_path, "cancelled".to_string(), false));
        }

        let data = match fs::read(&file_path) {
          Ok(d) => d,
          Err(e) if e.kind() == std::io::ErrorKind::NotFound && !critical => {
            log::debug!("File disappeared, skipping: {}", file_path.display());
            tracker.record_success(0);
            return Ok(relative_path);
          }
          Err(e) => {
            let msg = format!("Failed to read {}: {}", file_path.display(), e);
            log::warn!("{}", msg);
            tracker.record_failure();
            return Err((relative_path, msg, critical));
          }
        };

        let upload_data = if let Some(ref key) = enc_key {
          match encryption::encrypt_bytes(key, &data) {
            Ok(encrypted) => encrypted,
            Err(e) => {
              let msg = format!("Failed to encrypt {}: {}", file_path.display(), e);
              log::warn!("{}", msg);
              tracker.record_failure();
              return Err((relative_path, msg, critical));
            }
          }
        } else {
          data
        };

        // Retry loop for network uploads
        let mut last_err = String::new();
        for attempt in 0..MAX_FILE_RETRIES {
          match client
            .upload_bytes(&url, &upload_data, content_type.as_deref())
            .await
          {
            Ok(()) => {
              tracker.record_success(file_size);

              // Record in resume state, save periodically
              {
                let mut state = resume_state.lock().await;
                state.completed_files.insert(relative_path.clone());
                let count = save_counter.fetch_add(1, Ordering::Relaxed);
                if count.is_multiple_of(50) {
                  let _ = state.save(&profile_dir_clone);
                }
              }

              return Ok(relative_path);
            }
            Err(e) => {
              last_err = format!("{}", e);
              if attempt < MAX_FILE_RETRIES - 1 {
                log::debug!(
                  "Retry {}/{} for {}: {}",
                  attempt + 1,
                  MAX_FILE_RETRIES,
                  relative_path,
                  last_err
                );
                tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt as u64 + 1)))
                  .await;
              }
            }
          }
        }

        let msg = format!(
          "Failed to upload {} after {} retries: {}",
          relative_path, MAX_FILE_RETRIES, last_err
        );
        log::warn!("{}", msg);
        tracker.record_failure();
        Err((relative_path, msg, critical))
      }));
    }

    // Collect results
    let mut critical_failures = Vec::new();
    let mut non_critical_failures = Vec::new();

    for handle in handles {
      match handle.await {
        Ok(Ok(_)) => {}
        Ok(Err((path, msg, true))) => critical_failures.push((path, msg)),
        Ok(Err((path, msg, false))) => non_critical_failures.push((path, msg)),
        Err(e) => {
          log::warn!("Upload task panicked: {}", e);
        }
      }
    }

    // Final resume state save
    {
      let state = resume_state.lock().await;
      let _ = state.save(&profile_dir);
    }

    tracker.emit_final();

    if !non_critical_failures.is_empty() {
      log::warn!(
        "Upload completed with {} non-critical failures for profile {}",
        non_critical_failures.len(),
        profile_id_owned
      );
    }

    if !critical_failures.is_empty() {
      let file_list: Vec<&str> = critical_failures.iter().map(|(p, _)| p.as_str()).collect();
      return Err(SyncError::IoError(format!(
        "Critical files failed to upload: {}. Sync aborted to prevent data loss.",
        file_list.join(", ")
      )));
    }

    Ok(())
  }

  #[allow(clippy::too_many_arguments)]
  async fn download_profile_files(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    profile_name: &str,
    profile_dir: &Path,
    files: &[super::manifest::ManifestFileEntry],
    encryption_key: Option<&[u8; 32]>,
    key_prefix: &str,
    cancel_flag: &Arc<AtomicBool>,
  ) -> SyncResult<()> {
    if files.is_empty() {
      return Ok(());
    }

    // Load resume state to skip already-downloaded files
    let mut resume_state = SyncResumeState::load(profile_dir)
      .filter(|s| s.profile_id == profile_id && s.direction == "download");

    let already_done: HashSet<String> = resume_state
      .as_ref()
      .map(|s| s.completed_files.clone())
      .unwrap_or_default();

    let files_to_process: Vec<_> = files
      .iter()
      .filter(|f| !already_done.contains(&f.path))
      .collect();
    let skipped = files.len() - files_to_process.len();

    if skipped > 0 {
      log::info!(
        "Resume: skipping {} already-downloaded files, processing {} remaining for profile {}",
        skipped,
        files_to_process.len(),
        profile_id
      );
    }

    log::info!(
      "Downloading {} files for profile {}",
      files_to_process.len(),
      profile_id
    );

    if files_to_process.is_empty() {
      return Ok(());
    }

    // Initialize resume state if not resuming
    if resume_state.is_none() {
      resume_state = Some(SyncResumeState {
        profile_id: profile_id.to_string(),
        direction: "download".to_string(),
        started_at: Utc::now().to_rfc3339(),
        completed_files: HashSet::new(),
      });
    }
    let resume_state = Arc::new(TokioMutex::new(resume_state.unwrap()));

    // Get batch presigned URLs
    let keys: Vec<String> = files_to_process
      .iter()
      .map(|f| format!("{}profiles/{}/files/{}", key_prefix, profile_id, f.path))
      .collect();

    let batch_response = self.client.presign_download_batch(keys).await?;

    // Build URL map
    let url_map: HashMap<String, String> = batch_response
      .items
      .into_iter()
      .map(|item| (item.key, item.url))
      .collect();

    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let already_bytes: u64 = files
      .iter()
      .filter(|f| already_done.contains(&f.path))
      .map(|f| f.size)
      .sum();

    let tracker = Arc::new(SyncProgressTracker::new(
      profile_id.to_string(),
      profile_name.to_string(),
      "downloading",
      files.len() as u64,
      total_bytes,
    ));
    tracker
      .completed_files
      .store(skipped as u64, Ordering::Relaxed);
    tracker
      .completed_bytes
      .store(already_bytes, Ordering::Relaxed);
    tracker.emit_final();

    let semaphore = Arc::new(Semaphore::new(SYNC_CONCURRENCY));
    let client = self.client.clone();
    let profile_dir = profile_dir.to_path_buf();
    let profile_id_owned = profile_id.to_string();
    let enc_key = encryption_key.copied();

    type FileResult = Result<String, (String, String, bool)>;
    let mut handles: Vec<tokio::task::JoinHandle<FileResult>> = Vec::new();

    let save_counter = Arc::new(AtomicU64::new(0));

    for file in &files_to_process {
      if cancel_flag.load(Ordering::Relaxed) {
        log::info!(
          "Download cancelled for profile {} before scheduling more files",
          profile_id_owned
        );
        break;
      }
      let sem = semaphore.clone();
      let file_path = profile_dir.join(&file.path);
      let relative_path = file.path.clone();
      let file_size = file.size;
      let remote_key = format!(
        "{}profiles/{}/files/{}",
        key_prefix, profile_id_owned, file.path
      );
      let url = url_map.get(&remote_key).cloned();
      let critical = is_critical_file(&file.path);

      if url.is_none() {
        log::warn!("No presigned URL for {}", remote_key);
        if critical {
          return Err(SyncError::NetworkError(format!(
            "No presigned URL for critical file: {}",
            file.path
          )));
        }
        continue;
      }

      let url = url.unwrap();
      let client = client.clone();
      let tracker = tracker.clone();
      let resume_state = resume_state.clone();
      let save_counter = save_counter.clone();
      let profile_dir_clone = profile_dir.clone();
      let cancel_flag_task = cancel_flag.clone();

      handles.push(tokio::spawn(async move {
        let _permit = sem.acquire().await.unwrap();

        if cancel_flag_task.load(Ordering::Relaxed) {
          return Err((relative_path, "cancelled".to_string(), false));
        }

        // Retry loop for network downloads
        let mut last_err = String::new();
        for attempt in 0..MAX_FILE_RETRIES {
          if cancel_flag_task.load(Ordering::Relaxed) {
            return Err((relative_path, "cancelled".to_string(), false));
          }
          match client.download_bytes(&url).await {
            Ok(data) => {
              let write_data = if let Some(ref key) = enc_key {
                match encryption::decrypt_bytes(key, &data) {
                  Ok(decrypted) => decrypted,
                  Err(e) => {
                    let msg = format!("Failed to decrypt {}: {}", relative_path, e);
                    log::warn!("{}", msg);
                    tracker.record_failure();
                    return Err((relative_path, msg, critical));
                  }
                }
              } else {
                data
              };

              if let Some(parent) = file_path.parent() {
                let _ = fs::create_dir_all(parent);
              }
              if let Err(e) = fs::write(&file_path, &write_data) {
                let msg = format!("Failed to write {}: {}", file_path.display(), e);
                log::warn!("{}", msg);
                tracker.record_failure();
                return Err((relative_path, msg, critical));
              }

              tracker.record_success(file_size);

              {
                let mut state = resume_state.lock().await;
                state.completed_files.insert(relative_path.clone());
                let count = save_counter.fetch_add(1, Ordering::Relaxed);
                if count.is_multiple_of(50) {
                  let _ = state.save(&profile_dir_clone);
                }
              }

              return Ok(relative_path);
            }
            Err(e) => {
              last_err = format!("{}", e);
              if attempt < MAX_FILE_RETRIES - 1 {
                log::debug!(
                  "Retry {}/{} for {}: {}",
                  attempt + 1,
                  MAX_FILE_RETRIES,
                  relative_path,
                  last_err
                );
                tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt as u64 + 1)))
                  .await;
              }
            }
          }
        }

        let msg = format!(
          "Failed to download {} after {} retries: {}",
          relative_path, MAX_FILE_RETRIES, last_err
        );
        log::warn!("{}", msg);
        tracker.record_failure();
        Err((relative_path, msg, critical))
      }));
    }

    let mut critical_failures = Vec::new();
    let mut non_critical_failures = Vec::new();

    for handle in handles {
      match handle.await {
        Ok(Ok(_)) => {}
        Ok(Err((path, msg, true))) => critical_failures.push((path, msg)),
        Ok(Err((path, msg, false))) => non_critical_failures.push((path, msg)),
        Err(e) => {
          log::warn!("Download task panicked: {}", e);
        }
      }
    }

    // Final resume state save
    {
      let state = resume_state.lock().await;
      let _ = state.save(&profile_dir);
    }

    tracker.emit_final();

    if !non_critical_failures.is_empty() {
      log::warn!(
        "Download completed with {} non-critical failures for profile {}",
        non_critical_failures.len(),
        profile_id_owned
      );
    }

    if !critical_failures.is_empty() {
      let file_list: Vec<&str> = critical_failures.iter().map(|(p, _)| p.as_str()).collect();
      return Err(SyncError::IoError(format!(
        "Critical files failed to download: {}. Sync aborted to prevent data loss.",
        file_list.join(", ")
      )));
    }

    Ok(())
  }

  pub async fn download_profile_if_missing(
    &self,
    app_handle: &tauri::AppHandle,
    profile_id: &str,
    key_prefix: &str,
  ) -> SyncResult<bool> {
    let profile_manager = ProfileManager::instance();
    let profiles_dir = profile_manager.get_profiles_dir();
    let profile_dir = profiles_dir.join(profile_id);

    // Check if profile exists locally
    let profile_uuid = uuid::Uuid::parse_str(profile_id)
      .map_err(|_| SyncError::InvalidData(format!("Invalid profile ID format: {}", profile_id)))?;

    let profiles = profile_manager
      .list_profiles()
      .map_err(|e| SyncError::IoError(format!("Failed to list profiles: {e}")))?;

    let exists_locally = profiles.iter().any(|p| p.id == profile_uuid);

    if exists_locally {
      log::debug!("Profile {} exists locally, skipping download", profile_id);
      return Ok(false);
    }

    // Check if profile exists remotely
    let manifest_key = format!("{}profiles/{}/manifest.json", key_prefix, profile_id);
    let stat = self.client.stat(&manifest_key).await?;

    if !stat.exists {
      log::debug!("Profile {} does not exist remotely, skipping", profile_id);
      return Ok(false);
    }

    log::info!(
      "Profile {} exists remotely but not locally, downloading...",
      profile_id
    );

    // Download metadata.json first to get profile info
    let metadata_key = format!("{}profiles/{}/metadata.json", key_prefix, profile_id);
    let metadata_stat = self.client.stat(&metadata_key).await?;

    if !metadata_stat.exists {
      log::warn!(
        "Profile {} manifest exists but metadata.json missing, skipping",
        profile_id
      );
      return Ok(false);
    }

    let metadata_presign = self.client.presign_download(&metadata_key).await?;
    let metadata_data = self.client.download_bytes(&metadata_presign.url).await?;
    let mut profile: BrowserProfile = serde_json::from_slice(&metadata_data)
      .map_err(|e| SyncError::SerializationError(format!("Failed to parse metadata: {e}")))?;

    // Cross-OS profile: save metadata only, skip manifest + file downloads
    if profile.is_cross_os() {
      log::info!(
        "Profile {} is cross-OS (host_os={:?}), downloading metadata only",
        profile_id,
        profile.host_os
      );

      fs::create_dir_all(&profile_dir).map_err(|e| {
        SyncError::IoError(format!(
          "Failed to create profile directory {}: {e}",
          profile_dir.display()
        ))
      })?;

      if profile.sync_mode == SyncMode::Disabled {
        profile.sync_mode = SyncMode::Regular;
      }
      profile.last_sync = Some(
        std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap()
          .as_secs(),
      );

      profile_manager
        .save_profile(&profile)
        .map_err(|e| SyncError::IoError(format!("Failed to save cross-OS profile: {e}")))?;

      let _ = events::emit("profiles-changed", ());
      let _ = events::emit(
        "profile-sync-status",
        serde_json::json!({
          "profile_id": profile_id,
          "profile_name": profile.name,
          "status": "synced"
        }),
      );

      log::info!(
        "Cross-OS profile {} metadata downloaded successfully",
        profile_id
      );
      return Ok(true);
    }

    // Derive encryption key before downloading manifest if profile uses encrypted sync.
    // The manifest itself may be encrypted (new behavior) or plaintext (backwards compat).
    let encryption_key = if profile.is_encrypted_sync() {
      let password = encryption::load_e2e_password()
        .map_err(|e| SyncError::InvalidData(format!("Failed to load E2E password: {e}")))?
        .ok_or_else(|| {
          let _ = events::emit("profile-sync-e2e-password-required", ());
          SyncError::InvalidData(
            "Remote profile is encrypted but no E2E password is set".to_string(),
          )
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

    // Download manifest (may be encrypted for e2e profiles)
    let manifest = self
      .download_manifest(&manifest_key, encryption_key.as_ref())
      .await?;
    let Some(manifest) = manifest else {
      return Err(SyncError::InvalidData(
        "Remote manifest not found".to_string(),
      ));
    };

    // Ensure profile directory exists
    fs::create_dir_all(&profile_dir).map_err(|e| {
      SyncError::IoError(format!(
        "Failed to create profile directory {}: {e}",
        profile_dir.display()
      ))
    })?;

    // Download all files from manifest
    let total_size: u64 = manifest.files.iter().map(|f| f.size).sum();
    log::info!(
      "Profile {} recovery: downloading {} files ({} bytes total)",
      profile_id,
      manifest.files.len(),
      total_size
    );
    for file in &manifest.files {
      log::info!(
        "  -> {} ({} bytes, hash: {})",
        file.path,
        file.size,
        file.hash
      );
    }
    if !manifest.files.is_empty() {
      let cancel_flag = register_sync_cancel(profile_id);
      let _cancel_guard = SyncCancelGuard(profile_id.to_string());
      self
        .download_profile_files(
          app_handle,
          profile_id,
          &profile.name,
          &profile_dir,
          &manifest.files,
          encryption_key.as_ref(),
          key_prefix,
          &cancel_flag,
        )
        .await?;
    }

    // Verify critical files after download
    let os_crypt_key_path = profile_dir.join("profile").join("os_crypt_key");
    let cookies_path = {
      let network = profile_dir
        .join("profile")
        .join("Default")
        .join("Network")
        .join("Cookies");
      if network.exists() {
        network
      } else {
        profile_dir.join("profile").join("Default").join("Cookies")
      }
    };
    if os_crypt_key_path.exists() {
      let key_data = fs::read(&os_crypt_key_path).unwrap_or_default();
      log::info!(
        "Profile {} sync: os_crypt_key present ({} bytes, sha256: {:x})",
        profile_id,
        key_data.len(),
        {
          use std::hash::{Hash, Hasher};
          let mut h = std::collections::hash_map::DefaultHasher::new();
          key_data.hash(&mut h);
          h.finish()
        }
      );
    } else {
      log::warn!(
        "Profile {} sync: os_crypt_key NOT FOUND after download",
        profile_id
      );
    }
    if cookies_path.exists() {
      let cookies_meta = fs::metadata(&cookies_path).unwrap_or_else(|_| fs::metadata(".").unwrap());
      log::info!(
        "Profile {} sync: Cookies present ({} bytes)",
        profile_id,
        cookies_meta.len()
      );
    } else {
      log::warn!(
        "Profile {} sync: Cookies NOT FOUND after download",
        profile_id
      );
    }

    // Set sync mode and save profile
    if profile.sync_mode == SyncMode::Disabled {
      profile.sync_mode = if manifest.encrypted {
        SyncMode::Encrypted
      } else {
        SyncMode::Regular
      };
    }
    profile.last_sync = Some(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    );

    profile_manager
      .save_profile(&profile)
      .map_err(|e| SyncError::IoError(format!("Failed to save downloaded profile: {e}")))?;

    let _ = events::emit("profiles-changed", ());
    let _ = events::emit(
      "profile-sync-status",
      serde_json::json!({
        "profile_id": profile_id,
        "profile_name": profile.name,
        "status": "synced"
      }),
    );

    log::info!("Profile {} downloaded successfully", profile_id);
    Ok(true)
  }

  /// Check for profiles that exist remotely but not locally and download them
  pub async fn check_for_missing_synced_profiles(
    &self,
    app_handle: &tauri::AppHandle,
  ) -> SyncResult<Vec<String>> {
    log::info!("Checking for missing synced profiles...");

    // List all personal profiles from S3 (paginated)
    let all_objects = self.client.list_all("profiles/").await?;

    let mut downloaded: Vec<String> = Vec::new();

    // Extract unique profile IDs with their key prefix
    let mut profiles_to_check: HashMap<String, String> = HashMap::new();
    for obj in all_objects {
      if obj.key.starts_with("profiles/") && obj.key.ends_with("/manifest.json") {
        if let Some(profile_id) = obj
          .key
          .strip_prefix("profiles/")
          .and_then(|s| s.strip_suffix("/manifest.json"))
        {
          profiles_to_check.insert(profile_id.to_string(), String::new());
        }
      }
    }

    // Also list team profiles if user is on a team
    if let Some(auth) = crate::api::cloud_auth::CLOUD_AUTH.get_user().await {
      if let Some(team_id) = &auth.user.team_id {
        let team_prefix = format!("teams/{}/", team_id);
        let team_list_key = format!("{}profiles/", team_prefix);
        if let Ok(team_objects) = self.client.list_all(&team_list_key).await {
          for obj in team_objects {
            if obj.key.starts_with("profiles/") && obj.key.ends_with("/manifest.json") {
              if let Some(profile_id) = obj
                .key
                .strip_prefix("profiles/")
                .and_then(|s| s.strip_suffix("/manifest.json"))
              {
                profiles_to_check.insert(profile_id.to_string(), team_prefix.clone());
              }
            }
          }
        }
      }
    }

    log::info!(
      "Found {} profiles in remote storage, checking for missing ones...",
      profiles_to_check.len()
    );

    // For each remote profile, check if it exists locally and download if missing.
    // Skip any profile that has a tombstone — a leftover manifest under a
    // tombstoned id means delete_prefix raced or partially failed, and
    // re-downloading it here is what surfaced the "Browsing keeps re-syncing"
    // bug after a delete.
    for (profile_id, key_prefix) in &profiles_to_check {
      let personal_tombstone = format!("tombstones/profiles/{}.json", profile_id);
      let has_personal_tombstone = matches!(
        self.client.stat(&personal_tombstone).await,
        Ok(stat) if stat.exists
      );
      let team_tombstone_key = if key_prefix.is_empty() {
        None
      } else {
        Some(format!(
          "{}tombstones/profiles/{}.json",
          key_prefix, profile_id
        ))
      };
      let has_team_tombstone = if let Some(ref tk) = team_tombstone_key {
        matches!(self.client.stat(tk).await, Ok(stat) if stat.exists)
      } else {
        false
      };
      if has_personal_tombstone || has_team_tombstone {
        log::info!(
          "Skipping download of tombstoned profile {} (clearing leftover remote files)",
          profile_id
        );
        let prefix = format!("{}profiles/{}/", key_prefix, profile_id);
        if let Err(e) = self.client.delete_prefix(&prefix, None).await {
          log::warn!(
            "Failed to clear stale remote files for tombstoned profile {}: {}",
            profile_id,
            e
          );
        }
        continue;
      }

      match self
        .download_profile_if_missing(app_handle, profile_id, key_prefix)
        .await
      {
        Ok(true) => {
          downloaded.push(profile_id.clone());
        }
        Ok(false) => {
          // Profile exists locally or doesn't exist remotely, skip
        }
        Err(e) => {
          log::warn!("Failed to check/download profile {}: {}", profile_id, e);
        }
      }
    }

    if !downloaded.is_empty() {
      log::info!(
        "Downloaded {} missing profiles: {:?}",
        downloaded.len(),
        downloaded
      );
    } else {
      log::info!("No missing profiles found");
    }

    // Delete local synced profiles that have a remote tombstone (deleted on another device)
    {
      let profile_manager = ProfileManager::instance();
      let local_synced: Vec<(String, Option<String>)> = profile_manager
        .list_profiles()
        .unwrap_or_default()
        .iter()
        .filter(|p| p.is_sync_enabled())
        .map(|p| (p.id.to_string(), p.created_by_id.clone()))
        .collect();

      let team_prefix = if let Some(auth) = crate::api::cloud_auth::CLOUD_AUTH.get_user().await {
        auth.user.team_id.map(|tid| format!("teams/{}/", tid))
      } else {
        None
      };

      for (pid, created_by_id) in &local_synced {
        // Check personal tombstone
        let personal_tombstone = format!("tombstones/profiles/{}.json", pid);
        let has_personal_tombstone = matches!(
          self.client.stat(&personal_tombstone).await,
          Ok(stat) if stat.exists
        );

        // Check team tombstone
        let has_team_tombstone = if let (Some(tp), Some(_)) = (&team_prefix, created_by_id) {
          let team_tombstone = format!("{}tombstones/profiles/{}.json", tp, pid);
          matches!(
            self.client.stat(&team_tombstone).await,
            Ok(stat) if stat.exists
          )
        } else {
          false
        };

        if has_personal_tombstone || has_team_tombstone {
          // Originator guard: re-read the profile right before deleting. If the
          // local user disabled sync between the snapshot above and this stat
          // call, they're the one who wrote this tombstone — keep their local
          // copy. Tombstones must delete remote-originated changes, never the
          // sender's own data. (Caused mass local deletion in v0.24.x.)
          let still_sync_enabled = profile_manager
            .list_profiles()
            .unwrap_or_default()
            .iter()
            .find(|p| p.id.to_string() == *pid)
            .is_some_and(|p| p.is_sync_enabled());
          if !still_sync_enabled {
            log::info!(
              "Profile {} has a tombstone but sync is no longer enabled locally — keeping local copy (originating device)",
              pid
            );
            continue;
          }
          log::info!(
            "Profile {} has remote tombstone, deleting locally (deleted on another device)",
            pid
          );
          if let Err(e) = profile_manager.delete_profile_local_only(pid) {
            log::warn!("Failed to delete tombstoned profile {}: {}", pid, e);
          }
        }
      }
    }

    // Refresh metadata for local cross-OS profiles (propagate renames, tags, notes from originating device)
    let profile_manager = ProfileManager::instance();
    // Collect cross-OS profiles before async operations to avoid holding non-Send Result across await
    let cross_os_profiles: Vec<(String, SyncMode, Option<String>)> = profile_manager
      .list_profiles()
      .unwrap_or_default()
      .iter()
      .filter(|p| p.is_cross_os() && p.is_sync_enabled())
      .map(|p| (p.id.to_string(), p.sync_mode, p.created_by_id.clone()))
      .collect();

    if !cross_os_profiles.is_empty() {
      let team_prefix = if let Some(auth) = crate::api::cloud_auth::CLOUD_AUTH.get_user().await {
        auth.user.team_id.map(|tid| format!("teams/{}/", tid))
      } else {
        None
      };

      for (pid, sync_mode, created_by_id) in &cross_os_profiles {
        let kp = if created_by_id.is_some() {
          team_prefix.as_deref().unwrap_or("")
        } else {
          ""
        };
        let metadata_key = format!("{}profiles/{}/metadata.json", kp, pid);
        match self.client.stat(&metadata_key).await {
          Ok(stat) if stat.exists => match self.client.presign_download(&metadata_key).await {
            Ok(presign) => match self.client.download_bytes(&presign.url).await {
              Ok(data) => {
                if let Ok(mut remote_profile) = serde_json::from_slice::<BrowserProfile>(&data) {
                  remote_profile.sync_mode = *sync_mode;
                  remote_profile.last_sync = Some(
                    std::time::SystemTime::now()
                      .duration_since(std::time::UNIX_EPOCH)
                      .unwrap()
                      .as_secs(),
                  );
                  if let Err(e) = profile_manager.save_profile(&remote_profile) {
                    log::warn!("Failed to refresh cross-OS profile {} metadata: {}", pid, e);
                  } else {
                    log::debug!("Refreshed cross-OS profile {} metadata", pid);
                  }
                }
              }
              Err(e) => {
                log::warn!(
                  "Failed to download cross-OS profile {} metadata: {}",
                  pid,
                  e
                );
              }
            },
            Err(e) => {
              log::warn!("Failed to presign cross-OS profile {} metadata: {}", pid, e);
            }
          },
          _ => {}
        }
      }
      let _ = events::emit("profiles-changed", ());
    }

    Ok(downloaded)
  }

  /// Check for remote entities (proxies, groups, VPNs) not present locally and download them
  pub async fn check_for_missing_synced_entities(
    &self,
    app_handle: &tauri::AppHandle,
  ) -> SyncResult<()> {
    log::info!("Checking for missing synced entities...");

    // Check for remote proxies not present locally
    let remote_proxies = self.client.list("proxies/").await?;
    for obj in &remote_proxies.objects {
      if let Some(proxy_id) = obj
        .key
        .strip_prefix("proxies/")
        .and_then(|s| s.strip_suffix(".json"))
      {
        let exists_locally = crate::proxy::proxy_manager::PROXY_MANAGER
          .get_stored_proxies()
          .iter()
          .any(|p| p.id == proxy_id);
        if !exists_locally {
          let tombstone_key = format!("tombstones/proxies/{}.json", proxy_id);
          if let Ok(stat) = self.client.stat(&tombstone_key).await {
            if stat.exists {
              continue;
            }
          }
          log::info!(
            "Proxy {} exists remotely but not locally, downloading...",
            proxy_id
          );
          if let Err(e) = self.download_proxy(proxy_id, Some(app_handle)).await {
            log::warn!("Failed to download missing proxy {}: {}", proxy_id, e);
          }
        }
      }
    }

    // Check for remote groups not present locally
    let remote_groups = self.client.list("groups/").await?;
    for obj in &remote_groups.objects {
      if let Some(group_id) = obj
        .key
        .strip_prefix("groups/")
        .and_then(|s| s.strip_suffix(".json"))
      {
        let exists_locally = {
          let group_manager = crate::group_manager::GROUP_MANAGER.lock().unwrap();
          group_manager
            .get_all_groups()
            .unwrap_or_default()
            .iter()
            .any(|g| g.id == group_id)
        };
        if !exists_locally {
          let tombstone_key = format!("tombstones/groups/{}.json", group_id);
          if let Ok(stat) = self.client.stat(&tombstone_key).await {
            if stat.exists {
              continue;
            }
          }
          log::info!(
            "Group {} exists remotely but not locally, downloading...",
            group_id
          );
          if let Err(e) = self.download_group(group_id, Some(app_handle)).await {
            log::warn!("Failed to download missing group {}: {}", group_id, e);
          }
        }
      }
    }

    // Check for remote VPNs not present locally
    let remote_vpns = self.client.list("vpns/").await?;
    for obj in &remote_vpns.objects {
      if let Some(vpn_id) = obj
        .key
        .strip_prefix("vpns/")
        .and_then(|s| s.strip_suffix(".json"))
      {
        let exists_locally = {
          let storage = crate::vpn::VPN_STORAGE.lock().unwrap();
          storage.load_config(vpn_id).is_ok()
        };
        if !exists_locally {
          let tombstone_key = format!("tombstones/vpns/{}.json", vpn_id);
          if let Ok(stat) = self.client.stat(&tombstone_key).await {
            if stat.exists {
              continue;
            }
          }
          log::info!(
            "VPN {} exists remotely but not locally, downloading...",
            vpn_id
          );
          if let Err(e) = self.download_vpn(vpn_id, Some(app_handle)).await {
            log::warn!("Failed to download missing VPN {}: {}", vpn_id, e);
          }
        }
      }
    }

    log::info!("Missing synced entities check complete");
    Ok(())
  }
}

/// Check if proxy is used by any synced profile
pub fn is_proxy_used_by_synced_profile(proxy_id: &str) -> bool {
  let profile_manager = ProfileManager::instance();
  if let Ok(profiles) = profile_manager.list_profiles() {
    profiles
      .iter()
      .any(|p| p.is_sync_enabled() && p.proxy_id.as_deref() == Some(proxy_id))
  } else {
    false
  }
}

/// Check if group is used by any synced profile
pub fn is_group_used_by_synced_profile(group_id: &str) -> bool {
  let profile_manager = ProfileManager::instance();
  if let Ok(profiles) = profile_manager.list_profiles() {
    profiles
      .iter()
      .any(|p| p.is_sync_enabled() && p.group_id.as_deref() == Some(group_id))
  } else {
    false
  }
}