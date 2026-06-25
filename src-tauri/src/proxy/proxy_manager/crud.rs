impl ProxyManager {
  pub fn get_proxy_file_path(&self, proxy_id: &str) -> PathBuf {
    self.get_proxies_dir().join(format!("{proxy_id}.json"))
  }

  // Load stored proxies from disk
  fn load_stored_proxies(&self) -> Result<(), Box<dyn std::error::Error>> {
    let proxies_dir = self.get_proxies_dir();

    if !proxies_dir.exists() {
      log::debug!("Proxies directory does not exist: {:?}", proxies_dir);
      return Ok(()); // No proxies directory yet
    }

    log::debug!("Loading stored proxies from: {:?}", proxies_dir);

    let mut stored_proxies = self.stored_proxies.lock().unwrap();
    let mut loaded_count = 0;
    let mut error_count = 0;

    // Read all JSON files from the proxies directory
    for entry in fs::read_dir(&proxies_dir)? {
      let entry = entry?;
      let path = entry.path();

      if path.extension().is_some_and(|ext| ext == "json") {
        match fs::read_to_string(&path) {
          Ok(content) => match serde_json::from_str::<StoredProxy>(&content) {
            Ok(proxy) => {
              log::debug!("Loaded stored proxy: {} ({})", proxy.name, proxy.id);
              stored_proxies.insert(proxy.id.clone(), proxy);
              loaded_count += 1;
            }
            Err(e) => {
              log::warn!(
                "Failed to parse proxy file {:?} as StoredProxy: {}",
                path,
                e
              );
              error_count += 1;
            }
          },
          Err(e) => {
            log::warn!("Failed to read proxy file {:?}: {}", path, e);
            error_count += 1;
          }
        }
      }
    }

    log::info!(
      "Loaded {} stored proxies ({} errors)",
      loaded_count,
      error_count
    );
    Ok(())
  }

  // Save a single proxy to disk
  fn save_proxy(&self, proxy: &StoredProxy) -> Result<(), Box<dyn std::error::Error>> {
    let proxies_dir = self.get_proxies_dir();

    // Ensure directory exists
    fs::create_dir_all(&proxies_dir)?;

    let proxy_file = self.get_proxy_file_path(&proxy.id);
    let content = serde_json::to_string_pretty(proxy)?;
    fs::write(&proxy_file, content)?;

    Ok(())
  }

  // Delete a proxy file from disk
  fn delete_proxy_file(&self, proxy_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let proxy_file = self.get_proxy_file_path(proxy_id);
    if proxy_file.exists() {
      fs::remove_file(proxy_file)?;
    }
    Ok(())
  }

  // Create a new stored proxy
  pub fn create_stored_proxy(
    &self,
    _app_handle: &tauri::AppHandle,
    name: String,
    proxy_settings: ProxySettings,
  ) -> Result<StoredProxy, String> {
    // Check if name already exists
    {
      let stored_proxies = self.stored_proxies.lock().unwrap();
      if stored_proxies.values().any(|p| p.name == name) {
        return Err(format!("Proxy with name '{name}' already exists"));
      }
    }

    let stored_proxy = StoredProxy::new(name, proxy_settings);

    {
      let mut stored_proxies = self.stored_proxies.lock().unwrap();
      stored_proxies.insert(stored_proxy.id.clone(), stored_proxy.clone());
    }

    if let Err(e) = self.save_proxy(&stored_proxy) {
      log::warn!("Failed to save proxy: {e}");
    }

    // Emit event for reactive UI updates
    if let Err(e) = events::emit_empty("proxies-changed") {
      log::error!("Failed to emit proxies-changed event: {e}");
    }

    if stored_proxy.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let id = stored_proxy.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_proxy_sync(id).await;
        });
      }
    }

    Ok(stored_proxy)
  }

  // Check if a cloud-managed proxy exists
  pub fn has_cloud_proxy(&self) -> bool {
    let stored_proxies = self.stored_proxies.lock().unwrap();
    stored_proxies.contains_key(CLOUD_PROXY_ID)
  }

  // Upsert the cloud-managed proxy (create or update)
  pub fn upsert_cloud_proxy(&self, proxy_settings: ProxySettings) -> Result<StoredProxy, String> {
    let mut stored_proxies = self.stored_proxies.lock().unwrap();

    if let Some(existing) = stored_proxies.get_mut(CLOUD_PROXY_ID) {
      existing.proxy_settings = proxy_settings;
      let updated = existing.clone();
      drop(stored_proxies);

      if let Err(e) = self.save_proxy(&updated) {
        log::warn!("Failed to save cloud proxy: {e}");
      }
      if let Err(e) = events::emit_empty("proxies-changed") {
        log::error!("Failed to emit proxies-changed event: {e}");
      }
      Ok(updated)
    } else {
      let cloud_proxy = StoredProxy {
        id: CLOUD_PROXY_ID.to_string(),
        name: "Included Proxy".to_string(),
        proxy_settings,
        sync_enabled: false,
        last_sync: None,
        updated_at: Some(now_secs()),
        is_cloud_managed: true,
        is_cloud_derived: false,
        geo_country: None,
        geo_state: None,
        geo_region: None,
        geo_city: None,
        geo_isp: None,
        dynamic_proxy_url: None,
        dynamic_proxy_format: None,
      };
      stored_proxies.insert(CLOUD_PROXY_ID.to_string(), cloud_proxy.clone());
      drop(stored_proxies);

      if let Err(e) = self.save_proxy(&cloud_proxy) {
        log::warn!("Failed to save cloud proxy: {e}");
      }
      if let Err(e) = events::emit_empty("proxies-changed") {
        log::error!("Failed to emit proxies-changed event: {e}");
      }
      Ok(cloud_proxy)
    }
  }

  // Remove the cloud-managed proxy
  pub fn remove_cloud_proxy(&self) {
    let removed = {
      let mut stored_proxies = self.stored_proxies.lock().unwrap();
      stored_proxies.remove(CLOUD_PROXY_ID).is_some()
    };

    if removed {
      if let Err(e) = self.delete_proxy_file(CLOUD_PROXY_ID) {
        log::warn!("Failed to delete cloud proxy file: {e}");
      }
      if let Err(e) = events::emit_empty("proxies-changed") {
        log::error!("Failed to emit proxies-changed event: {e}");
      }
    }
  }

  pub fn remove_cloud_proxies(&self) {
    let removed_ids: Vec<String> = {
      let mut stored_proxies = self.stored_proxies.lock().unwrap();
      let ids_to_remove: Vec<String> = stored_proxies
        .values()
        .filter(|p| p.is_cloud_managed || p.is_cloud_derived)
        .map(|p| p.id.clone())
        .collect();
      for id in &ids_to_remove {
        stored_proxies.remove(id);
      }
      ids_to_remove
    };

    if !removed_ids.is_empty() {
      for id in &removed_ids {
        if let Err(e) = self.delete_proxy_file(id) {
          log::warn!("Failed to delete cloud proxy file {id}: {e}");
        }
      }
      if let Err(e) = events::emit_empty("proxies-changed") {
        log::error!("Failed to emit proxies-changed event: {e}");
      }
      if let Err(e) = events::emit_empty("stored-proxies-changed") {
        log::error!("Failed to emit stored-proxies-changed event: {e}");
      }
    }
  }

  // Build a geo-targeted username from base username and location parts
  // LP v2 format: username-country-{cc}[-region-{region}][-city-{city}][-isp-{isp}]
  // Note: sid and ttl are NOT included here — they are injected at browser launch time
  // per-profile via resolve_proxy_for_profile()
  fn build_geo_username(
    base_username: &str,
    country: &str,
    region: &Option<String>,
    city: &Option<String>,
    isp: &Option<String>,
  ) -> String {
    let mut username = format!("{}-country-{}", base_username, country);
    if let Some(region) = region {
      username = format!("{}-region-{}", username, region);
    }
    if let Some(city) = city {
      username = format!("{}-city-{}", username, city);
    }
    if let Some(isp) = isp {
      username = format!("{}-isp-{}", username, isp);
    }
    username
  }

  /// Generate a deterministic 11-char alphanumeric session ID from a profile UUID.
  /// This ensures the same profile always gets the same sticky IP session,
  /// even across credential refreshes.
  pub fn generate_sid_for_profile(profile_id: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    profile_id.hash(&mut hasher);
    let hash = hasher.finish();

    // Convert to base36 (a-z0-9) and take 11 chars
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    let mut sid = String::with_capacity(11);
    let mut val = hash;
    for _ in 0..11 {
      sid.push(chars[(val % 36) as usize]);
      val /= 36;
    }
    sid
  }

  /// Build the full proxy username with sid and ttl for a specific profile launch.
  /// This is called at browser launch time, not at proxy creation time.
  pub fn build_username_with_sid(base_geo_username: &str, profile_id: &str) -> String {
    let sid = Self::generate_sid_for_profile(profile_id);
    format!("{}-sid-{}-ttl-1440m", base_geo_username, sid)
  }

  /// Resolve proxy settings for a specific profile, injecting profile-specific sid
  /// for cloud-derived proxies with geo targeting.
  pub fn resolve_proxy_for_profile(
    &self,
    proxy_id: &str,
    profile_id: &str,
  ) -> Option<ProxySettings> {
    let stored_proxies = self.stored_proxies.lock().unwrap();
    let proxy = stored_proxies.get(proxy_id)?;
    let mut settings = proxy.proxy_settings.clone();

    // For cloud-derived proxies with geo targeting, inject profile-specific sid
    if proxy.is_cloud_derived && proxy.geo_country.is_some() {
      if let Some(ref username) = settings.username {
        settings.username = Some(Self::build_username_with_sid(username, profile_id));
      }
    }

    Some(settings)
  }

  // Create a cloud-derived location proxy from the base cloud proxy credentials
  pub fn create_cloud_location_proxy(
    &self,
    name: String,
    country: String,
    region: Option<String>,
    city: Option<String>,
    isp: Option<String>,
  ) -> Result<StoredProxy, String> {
    // Get base cloud proxy credentials
    let base_proxy = {
      let stored_proxies = self.stored_proxies.lock().unwrap();
      stored_proxies
        .get(CLOUD_PROXY_ID)
        .cloned()
        .ok_or_else(|| "No cloud proxy available. Please log in first.".to_string())?
    };

    let base_username = base_proxy
      .proxy_settings
      .username
      .as_ref()
      .ok_or_else(|| "Cloud proxy has no username".to_string())?;

    let geo_username = Self::build_geo_username(base_username, &country, &region, &city, &isp);

    let proxy_settings = ProxySettings {
      proxy_type: base_proxy.proxy_settings.proxy_type.clone(),
      host: base_proxy.proxy_settings.host.clone(),
      port: base_proxy.proxy_settings.port,
      username: Some(geo_username),
      password: base_proxy.proxy_settings.password.clone(),
    };

    // Check if name already exists
    {
      let stored_proxies = self.stored_proxies.lock().unwrap();
      if stored_proxies.values().any(|p| p.name == name) {
        return Err(format!("Proxy with name '{}' already exists", name));
      }
    }

    let stored_proxy = StoredProxy {
      id: uuid::Uuid::new_v4().to_string(),
      name,
      proxy_settings,
      sync_enabled: false,
      last_sync: None,
      updated_at: Some(now_secs()),
      is_cloud_managed: false,
      is_cloud_derived: true,
      geo_country: Some(country),
      geo_state: None,
      geo_region: region,
      geo_city: city,
      geo_isp: isp,
      dynamic_proxy_url: None,
      dynamic_proxy_format: None,
    };

    {
      let mut stored_proxies = self.stored_proxies.lock().unwrap();
      stored_proxies.insert(stored_proxy.id.clone(), stored_proxy.clone());
    }

    if let Err(e) = self.save_proxy(&stored_proxy) {
      log::warn!("Failed to save location proxy: {e}");
    }

    if let Err(e) = events::emit_empty("proxies-changed") {
      log::error!("Failed to emit proxies-changed event: {e}");
    }

    Ok(stored_proxy)
  }

  // Update all cloud-derived proxies when base cloud proxy credentials change
  pub fn update_cloud_derived_proxies(&self) {
    let base_proxy = {
      let stored_proxies = self.stored_proxies.lock().unwrap();
      match stored_proxies.get(CLOUD_PROXY_ID) {
        Some(p) => p.clone(),
        None => return, // No cloud proxy, nothing to update
      }
    };

    let base_username = match &base_proxy.proxy_settings.username {
      Some(u) => u.clone(),
      None => return,
    };

    let mut updated = false;
    let mut stored_proxies = self.stored_proxies.lock().unwrap();

    for proxy in stored_proxies.values_mut() {
      if !proxy.is_cloud_derived {
        continue;
      }

      let country = match &proxy.geo_country {
        Some(c) => c.clone(),
        None => continue,
      };

      let region = proxy.effective_region().cloned();
      let geo_username = Self::build_geo_username(
        &base_username,
        &country,
        &region,
        &proxy.geo_city,
        &proxy.geo_isp,
      );

      proxy.updated_at = Some(now_secs());
      proxy.proxy_settings.username = Some(geo_username);
      proxy.proxy_settings.password = base_proxy.proxy_settings.password.clone();
      proxy.proxy_settings.host = base_proxy.proxy_settings.host.clone();
      proxy.proxy_settings.port = base_proxy.proxy_settings.port;

      updated = true;
    }

    if updated {
      // Save all updated proxies
      let proxies_to_save: Vec<StoredProxy> = stored_proxies
        .values()
        .filter(|p| p.is_cloud_derived)
        .cloned()
        .collect();
      drop(stored_proxies);

      for proxy in &proxies_to_save {
        if let Err(e) = self.save_proxy(proxy) {
          log::warn!("Failed to save updated derived proxy {}: {e}", proxy.id);
        }
      }

      if let Err(e) = events::emit_empty("proxies-changed") {
        log::error!("Failed to emit proxies-changed event: {e}");
      }

      log::debug!("Updated {} cloud-derived proxies", proxies_to_save.len());
    }
  }

  pub fn remove_from_memory(&self, proxy_id: &str) {
    let mut stored_proxies = self.stored_proxies.lock().unwrap();
    stored_proxies.remove(proxy_id);
  }

  // Get all stored proxies
  pub fn get_stored_proxies(&self) -> Vec<StoredProxy> {
    let stored_proxies = self.stored_proxies.lock().unwrap();
    let mut list: Vec<StoredProxy> = stored_proxies.values().cloned().collect();
    // Sort case-insensitively by name for consistent ordering across UI/API consumers
    list.sort_by_key(|p| p.name.to_lowercase());
    list
  }

  /// Insert/replace a stored proxy in the in-memory map. Used by sync's
  /// download_proxy after it writes the file to disk, mirroring how
  /// download_group/download_vpn/download_extension keep their managers'
  /// in-memory state in sync. Without this, get_stored_proxies (which reads
  /// only the map) never sees a downloaded proxy until restart, so sync keeps
  /// re-downloading it indefinitely.
  pub fn upsert_stored_proxy(&self, proxy: StoredProxy) {
    let mut stored_proxies = self.stored_proxies.lock().unwrap();
    stored_proxies.insert(proxy.id.clone(), proxy);
  }

  // Get a stored proxy by ID

  // Update a stored proxy
  pub fn update_stored_proxy(
    &self,
    _app_handle: &tauri::AppHandle,
    proxy_id: &str,
    name: Option<String>,
    proxy_settings: Option<ProxySettings>,
  ) -> Result<StoredProxy, String> {
    // First, check for conflicts without holding a mutable reference
    {
      let stored_proxies = self.stored_proxies.lock().unwrap();

      // Check if proxy exists
      if !stored_proxies.contains_key(proxy_id) {
        return Err(format!("Proxy with ID '{proxy_id}' not found"));
      }

      // Block editing cloud-managed proxies
      if stored_proxies
        .get(proxy_id)
        .is_some_and(|p| p.is_cloud_managed)
      {
        return Err("Cannot edit a cloud-managed proxy".to_string());
      }

      // Check if new name conflicts with existing proxies
      if let Some(ref new_name) = name {
        if stored_proxies
          .values()
          .any(|p| p.id != proxy_id && p.name == *new_name)
        {
          return Err(format!("Proxy with name '{new_name}' already exists"));
        }
      }
    } // Release the lock here

    // Now get mutable access for updates
    let updated_proxy = {
      let mut stored_proxies = self.stored_proxies.lock().unwrap();
      let stored_proxy = stored_proxies.get_mut(proxy_id).unwrap(); // Safe because we checked above

      if let Some(new_name) = name {
        stored_proxy.update_name(new_name);
      }

      if let Some(new_settings) = proxy_settings {
        stored_proxy.update_settings(new_settings);
      }

      stored_proxy.clone()
    };

    if let Err(e) = self.save_proxy(&updated_proxy) {
      log::warn!("Failed to save proxy: {e}");
    }

    // Emit event for reactive UI updates
    if let Err(e) = events::emit_empty("proxies-changed") {
      log::error!("Failed to emit proxies-changed event: {e}");
    }

    if updated_proxy.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let id = updated_proxy.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_proxy_sync(id).await;
        });
      }
    }

    Ok(updated_proxy)
  }

  /// Update the in-memory `sync_enabled` / `last_sync` fields of a stored
  /// proxy and persist the change to disk. Returns the updated proxy or
  /// `Err` if the proxy isn't found / is cloud-managed.
  ///
  /// This is the canonical write path for sync-state changes — direct
  /// `fs::write` from a sync command would leave the in-memory cache
  /// (`stored_proxies`) stale, and the next `get_stored_proxies()` would
  /// return the old `sync_enabled`, breaking the UI toggle.
  pub fn set_stored_proxy_sync_state(
    &self,
    proxy_id: &str,
    sync_enabled: bool,
    last_sync: Option<u64>,
  ) -> Result<StoredProxy, String> {
    let updated_proxy = {
      let mut stored_proxies = self.stored_proxies.lock().unwrap();
      let proxy = stored_proxies
        .get_mut(proxy_id)
        .ok_or_else(|| format!("Proxy with ID '{proxy_id}' not found"))?;

      if proxy.is_cloud_managed {
        return Err("Cannot modify sync for a cloud-managed proxy".to_string());
      }

      proxy.sync_enabled = sync_enabled;
      proxy.last_sync = last_sync;
      proxy.clone()
    };

    self
      .save_proxy(&updated_proxy)
      .map_err(|e| format!("Failed to save proxy: {e}"))?;

    Ok(updated_proxy)
  }

  // Delete a stored proxy
  pub fn delete_stored_proxy(
    &self,
    app_handle: &tauri::AppHandle,
    proxy_id: &str,
  ) -> Result<(), String> {
    // Remember if sync was enabled before deleting
    let was_sync_enabled = {
      let stored_proxies = self.stored_proxies.lock().unwrap();

      // Block deleting cloud-managed proxies
      if stored_proxies
        .get(proxy_id)
        .is_some_and(|p| p.is_cloud_managed)
      {
        return Err("Cannot delete a cloud-managed proxy".to_string());
      }

      stored_proxies
        .get(proxy_id)
        .map(|p| p.sync_enabled)
        .unwrap_or(false)
    };

    {
      let mut stored_proxies = self.stored_proxies.lock().unwrap();
      if stored_proxies.remove(proxy_id).is_none() {
        return Err(format!("Proxy with ID '{proxy_id}' not found"));
      }
    }

    if let Err(e) = self.delete_proxy_file(proxy_id) {
      log::warn!("Failed to delete proxy file: {e}");
    }

    // If sync was enabled, also delete from S3
    if was_sync_enabled {
      let proxy_id_owned = proxy_id.to_string();
      let app_handle_clone = app_handle.clone();
      tauri::async_runtime::spawn(async move {
        match crate::sync::SyncEngine::create_from_settings(&app_handle_clone).await {
          Ok(engine) => {
            if let Err(e) = engine.delete_proxy(&proxy_id_owned).await {
              log::warn!("Failed to delete proxy {} from sync: {}", proxy_id_owned, e);
            } else {
              log::info!("Proxy {} deleted from S3 sync storage", proxy_id_owned);
            }
          }
          Err(e) => {
            log::debug!("Sync not configured, skipping remote deletion: {}", e);
          }
        }
      });
    }

    // Emit event for reactive UI updates
    if let Err(e) = events::emit_empty("proxies-changed") {
      log::error!("Failed to emit proxies-changed event: {e}");
    }

    Ok(())
  }

  // Check if a proxy is cloud-managed or cloud-derived (needs fresh credentials)
  pub fn is_cloud_or_derived(&self, proxy_id: &str) -> bool {
    let stored_proxies = self.stored_proxies.lock().unwrap();
    stored_proxies
      .get(proxy_id)
      .is_some_and(|p| p.is_cloud_managed || p.is_cloud_derived)
  }

  // Get proxy settings for a stored proxy ID
  pub fn get_proxy_settings_by_id(&self, proxy_id: &str) -> Option<ProxySettings> {
    let stored_proxies = self.stored_proxies.lock().unwrap();
    stored_proxies
      .get(proxy_id)
      .map(|p| p.proxy_settings.clone())
  }

}
