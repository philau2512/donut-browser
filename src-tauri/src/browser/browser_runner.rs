use crate::api::cloud_auth::CLOUD_AUTH;
use crate::browser::camoufox_manager::{CamoufoxConfig, CamoufoxManager};
use crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry;
use crate::browser::platform_browser;
use crate::browser::wayfern_manager::{WayfernConfig, WayfernManager};
use crate::browser::ProxySettings;
use crate::events;
use crate::profile::{BrowserProfile, ProfileManager};
use crate::proxy::proxy_manager::PROXY_MANAGER;
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::System;

pub struct BrowserRunner {
  pub profile_manager: &'static ProfileManager,
  pub downloaded_browsers_registry: &'static DownloadedBrowsersRegistry,
  auto_updater: &'static crate::updater::auto_updater::AutoUpdater,
  camoufox_manager: &'static CamoufoxManager,
  wayfern_manager: &'static WayfernManager,
}

impl BrowserRunner {
  fn new() -> Self {
    Self {
      profile_manager: ProfileManager::instance(),
      downloaded_browsers_registry: DownloadedBrowsersRegistry::instance(),
      auto_updater: crate::updater::auto_updater::AutoUpdater::instance(),
      camoufox_manager: CamoufoxManager::instance(),
      wayfern_manager: WayfernManager::instance(),
    }
  }

  pub fn instance() -> &'static BrowserRunner {
    &BROWSER_RUNNER
  }

  pub fn get_binaries_dir(&self) -> PathBuf {
    crate::settings::app_dirs::binaries_dir()
  }

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

  pub async fn launch_browser(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
    url: Option<String>,
    local_proxy_settings: Option<&ProxySettings>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
    self
      .launch_browser_internal(app_handle, profile, url, local_proxy_settings, None, false)
      .await
  }

  async fn launch_browser_internal(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
    url: Option<String>,
    _local_proxy_settings: Option<&ProxySettings>,
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
    // Handle Camoufox profiles using CamoufoxManager
    if profile.browser == "camoufox" {
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

      return Ok(updated_profile);
    }

    // Handle Wayfern profiles using WayfernManager
    if profile.browser == "wayfern" {
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

      return Ok(updated_profile);
    }

    Err(format!("Unsupported browser type: {}", profile.browser).into())
  }

  pub async fn handle_profile_stopped(
    &self,
    app_handle: &tauri::AppHandle,
    profile_id: &str,
    exit_status: Option<&str>,
    is_crash: bool,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Handling profile stop immediately for ID: {profile_id}");

    // 1. Cập nhật ACTIVE_RUNNING_STATES thành false
    {
      if let Ok(mut states) = ACTIVE_RUNNING_STATES.lock() {
        states.insert(profile_id.to_string(), false);
      }
    }

    // 2. Lấy profile từ đĩa
    let profiles_dir = self.profile_manager.get_profiles_dir();
    let profile_uuid_dir = profiles_dir.join(profile_id);

    // Stop and clean up WayfernManager tracking for this profile (especially the fingerprint watcher)
    let profile_path_str = profile_uuid_dir.to_string_lossy();
    if let Some(existing) = self
      .wayfern_manager
      .find_wayfern_by_profile(&profile_path_str)
      .await
    {
      log::info!(
        "Cleaning up Wayfern instance for stopped profile: {}",
        existing.id
      );
      let _ = self.wayfern_manager.stop_wayfern(&existing.id).await;
    }

    let metadata_file = profile_uuid_dir.join("metadata.json");

    if !metadata_file.exists() {
      log::warn!("Profile metadata not found for stop handler: {profile_id}");
      return Ok(());
    }

    // Write diagnostic exit log (keep last 50 lines max)
    {
      let log_file = profile_uuid_dir.join("browser_exit.log");
      let time_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
      let details = exit_status.unwrap_or("Unknown/Naturally");
      let log_line = format!("[{}] Browser exited. Details: {}", time_str, details);

      let mut lines = Vec::new();
      if log_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&log_file) {
          lines = content.lines().map(|s| s.to_string()).collect();
        }
      }
      lines.push(log_line);

      if lines.len() > 50 {
        let skip_count = lines.len() - 50;
        lines = lines.into_iter().skip(skip_count).collect();
      }

      let new_content = lines.join("\n") + "\n";
      let _ = std::fs::write(&log_file, new_content);
    }

    let content = std::fs::read_to_string(&metadata_file)?;
    let mut profile: BrowserProfile = serde_json::from_str(&content)?;

    // Emit crash event if is_crash is true
    if is_crash {
      #[derive(serde::Serialize, Clone)]
      struct ProfileCrashPayload {
        id: String,
        name: String,
        exit_status: String,
      }
      let payload = ProfileCrashPayload {
        id: profile_id.to_string(),
        name: profile.name.clone(),
        exit_status: exit_status.unwrap_or("Unknown").to_string(),
      };
      if let Err(e) = events::emit("profile-crash", &payload) {
        log::warn!("Warning: Failed to emit profile crash event: {e}");
      }
    }

    // Ephemeral cleanup
    if profile.ephemeral {
      crate::browser::ephemeral_dirs::remove_ephemeral_dir(profile_id);
    }

    let mut profile_updated = false;

    // 3. Clear process_id nếu có
    if profile.process_id.is_some() {
      profile.process_id = None;
      if let Err(e) = self.profile_manager.save_profile(&profile) {
        log::warn!("Warning: Failed to clear profile process info: {e}");
      }
      profile_updated = true;
    }

    // 4. Run auto-updater nếu cần
    let mut final_profile = profile.clone();
    if profile_updated {
      if let Some(updated) = self
        .auto_updater
        .update_profile_to_latest_installed(app_handle, &profile)
      {
        final_profile = updated;
      }
      // Emit profile-updated
      if let Err(e) = events::emit("profile-updated", &final_profile) {
        log::warn!("Warning: Failed to emit profile update event: {e}");
      }
    }

    // 5. Password protected complete
    if final_profile.password_protected {
      crate::profile::password::complete_after_quit_and_wait(&final_profile).await;
    }

    // 6. Notify sync scheduler
    if let Some(scheduler) = crate::sync::get_global_scheduler() {
      scheduler.mark_profile_stopped(profile_id).await;
    }

    // Stop proxy worker instantly for this profile
    PROXY_MANAGER.stop_proxy_for_profile(profile_id).await;

    // 7. Emit profile-running-changed
    #[derive(serde::Serialize)]
    struct RunningChangedPayload {
      id: String,
      is_running: bool,
    }

    let payload = RunningChangedPayload {
      id: profile_id.to_string(),
      is_running: false,
    };

    if let Err(e) = events::emit("profile-running-changed", &payload) {
      log::warn!("Warning: Failed to emit profile running changed event: {e}");
    } else {
      log::info!(
        "Successfully emitted profile-running-changed event for stopped profile {}: running=false",
        final_profile.name
      );
    }

    Ok(())
  }
}

include!("browser_runner_url.rs");
include!("browser_runner_kill.rs");
include!("browser_runner_kill2.rs");
include!("browser_runner_find.rs");
include!("browser_runner_commands.rs");
