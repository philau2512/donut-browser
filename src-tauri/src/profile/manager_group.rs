impl ProfileManager {
  pub fn assign_profiles_to_group(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_ids: Vec<String>,
    group_id: Option<String>,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let profiles = self.list_profiles()?;

    for profile_id in profile_ids {
      let profile_uuid = uuid::Uuid::parse_str(&profile_id)
        .map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
      let mut profile = profiles
        .iter()
        .find(|p| p.id == profile_uuid)
        .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?
        .clone();

      // Check if browser is running
      if profile.process_id.is_some() {
        return Err(format!(
          "Cannot modify group for profile '{}' while browser is running. Please stop the browser first.", profile.name
        ).into());
      }

      profile.group_id = group_id.clone();
      profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());
      self.save_profile(&profile)?;

      crate::sync::queue_profile_sync_if_eligible(&profile);

      // Auto-enable sync for new group if profile has sync enabled
      if profile.is_sync_enabled() {
        if let Some(ref new_group_id) = group_id {
          let group_id_clone = new_group_id.clone();
          tauri::async_runtime::spawn(async move {
            let _ = crate::sync::enable_group_sync_if_needed(&group_id_clone).await;
            if let Some(scheduler) = crate::sync::get_global_scheduler() {
              scheduler.queue_group_sync(group_id_clone).await;
            }
          });
        }
      }
    }

    // Rebuild tag suggestions after group changes just in case
    let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
      let _ = tm.rebuild_from_profiles(&self.list_profiles().unwrap_or_default());
    });

    // Emit profile group assignment event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(())
  }

  pub fn update_profile_tags(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    tags: Vec<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    // Find the profile by ID
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    let mut seen = std::collections::HashSet::new();
    let mut deduped: Vec<String> = Vec::with_capacity(tags.len());
    for t in tags.into_iter() {
      if seen.insert(t.clone()) {
        deduped.push(t);
      }
    }
    profile.tags = deduped;
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    // Save profile
    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    // Update global tag suggestions from all profiles
    let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
      let _ = tm.rebuild_from_profiles(&self.list_profiles().unwrap_or_default());
    });

    // Emit profile tags update event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn delete_tag_globally(
    &self,
    _app_handle: &tauri::AppHandle,
    tag: &str,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let profiles = self.list_profiles()?;
    for mut profile in profiles {
      if profile.tags.iter().any(|t| t == tag) {
        profile.tags.retain(|t| t != tag);
        profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());
        self.save_profile(&profile)?;
        crate::sync::queue_profile_sync_if_eligible(&profile);
      }
    }

    let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
      let _ = tm.delete_tag(tag);
    });

    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(())
  }

  pub fn update_profile_note(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    note: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    // Find the profile by ID
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    // Update note (trim whitespace, set to None if empty)
    profile.note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    // Save profile
    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    // Emit profile note update event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn update_profile_status(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    profile_status: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    profile.profile_status = profile_status
      .map(|s| s.trim().to_string())
      .filter(|s| !s.is_empty());
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn update_profile_launch_hook(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    launch_hook: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    profile.launch_hook = Self::normalize_launch_hook(launch_hook)?;
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    if let Err(e) = events::emit("profile-updated", &profile) {
      log::warn!("Warning: Failed to emit profile update event: {e}");
    }

    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn update_profile_proxy_bypass_rules(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    rules: Vec<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    profile.proxy_bypass_rules = rules;
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn update_profile_dns_blocklist(
    &self,
    profile_id: &str,
    dns_blocklist: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    profile.dns_blocklist = dns_blocklist;
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn delete_multiple_profiles(
    &self,
    app_handle: &tauri::AppHandle,
    profile_ids: Vec<String>,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let profiles = self.list_profiles()?;
    let mut sync_enabled_ids: Vec<String> = Vec::new();

    for profile_id in profile_ids {
      let profile_uuid = uuid::Uuid::parse_str(&profile_id)
        .map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
      let profile = profiles
        .iter()
        .find(|p| p.id == profile_uuid)
        .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

      // Check if browser is running (cross-OS profiles can't be running locally)
      if profile.process_id.is_some() && !profile.is_cross_os() {
        return Err(
          format!(
            "Cannot delete profile '{}' while browser is running. Please stop the browser first.",
            profile.name
          )
          .into(),
        );
      }

      // Track sync-enabled profiles for remote deletion
      if profile.is_sync_enabled() {
        sync_enabled_ids.push(profile_id.clone());
      }

      // Delete the profile
      let profiles_dir = self.get_profiles_dir();
      let profile_uuid_dir = profiles_dir.join(profile.id.to_string());

      if profile_uuid_dir.exists() {
        std::fs::remove_dir_all(&profile_uuid_dir)?;
      }
    }

    // Delete sync-enabled profiles from S3
    if !sync_enabled_ids.is_empty() {
      let app_handle_clone = app_handle.clone();
      tauri::async_runtime::spawn(async move {
        if let Ok(engine) = crate::sync::SyncEngine::create_from_settings(&app_handle_clone).await {
          for profile_id in sync_enabled_ids {
            if let Err(e) = engine.delete_profile(&profile_id).await {
              log::warn!("Failed to delete profile {} from sync: {}", profile_id, e);
            }
          }
        }
      });
    }

    // Emit profile deletion event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(())
  }

  fn generate_clone_name(&self, original_name: &str) -> Result<String, Box<dyn std::error::Error>> {
    let profiles = self.list_profiles()?;
    let existing_names: std::collections::HashSet<String> =
      profiles.iter().map(|p| p.name.clone()).collect();

    let candidate = format!("{original_name} (Copy)");
    if !existing_names.contains(&candidate) {
      return Ok(candidate);
    }

    for i in 2.. {
      let candidate = format!("{original_name} (Copy {i})");
      if !existing_names.contains(&candidate) {
        return Ok(candidate);
      }
    }

    unreachable!()
  }

  pub fn clone_profile(
    &self,
    profile_id: &str,
    custom_name: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let source = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    if source.process_id.is_some() {
      return Err(
        "Cannot clone profile while browser is running. Please stop the browser first.".into(),
      );
    }

    let new_id = uuid::Uuid::new_v4();
    let clone_name = match custom_name {
      Some(name) if !name.trim().is_empty() => name.trim().to_string(),
      _ => self.generate_clone_name(&source.name)?,
    };

    let profiles_dir = self.get_profiles_dir();
    let source_dir = profiles_dir.join(source.id.to_string());
    let dest_dir = profiles_dir.join(new_id.to_string());

    if source_dir.exists() {
      crate::profile::profile_importer::ProfileImporter::copy_directory_recursive(
        &source_dir,
        &dest_dir,
      )?;
    } else {
      fs::create_dir_all(&dest_dir)?;
    }

    let mut new_profile = BrowserProfile {
      id: new_id,
      name: clone_name,
      browser: source.browser,
      version: source.version,
      proxy_id: source.proxy_id,
      vpn_id: source.vpn_id,
      launch_hook: source.launch_hook,
      automation: source.automation,
      process_id: None,
      last_launch: None,
      release_type: source.release_type,
      camoufox_config: source.camoufox_config,
      wayfern_config: source.wayfern_config,
      group_id: source.group_id,
      tags: source.tags,
      note: source.note,
      sync_mode: SyncMode::Disabled,
      encryption_salt: None,
      last_sync: None,
      host_os: Some(get_host_os()),
      ephemeral: false,
      extension_group_id: source.extension_group_id,
      proxy_bypass_rules: source.proxy_bypass_rules,
      created_by_id: None,
      created_by_email: None,
      dns_blocklist: source.dns_blocklist,
      password_protected: false,
      created_at: Some(
        std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .map(|d| d.as_secs())
          .unwrap_or(0),
      ),
      updated_at: Some(crate::proxy::proxy_manager::now_secs()),
      profile_status: None,
    };

    // Donut: a clone must NOT be linkable to its source. The source
    // wayfern_config embeds the persisted fingerprint JSON (including the
    // canvas_noise_seed), so copying it verbatim makes the clone emit
    // BYTE-IDENTICAL canvas/WebGL/audio readback hashes and identical device
    // signals as the source — trivially linkable if both run concurrently. Clear
    // the fingerprint so the launch path mints a fresh one (a new
    // canvas_noise_seed via RandBytes + an independent device fingerprint),
    // exactly as create_profile does when fingerprint.is_none(). NOTE: the
    // user-data-dir copy above still duplicates cookies/localStorage/TLS state —
    // a separate storage-linkage vector the user must clear if they want full
    // isolation between a clone and its source.
    if let Some(cfg) = new_profile.wayfern_config.as_mut() {
      cfg.fingerprint = None;
    }

    self.save_profile(&new_profile)?;

    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(new_profile)
  }

  pub async fn update_camoufox_config(
    &self,
    app_handle: tauri::AppHandle,
    profile_id: &str,
    config: CamoufoxConfig,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Find the profile by ID
    let profile_uuid = uuid::Uuid::parse_str(profile_id).map_err(
      |_| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Invalid profile ID: {profile_id}").into()
      },
    )?;
    let profiles =
      self
        .list_profiles()
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
          format!("Failed to list profiles: {e}").into()
        })?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Profile with ID '{profile_id}' not found").into()
      })?;

    // Check if the browser is currently running using the comprehensive status check
    let is_running = self
      .check_browser_status(app_handle.clone(), &profile)
      .await?;

    if is_running {
      return Err(
        "Cannot update Camoufox configuration while browser is running. Please stop the browser first.".into(),
      );
    }

    // Update the Camoufox configuration
    profile.camoufox_config = Some(config);

    // Save the updated profile
    self
      .save_profile(&profile)
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Failed to save profile: {e}").into()
      })?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    log::info!(
      "Camoufox configuration updated for profile '{}' (ID: {}).",
      profile.name,
      profile_id
    );

    // Emit profile config update event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(())
  }

  pub async fn update_wayfern_config(
    &self,
    app_handle: tauri::AppHandle,
    profile_id: &str,
    config: WayfernConfig,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Find the profile by ID
    let profile_uuid = uuid::Uuid::parse_str(profile_id).map_err(
      |_| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Invalid profile ID: {profile_id}").into()
      },
    )?;
    let profiles =
      self
        .list_profiles()
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
          format!("Failed to list profiles: {e}").into()
        })?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Profile with ID '{profile_id}' not found").into()
      })?;

    // Check if the browser is currently running using the comprehensive status check
    let is_running = self
      .check_browser_status(app_handle.clone(), &profile)
      .await?;

    if is_running {
      return Err(
        "Cannot update Wayfern configuration while browser is running. Please stop the browser first.".into(),
      );
    }

    // Update the Wayfern configuration
    profile.wayfern_config = Some(config);

    // Save the updated profile
    self
      .save_profile(&profile)
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Failed to save profile: {e}").into()
      })?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    log::info!(
      "Wayfern configuration updated for profile '{}' (ID: {}).",
      profile.name,
      profile_id
    );

    // Emit profile config update event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(())
  }

  pub async fn update_profile_proxy(
    &self,
    _app_handle: tauri::AppHandle,
    profile_id: &str,
    proxy_id: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
    // Find the profile by ID
    let profile_uuid = uuid::Uuid::parse_str(profile_id).map_err(
      |_| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Invalid profile ID: {profile_id}").into()
      },
    )?;
    let profiles =
      self
        .list_profiles()
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
          format!("Failed to list profiles: {e}").into()
        })?;

    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Profile with ID '{profile_id}' not found").into()
      })?;

    // Remember old proxy_id for cleanup (not used yet, but may be needed for cleanup)
    let _old_proxy_id = profile.proxy_id.clone();

    // Update proxy settings and clear VPN (mutual exclusion)
    profile.proxy_id = proxy_id.clone();
    profile.vpn_id = None;
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    // Save the updated profile
    self
      .save_profile(&profile)
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        format!("Failed to save profile: {e}").into()
      })?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    // Auto-enable sync for new proxy if profile has sync enabled
    if profile.is_sync_enabled() {
      if let Some(ref new_proxy_id) = proxy_id {
        let _ = crate::sync::enable_proxy_sync_if_needed(new_proxy_id).await;
        if let Some(scheduler) = crate::sync::get_global_scheduler() {
          scheduler.queue_proxy_sync(new_proxy_id.clone()).await;
        }
      }
    }

    // Update on-disk browser profile config immediately.
    // Both supported browser types ignore this write (Camoufox rewrites
    // user.js at launch with the local donut-proxy host, Wayfern takes its
    // proxy via `--proxy-pac-url=` and never reads user.js), and for
    // Camoufox specifically writing the upstream host here would leave a
    // stale, wrong proxy in user.js until the next launch.
    if !matches!(profile.browser.as_str(), "camoufox" | "wayfern") {
      if let Some(proxy_id_ref) = &proxy_id {
        if let Some(proxy_settings) = PROXY_MANAGER.get_proxy_settings_by_id(proxy_id_ref) {
          let profiles_dir = self.get_profiles_dir();
          let profile_path = profiles_dir.join(profile.id.to_string()).join("profile");
          self
            .apply_proxy_settings_to_profile(&profile_path, &proxy_settings, None)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
              format!("Failed to apply proxy settings: {e}").into()
            })?;
        } else {
          // Proxy ID provided but proxy not found, disable proxy
          let profiles_dir = self.get_profiles_dir();
          let profile_path = profiles_dir.join(profile.id.to_string()).join("profile");
          self
            .disable_proxy_settings_in_profile(&profile_path)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
              format!("Failed to disable proxy settings: {e}").into()
            })?;
        }
      } else {
        // No proxy ID provided, disable proxy
        let profiles_dir = self.get_profiles_dir();
        let profile_path = profiles_dir.join(profile.id.to_string()).join("profile");
        self
          .disable_proxy_settings_in_profile(&profile_path)
          .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
            format!("Failed to disable proxy settings: {e}").into()
          })?;
      }
    }

    // Emit profile update event so frontend UIs can refresh immediately (e.g. proxy manager)
    if let Err(e) = events::emit("profile-updated", &profile) {
      log::warn!("Warning: Failed to emit profile update event: {e}");
    }

    // Emit general profiles changed event for profile list updates
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

}
