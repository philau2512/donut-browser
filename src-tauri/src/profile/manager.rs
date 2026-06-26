use crate::api::api_client::is_browser_version_nightly;
use crate::api::cloud_auth::CLOUD_AUTH;
use crate::browser::camoufox_manager::CamoufoxConfig;
use crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry;
use crate::browser::wayfern_manager::WayfernConfig;
use crate::browser::{create_browser, BrowserType, ProxySettings};
use crate::events;
use crate::profile::types::{get_host_os, BrowserProfile, SyncMode};
use crate::proxy::proxy_manager::PROXY_MANAGER;
use std::fs::{self, create_dir_all};
use std::path::{Path, PathBuf};
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};
use url::Url;

fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
  let tmp = path.with_extension(match path.extension().and_then(|e| e.to_str()) {
    Some(ext) => format!("{ext}.tmp"),
    None => "tmp".to_string(),
  });
  {
    let mut f = fs::File::create(&tmp)?;
    use std::io::Write;
    f.write_all(data)?;
    f.sync_all()?;
  }
  fs::rename(&tmp, path)
}

pub struct ProfileManager {
  camoufox_manager: &'static crate::browser::camoufox_manager::CamoufoxManager,
  wayfern_manager: &'static crate::browser::wayfern_manager::WayfernManager,
}

impl ProfileManager {
  fn new() -> Self {
    Self {
      camoufox_manager: crate::browser::camoufox_manager::CamoufoxManager::instance(),
      wayfern_manager: crate::browser::wayfern_manager::WayfernManager::instance(),
    }
  }

  pub fn instance() -> &'static ProfileManager {
    &PROFILE_MANAGER
  }

  pub fn get_profiles_dir(&self) -> PathBuf {
    crate::settings::app_dirs::profiles_dir()
  }

  pub fn get_binaries_dir(&self) -> PathBuf {
    crate::settings::app_dirs::binaries_dir()
  }

  fn normalize_launch_hook(
    launch_hook: Option<String>,
  ) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let Some(raw) = launch_hook else {
      return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
      return Ok(None);
    }

    let parsed = Url::parse(trimmed).map_err(|e| format!("Invalid launch hook URL: {e}"))?;
    match parsed.scheme() {
      "http" | "https" => Ok(Some(parsed.to_string())),
      _ => Err("Launch hook URL must use http or https".into()),
    }
  }

  #[allow(clippy::too_many_arguments)]
  pub async fn create_profile_with_group(
    &self,
    app_handle: &tauri::AppHandle,
    name: &str,
    browser: &str,
    version: &str,
    release_type: &str,
    proxy_id: Option<String>,
    vpn_id: Option<String>,
    camoufox_config: Option<CamoufoxConfig>,
    wayfern_config: Option<WayfernConfig>,
    group_id: Option<String>,
    ephemeral: bool,
    dns_blocklist: Option<String>,
    launch_hook: Option<String>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    if proxy_id.is_some() && vpn_id.is_some() {
      return Err("Cannot set both proxy_id and vpn_id".into());
    }

    let launch_hook = Self::normalize_launch_hook(launch_hook)?;

    // Sync cloud proxy credentials if the profile uses a cloud or cloud-derived proxy
    if let Some(ref pid) = proxy_id {
      if PROXY_MANAGER.is_cloud_or_derived(pid)
        || pid == crate::proxy::proxy_manager::CLOUD_PROXY_ID
      {
        log::info!("Syncing cloud proxy credentials before profile creation");
        CLOUD_AUTH.sync_cloud_proxy().await;
      }
    }

    log::info!("Attempting to create profile: {name}");

    // Check if a profile with this name already exists (case insensitive)
    let existing_profiles = self.list_profiles()?;
    if existing_profiles
      .iter()
      .any(|p| p.name.to_lowercase() == name.to_lowercase())
    {
      return Err(format!("Profile with name '{name}' already exists").into());
    }

    // Generate a new UUID for this profile
    let profile_id = uuid::Uuid::new_v4();
    let profiles_dir = self.get_profiles_dir();
    let profile_uuid_dir = profiles_dir.join(profile_id.to_string());
    let profile_data_dir = profile_uuid_dir.join("profile");
    let profile_file = profile_uuid_dir.join("metadata.json");

    // Create profile directory with UUID and profile subdirectory
    create_dir_all(&profile_uuid_dir)?;
    if !ephemeral {
      create_dir_all(&profile_data_dir)?;
    }

    // For Camoufox profiles, generate fingerprint during creation
    let final_camoufox_config = if browser == "camoufox" {
      let mut config = camoufox_config.unwrap_or_else(|| {
        log::info!("Creating default Camoufox config for profile: {name}");
        crate::browser::camoufox_manager::CamoufoxConfig::default()
      });

      // Pass upstream proxy information to config for fingerprint generation
      if let Some(proxy_id_ref) = &proxy_id {
        if let Some(proxy_settings) = PROXY_MANAGER.get_proxy_settings_by_id(proxy_id_ref) {
          // For fingerprint generation, pass upstream proxy directly with credentials if present
          let proxy_url = if let (Some(username), Some(password)) =
            (&proxy_settings.username, &proxy_settings.password)
          {
            format!(
              "{}://{}:{}@{}:{}",
              proxy_settings.proxy_type.to_lowercase(),
              username,
              password,
              proxy_settings.host,
              proxy_settings.port
            )
          } else {
            format!(
              "{}://{}:{}",
              proxy_settings.proxy_type.to_lowercase(),
              proxy_settings.host,
              proxy_settings.port
            )
          };
          config.proxy = Some(proxy_url);
          log::info!(
            "Using upstream proxy for Camoufox fingerprint generation: {}://{}:{}",
            proxy_settings.proxy_type.to_lowercase(),
            proxy_settings.host,
            proxy_settings.port
          );
        }
      }

      // Generate fingerprint if not already provided
      if config.fingerprint.is_none() {
        log::info!("Generating fingerprint for Camoufox profile: {name}");

        // Use the camoufox launcher to generate the config

        // Create a temporary profile for fingerprint generation
        let temp_profile = BrowserProfile {
          id: uuid::Uuid::new_v4(),
          name: name.to_string(),
          browser: browser.to_string(),
          version: version.to_string(),
          proxy_id: proxy_id.clone(),
          vpn_id: None,
          launch_hook: launch_hook.clone(),
          process_id: None,
          last_launch: None,
          release_type: release_type.to_string(),
          camoufox_config: None,
          wayfern_config: None,
          group_id: group_id.clone(),
          tags: Vec::new(),
          note: None,
          sync_mode: SyncMode::Disabled,
          encryption_salt: None,
          last_sync: None,
          host_os: None,
          ephemeral: false,
          extension_group_id: None,
          proxy_bypass_rules: Vec::new(),
          created_by_id: None,
          created_by_email: None,
          dns_blocklist: None,
          password_protected: false,
          created_at: None,
          updated_at: None,
        };

        match self
          .camoufox_manager
          .generate_fingerprint_config(app_handle, &temp_profile, &config)
          .await
        {
          Ok(generated_fingerprint) => {
            config.fingerprint = Some(generated_fingerprint);
            log::info!("Successfully generated fingerprint for profile: {name}");
          }
          Err(e) => {
            return Err(
              format!("Failed to generate fingerprint for Camoufox profile '{name}': {e}").into(),
            );
          }
        }
      } else {
        log::info!("Using provided fingerprint for Camoufox profile: {name}");
      }

      // Clear the proxy from config after fingerprint generation
      // Browser launch should always use local proxy, never direct to upstream
      config.proxy = None;

      Some(config)
    } else {
      camoufox_config.clone()
    };

    // For Wayfern profiles, generate fingerprint during creation
    let final_wayfern_config = if browser == "wayfern" {
      let mut config = wayfern_config.unwrap_or_else(|| {
        log::info!("Creating default Wayfern config for profile: {name}");
        crate::browser::wayfern_manager::WayfernConfig::default()
      });

      // Always ensure executable_path is set to the user's binary location
      // Pass upstream proxy information to config for fingerprint generation
      if let Some(proxy_id_ref) = &proxy_id {
        if let Some(proxy_settings) = PROXY_MANAGER.get_proxy_settings_by_id(proxy_id_ref) {
          let proxy_url = if let (Some(username), Some(password)) =
            (&proxy_settings.username, &proxy_settings.password)
          {
            format!(
              "{}://{}:{}@{}:{}",
              proxy_settings.proxy_type.to_lowercase(),
              username,
              password,
              proxy_settings.host,
              proxy_settings.port
            )
          } else {
            format!(
              "{}://{}:{}",
              proxy_settings.proxy_type.to_lowercase(),
              proxy_settings.host,
              proxy_settings.port
            )
          };
          config.proxy = Some(proxy_url);
          log::info!(
            "Using upstream proxy for Wayfern fingerprint generation: {}://{}:{}",
            proxy_settings.proxy_type.to_lowercase(),
            proxy_settings.host,
            proxy_settings.port
          );
        }
      }

      // Generate fingerprint if not already provided
      if config.fingerprint.is_none() {
        log::info!("Generating fingerprint for Wayfern profile: {name}");

        // Create a temporary profile for fingerprint generation
        let temp_profile = BrowserProfile {
          id: uuid::Uuid::new_v4(),
          name: name.to_string(),
          browser: browser.to_string(),
          version: version.to_string(),
          proxy_id: proxy_id.clone(),
          vpn_id: None,
          launch_hook: launch_hook.clone(),
          process_id: None,
          last_launch: None,
          release_type: release_type.to_string(),
          camoufox_config: None,
          wayfern_config: None,
          group_id: group_id.clone(),
          tags: Vec::new(),
          note: None,
          sync_mode: SyncMode::Disabled,
          encryption_salt: None,
          last_sync: None,
          host_os: None,
          ephemeral: false,
          extension_group_id: None,
          proxy_bypass_rules: Vec::new(),
          created_by_id: None,
          created_by_email: None,
          dns_blocklist: None,
          password_protected: false,
          created_at: None,
          updated_at: None,
        };

        match self
          .wayfern_manager
          .generate_fingerprint_config(app_handle, &temp_profile, &config)
          .await
        {
          Ok(generated_fingerprint) => {
            config.fingerprint = Some(generated_fingerprint);
            log::info!("Successfully generated fingerprint for Wayfern profile: {name}");
          }
          Err(e) => {
            return Err(
              format!("Failed to generate fingerprint for Wayfern profile '{name}': {e}").into(),
            );
          }
        }
      } else {
        log::info!("Using provided fingerprint for Wayfern profile: {name}");
      }

      // Record which proxy/geoip the fingerprint's location data was computed
      // for. On launch this is compared against the profile's current routing
      // so a proxy that was changed after creation triggers a location refresh
      // instead of showing a stale timezone.
      config.geo_proxy_signature = Some(
        crate::browser::wayfern_manager::WayfernManager::geo_signature(
          proxy_id
            .as_ref()
            .and_then(|id| PROXY_MANAGER.get_proxy_settings_by_id(id))
            .as_ref(),
          None,
          config.geoip.as_ref(),
        ),
      );

      // Clear the proxy from config after fingerprint generation
      config.proxy = None;

      Some(config)
    } else {
      wayfern_config.clone()
    };

    let profile = BrowserProfile {
      id: profile_id,
      name: name.to_string(),
      browser: browser.to_string(),
      version: version.to_string(),
      proxy_id: proxy_id.clone(),
      vpn_id: vpn_id.clone(),
      launch_hook,
      process_id: None,
      last_launch: None,
      release_type: release_type.to_string(),
      camoufox_config: final_camoufox_config,
      wayfern_config: final_wayfern_config,
      group_id: group_id.clone(),
      tags: Vec::new(),
      note: None,
      sync_mode: SyncMode::Disabled,
      encryption_salt: None,
      last_sync: None,
      host_os: Some(get_host_os()),
      ephemeral,
      extension_group_id: None,
      proxy_bypass_rules: Vec::new(),
      created_by_id: None,
      created_by_email: None,
      dns_blocklist,
      password_protected: false,
      created_at: Some(
        std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .map(|d| d.as_secs())
          .unwrap_or(0),
      ),
      updated_at: Some(crate::proxy::proxy_manager::now_secs()),
    };

    // Save profile info
    self.save_profile(&profile)?;

    // Verify the profile was saved correctly
    if !profile_file.exists() {
      return Err(format!("Failed to create profile file for '{name}'").into());
    }

    log::info!("Profile '{name}' created successfully with ID: {profile_id}");

    // `apply_proxy_settings_to_profile` writes a Firefox-style user.js
    // with the upstream proxy host. That is wrong for both supported
    // browser types:
    // - Camoufox: camoufox_manager rewrites user.js at every launch with
    //   the local donut-proxy host; writing the upstream here leaves a
    //   stale, wrong proxy in user.js until the next launch.
    // - Wayfern: Chromium gets its proxy via `--proxy-pac-url=` at launch
    //   (see wayfern_manager.rs) and never reads user.js.
    // So we only call it for any unrecognized browser type that might be
    // a true Firefox-family target (none currently). Ephemeral profiles
    // skip regardless because their data dir is created at launch time.
    if !ephemeral && !matches!(browser, "camoufox" | "wayfern") {
      if let Some(proxy_id_ref) = &proxy_id {
        if let Some(proxy_settings) = PROXY_MANAGER.get_proxy_settings_by_id(proxy_id_ref) {
          self.apply_proxy_settings_to_profile(&profile_data_dir, &proxy_settings, None)?;
        } else {
          // Proxy ID provided but not found, disable proxy
          self.disable_proxy_settings_in_profile(&profile_data_dir)?;
        }
      } else {
        // Create user.js with common Firefox preferences but no proxy
        self.disable_proxy_settings_in_profile(&profile_data_dir)?;
      }
    }

    // Emit profile creation event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn save_profile(&self, profile: &BrowserProfile) -> Result<(), Box<dyn std::error::Error>> {
    let profiles_dir = self.get_profiles_dir();
    let profile_uuid_dir = profiles_dir.join(profile.id.to_string());
    let profile_file = profile_uuid_dir.join("metadata.json");

    // Ensure the UUID directory exists
    create_dir_all(&profile_uuid_dir)?;

    let json = serde_json::to_string_pretty(profile)?;
    atomic_write(&profile_file, json.as_bytes())?;

    // Update tag suggestions after any save
    let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
      let _ = tm.rebuild_from_profiles(&self.list_profiles().unwrap_or_default());
    });

    Ok(())
  }

  pub fn list_profiles(&self) -> Result<Vec<BrowserProfile>, Box<dyn std::error::Error>> {
    let profiles_dir = self.get_profiles_dir();
    if !profiles_dir.exists() {
      return Ok(vec![]);
    }

    let mut profiles = Vec::new();
    for entry in fs::read_dir(profiles_dir)? {
      let entry = entry?;
      let path = entry.path();

      // Look for UUID directories containing metadata.json
      if path.is_dir() {
        let metadata_file = path.join("metadata.json");
        if metadata_file.exists() {
          let content = match fs::read_to_string(&metadata_file) {
            Ok(c) => c,
            Err(e) => {
              log::warn!(
                "Skipping profile at {}: failed to read metadata.json: {e}",
                path.display()
              );
              continue;
            }
          };
          let mut profile: BrowserProfile = match serde_json::from_str(&content) {
            Ok(p) => p,
            Err(e) => {
              log::warn!(
                "Skipping profile at {}: invalid metadata.json: {e}",
                path.display()
              );
              continue;
            }
          };

          // Backfill host_os from browser config for profiles created before
          // the field existed (or synced without it).
          if profile.host_os.is_none() {
            let inferred_os = profile.resolved_os().map(str::to_string);
            if let Some(os) = inferred_os {
              profile.host_os = Some(os);
              if let Ok(json) = serde_json::to_string_pretty(&profile) {
                let _ = atomic_write(&metadata_file, json.as_bytes());
              }
            }
          }

          profiles.push(profile);
        }
      }
    }

    Ok(profiles)
  }

  pub fn rename_profile(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    new_name: &str,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    // Check if new name already exists (case insensitive)
    let existing_profiles = self.list_profiles()?;
    if existing_profiles
      .iter()
      .any(|p| p.name.to_lowercase() == new_name.to_lowercase())
    {
      return Err(format!("Profile with name '{new_name}' already exists").into());
    }

    // Find the profile by ID
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let mut profile = existing_profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    // Update profile name (no need to move directories since we use UUID)
    profile.name = new_name.to_string();
    profile.updated_at = Some(crate::proxy::proxy_manager::now_secs());

    // Save profile with new name
    self.save_profile(&profile)?;

    crate::sync::queue_profile_sync_if_eligible(&profile);

    // Keep tag suggestions up to date after name change (rebuild from all profiles)
    let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
      let _ = tm.rebuild_from_profiles(&self.list_profiles().unwrap_or_default());
    });

    // Emit profile rename event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }

  pub fn delete_profile(
    &self,
    app_handle: &tauri::AppHandle,
    profile_id: &str,
  ) -> Result<(), Box<dyn std::error::Error>> {
    log::info!("Attempting to delete profile with ID: {profile_id}");

    // Find the profile by ID
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    // Check if browser is running (cross-OS profiles can't be running locally)
    if profile.process_id.is_some() && !profile.is_cross_os() {
      return Err(
        "Cannot delete profile while browser is running. Please stop the browser first.".into(),
      );
    }

    // Remember sync mode before deleting local files
    let was_sync_enabled = profile.is_sync_enabled();

    let profiles_dir = self.get_profiles_dir();
    let profile_uuid_dir = profiles_dir.join(profile.id.to_string());

    // Delete the entire UUID directory (contains both metadata.json and profile data)
    if profile_uuid_dir.exists() {
      log::info!("Deleting profile directory: {}", profile_uuid_dir.display());
      fs::remove_dir_all(&profile_uuid_dir)?;
      log::info!("Profile directory deleted successfully");
    }

    // Verify deletion was successful
    if profile_uuid_dir.exists() {
      return Err(format!("Failed to completely delete profile '{}'", profile.name).into());
    }

    log::info!(
      "Profile '{}' (ID: {}) deleted successfully",
      profile.name,
      profile_id
    );

    // If sync was enabled, also delete from S3
    if was_sync_enabled {
      let profile_id_owned = profile_id.to_string();
      let app_handle_clone = app_handle.clone();
      tauri::async_runtime::spawn(async move {
        match crate::sync::SyncEngine::create_from_settings(&app_handle_clone).await {
          Ok(engine) => {
            if let Err(e) = engine.delete_profile(&profile_id_owned).await {
              log::warn!(
                "Failed to delete profile {} from sync: {}",
                profile_id_owned,
                e
              );
            } else {
              log::info!("Profile {} deleted from S3 sync storage", profile_id_owned);
            }
          }
          Err(e) => {
            log::debug!("Sync not configured, skipping remote deletion: {}", e);
          }
        }
      });
    }

    // Rebuild tag suggestions after deletion
    let _ = crate::profile::tag_manager::TAG_MANAGER.lock().map(|tm| {
      let _ = tm.rebuild_from_profiles(&self.list_profiles().unwrap_or_default());
    });

    // Always perform cleanup after profile deletion to remove unused binaries
    if let Err(e) = DownloadedBrowsersRegistry::instance().cleanup_unused_binaries() {
      log::warn!("Warning: Failed to cleanup unused binaries after profile deletion: {e}");
    }

    // Emit profile deletion event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(())
  }

  /// Delete a profile from the local filesystem only, without triggering remote sync deletion.
  /// Used when a profile was deleted on another device and the local copy should be cleaned up.
  pub fn delete_profile_local_only(
    &self,
    profile_id: &str,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let profiles_dir = self.get_profiles_dir();
    let profile_dir = profiles_dir.join(profile_id);
    if profile_dir.exists() {
      fs::remove_dir_all(&profile_dir)?;
      log::info!("Deleted local profile {} (tombstoned remotely)", profile_id);
    }

    if let Err(e) =
      crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance()
        .cleanup_unused_binaries()
    {
      log::warn!("Failed to cleanup binaries after tombstone deletion: {e}");
    }

    let _ = crate::events::emit_empty("profiles-changed");
    Ok(())
  }

  pub fn update_profile_version(
    &self,
    _app_handle: &tauri::AppHandle,
    profile_id: &str,
    version: &str,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error>> {
    // Find the profile by ID
    let profile_uuid =
      uuid::Uuid::parse_str(profile_id).map_err(|_| format!("Invalid profile ID: {profile_id}"))?;
    let profiles = self.list_profiles()?;
    let mut profile = profiles
      .into_iter()
      .find(|p| p.id == profile_uuid)
      .ok_or_else(|| format!("Profile with ID '{profile_id}' not found"))?;

    // Check if the browser is currently running
    if profile.process_id.is_some() {
      return Err(
        "Cannot update version while browser is running. Please stop the browser first.".into(),
      );
    }

    // Verify the new version is downloaded
    let browser_type = BrowserType::from_str(&profile.browser)
      .map_err(|_| format!("Invalid browser type: {}", profile.browser))?;
    let browser = create_browser(browser_type.clone());
    let binaries_dir = self.get_binaries_dir();

    if !browser.is_version_downloaded(version, &binaries_dir) {
      return Err(format!("Browser version {version} is not downloaded").into());
    }

    // Update version
    profile.version = version.to_string();

    // Update the release_type based on the version and browser
    profile.release_type = if is_browser_version_nightly(&profile.browser, version, None) {
      "nightly".to_string()
    } else {
      "stable".to_string()
    };

    // Save the updated profile
    self.save_profile(&profile)?;

    // Emit profile update event
    if let Err(e) = events::emit_empty("profiles-changed") {
      log::warn!("Warning: Failed to emit profiles-changed event: {e}");
    }

    Ok(profile)
  }
}

include!("manager_group.rs");
include!("manager_config.rs");
include!("manager_launch.rs");
include!("manager_tests.rs");
include!("manager_commands.rs");
