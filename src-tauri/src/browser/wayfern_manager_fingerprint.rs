impl WayfernManager {
  /// Resolve `metadata.json` from a Chromium `--user-data-dir` path (`.../profiles/{id}/profile`).
  fn profile_from_data_dir(
    profile_data_path: &str,
  ) -> Option<(BrowserProfile, WayfernConfig)> {
    let data_path = std::path::Path::new(profile_data_path);
    let profile_uuid_dir = data_path.parent()?;
    let metadata_path = profile_uuid_dir.join("metadata.json");
    let content = std::fs::read_to_string(&metadata_path).ok()?;
    let profile: BrowserProfile = serde_json::from_str(&content).ok()?;
    let config = profile.wayfern_config.clone()?;
    Some((profile, config))
  }

  /// Re-apply fingerprint + watcher on a recovered Wayfern instance after GUI restart.
  pub(crate) async fn rehydrate_recovered_instance(
    &self,
    instance_id: &str,
    profile_data_path: &str,
    port: u16,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (profile, config) = Self::profile_from_data_dir(profile_data_path).ok_or_else(|| {
      serde_json::json!({
        "code": "WAYFERN_REHYDRATE_FAILED",
        "params": { "reason": "profile_metadata_not_found" }
      })
      .to_string()
    })?;

    if config.fingerprint.is_none() {
      return Err(serde_json::json!({ "code": "WAYFERN_FINGERPRINT_MISSING" }).to_string().into());
    }

    let webrtc_mode = resolve_webrtc_mode(
      config.block_webrtc.unwrap_or(false),
      config.webrtc_mode.as_deref(),
    );

    self.wait_for_cdp_ready(port).await?;

    let fingerprint_params = self
      .prepare_fingerprint_cdp_params(&config, &profile, None, webrtc_mode)
      .await?;

    let fingerprint_params = Arc::new(fingerprint_params);
    let fingerprinted_targets = Arc::new(AsyncMutex::new(HashSet::new()));

    let targets = self.get_cdp_targets(port).await?;
    let page_targets: Vec<_> = targets.iter().filter(|t| t.target_type == "page").collect();
    let page_refs: Vec<&CdpTarget> = page_targets.to_vec();
    self
      .apply_fingerprint_to_targets(&page_refs, &fingerprint_params, &fingerprinted_targets)
      .await?;

    let watcher_cancel = self.start_fingerprint_watcher(
      port,
      fingerprint_params.clone(),
      fingerprinted_targets.clone(),
    );

    let mut inner = self.inner.lock().await;
    if let Some(instance) = inner.instances.get_mut(instance_id) {
      instance.fingerprint_params = Some(fingerprint_params);
      instance.fingerprinted_targets = fingerprinted_targets;
      instance.watcher_cancel = Some(watcher_cancel);
    }

    log::info!(
      "Re-hydrated fingerprint watcher for recovered Wayfern instance {instance_id} on CDP port {port}"
    );
    Ok(())
  }

  /// Build the `Wayfern.setFingerprint` params from stored config.
  /// Resolves missing timezone/geolocation via the current proxy instead of
  /// hardcoded fallbacks that would mismatch the exit IP.
  pub(crate) async fn prepare_fingerprint_cdp_params(
    &self,
    config: &WayfernConfig,
    profile: &BrowserProfile,
    proxy_url: Option<&str>,
    webrtc_mode: &str,
  ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
    let fingerprint_json = config
      .fingerprint
      .as_deref()
      .ok_or("WAYFERN_FINGERPRINT_MISSING")?;

    let stored_value: serde_json::Value = serde_json::from_str(fingerprint_json)
      .map_err(|e| format!("Failed to parse stored fingerprint JSON: {e}"))?;

    let mut fingerprint = if stored_value.get("fingerprint").is_some() {
      stored_value.get("fingerprint").cloned().unwrap()
    } else {
      stored_value
    };

    let needs_geo = fingerprint.as_object().is_some_and(|obj| {
      !obj.contains_key("timezone")
        || !obj.contains_key("timezoneOffset")
        || !obj.contains_key("latitude")
        || !obj.contains_key("longitude")
    });

    if needs_geo {
      let applied = Self::apply_geolocation(&mut fingerprint, proxy_url, config.geoip.as_ref()).await;
      if !applied {
        return Err(serde_json::json!({
          "code": "WAYFERN_GEOLOCATION_REQUIRED",
          "params": { "reason": "timezone_or_geolocation_missing_and_proxy_unreachable" }
        })
        .to_string()
        .into());
      }
    }

    let mut fingerprint_for_cdp = Self::denormalize_fingerprint(fingerprint);

    if let Some(obj) = fingerprint_for_cdp.as_object_mut() {
      if let Some(serde_json::Value::String(s)) = obj.get("languages").cloned() {
        let arr: Vec<&str> = s.split(',').map(|l| l.trim()).collect();
        obj.insert("languages".to_string(), json!(arr));
      }
    }

    let host_os = if cfg!(target_os = "macos") {
      "macos"
    } else if cfg!(target_os = "linux") {
      "linux"
    } else {
      "windows"
    };

    let fingerprint_os = fingerprint_for_cdp
      .get("platform")
      .and_then(|p| p.as_str())
      .map(|p| p.to_lowercase())
      .unwrap_or_default();

    let is_cross_os = if fingerprint_os.contains("mac") {
      host_os != "macos"
    } else if fingerprint_os.contains("win") {
      host_os != "windows"
    } else if fingerprint_os.contains("linux") {
      host_os != "linux"
    } else if fingerprint_os.contains("iphone") || fingerprint_os.contains("ipad") || fingerprint_os.contains("ios") {
      true
    } else { fingerprint_os.contains("android") };

    let mut wayfern_token = crate::api::cloud_auth::CLOUD_AUTH.get_wayfern_token().await;
    if wayfern_token.is_none() && is_cross_os && crate::api::cloud_auth::CLOUD_AUTH.has_active_paid_subscription().await {
      log::info!("Wayfern token missing for cross-OS launch, requesting one...");
      if let Err(e) = crate::api::cloud_auth::CLOUD_AUTH.request_wayfern_token().await {
        log::warn!("Failed to request wayfern token for launch: {e}");
      } else {
        wayfern_token = crate::api::cloud_auth::CLOUD_AUTH.get_wayfern_token().await;
      }
    }

    let mut fingerprint_params = fingerprint_for_cdp;
    if let Some(ref token) = wayfern_token {
      if let Some(obj) = fingerprint_params.as_object_mut() {
        obj.insert("wayfernToken".to_string(), json!(token));
      }
    }

    if webrtc_mode == "alter" {
      let geoip = config.geoip.as_ref();
      let ip_result = async {
        match geoip {
          Some(serde_json::Value::String(ip_str)) if !ip_str.is_empty() => Ok(ip_str.clone()),
          _ => crate::proxy::ip_utils::fetch_public_ip(proxy_url).await,
        }
      }
      .await;

      let ip = ip_result.map_err(|e| {
        serde_json::json!({
          "code": "WAYFERN_WEBRTC_ALTER_IP_UNAVAILABLE",
          "params": { "detail": e.to_string() }
        })
        .to_string()
      })?;

      let addr = ip.parse::<std::net::IpAddr>().map_err(|e| {
        serde_json::json!({
          "code": "WAYFERN_WEBRTC_ALTER_IP_INVALID",
          "params": { "ip": ip, "detail": e.to_string() }
        })
        .to_string()
      })?;

      let obj = fingerprint_params
        .as_object_mut()
        .ok_or("Fingerprint must be a JSON object for WebRTC alter mode")?;

      match addr {
        std::net::IpAddr::V4(v4) => {
          obj.insert("webrtc:ipv4".to_string(), json!(v4.to_string()));
        }
        std::net::IpAddr::V6(v6) => {
          obj.insert("webrtc:ipv6".to_string(), json!(v6.to_string()));
        }
      }

      let mut hash_val: usize = 0;
      for byte in profile.id.as_bytes() {
        hash_val = hash_val.wrapping_add(*byte as usize);
      }
      let local_octet = 2 + (hash_val % 253);
      obj.insert(
        "webrtc:localipv4".to_string(),
        json!(format!("192.168.1.{local_octet}")),
      );
      log::info!(
        "Injected WebRTC IP spoofing for Wayfern: ipv4/ipv6={ip}, localipv4=192.168.1.{local_octet}"
      );
    }

    // Defense in depth: Validate fingerprint consistency before launch
    // This catches stale fingerprints from before screen consistency fix
    // and manually edited fingerprints in profile metadata
    if let Some(os) = config.os.as_deref() {
      if let Err(e) = crate::browser::wayfern_manager::WayfernManager::validate_fingerprint_consistency(
        &fingerprint_params,
        os,
      ) {
        return Err(serde_json::json!({
          "code": "WAYFERN_FINGERPRINT_INCONSISTENT",
          "params": { "reason": e }
        })
        .to_string()
        .into());
      }
    }

    Ok(fingerprint_params)
  }

  /// Apply `Wayfern.setFingerprint` to page targets. Fails when no target
  /// accepts the fingerprint — never silently launch half-spoofed.
  pub(crate) async fn apply_fingerprint_to_targets(
    &self,
    targets: &[&CdpTarget],
    fingerprint_params: &serde_json::Value,
    fingerprinted: &Arc<AsyncMutex<HashSet<String>>>,
  ) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
    if targets.is_empty() {
      return Err(serde_json::json!({ "code": "WAYFERN_NO_PAGE_TARGETS" }).to_string().into());
    }

    let mut used_fingerprint: Option<String> = None;
    let mut successes = 0usize;
    let mut last_error: Option<String> = None;

    for target in targets {
      let Some(ws_url) = &target.websocket_debugger_url else {
        continue;
      };

      {
        let known = fingerprinted.lock().await;
        if known.contains(ws_url) {
          successes += 1;
          continue;
        }
      }

      let target_id = target.id.as_deref().unwrap_or("unknown");
      log::info!("Applying fingerprint to target {target_id} via WebSocket: {ws_url}");
      match self
        .send_cdp_command(ws_url, "Wayfern.setFingerprint", fingerprint_params.clone())
        .await
      {
        Ok(result) => {
          successes += 1;
          fingerprinted.lock().await.insert(ws_url.clone());
          log::info!("Successfully applied fingerprint to page target: {result:?}");

          if used_fingerprint.is_none() {
            let fp = result.get("fingerprint").cloned().unwrap_or(result);
            if fp.is_object() {
              match serde_json::to_string(&Self::normalize_fingerprint(fp)) {
                Ok(s) => used_fingerprint = Some(s),
                Err(e) => log::warn!("Failed to serialize used fingerprint: {e}"),
              }
            }
          }
        }
        Err(e) => {
          last_error = Some(e.to_string());
          log::error!("Failed to apply fingerprint to target {target_id} ({ws_url}): {e}");
        }
      }
    }

    if successes == 0 {
      let detail = last_error.unwrap_or_else(|| "no page targets with a WebSocket URL".to_string());
      return Err(serde_json::json!({
        "code": "WAYFERN_FINGERPRINT_APPLY_FAILED",
        "params": { "detail": detail }
      })
      .to_string()
      .into());
    }

    Ok(used_fingerprint)
  }

  /// Re-apply fingerprint to any page targets not yet fingerprinted.
  pub(crate) async fn respoof_new_page_targets(
    &self,
    port: u16,
    fingerprint_params: &Arc<serde_json::Value>,
    fingerprinted: &Arc<AsyncMutex<HashSet<String>>>,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let targets = self.get_cdp_targets(port).await?;
    let page_targets: Vec<_> = targets.iter().filter(|t| t.target_type == "page").collect();
    if page_targets.is_empty() {
      return Ok(());
    }

    let refs: Vec<&CdpTarget> = page_targets.to_vec();
    self
      .apply_fingerprint_to_targets(&refs, fingerprint_params, fingerprinted)
      .await?;
    Ok(())
  }

  /// Poll for new page targets and re-apply fingerprint (Ctrl+T, window.open, automation).
  /// Uses watch channel with boolean flag (false → true) for reliable cancellation.
  /// Prevents log spam after browser instance is stopped.
  pub(crate) fn start_fingerprint_watcher(
    &self,
    port: u16,
    fingerprint_params: Arc<serde_json::Value>,
    fingerprinted: Arc<AsyncMutex<HashSet<String>>>,
  ) -> tokio::sync::watch::Sender<bool> {
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    let manager = WayfernManager {
      inner: self.inner.clone(),
      http_client: self.http_client.clone(),
    };

    tokio::spawn(async move {
      let mut interval = tokio::time::interval(Duration::from_millis(1500));
      loop {
        tokio::select! {
          result = cancel_rx.changed() => {
            if result.is_err() || *cancel_rx.borrow() {
              log::debug!("Fingerprint watcher stopped for CDP port {port}");
              break;
            }
          }
          _ = interval.tick() => {
            if let Err(e) = manager
              .respoof_new_page_targets(port, &fingerprint_params, &fingerprinted)
              .await
            {
              log::warn!("Fingerprint re-apply on port {port} failed: {e}");
            }
          }
        }
      }
    });

    cancel_tx
  }
}