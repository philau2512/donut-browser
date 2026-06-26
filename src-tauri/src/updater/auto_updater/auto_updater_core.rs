use crate::browser::browser_version_manager::{BrowserVersionInfo, BrowserVersionManager};
use crate::profile::{BrowserProfile, ProfileManager};
use crate::settings::settings_manager::SettingsManager;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateNotification {
  pub id: String,
  pub browser: String,
  pub current_version: String,
  pub new_version: String,
  pub affected_profiles: Vec<String>,
  pub is_stable_update: bool,
  pub timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AutoUpdateState {
  pub pending_updates: Vec<UpdateNotification>,
  pub disabled_browsers: HashSet<String>, // browsers disabled during update
  #[serde(default)]
  pub auto_update_downloads: HashSet<String>, // track auto-update downloads for toast suppression
  pub last_check_timestamp: u64,
}

pub struct AutoUpdater {
  browser_version_manager: &'static BrowserVersionManager,
  settings_manager: &'static SettingsManager,
  profile_manager: &'static ProfileManager,
}

impl AutoUpdater {
  fn new() -> Self {
    Self {
      browser_version_manager: BrowserVersionManager::instance(),
      settings_manager: SettingsManager::instance(),
      profile_manager: ProfileManager::instance(),
    }
  }

  pub fn instance() -> &'static AutoUpdater {
    &AUTO_UPDATER
  }

  /// Check for updates for all profiles
  pub async fn check_for_updates(
    &self,
  ) -> Result<Vec<UpdateNotification>, Box<dyn std::error::Error + Send + Sync>> {
    let mut notifications = Vec::new();
    let mut browser_versions: HashMap<String, Vec<BrowserVersionInfo>> = HashMap::new();

    // Group profiles by browser
    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;
    let mut browser_profiles: HashMap<String, Vec<BrowserProfile>> = HashMap::new();

    for profile in profiles {
      if profile.is_cross_os() {
        continue;
      }

      // Only check supported browsers
      if !self
        .browser_version_manager
        .is_browser_supported(&profile.browser)
        .unwrap_or(false)
      {
        continue;
      }

      browser_profiles
        .entry(profile.browser.clone())
        .or_default()
        .push(profile);
    }

    for (browser, profiles) in browser_profiles {
      // Always fetch fresh versions for update checks — stale cache would miss new releases
      let versions = match self
        .browser_version_manager
        .fetch_browser_versions_detailed(&browser, false)
        .await
      {
        Ok(versions) => versions,
        Err(e) => {
          log::warn!("Failed to fetch versions for {browser}: {e}, trying cache");
          // Fall back to cache if network fails
          if let Some(cached) = self
            .browser_version_manager
            .get_cached_browser_versions_detailed(&browser)
          {
            cached
          } else {
            continue;
          }
        }
      };

      browser_versions.insert(browser.clone(), versions.clone());

      // Check each profile for updates
      for profile in profiles {
        if let Some(update) = self.check_profile_update(&profile, &versions)? {
          notifications.push(update);
        }
      }
    }

    Ok(notifications)
  }

  pub async fn check_for_updates_with_progress(&self, app_handle: &tauri::AppHandle) {
    log::info!("Starting auto-update check with progress...");

    // Browser auto-updates are always enabled — the disable_auto_updates setting
    // only controls app self-updates, not browser version updates.

    // Check for browser updates and trigger auto-downloads
    match self.check_for_updates().await {
      Ok(update_notifications) => {
        // Group by browser+version to avoid duplicate downloads
        let grouped = self.group_update_notifications(update_notifications);
        if !grouped.is_empty() {
          log::info!("Found {} browser updates", grouped.len());

          for notification in grouped {
            log::info!(
              "Auto-updating {} to version {} ({} profiles)",
              notification.browser,
              notification.new_version,
              notification.affected_profiles.len()
            );

            let browser = notification.browser.clone();
            let new_version = notification.new_version.clone();
            let app_handle_clone = app_handle.clone();

            // Spawn async task to handle the download and auto-update
            tokio::spawn(async move {
              let registry =
                crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance(
                );

              // Skip if this browser-version pair is already being downloaded
              if crate::browser::downloader::is_downloading(&browser, &new_version) {
                log::info!(
                  "Browser {browser} {new_version} is already being downloaded, skipping duplicate"
                );
                return;
              }

              if registry.is_browser_downloaded(&browser, &new_version) {
                log::info!("Browser {browser} {new_version} already downloaded, proceeding to auto-update profiles");

                // Browser already exists, go straight to profile update
                match AutoUpdater::instance()
                  .auto_update_profile_versions(&app_handle_clone, &browser, &new_version)
                  .await
                {
                  Ok(updated_profiles) => {
                    if !updated_profiles.is_empty() {
                      log::info!(
                        "Auto-updated {} profiles to {browser} {new_version}: {:?}",
                        updated_profiles.len(),
                        updated_profiles
                      );
                    }
                  }
                  Err(e) => {
                    log::error!("Failed to auto-update profiles for {browser}: {e}");
                  }
                }
              } else {
                log::info!("Downloading browser {browser} version {new_version}...");

                // Download directly from Rust — download_browser_full already
                // auto-updates non-running profiles after successful download.
                match crate::browser::downloader::download_browser(
                  app_handle_clone,
                  browser.clone(),
                  new_version.clone(),
                )
                .await
                {
                  Ok(actual_version) => {
                    log::info!("Auto-download completed for {browser} {actual_version}");
                  }
                  Err(e) => {
                    log::error!("Failed to auto-download {browser} {new_version}: {e}");
                  }
                }
              }
            });
          }
        } else {
          log::info!("No browser updates needed");
        }
      }
      Err(e) => {
        log::error!("Failed to check for browser updates: {e}");
      }
    }

    // Also update any profiles that can be bumped to an already-installed newer version.
    // This handles cases where a version was downloaded but profiles weren't updated
    // (e.g., they were running at the time, or the update was missed).
    match self.update_profiles_to_latest_installed(app_handle) {
      Ok(updated) => {
        if !updated.is_empty() {
          log::info!(
            "Updated {} profiles to latest installed versions: {:?}",
            updated.len(),
            updated
          );
        }
      }
      Err(e) => {
        log::error!("Failed to update profiles to latest installed versions: {e}");
      }
    }
  }

  /// Check if a specific profile has an available update
  pub(crate) fn check_profile_update(
    &self,
    profile: &BrowserProfile,
    available_versions: &[BrowserVersionInfo],
  ) -> Result<Option<UpdateNotification>, Box<dyn std::error::Error + Send + Sync>> {
    let current_version = &profile.version;
    let is_current_nightly =
      crate::api::api_client::is_browser_version_nightly(&profile.browser, current_version, None);

    // Find the best available update
    let best_update = available_versions
      .iter()
      .filter(|v| {
        // Only consider versions newer than current
        self.is_version_newer(&v.version, current_version)
          && crate::api::api_client::is_browser_version_nightly(&profile.browser, &v.version, None)
            == is_current_nightly
      })
      .max_by(|a, b| self.compare_versions(&a.version, &b.version));

    if let Some(update_version) = best_update {
      let notification = UpdateNotification {
        id: format!(
          "{}_{}_to_{}",
          profile.browser, current_version, update_version.version
        ),
        browser: profile.browser.clone(),
        current_version: current_version.clone(),
        new_version: update_version.version.clone(),
        affected_profiles: vec![profile.name.clone()],
        is_stable_update: !update_version.is_prerelease,
        timestamp: std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap()
          .as_secs(),
      };
      Ok(Some(notification))
    } else {
      Ok(None)
    }
  }

  /// Group update notifications by browser and version
  pub fn group_update_notifications(
    &self,
    notifications: Vec<UpdateNotification>,
  ) -> Vec<UpdateNotification> {
    let mut grouped: HashMap<String, UpdateNotification> = HashMap::new();

    for notification in notifications {
      let key = format!("{}_{}", notification.browser, notification.new_version);

      if let Some(existing) = grouped.get_mut(&key) {
        // Merge affected profiles
        existing
          .affected_profiles
          .extend(notification.affected_profiles);
        existing.affected_profiles.sort();
        existing.affected_profiles.dedup();
      } else {
        grouped.insert(key, notification);
      }
    }

    let mut result: Vec<UpdateNotification> = grouped.into_values().collect();

    // Sort by priority: stable updates first, then by timestamp
    result.sort_by(|a, b| match (a.is_stable_update, b.is_stable_update) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => b.timestamp.cmp(&a.timestamp),
    });

    result
  }

  /// Automatically update all affected profile versions after browser download
  pub async fn auto_update_profile_versions(
    &self,
    app_handle: &tauri::AppHandle,
    browser: &str,
    new_version: &str,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    let mut updated_profiles = Vec::new();

    // Find all profiles for this browser that should be updated
    for profile in profiles {
      if profile.browser == browser {
        if profile.is_cross_os() {
          continue;
        }

        // Check if profile is currently running
        if profile.process_id.is_some() {
          // Store as pending update so it gets applied when browser closes
          log::info!(
            "Profile {} is running, storing pending update {} -> {}",
            profile.name,
            profile.version,
            new_version
          );
          let mut state = self.load_auto_update_state().unwrap_or_default();
          let notification = UpdateNotification {
            id: format!("{}_{}_to_{}", browser, profile.version, new_version),
            browser: browser.to_string(),
            current_version: profile.version.clone(),
            new_version: new_version.to_string(),
            affected_profiles: vec![profile.name.clone()],
            is_stable_update: true,
            timestamp: std::time::SystemTime::now()
              .duration_since(std::time::UNIX_EPOCH)
              .unwrap_or_default()
              .as_secs(),
          };
          // Add if not already pending
          if !state
            .pending_updates
            .iter()
            .any(|u| u.id == notification.id)
          {
            state.pending_updates.push(notification);
            let _ = self.save_auto_update_state(&state);
          }
          continue;
        }

        // Check if this is an update (newer version)
        if self.is_version_newer(new_version, &profile.version) {
          // Update the profile version
          match self.profile_manager.update_profile_version(
            app_handle,
            &profile.id.to_string(),
            new_version,
          ) {
            Ok(_) => {
              updated_profiles.push(profile.name);
            }
            Err(e) => {
              log::error!("Failed to update profile {}: {}", profile.name, e);
            }
          }
        }
      }
    }

    Ok(updated_profiles)
  }

  /// Complete browser update process with auto-update of profile versions
  pub async fn complete_browser_update_with_auto_update(
    &self,
    app_handle: &tauri::AppHandle,
    browser: &str,
    new_version: &str,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    // Auto-update profile versions first
    let updated_profiles = self
      .auto_update_profile_versions(app_handle, browser, new_version)
      .await?;

    // Remove browser from disabled list and clean up auto-update tracking
    let mut state = self.load_auto_update_state()?;
    state.disabled_browsers.remove(browser);
    let download_key = format!("{browser}-{new_version}");
    state.auto_update_downloads.remove(&download_key);
    self.save_auto_update_state(&state)?;

    Ok(updated_profiles)
  }

  /// Dismiss update notification
  pub fn dismiss_update_notification(
    &self,
    notification_id: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut state = self.load_auto_update_state()?;
    state.pending_updates.retain(|n| n.id != notification_id);
    self.save_auto_update_state(&state)?;
    Ok(())
  }

  pub(crate) fn is_version_newer(&self, version1: &str, version2: &str) -> bool {
    crate::api::api_client::is_version_newer(version1, version2)
  }

  pub(crate) fn compare_versions(&self, version1: &str, version2: &str) -> std::cmp::Ordering {
    crate::api::api_client::compare_versions(version1, version2)
  }

  pub(crate) fn get_auto_update_state_file(&self) -> PathBuf {
    self
      .settings_manager
      .get_settings_dir()
      .join("auto_update_state.json")
  }

  pub fn load_auto_update_state(
    &self,
  ) -> Result<AutoUpdateState, Box<dyn std::error::Error + Send + Sync>> {
    let state_file = self.get_auto_update_state_file();

    if !state_file.exists() {
      return Ok(AutoUpdateState::default());
    }

    let content = fs::read_to_string(state_file)?;
    let state: AutoUpdateState = serde_json::from_str(&content)?;
    Ok(state)
  }

  pub fn save_auto_update_state(
    &self,
    state: &AutoUpdateState,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let settings_dir = self.settings_manager.get_settings_dir();
    std::fs::create_dir_all(&settings_dir)?;

    let state_file = self.get_auto_update_state_file();
    let json = serde_json::to_string_pretty(state)?;
    fs::write(state_file, json)?;

    Ok(())
  }

  /// Get pending update versions for a specific browser
  /// Returns a set of (browser, version) pairs that have pending updates
  pub fn get_pending_update_versions(
    &self,
  ) -> Result<std::collections::HashSet<(String, String)>, Box<dyn std::error::Error + Send + Sync>>
  {
    let state = self.load_auto_update_state()?;
    let mut pending_versions = std::collections::HashSet::new();

    for update in &state.pending_updates {
      pending_versions.insert((update.browser.clone(), update.new_version.clone()));
    }

    Ok(pending_versions)
  }

  /// Get pending update for a specific browser version if it exists
  pub fn get_pending_update(
    &self,
    browser: &str,
    current_version: &str,
  ) -> Result<Option<UpdateNotification>, Box<dyn std::error::Error + Send + Sync>> {
    let state = self.load_auto_update_state()?;

    for update in &state.pending_updates {
      if update.browser == browser && update.current_version == current_version {
        return Ok(Some(update.clone()));
      }
    }

    Ok(None)
  }

  /// Get the latest installed version for a browser from the downloaded browsers registry
  pub fn get_latest_installed_version(&self, browser: &str) -> Option<String> {
    let registry =
      crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance();
    let versions = registry.get_downloaded_versions(browser);
    versions
      .into_iter()
      .filter(|v| registry.is_browser_downloaded(browser, v))
      .max_by(|a, b| self.compare_versions(a, b))
  }

  /// Update a single profile to the latest installed version for its browser.
  /// Used when a browser closes to ensure it's on the latest version.
  pub fn update_profile_to_latest_installed(
    &self,
    app_handle: &tauri::AppHandle,
    profile: &crate::profile::BrowserProfile,
  ) -> Option<crate::profile::BrowserProfile> {
    let latest = self.get_latest_installed_version(&profile.browser)?;

    if !self.is_version_newer(&latest, &profile.version) {
      return None;
    }

    // Only update stable->stable and nightly->nightly
    let is_profile_nightly =
      crate::api::api_client::is_browser_version_nightly(&profile.browser, &profile.version, None);
    let is_latest_nightly =
      crate::api::api_client::is_browser_version_nightly(&profile.browser, &latest, None);
    if is_profile_nightly != is_latest_nightly {
      return None;
    }

    match self
      .profile_manager
      .update_profile_version(app_handle, &profile.id.to_string(), &latest)
    {
      Ok(updated) => {
        log::info!(
          "Updated profile {} from {} {} to latest installed version {}",
          profile.name,
          profile.browser,
          profile.version,
          latest
        );
        Some(updated)
      }
      Err(e) => {
        log::error!(
          "Failed to update profile {} to latest installed version: {e}",
          profile.name
        );
        None
      }
    }
  }

  /// Update all non-running profiles to the latest installed version for each browser.
  /// Handles the case where a newer version was downloaded but profiles weren't updated.
  pub fn update_profiles_to_latest_installed(
    &self,
    app_handle: &tauri::AppHandle,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let registry =
      crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance();
    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    let mut all_updated = Vec::new();

    // Group profiles by browser
    let mut browser_profiles: HashMap<String, Vec<BrowserProfile>> = HashMap::new();
    for profile in profiles {
      if profile.is_cross_os() {
        continue;
      }
      browser_profiles
        .entry(profile.browser.clone())
        .or_default()
        .push(profile);
    }

    for (browser, profiles) in browser_profiles {
      let installed_versions = registry.get_downloaded_versions(&browser);
      if installed_versions.is_empty() {
        continue;
      }

      // Find the latest installed version that actually exists on disk
      let latest_installed = installed_versions
        .iter()
        .filter(|v| registry.is_browser_downloaded(&browser, v))
        .max_by(|a, b| self.compare_versions(a, b));

      let latest_version = match latest_installed {
        Some(v) => v.clone(),
        None => continue,
      };

      for profile in profiles {
        if profile.process_id.is_some() {
          continue;
        }

        if !self.is_version_newer(&latest_version, &profile.version) {
          continue;
        }

        // Only update stable->stable and nightly->nightly
        let is_profile_nightly =
          crate::api::api_client::is_browser_version_nightly(&browser, &profile.version, None);
        let is_latest_nightly =
          crate::api::api_client::is_browser_version_nightly(&browser, &latest_version, None);
        if is_profile_nightly != is_latest_nightly {
          continue;
        }

        match self.profile_manager.update_profile_version(
          app_handle,
          &profile.id.to_string(),
          &latest_version,
        ) {
          Ok(_) => {
            log::info!(
              "Updated profile {} from {} {} to latest installed version {}",
              profile.name,
              browser,
              profile.version,
              latest_version
            );
            all_updated.push(profile.name);
          }
          Err(e) => {
            log::error!("Failed to update profile {}: {e}", profile.name);
          }
        }
      }
    }

    Ok(all_updated)
  }
}

// Global singleton instance
lazy_static::lazy_static! {
  pub(super) static ref AUTO_UPDATER: AutoUpdater = AutoUpdater::new();
}
