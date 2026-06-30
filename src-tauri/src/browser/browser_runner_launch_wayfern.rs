// ═══════════════════════════════════════════════════════════════════════════════
// browser_runner_launch_wayfern.rs
// ═══════════════════════════════════════════════════════════════════════════════
//
// Wayfern (Chromium-based) browser launch orchestration.
// This file is included via include!() in browser_runner.rs.
//
// Responsibilities:
// - Wayfern config preparation and fingerprint generation
// - Local SOCKS5 proxy startup (required for Wayfern UDP routing)
// - VPN worker integration
// - Fingerprint geolocation refresh on proxy changes
// - Extension installation
// - Profile lifecycle management
//
// ═══════════════════════════════════════════════════════════════════════════════

impl BrowserRunner {
  async fn launch_wayfern_internal(
  &self,
  app_handle: tauri::AppHandle,
  profile: &BrowserProfile,
  url: Option<String>,
  _local_proxy_settings: Option<&ProxySettings>,
  remote_debugging_port: Option<u16>,
  headless: bool,
) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
  // Get or create wayfern config
  let mut wayfern_config = profile.wayfern_config.clone().unwrap_or_else(|| {
    log::info!(
      "No wayfern config found for profile {}, using default",
      profile.name
    );
    WayfernConfig::default()
  });

  // Always start a local proxy for Wayfern (for traffic monitoring and geoip support)
  let mut upstream_proxy = self
    .resolve_launch_proxy(profile)
    .await
    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;

  // If profile has a VPN instead of proxy, start VPN worker and use it as upstream
  if upstream_proxy.is_none() {
    if let Some(ref vpn_id) = profile.vpn_id {
      match crate::vpn::vpn_worker_runner::start_vpn_worker(vpn_id).await {
        Ok(vpn_worker) => {
          if let Some(port) = vpn_worker.local_port {
            upstream_proxy = Some(ProxySettings {
              proxy_type: "socks5".to_string(),
              host: "127.0.0.1".to_string(),
              port,
              username: None,
              password: None,
            });
            log::info!("VPN worker started for Wayfern profile on port {}", port);
          }
        }
        Err(e) => {
          return Err(format!("Failed to start VPN worker: {e}").into());
        }
      }
    }
  }

  log::info!(
    "Starting local proxy for Wayfern profile: {} (upstream: {})",
    profile.name,
    upstream_proxy
      .as_ref()
      .map(|p| format!("{}:{}", p.host, p.port))
      .unwrap_or_else(|| "DIRECT".to_string())
  );

  // Start the proxy and get local proxy settings
  // If proxy startup fails, DO NOT launch Wayfern - it requires local proxy
  let profile_id_str = profile.id.to_string();
  let blocklist_file = Self::resolve_blocklist_file(profile).await?;
  let local_proxy = PROXY_MANAGER
    .start_proxy(
      app_handle.clone(),
      upstream_proxy.as_ref(),
      0, // Use 0 as temporary PID, will be updated later
      Some(&profile_id_str),
      profile.proxy_bypass_rules.clone(),
      blocklist_file,
      // Wayfern (Chromium) uses a local SOCKS5 proxy so QUIC and WebRTC
      // UDP can be routed through it (via SOCKS5 UDP ASSOCIATE) without
      // leaking the real IP, rather than being forced direct as they
      // would be over an HTTP CONNECT proxy.
      "socks5",
    )
    .await
    .map_err(|e| {
      let error_msg = format!("Failed to start local proxy for Wayfern: {e}");
      log::error!("{}", error_msg);
      error_msg
    })?;

  // Format proxy URL for wayfern - use SOCKS5 for the local proxy so
  // Chromium proxies UDP (QUIC/WebRTC), not just TCP.
  let proxy_url = format!("socks5://{}:{}", local_proxy.host, local_proxy.port);

  // Set proxy in wayfern config
  wayfern_config.proxy = Some(proxy_url);

  log::info!(
    "Configured local proxy for Wayfern: {:?}",
    wayfern_config.proxy
  );

  // Check if we need to generate a new fingerprint on every launch
  let mut updated_profile = profile.clone();
  if wayfern_config.randomize_fingerprint_on_launch == Some(true) {
    log::info!(
      "Generating random fingerprint for Wayfern profile: {}",
      profile.name
    );

    // Create a config copy without the existing fingerprint to force generation of a new one
    let mut config_for_generation = wayfern_config.clone();
    config_for_generation.fingerprint = None;

    // Generate a new fingerprint
    let new_fingerprint = self
      .wayfern_manager
      .generate_fingerprint_config(&app_handle, profile, &config_for_generation)
      .await
      .map_err(|e| format!("Failed to generate random fingerprint: {e}"))?;

    log::info!(
      "New fingerprint generated, length: {} chars",
      new_fingerprint.len()
    );

    // Update the config with the new fingerprint for launching
    wayfern_config.fingerprint = Some(new_fingerprint.clone());

    // Save the updated fingerprint to the profile so it persists.
    let mut updated_wayfern_config = updated_profile.wayfern_config.clone().unwrap_or_default();
    updated_wayfern_config.fingerprint = Some(new_fingerprint);
    // Preserve the randomize flag so it persists across launches
    updated_wayfern_config.randomize_fingerprint_on_launch = Some(true);
    // Preserve the OS setting so it's used for future fingerprint generation
    if wayfern_config.os.is_some() {
      updated_wayfern_config.os = wayfern_config.os.clone();
    }
    // The fresh fingerprint's location matches the current routing; record
    // its signature so launches keep it in sync with the non-randomize path.
    updated_wayfern_config.geo_proxy_signature = Some(
      crate::browser::wayfern_manager::WayfernManager::geo_signature(
        upstream_proxy.as_ref(),
        profile.vpn_id.as_deref(),
        wayfern_config.geoip.as_ref(),
      ),
    );
    updated_profile.wayfern_config = Some(updated_wayfern_config.clone());

    log::info!(
      "Updated profile wayfern_config with new fingerprint for profile: {}, fingerprint length: {}",
      profile.name,
      updated_wayfern_config.fingerprint.as_ref().map(|f| f.len()).unwrap_or(0)
    );
  } else {
    // Safety net: the stored fingerprint's timezone and geolocation were
    // computed for whatever proxy was set when the fingerprint was
    // generated. If the profile's proxy or VPN has changed since (the
    // common case being a user who forgot to set a proxy at creation and
    // added one afterwards), that location data is stale and the user would
    // see the wrong timezone on first launch. When the routing signature no
    // longer matches, refresh just the location fields of the stored
    // fingerprint through the current proxy. Wayfern only; the randomize
    // path above already regenerates the whole fingerprint each launch.
    let current_geo_sig = crate::browser::wayfern_manager::WayfernManager::geo_signature(
      upstream_proxy.as_ref(),
      profile.vpn_id.as_deref(),
      wayfern_config.geoip.as_ref(),
    );
    let geo_enabled = !matches!(
      wayfern_config.geoip.as_ref(),
      Some(serde_json::Value::Bool(false))
    );
    if geo_enabled
      && wayfern_config.geo_proxy_signature.as_deref() != Some(current_geo_sig.as_str())
    {
      if let Some(stored_fp) = wayfern_config.fingerprint.clone() {
        log::info!(
          "Routing changed for Wayfern profile {} since its fingerprint was generated (was {:?}, now {}); refreshing timezone and geolocation",
          profile.name,
          wayfern_config.geo_proxy_signature,
          current_geo_sig
        );
        match crate::browser::wayfern_manager::WayfernManager::refresh_fingerprint_geolocation(
          &stored_fp,
          wayfern_config.proxy.as_deref(),
          wayfern_config.geoip.as_ref(),
        )
        .await
        {
          Some(refreshed) => {
            // Use the refreshed fingerprint for this launch...
            wayfern_config.fingerprint = Some(refreshed.clone());
            wayfern_config.geo_proxy_signature = Some(current_geo_sig.clone());
            // ...and persist it so the corrected location sticks and we do
            // not refresh again on the next launch with the same proxy.
            let mut cfg = updated_profile.wayfern_config.clone().unwrap_or_default();
            cfg.fingerprint = Some(refreshed);
            cfg.geo_proxy_signature = Some(current_geo_sig);
            updated_profile.wayfern_config = Some(cfg);
          }
          None => {
            log::warn!(
              "Could not refresh geolocation for Wayfern profile {} (proxy unreachable?); launching with existing location and will retry next launch",
              profile.name
            );
          }
        }
      }
    }
  }

  // Create ephemeral dir for ephemeral or password-protected profiles
  if profile.password_protected {
    crate::profile::password::prepare_for_launch(profile)
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
  } else if profile.ephemeral {
    crate::browser::ephemeral_dirs::create_ephemeral_dir(&profile.id.to_string())
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
  }

  // Launch Wayfern browser
  log::info!("Launching Wayfern for profile: {}", profile.name);

  // Get profile path for Wayfern
  let profiles_dir = self.profile_manager.get_profiles_dir();
  let profile_data_path =
    crate::browser::ephemeral_dirs::get_effective_profile_path(&updated_profile, &profiles_dir);
  let profile_path_str = profile_data_path.to_string_lossy().to_string();

  // Install extensions if an extension group is assigned
  let mut extension_paths = Vec::new();
  if updated_profile.extension_group_id.is_some() {
    let mgr = crate::browser::extension_manager::EXTENSION_MANAGER
      .lock()
      .unwrap();
    match mgr.install_extensions_for_profile(&updated_profile, &profile_data_path) {
      Ok(paths) => {
        if !paths.is_empty() {
          log::info!(
            "Prepared {} Chromium extensions for profile: {}",
            paths.len(),
            updated_profile.name
          );
        }
        extension_paths = paths;
      }
      Err(e) => {
        log::warn!("Failed to install extensions for Wayfern profile: {e}");
      }
    }
  }

  // Get proxy URL from config
  let proxy_url = wayfern_config.proxy.as_deref();

  let wayfern_result = self
    .wayfern_manager
    .launch_wayfern(
      &app_handle,
      &updated_profile,
      &profile_path_str,
      &wayfern_config,
      url.as_deref(),
      proxy_url,
      profile.ephemeral,
      &extension_paths,
      remote_debugging_port,
      headless,
    )
    .await
    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
      format!("Failed to launch Wayfern: {e}").into()
    })?;

  // Get the process ID from launch result
  let process_id = wayfern_result.processId.unwrap_or(0);
  log::info!("Wayfern launched successfully with PID: {process_id}");

  // Wayfern.setFingerprint echoes back the fingerprint the browser actually
  // applied, which may be UPGRADED from the stored one (e.g. when the
  // stored fingerprint targets an older browser version). Persist it so the
  // next launch starts from the upgraded value — saved below via
  // save_process_info(&updated_profile).
  if let Some(used_fp) = wayfern_result.used_fingerprint.clone() {
    let mut cfg = updated_profile.wayfern_config.clone().unwrap_or_default();
    if cfg.fingerprint.as_deref() != Some(used_fp.as_str()) {
      log::info!(
        "Persisting upgraded fingerprint from Wayfern.setFingerprint for profile: {} (len {})",
        profile.name,
        used_fp.len()
      );
      cfg.fingerprint = Some(used_fp);
      updated_profile.wayfern_config = Some(cfg);
    }
  }

  // Update profile with the process info
  updated_profile.process_id = Some(process_id);
  updated_profile.last_launch = Some(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs());

  // Update the proxy manager with the correct PID
  if let Err(e) = PROXY_MANAGER.update_proxy_pid(0, process_id) {
    log::warn!("Warning: Failed to update proxy PID mapping: {e}");
  } else {
    log::info!("Updated proxy PID mapping from temp (0) to actual PID: {process_id}");
  }

  // Persist the real browser PID so the detached proxy worker self-reaps
  // when this browser dies, even after the GUI exits/restarts.
  PROXY_MANAGER.set_browser_pid_for_profile(&updated_profile.id.to_string(), process_id);

  // Save the updated profile
  log::info!(
    "Saving profile {} with wayfern_config fingerprint length: {}",
    updated_profile.name,
    updated_profile
      .wayfern_config
      .as_ref()
      .and_then(|c| c.fingerprint.as_ref())
      .map(|f| f.len())
      .unwrap_or(0)
  );
  self.save_process_info(&updated_profile)?;
  let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
    let _ = tm.rebuild_from_profiles(&self.profile_manager.list_profiles().unwrap_or_default());
  });
  log::info!(
    "Successfully saved profile with process info: {}",
    updated_profile.name
  );

  // Emit profiles-changed to trigger frontend to reload profiles from disk
  if let Err(e) = events::emit_empty("profiles-changed") {
    log::warn!("Warning: Failed to emit profiles-changed event: {e}");
  }

  log::info!(
    "Emitting profile events for successful Wayfern launch: {}",
    updated_profile.name
  );

  // Emit profile update event to frontend
  if let Err(e) = events::emit("profile-updated", &updated_profile) {
    log::warn!("Warning: Failed to emit profile update event: {e}");
  }

  if let Ok(mut states) = ACTIVE_RUNNING_STATES.lock() {
    states.insert(updated_profile.id.to_string(), true);
  }

  // Emit minimal running changed event to frontend
  #[derive(Serialize)]
  struct RunningChangedPayload {
    id: String,
    is_running: bool,
  }

  let payload = RunningChangedPayload {
    id: updated_profile.id.to_string(),
    is_running: updated_profile.process_id.is_some(),
  };

  if let Err(e) = events::emit("profile-running-changed", &payload) {
    log::warn!("Warning: Failed to emit profile running changed event: {e}");
  } else {
    log::info!(
      "Successfully emitted profile-running-changed event for Wayfern {}: running={}",
      updated_profile.name,
      payload.is_running
    );
  }

  Ok(updated_profile)
}
}
