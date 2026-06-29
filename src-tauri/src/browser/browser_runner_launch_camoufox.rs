// ═══════════════════════════════════════════════════════════════════════════════
// browser_runner_launch_camoufox.rs
// ═══════════════════════════════════════════════════════════════════════════════
//
// Camoufox (Firefox-based) browser launch orchestration.
// This file is included via include!() in browser_runner.rs.
//
// Responsibilities:
// - Camoufox config preparation and fingerprint generation
// - Local proxy startup (required for Camoufox)
// - VPN worker integration
// - Extension installation
// - Profile lifecycle management
//
// ═══════════════════════════════════════════════════════════════════════════════

impl BrowserRunner {
  async fn launch_camoufox_internal(
  &self,
  app_handle: tauri::AppHandle,
  profile: &BrowserProfile,
  url: Option<String>,
  _local_proxy_settings: Option<&ProxySettings>,
  remote_debugging_port: Option<u16>,
  headless: bool,
) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
  // Get or create camoufox config
  let mut camoufox_config = profile.camoufox_config.clone().unwrap_or_else(|| {
    log::info!(
      "No camoufox config found for profile {}, using default",
      profile.name
    );
    CamoufoxConfig::default()
  });

  // Always start a local proxy for Camoufox (for traffic monitoring and geoip support)
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
            log::info!("VPN worker started for Camoufox profile on port {}", port);
          }
        }
        Err(e) => {
          return Err(format!("Failed to start VPN worker: {e}").into());
        }
      }
    }
  }

  log::info!(
    "Starting local proxy for Camoufox profile: {} (upstream: {})",
    profile.name,
    upstream_proxy
      .as_ref()
      .map(|p| format!("{}:{}", p.host, p.port))
      .unwrap_or_else(|| "DIRECT".to_string())
  );

  // Start the proxy and get local proxy settings
  // If proxy startup fails, DO NOT launch Camoufox - it requires local proxy
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
      // Camoufox (Firefox 150, and Firefox 135 on the not-yet-updated
      // Windows build) keeps the local HTTP proxy: Firefox's QUIC stack
      // bypasses a configured proxy, so QUIC is disabled and HTTP CONNECT
      // covers everything. SOCKS5 is reserved for Wayfern.
      "http",
    )
    .await
    .map_err(|e| {
      let error_msg = format!("Failed to start local proxy for Camoufox: {e}");
      log::error!("{}", error_msg);
      error_msg
    })?;

  // Format proxy URL for camoufox - always use HTTP for the local proxy
  let proxy_url = format!("http://{}:{}", local_proxy.host, local_proxy.port);

  // Set proxy in camoufox config
  camoufox_config.proxy = Some(proxy_url);

  // Ensure geoip is always enabled for proper geolocation spoofing
  if camoufox_config.geoip.is_none() {
    camoufox_config.geoip = Some(serde_json::Value::Bool(true));
  }

  log::info!(
    "Configured local proxy for Camoufox: {:?}, geoip: {:?}",
    camoufox_config.proxy,
    camoufox_config.geoip
  );

  // Check if we need to generate a new fingerprint on every launch
  let mut updated_profile = profile.clone();
  if camoufox_config.randomize_fingerprint_on_launch == Some(true) {
    log::info!(
      "Generating random fingerprint for Camoufox profile: {}",
      profile.name
    );

    // Create a config copy without the existing fingerprint to force generation of a new one
    let mut config_for_generation = camoufox_config.clone();
    config_for_generation.fingerprint = None;

    // Generate a new fingerprint
    let new_fingerprint = self
      .camoufox_manager
      .generate_fingerprint_config(&app_handle, profile, &config_for_generation)
      .await
      .map_err(|e| format!("Failed to generate random fingerprint: {e}"))?;

    log::info!(
      "New fingerprint generated, length: {} chars",
      new_fingerprint.len()
    );

    // Update the config with the new fingerprint for launching
    camoufox_config.fingerprint = Some(new_fingerprint.clone());

    // Save the updated fingerprint to the profile so it persists
    // We need to preserve all existing config fields and only update the fingerprint
    let mut updated_camoufox_config =
      updated_profile.camoufox_config.clone().unwrap_or_default();
    updated_camoufox_config.fingerprint = Some(new_fingerprint);
    // Preserve the randomize flag so it persists across launches
    updated_camoufox_config.randomize_fingerprint_on_launch = Some(true);
    // Preserve the OS setting so it's used for future fingerprint generation
    if camoufox_config.os.is_some() {
      updated_camoufox_config.os = camoufox_config.os.clone();
    }
    updated_profile.camoufox_config = Some(updated_camoufox_config.clone());

    log::info!(
      "Updated profile camoufox_config with new fingerprint for profile: {}, fingerprint length: {}",
      profile.name,
      updated_camoufox_config.fingerprint.as_ref().map(|f| f.len()).unwrap_or(0)
    );
  }

  // Create ephemeral dir for ephemeral or password-protected profiles
  let override_profile_path = if profile.password_protected {
    let dir = crate::profile::password::prepare_for_launch(profile)
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
    Some(dir)
  } else if profile.ephemeral {
    let dir = crate::browser::ephemeral_dirs::create_ephemeral_dir(&profile.id.to_string())
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
    Some(dir)
  } else {
    None
  };

  // Install extensions if an extension group is assigned
  if updated_profile.extension_group_id.is_some() {
    let profiles_dir = self.profile_manager.get_profiles_dir();
    let ext_profile_path = if let Some(ref override_path) = override_profile_path {
      override_path.clone()
    } else {
      updated_profile.get_profile_data_path(&profiles_dir)
    };
    let mgr = crate::browser::extension_manager::EXTENSION_MANAGER
      .lock()
      .unwrap();
    match mgr.install_extensions_for_profile(&updated_profile, &ext_profile_path) {
      Ok(paths) => {
        if !paths.is_empty() {
          log::info!(
            "Installed {} Firefox extensions for profile: {}",
            paths.len(),
            updated_profile.name
          );
        }
      }
      Err(e) => {
        log::warn!("Failed to install extensions for Camoufox profile: {e}");
      }
    }
  }

  // Launch Camoufox browser
  log::info!("Launching Camoufox for profile: {}", profile.name);
  let camoufox_result = self
    .camoufox_manager
    .launch_camoufox_profile(
      app_handle.clone(),
      updated_profile.clone(),
      camoufox_config,
      url,
      override_profile_path,
      remote_debugging_port,
      headless,
    )
    .await
    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
      format!("Failed to launch Camoufox: {e}").into()
    })?;

  // For server-based Camoufox, we use the process_id
  let process_id = camoufox_result.processId.unwrap_or(0);
  log::info!("Camoufox launched successfully with PID: {process_id}");

  // Update profile with the process info from camoufox result
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

  // Save the updated profile (includes new fingerprint if randomize is enabled)
  log::info!(
    "Saving profile {} with camoufox_config fingerprint length: {}",
    updated_profile.name,
    updated_profile
      .camoufox_config
      .as_ref()
      .and_then(|c| c.fingerprint.as_ref())
      .map(|f| f.len())
      .unwrap_or(0)
  );
  self.save_process_info(&updated_profile)?;
  // Ensure tag suggestions include any tags from this profile
  let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
    let _ = tm.rebuild_from_profiles(&self.profile_manager.list_profiles().unwrap_or_default());
  });
  log::info!(
    "Successfully saved profile with process info: {}",
    updated_profile.name
  );

  // Emit profiles-changed to trigger frontend to reload profiles from disk
  // This ensures the UI displays the newly generated fingerprint
  if let Err(e) = events::emit_empty("profiles-changed") {
    log::warn!("Warning: Failed to emit profiles-changed event: {e}");
  }

  log::info!(
    "Emitting profile events for successful Camoufox launch: {}",
    updated_profile.name
  );

  // Emit profile update event to frontend
  if let Err(e) = events::emit("profile-updated", &updated_profile) {
    log::warn!("Warning: Failed to emit profile update event: {e}");
  }

  if let Ok(mut states) = ACTIVE_RUNNING_STATES.lock() {
    states.insert(updated_profile.id.to_string(), true);
  }

  // Emit minimal running changed event to frontend with a small delay
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
      "Successfully emitted profile-running-changed event for Camoufox {}: running={}",
      updated_profile.name,
      payload.is_running
    );
  }

  Ok(updated_profile)
}
}
