impl SyncEngine {
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
          let group_manager = crate::profile::group_manager::GROUP_MANAGER.lock().unwrap();
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
