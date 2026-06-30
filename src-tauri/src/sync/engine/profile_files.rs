impl SyncEngine {
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
}
