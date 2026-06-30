// ═══════════════════════════════════════════════════════════════════════════════
// browser_runner_helpers.rs
// ═══════════════════════════════════════════════════════════════════════════════
//
// Shared helper methods for BrowserRunner.
// This file is included via include!() in browser_runner.rs.
//
// Methods:
// - resolve_blocklist_file: DNS blocklist resolution
// - resolve_proxy_with_refresh: Cloud proxy credential refresh and resolution
// - fire_launch_hook: HTTP launch hook invocation
// - resolve_launch_proxy: Automation pipeline + proxy resolution orchestration
// - get_browser_executable_path: Common executable path resolution
//
// ═══════════════════════════════════════════════════════════════════════════════

impl BrowserRunner {

/// Resolve the DNS blocklist level to a cached file path.
/// If a level is set but the cache is missing, fetches on demand (blocks until done).
async fn resolve_blocklist_file(
  profile: &crate::profile::BrowserProfile,
) -> Result<Option<String>, String> {
  let Some(ref level_str) = profile.dns_blocklist else {
    return Ok(None);
  };
  let Some(level) = crate::profile::dns_blocklist::BlocklistLevel::parse_level(level_str) else {
    return Ok(None);
  };
  if level == crate::profile::dns_blocklist::BlocklistLevel::None {
    return Ok(None);
  }
  let path = crate::profile::dns_blocklist::BlocklistManager::ensure_cached(level)
    .await
    .map_err(|e| format!("Failed to fetch DNS blocklist: {e}"))?;
  Ok(Some(path.to_string_lossy().to_string()))
}

/// Refresh cloud proxy credentials if the profile uses a cloud or cloud-derived proxy,
/// then resolve the proxy settings with profile-specific sid for sticky sessions.
async fn resolve_proxy_with_refresh(
  &self,
  proxy_id: Option<&String>,
  profile_id: Option<&str>,
) -> Result<Option<ProxySettings>, String> {
  let proxy_id = match proxy_id {
    Some(id) => id,
    None => return Ok(None),
  };

  if PROXY_MANAGER.is_cloud_or_derived(proxy_id) {
    log::info!("Refreshing cloud proxy credentials before launch for proxy {proxy_id}");
    CLOUD_AUTH.sync_cloud_proxy().await;
  }
  // For cloud-derived proxies, inject profile-specific sid for sticky sessions
  if let Some(pid) = profile_id {
    if PROXY_MANAGER.is_cloud_or_derived(proxy_id) {
      return Ok(PROXY_MANAGER.resolve_proxy_for_profile(proxy_id, pid));
    }
  }
  Ok(PROXY_MANAGER.get_proxy_settings_by_id(proxy_id))
}

fn fire_launch_hook(profile: &BrowserProfile) {
  let Some(raw_url) = profile.launch_hook.as_deref() else {
    return;
  };
  let trimmed = raw_url.trim();
  if trimmed.is_empty() {
    return;
  }

  let parsed = match url::Url::parse(trimmed) {
    Ok(u) => u,
    Err(e) => {
      log::warn!(
        "Skipping launch hook for profile {} (ID: {}): invalid URL: {e}",
        profile.name,
        profile.id
      );
      return;
    }
  };

  if !matches!(parsed.scheme(), "http" | "https") {
    log::warn!(
      "Skipping launch hook for profile {} (ID: {}): URL must be http or https",
      profile.name,
      profile.id
    );
    return;
  }

  let url = parsed.to_string();
  let profile_name = profile.name.clone();
  let profile_id = profile.id.to_string();

  log::info!("Firing launch hook GET {url} for profile {profile_name} (ID: {profile_id})");

  tokio::spawn(async move {
    let client = match reqwest::Client::builder()
      .timeout(Duration::from_secs(5))
      .build()
    {
      Ok(c) => c,
      Err(e) => {
        log::warn!("Launch hook client build failed for {url}: {e}");
        return;
      }
    };

    match client.get(&url).send().await {
      Ok(resp) => {
        log::info!(
          "Launch hook {url} for profile {profile_name} returned status {}",
          resp.status()
        );
      }
      Err(e) => {
        log::warn!("Launch hook {url} for profile {profile_name} failed: {e}");
      }
    }
  });
}

async fn resolve_launch_proxy(
  &self,
  profile: &BrowserProfile,
) -> Result<Option<ProxySettings>, String> {
  Self::fire_launch_hook(profile);

  // Run before_open automation pipeline if configured
  if let Some(ref automation) = profile.automation {
    if !automation.before_open.is_empty() {
      log::info!(
        "[AUTOMATION] Running before_open pipeline for profile {} ({})",
        profile.name,
        profile.id
      );

      // Create execution context
      let mut context = ExecutionContext::new(profile.id.to_string(), profile.name.clone());

      // Execute pipeline with stop_on_failure=true (block launch on error)
      match AutomationEngine::run_pipeline(
        "BEFORE_OPEN",
        &automation.before_open,
        &mut context,
        true, // stop_on_failure
      )
      .await
      {
        Ok(()) => {
          log::info!(
            "[AUTOMATION] before_open pipeline completed successfully for profile {}",
            profile.name
          );

          // If dynamic proxy was set by automation, use it
          if let Some(dynamic_proxy) = context.dynamic_proxy {
            log::info!(
              "[AUTOMATION] Using dynamic proxy from automation: {}:{}",
              dynamic_proxy.host,
              dynamic_proxy.port
            );

            return Ok(Some(ProxySettings {
              proxy_type: dynamic_proxy.protocol,
              host: dynamic_proxy.host,
              port: dynamic_proxy.port,
              username: dynamic_proxy.username,
              password: dynamic_proxy.password,
            }));
          }
        }
        Err(e) => {
          log::error!(
            "[AUTOMATION] before_open pipeline failed for profile {}: {}",
            profile.name,
            e
          );
          return Err(format!("Automation pipeline failed: {}", e));
        }
      }
    }
  }

  // Fall back to configured proxy (if no dynamic proxy from automation)
  self
    .resolve_proxy_with_refresh(profile.proxy_id.as_ref(), Some(&profile.id.to_string()))
    .await
}

/// Get the executable path for a browser profile
/// This is a common helper to eliminate code duplication across the codebase
pub fn get_browser_executable_path(
  &self,
  profile: &BrowserProfile,
) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
  // Create browser instance to get executable path
  let browser_type = crate::browser::BrowserType::from_str(&profile.browser)
    .map_err(|e| format!("Invalid browser type: {e}"))?;
  let browser = crate::browser::create_browser(browser_type);

  // Construct browser directory path: binaries/<browser>/<version>/
  let mut browser_dir = self.get_binaries_dir();
  browser_dir.push(&profile.browser);
  browser_dir.push(&profile.version);

  // Get platform-specific executable path
  browser
    .get_executable_path(&browser_dir)
    .map_err(|e| format!("Failed to get executable path for {}: {e}", profile.browser).into())
}
}
