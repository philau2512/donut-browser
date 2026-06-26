
fn solve_pow(prefix: &str, difficulty: u32) -> Option<String> {
  if difficulty == 0 || difficulty > 32 {
    return None;
  }
  let prefix_bytes = prefix.as_bytes();
  let mut buf = Vec::with_capacity(prefix_bytes.len() + 24);
  for nonce in 0u64..u64::MAX {
    buf.clear();
    buf.extend_from_slice(prefix_bytes);
    let nonce_str = nonce.to_string();
    buf.extend_from_slice(nonce_str.as_bytes());
    let digest = Sha256::digest(&buf);
    if has_leading_zero_bits(&digest, difficulty) {
      return Some(nonce_str);
    }
  }
  None
}

fn has_leading_zero_bits(digest: &[u8], bits: u32) -> bool {
  let full_bytes = (bits / 8) as usize;
  if digest.len() < full_bytes + 1 {
    return false;
  }
  for &b in &digest[..full_bytes] {
    if b != 0 {
      return false;
    }
  }
  let remainder = bits % 8;
  if remainder == 0 {
    return true;
  }
  let mask = 0xffu8 << (8 - remainder);
  (digest[full_bytes] & mask) == 0
}

// --- Tauri commands ---

#[tauri::command]
pub async fn cloud_exchange_device_code(
  app_handle: tauri::AppHandle,
  code: String,
) -> Result<CloudAuthState, String> {
  let mut state = CLOUD_AUTH.exchange_device_code(&code).await?;

  let has_subscription = CLOUD_AUTH.has_active_paid_subscription().await;
  log::info!(
    "Post-login: plan={}, has_active_subscription={}",
    state.user.plan,
    has_subscription
  );

  // Pre-fetch sync token so sync can start immediately
  if has_subscription {
    log::info!("Pre-fetching sync token...");
    match CLOUD_AUTH.get_or_refresh_sync_token().await {
      Ok(Some(_)) => log::info!("Sync token pre-fetched successfully"),
      Ok(None) => log::warn!("Sync token not available despite active subscription"),
      Err(e) => log::error!("Failed to pre-fetch sync token after login: {e}"),
    }

    // Request wayfern token for paid users
    if let Err(e) = CLOUD_AUTH.request_wayfern_token().await {
      log::warn!("Failed to request wayfern token after login: {e}");
    }
  }

  // Sync cloud proxy after login
  CLOUD_AUTH.sync_cloud_proxy().await;

  // Connect profile lock manager for paid users
  if state.user.plan != "free" {
    crate::profile::team_lock::PROFILE_LOCK.connect().await;
  }

  let _ = crate::events::emit_empty("cloud-auth-changed");

  let _ = &app_handle;
  state.user.entitlements = Some(state.user.entitlements());
  Ok(state)
}

#[tauri::command]
pub async fn cloud_get_user() -> Result<Option<CloudAuthState>, String> {
  Ok(CLOUD_AUTH.get_user().await.map(|mut state| {
    // Always hand the frontend a resolved entitlements object so it never has to
    // derive capabilities itself (covers older cached state with no entitlements).
    state.user.entitlements = Some(state.user.entitlements());
    state
  }))
}

#[tauri::command]
pub async fn cloud_refresh_profile() -> Result<CloudUser, String> {
  let mut user = CLOUD_AUTH.fetch_profile().await?;
  user.entitlements = Some(user.entitlements());
  Ok(user)
}

#[tauri::command]
pub async fn cloud_logout(app_handle: tauri::AppHandle) -> Result<(), String> {
  CLOUD_AUTH.logout().await?;

  // Always clear the stored sync URL and token on cloud logout. While the
  // user was signed in, the cloud auth flow populated these with the hosted
  // sync server's URL + a server-issued token — leaving them in place would
  // pre-fill the Self-Hosted tab with our production URL and a token the
  // user never typed. The cloud-URL-only check we used to do here missed
  // trailing-slash / scheme variants and any future cloud endpoint moves.
  let manager = crate::settings::settings_manager::SettingsManager::instance();
  let _ = manager.save_sync_server_url(None);
  let _ = manager.remove_sync_token(&app_handle).await;

  // Remove cloud-managed and cloud-derived proxies
  crate::proxy::proxy_manager::PROXY_MANAGER.remove_cloud_proxies();

  let _ = crate::events::emit_empty("cloud-auth-changed");
  Ok(())
}

#[tauri::command]
pub async fn cloud_has_active_subscription() -> Result<bool, String> {
  Ok(CLOUD_AUTH.has_active_paid_subscription().await)
}

#[tauri::command]
pub async fn cloud_get_wayfern_token() -> Result<Option<String>, String> {
  Ok(CLOUD_AUTH.get_wayfern_token().await)
}

#[tauri::command]
pub async fn cloud_refresh_wayfern_token() -> Result<Option<String>, String> {
  CLOUD_AUTH.request_wayfern_token().await?;
  Ok(CLOUD_AUTH.get_wayfern_token().await)
}

#[tauri::command]
pub async fn cloud_get_countries() -> Result<Vec<LocationItem>, String> {
  CLOUD_AUTH.fetch_countries().await
}

#[tauri::command]
pub async fn cloud_get_regions(country: String) -> Result<Vec<LocationItem>, String> {
  CLOUD_AUTH.fetch_regions(&country).await
}

#[tauri::command]
pub async fn cloud_get_cities(
  country: String,
  region: Option<String>,
) -> Result<Vec<LocationItem>, String> {
  CLOUD_AUTH.fetch_cities(&country, region.as_deref()).await
}

#[tauri::command]
pub async fn cloud_get_isps(
  country: String,
  region: Option<String>,
  city: Option<String>,
) -> Result<Vec<LocationItem>, String> {
  CLOUD_AUTH
    .fetch_isps(&country, region.as_deref(), city.as_deref())
    .await
}

#[tauri::command]
pub async fn create_cloud_location_proxy(
  name: String,
  country: String,
  region: Option<String>,
  city: Option<String>,
  isp: Option<String>,
) -> Result<crate::proxy::proxy_manager::StoredProxy, String> {
  // If no cloud proxy exists yet, attempt to sync it first
  if !PROXY_MANAGER.has_cloud_proxy() {
    CLOUD_AUTH.sync_cloud_proxy().await;
  }
  PROXY_MANAGER.create_cloud_location_proxy(name, country, region, city, isp)
}

#[derive(Debug, Serialize)]
pub struct CloudProxyUsage {
  pub used_mb: i64,
  pub limit_mb: i64,
  pub remaining_mb: i64,
  pub recurring_limit_mb: i64,
  pub extra_limit_mb: i64,
}

#[derive(Debug, Deserialize)]
struct ProxyUsageResponse {
  #[serde(rename = "usedMb")]
  used_mb: i64,
  #[serde(rename = "limitMb")]
  limit_mb: i64,
  #[serde(rename = "remainingMb")]
  remaining_mb: i64,
  #[serde(rename = "recurringLimitMb", default)]
  recurring_limit_mb: i64,
  #[serde(rename = "extraLimitMb", default)]
  extra_limit_mb: i64,
}

#[tauri::command]
pub async fn cloud_get_proxy_usage() -> Result<Option<CloudProxyUsage>, String> {
  let (has_proxy, cached_recurring, cached_extra) = {
    let state = CLOUD_AUTH.state.lock().await;
    match &*state {
      Some(auth)
        if auth.user.proxy_bandwidth_limit_mb > 0 || auth.user.proxy_bandwidth_extra_mb > 0 =>
      {
        (
          true,
          auth.user.proxy_bandwidth_limit_mb,
          auth.user.proxy_bandwidth_extra_mb,
        )
      }
      _ => return Ok(None),
    }
  };

  if !has_proxy {
    return Ok(None);
  }

  // Fetch live usage from the API
  match CLOUD_AUTH
    .api_call_with_retry(|access_token| {
      let url = format!("{CLOUD_API_URL}/api/proxy/usage");
      let client = reqwest::Client::new();
      async move {
        let response = client
          .get(&url)
          .header("Authorization", format!("Bearer {access_token}"))
          .send()
          .await
          .map_err(|e| format!("Failed to fetch proxy usage: {e}"))?;

        if !response.status().is_success() {
          return Err(format!(
            "Proxy usage API returned status {}",
            response.status()
          ));
        }

        response
          .json::<ProxyUsageResponse>()
          .await
          .map_err(|e| format!("Failed to parse proxy usage: {e}"))
      }
    })
    .await
  {
    Ok(usage) => Ok(Some(CloudProxyUsage {
      used_mb: usage.used_mb,
      limit_mb: usage.limit_mb,
      remaining_mb: usage.remaining_mb,
      recurring_limit_mb: if usage.recurring_limit_mb > 0 {
        usage.recurring_limit_mb
      } else {
        cached_recurring
      },
      extra_limit_mb: if usage.recurring_limit_mb > 0 {
        usage.extra_limit_mb
      } else {
        cached_extra
      },
    })),
    Err(e) => {
      log::warn!("Failed to fetch live proxy usage, falling back to cached: {e}");
      // Fallback to cached values
      let state = CLOUD_AUTH.state.lock().await;
      match &*state {
        Some(auth) => {
          let used = auth.user.proxy_bandwidth_used_mb;
          let total = cached_recurring + cached_extra;
          Ok(Some(CloudProxyUsage {
            used_mb: used,
            limit_mb: total,
            remaining_mb: (total - used).max(0),
            recurring_limit_mb: cached_recurring,
            extra_limit_mb: cached_extra,
          }))
        }
        _ => Ok(None),
      }
    }
  }
}

#[tauri::command]
pub async fn restart_sync_service(app_handle: tauri::AppHandle) -> Result<(), String> {
  // Stop existing scheduler
  if let Some(scheduler) = sync::get_global_scheduler() {
    scheduler.stop();
  }

  // Restart sync pipeline
  let app_handle_sync = app_handle.clone();
  tauri::async_runtime::spawn(async move {
    let mut subscription_manager = sync::SubscriptionManager::new();
    let work_rx = subscription_manager.take_work_receiver();

    if let Err(e) = subscription_manager.start(app_handle_sync.clone()).await {
      log::warn!("Failed to start sync subscription: {e}");
      return;
    }

    if let Some(work_rx) = work_rx {
      let scheduler = Arc::new(sync::SyncScheduler::new());
      sync::set_global_scheduler(scheduler.clone());

      scheduler.sync_all_enabled_profiles(&app_handle_sync).await;

      match sync::SyncEngine::create_from_settings(&app_handle_sync).await {
        Ok(engine) => {
          if let Err(e) = engine
            .check_for_missing_synced_profiles(&app_handle_sync)
            .await
          {
            log::warn!("Failed to check for missing profiles: {}", e);
          }
          if let Err(e) = engine
            .check_for_missing_synced_entities(&app_handle_sync)
            .await
          {
            log::warn!("Failed to check for missing entities: {}", e);
          }
        }
        Err(e) => {
          log::warn!("Sync not configured, skipping missing profile check: {}", e);
        }
      }

      scheduler
        .clone()
        .start(app_handle_sync.clone(), work_rx)
        .await;
      log::info!("Sync scheduler restarted");
    }
  });

  Ok(())
}
