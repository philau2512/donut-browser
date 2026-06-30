impl CloudAuthManager {
  pub async fn get_or_refresh_sync_token(&self) -> Result<Option<String>, String> {
    if !self.is_logged_in().await {
      return Ok(None);
    }

    // Check cached sync token
    if let Ok(Some(token)) = Self::load_cloud_sync_token() {
      if !Self::is_jwt_expiring_soon(&token) {
        return Ok(Some(token));
      }
    }

    // Fetch new sync token
    let sync_token = self
      .api_call_with_retry(|access_token| {
        let url = format!("{CLOUD_API_URL}/api/auth/sync-token");
        let client = self.client.clone();
        async move {
          let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to get sync token: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Sync token request failed ({status}): {body}"));
          }

          let result: SyncTokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse sync token response: {e}"))?;

          Ok(result.sync_token)
        }
      })
      .await?;

    Self::store_cloud_sync_token(&sync_token)?;
    Ok(Some(sync_token))
  }

  pub async fn logout(&self) -> Result<(), String> {
    // Clear wayfern token
    self.clear_wayfern_token().await;

    // Disconnect profile lock manager
    crate::profile::team_lock::PROFILE_LOCK.disconnect().await;

    // Try to call the logout API (best-effort)
    if let Ok(Some(access_token)) = Self::load_access_token() {
      let refresh_token = Self::load_refresh_token().ok().flatten();
      let url = format!("{CLOUD_API_URL}/api/auth/logout");
      let mut body = serde_json::json!({});
      if let Some(rt) = &refresh_token {
        body = serde_json::json!({ "refreshToken": rt });
      }
      let _ = self
        .client
        .post(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .json(&body)
        .send()
        .await;
    }

    // Remove cloud proxy on logout
    PROXY_MANAGER.remove_cloud_proxy();

    self.clear_auth().await;
    Ok(())
  }

  pub async fn is_logged_in(&self) -> bool {
    let state = self.state.lock().await;
    state.is_some()
  }

  /// Resolve this session's entitlements (server-sent or locally derived).
  pub async fn entitlements(&self) -> Option<Entitlements> {
    let state = self.state.lock().await;
    state.as_ref().map(|auth| auth.user.entitlements())
  }

  /// Account is in a paid/active state. Used for the "any active plan" gates
  /// (sync token, wayfern token); per-feature access uses the capability helpers.
  pub async fn has_active_paid_subscription(&self) -> bool {
    self.entitlements().await.map(|e| e.active).unwrap_or(false)
  }

  /// Non-async version that uses try_lock, defaults to false if lock can't be acquired.
  pub fn has_active_paid_subscription_sync(&self) -> bool {
    match self.state.try_lock() {
      Ok(state) => state
        .as_ref()
        .map(|auth| auth.user.entitlements().active)
        .unwrap_or(false),
      Err(_) => false,
    }
  }

  /// Launch/drive profiles programmatically (local API + MCP automation).
  pub async fn can_use_browser_automation(&self) -> bool {
    self
      .entitlements()
      .await
      .map(|e| e.browser_automation)
      .unwrap_or(false)
  }

  /// Edit fingerprints / use a non-native OS fingerprint.
  pub async fn can_use_cross_os_fingerprints(&self) -> bool {
    self
      .entitlements()
      .await
      .map(|e| e.cross_os_fingerprints)
      .unwrap_or(false)
  }

  /// Cloud profile sync / backup (async).
  pub async fn can_use_cloud_backup(&self) -> bool {
    self
      .entitlements()
      .await
      .map(|e| e.cloud_backup)
      .unwrap_or(false)
  }

  /// Cloud profile sync / backup (non-async, try_lock; false if unavailable).
  pub fn can_use_cloud_backup_sync(&self) -> bool {
    match self.state.try_lock() {
      Ok(state) => state
        .as_ref()
        .map(|auth| auth.user.entitlements().cloud_backup)
        .unwrap_or(false),
      Err(_) => false,
    }
  }

  /// Per-hour cap on automation requests (0 when automation is unavailable).
  /// Carried for the future local rate limiter; read by the inert chokepoints.
  pub async fn requests_per_hour(&self) -> i64 {
    self
      .entitlements()
      .await
      .map(|e| e.requests_per_hour)
      .unwrap_or(0)
  }

  pub async fn is_fingerprint_os_allowed(&self, fingerprint_os: Option<&str>) -> bool {
    let host_os = crate::profile::types::get_host_os();
    match fingerprint_os {
      None => true,
      Some(os) if os == host_os => true,
      Some(_) => self.can_use_cross_os_fingerprints().await,
    }
  }

  pub async fn is_on_team_plan(&self) -> bool {
    if let Some(state) = self.get_user().await {
      return state.user.team_id.is_some();
    }
    false
  }

  pub async fn get_user(&self) -> Option<CloudAuthState> {
    let state = self.state.lock().await;
    state.clone()
  }

  async fn clear_auth(&self) {
    let mut state = self.state.lock().await;
    *state = None;
    Self::delete_all_cloud_files();
  }

  /// API call with 401 retry: if first attempt gets 401, refresh access token and retry once.
  /// Uses refresh_lock to prevent concurrent token rotations from racing.
  pub async fn api_call_with_retry<F, Fut, T>(&self, make_request: F) -> Result<T, String>
  where
    F: Fn(String) -> Fut + Send,
    Fut: std::future::Future<Output = Result<T, String>> + Send,
  {
    let access_token = Self::load_access_token()?.ok_or_else(|| "Not logged in".to_string())?;

    match make_request(access_token.clone()).await {
      Ok(result) => Ok(result),
      Err(e) if e.contains("(401") || e.contains("Unauthorized") => {
        log::info!("Got 401/Unauthorized response, attempting token refresh...");

        // Check if another caller already refreshed while we waited
        let current_token = Self::load_access_token()?.unwrap_or_default();
        if current_token != access_token && !current_token.is_empty() {
          log::info!("Token was already refreshed by another caller, retrying...");
          return make_request(current_token).await;
        }

        self.refresh_access_token().await?;
        let new_token =
          Self::load_access_token()?.ok_or_else(|| "Not logged in after refresh".to_string())?;
        log::info!("Token refreshed, retrying request...");
        make_request(new_token).await
      }
      Err(e) => Err(e),
    }
  }

  /// Fetch proxy configuration from the cloud backend
  async fn fetch_proxy_config(&self) -> Result<Option<CloudProxyConfigResponse>, String> {
    // Check cached user state for proxy bandwidth (subscription or extra)
    {
      let state = self.state.lock().await;
      match &*state {
        Some(auth)
          if auth.user.proxy_bandwidth_limit_mb > 0 || auth.user.proxy_bandwidth_extra_mb > 0 => {}
        _ => return Ok(None),
      }
    }

    match self
      .api_call_with_retry(|access_token| {
        let url = format!("{CLOUD_API_URL}/api/proxy/config");
        let client = self.client.clone();
        async move {
          let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch proxy config: {e}"))?;

          let status = response.status();
          if status == reqwest::StatusCode::FORBIDDEN {
            let body = response.text().await.unwrap_or_default();
            log::warn!("Proxy config returned 403: {body}");
            return Err("__403__".to_string());
          }

          if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Proxy config fetch failed ({status}): {body}"));
          }

          response
            .json::<CloudProxyConfigResponse>()
            .await
            .map_err(|e| format!("Failed to parse proxy config: {e}"))
        }
      })
      .await
    {
      Ok(config) => Ok(Some(config)),
      Err(e) if e.contains("__403__") => Ok(None),
      Err(e) => {
        log::warn!("Failed to fetch cloud proxy config: {e}");
        Ok(None)
      }
    }
  }

  /// Sync the cloud-managed proxy: fetch config and upsert or remove
  pub async fn sync_cloud_proxy(&self) {
    log::info!("Syncing cloud proxy configuration...");
    match self.fetch_proxy_config().await {
      Ok(Some(config)) => {
        log::info!(
          "Cloud proxy config received: host={}, port={}, protocol={}",
          config.host,
          config.port,
          config.protocol
        );
        let settings = ProxySettings {
          proxy_type: config.protocol,
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
        };
        match PROXY_MANAGER.upsert_cloud_proxy(settings) {
          Ok(_) => {
            log::info!("Cloud proxy synced successfully");
            // Propagate credential changes to derived location proxies
            PROXY_MANAGER.update_cloud_derived_proxies();
          }
          Err(e) => log::warn!("Failed to upsert cloud proxy: {e}"),
        }
      }
      Ok(None) => {
        log::info!("No cloud proxy config available (user may not have proxy bandwidth)");
        PROXY_MANAGER.remove_cloud_proxy();
      }
      Err(e) => {
        log::error!("Failed to sync cloud proxy: {e}");
      }
    }
  }

  /// Report the number of sync-enabled profiles to the cloud backend
  pub async fn report_sync_profile_count(&self, count: i64) -> Result<(), String> {
    self
      .api_call_with_retry(|access_token| {
        let url = format!("{CLOUD_API_URL}/api/auth/sync-profile-usage");
        let client = reqwest::Client::new();
        async move {
          let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(&serde_json::json!({ "count": count }))
            .send()
            .await
            .map_err(|e| format!("Failed to report profile usage: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Profile usage report failed ({status}): {body}"));
          }

          Ok(())
        }
      })
      .await
  }

  /// Fetch country list from the cloud backend
  pub async fn fetch_countries(&self) -> Result<Vec<LocationItem>, String> {
    self
      .api_call_with_retry(|access_token| {
        let url = format!("{CLOUD_API_URL}/api/proxy/locations/countries");
        let client = self.client.clone();
        async move {
          let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch countries: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Countries fetch failed ({status}): {body}"));
          }

          response
            .json::<Vec<LocationItem>>()
            .await
            .map_err(|e| format!("Failed to parse countries: {e}"))
        }
      })
      .await
  }

  /// Fetch region list for a country from the cloud backend
  pub async fn fetch_regions(&self, country: &str) -> Result<Vec<LocationItem>, String> {
    let country = country.to_string();
    self
      .api_call_with_retry(move |access_token| {
        let url = format!(
          "{CLOUD_API_URL}/api/proxy/locations/regions?country={}",
          country
        );
        let client = reqwest::Client::new();
        async move {
          let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch regions: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Regions fetch failed ({status}): {body}"));
          }

          response
            .json::<Vec<LocationItem>>()
            .await
            .map_err(|e| format!("Failed to parse regions: {e}"))
        }
      })
      .await
  }

  /// Fetch city list for a country, optionally filtered by region
  pub async fn fetch_cities(
    &self,
    country: &str,
    region: Option<&str>,
  ) -> Result<Vec<LocationItem>, String> {
    let country = country.to_string();
    let region = region.map(|s| s.to_string());
    self
      .api_call_with_retry(move |access_token| {
        let mut url = format!(
          "{CLOUD_API_URL}/api/proxy/locations/cities?country={}",
          country
        );
        if let Some(ref r) = region {
          url.push_str(&format!("&region={}", r));
        }
        let client = reqwest::Client::new();
        async move {
          let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch cities: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Cities fetch failed ({status}): {body}"));
          }

          response
            .json::<Vec<LocationItem>>()
            .await
            .map_err(|e| format!("Failed to parse cities: {e}"))
        }
      })
      .await
  }

  /// Fetch ISP list for a country, optionally filtered by region and city
  pub async fn fetch_isps(
    &self,
    country: &str,
    region: Option<&str>,
    city: Option<&str>,
  ) -> Result<Vec<LocationItem>, String> {
    let country = country.to_string();
    let region = region.map(|s| s.to_string());
    let city = city.map(|s| s.to_string());
    self
      .api_call_with_retry(move |access_token| {
        let mut url = format!(
          "{CLOUD_API_URL}/api/proxy/locations/isps?country={}",
          country
        );
        if let Some(ref r) = region {
          url.push_str(&format!("&region={}", r));
        }
        if let Some(ref c) = city {
          url.push_str(&format!("&city={}", c));
        }
        let client = reqwest::Client::new();
        async move {
          let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch ISPs: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("ISPs fetch failed ({status}): {body}"));
          }

          response
            .json::<Vec<LocationItem>>()
            .await
            .map_err(|e| format!("Failed to parse ISPs: {e}"))
        }
      })
      .await
  }

  /// Request a wayfern token from the cloud API. Only succeeds for paid users.
  pub async fn request_wayfern_token(&self) -> Result<(), String> {
    if !self.has_active_paid_subscription().await {
      self.clear_wayfern_token().await;
      return Ok(());
    }

    let result = self
      .api_call_with_retry(|access_token| {
        let url = format!("{CLOUD_API_URL}/api/auth/wayfern-start");
        // Bound the request: without a timeout, an unreachable
        // api.donutbrowser.com hangs the background fetch indefinitely,
        // which in turn forces wayfern_manager's launch-time wait to
        // exhaust its full polling budget every time.
        let client = reqwest::Client::builder()
          .timeout(std::time::Duration::from_secs(8))
          .connect_timeout(std::time::Duration::from_secs(4))
          .build()
          .unwrap_or_else(|_| reqwest::Client::new());
        async move {
          let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to request wayfern token: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Wayfern token request failed ({status}): {body}"));
          }

          let result: WayfernTokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse wayfern token response: {e}"))?;

          Ok(result.token)
        }
      })
      .await;

    let token = match result {
      Ok(token) => token,
      Err(e) => {
        // The backend returns 403 (ForbiddenException) for paid-feature blocks:
        // token-reuse throttle, "active subscription required", and the
        // primary-device restriction (see donutbrowser-infra wayfern.service.ts).
        // This is distinct from a 401 (dead access token) — the session is still
        // valid, the user is just temporarily/conditionally not entitled. So we
        // do NOT invalidate the session. Instead: drop the stale wayfern token so
        // no browser launches half-authenticated, re-fetch the profile so the
        // cached plan reflects the backend's real state (it may have changed),
        // and signal the UI so the user learns why automation stopped working.
        if e.contains("(403") || e.contains("Forbidden") {
          log::warn!("Wayfern token blocked by backend (403): {e}");
          self.clear_wayfern_token().await;
          if let Err(fetch_err) = self.fetch_profile().await {
            log::warn!("Profile re-fetch after wayfern block failed: {fetch_err}");
          }
          let _ = crate::events::emit_empty("wayfern-paid-blocked");
        }
        return Err(e);
      }
    };

    let mut wt = self.wayfern_token.lock().await;
    *wt = Some(token);
    log::info!("Wayfern token acquired");
    Ok(())
  }

  /// Get the current wayfern token, if any.
  pub async fn get_wayfern_token(&self) -> Option<String> {
    let wt = self.wayfern_token.lock().await;
    wt.clone()
  }

  /// Clear the cached wayfern token.
  pub async fn clear_wayfern_token(&self) {
    let mut wt = self.wayfern_token.lock().await;
    *wt = None;
  }

  /// Background loop that refreshes the sync token periodically
  pub async fn start_sync_token_refresh_loop(app_handle: tauri::AppHandle) {
    let mut wayfern_refresh_counter: u32 = 0;
    loop {
      tokio::time::sleep(std::time::Duration::from_secs(600)).await; // 10 minutes

      if !CLOUD_AUTH.is_logged_in().await {
        continue;
      }

      wayfern_refresh_counter += 1;

      // Proactively refresh the access token if it's expired or expiring soon.
      // This runs first so subsequent API calls use a fresh token.
      if let Ok(Some(token)) = Self::load_access_token() {
        if Self::is_jwt_expiring_soon(&token) {
          if let Err(e) = CLOUD_AUTH.refresh_access_token().await {
            log::warn!("Failed to refresh cloud access token: {e}");
            // If the refresh token itself was rejected, session is irrecoverable
            if e.contains("(401") || e.contains("Unauthorized") {
              log::warn!("Refresh token rejected — invalidating session");
              CLOUD_AUTH.invalidate_session().await;
              continue;
            }
          }
        }
      }

      match CLOUD_AUTH.get_or_refresh_sync_token().await {
        Ok(Some(_)) => {
          log::debug!("Cloud sync token refreshed successfully");
        }
        Ok(None) => {}
        Err(e) => {
          log::warn!("Failed to refresh cloud sync token: {e}");
        }
      }

      // Refresh profile data periodically
      if let Err(e) = CLOUD_AUTH.fetch_profile().await {
        log::debug!("Failed to refresh cloud profile: {e}");
      }

      // Reconnect profile lock manager if needed
      if let Some(auth_state) = CLOUD_AUTH.get_user().await {
        if auth_state.user.plan != "free"
          && !crate::profile::team_lock::PROFILE_LOCK.is_connected().await
        {
          crate::profile::team_lock::PROFILE_LOCK.connect().await;
        }
      }

      // Sync cloud proxy credentials
      CLOUD_AUTH.sync_cloud_proxy().await;

      // Refresh wayfern token every 10 hours (60 iterations of 10-minute loop)
      if wayfern_refresh_counter >= 60 {
        wayfern_refresh_counter = 0;
        if CLOUD_AUTH.has_active_paid_subscription().await {
          if let Err(e) = CLOUD_AUTH.request_wayfern_token().await {
            log::warn!("Failed to refresh wayfern token: {e}");
          }
        } else {
          CLOUD_AUTH.clear_wayfern_token().await;
        }
      }

      let _ = &app_handle; // keep app_handle alive
    }
  }
}
