use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::profile::{BrowserProfile, ProfileManager};
use crate::updater::geoip_downloader::GeoIPDownloader;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadedBrowserInfo {
  pub browser: String,
  pub version: String,
  pub file_path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct RegistryData {
  pub browsers: HashMap<String, HashMap<String, DownloadedBrowserInfo>>, // browser -> version -> info
}

pub struct DownloadedBrowsersRegistry {
  data: Mutex<RegistryData>,
  profile_manager: &'static ProfileManager,
  auto_updater: &'static crate::updater::auto_updater::AutoUpdater,
  geoip_downloader: &'static GeoIPDownloader,
}

impl DownloadedBrowsersRegistry {
  fn new() -> Self {
    Self {
      data: Mutex::new(RegistryData::default()),
      profile_manager: ProfileManager::instance(),
      auto_updater: crate::updater::auto_updater::AutoUpdater::instance(),
      geoip_downloader: GeoIPDownloader::instance(),
    }
  }

  pub fn instance() -> &'static DownloadedBrowsersRegistry {
    &DOWNLOADED_BROWSERS_REGISTRY
  }

  pub fn load(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let registry_path = Self::get_registry_path()?;

    if !registry_path.exists() {
      return Ok(());
    }

    let content = fs::read_to_string(&registry_path)?;
    let registry_data: RegistryData = serde_json::from_str(&content)?;

    let mut data = self.data.lock().unwrap();
    *data = registry_data;
    Ok(())
  }

  pub fn save(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let registry_path = Self::get_registry_path()?;

    // Ensure parent directory exists
    if let Some(parent) = registry_path.parent() {
      fs::create_dir_all(parent)?;
    }

    let data = self.data.lock().unwrap();
    let content = serde_json::to_string_pretty(&*data)?;
    fs::write(&registry_path, content)?;
    Ok(())
  }

  fn get_registry_path() -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    Ok(crate::settings::app_dirs::data_subdir().join("downloaded_browsers.json"))
  }

  pub fn add_browser(&self, info: DownloadedBrowserInfo) {
    let mut data = self.data.lock().unwrap();
    data
      .browsers
      .entry(info.browser.clone())
      .or_default()
      .insert(info.version.clone(), info);
  }

  pub fn remove_browser(&self, browser: &str, version: &str) -> Option<DownloadedBrowserInfo> {
    let mut data = self.data.lock().unwrap();
    data.browsers.get_mut(browser)?.remove(version)
  }

  /// Check if browser is registered in the registry (without disk validation)
  /// This method only checks the in-memory registry and does not validate file existence
  pub fn is_browser_registered(&self, browser: &str, version: &str) -> bool {
    let data = self.data.lock().unwrap();
    data
      .browsers
      .get(browser)
      .and_then(|versions| versions.get(version))
      .is_some()
  }

  /// Check if browser is downloaded and files exist on disk
  /// This method validates both registry entry and actual file existence
  pub fn is_browser_downloaded(&self, browser: &str, version: &str) -> bool {
    use crate::browser::{create_browser, BrowserType};

    // First check if browser is registered
    if !self.is_browser_registered(browser, version) {
      return false;
    }

    // Always check if files actually exist on disk
    let browser_type = match BrowserType::from_str(browser) {
      Ok(bt) => bt,
      Err(_) => {
        log::info!("Invalid browser type: {browser}");
        return false;
      }
    };
    let browser_instance = create_browser(browser_type.clone());

    let binaries_dir = crate::settings::app_dirs::binaries_dir();

    let files_exist = browser_instance.is_version_downloaded(version, &binaries_dir);

    // If files don't exist but registry thinks they do, clean up the registry
    if !files_exist {
      log::info!("Cleaning up stale registry entry for {browser} {version}");
      self.remove_browser(browser, version);
      let _ = self.save(); // Don't fail if save fails, just log
    }

    files_exist
  }

  pub fn get_downloaded_versions(&self, browser: &str) -> Vec<String> {
    let data = self.data.lock().unwrap();
    data
      .browsers
      .get(browser)
      .map(|versions| versions.keys().cloned().collect())
      .unwrap_or_default()
  }

  pub fn mark_download_started(&self, browser: &str, version: &str, file_path: PathBuf) {
    // Only mark download started, don't add to registry yet
    // The browser will be added to registry only after verification succeeds
    log::info!(
      "Marking download started for {}:{} at {}",
      browser,
      version,
      file_path.display()
    );
  }

  pub fn mark_download_completed(
    &self,
    browser: &str,
    version: &str,
    file_path: PathBuf,
  ) -> Result<(), String> {
    // Only mark as completed after verification succeeds
    let info = DownloadedBrowserInfo {
      browser: browser.to_string(),
      version: version.to_string(),
      file_path,
    };
    self.add_browser(info);
    log::info!("Browser {browser}:{version} successfully added to registry after verification");
    Ok(())
  }

  pub fn cleanup_failed_download(
    &self,
    browser: &str,
    version: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(info) = self.remove_browser(browser, version) {
      // Clean up extracted binaries but preserve downloaded archives
      if info.file_path.exists() {
        if info.file_path.is_dir() {
          // Allowed archive extensions to preserve
          let archive_exts = [
            "zip", "dmg", "tar.xz", "tar.gz", "tar.bz2", "AppImage", "exe", "pkg", "msi",
          ];

          for entry in fs::read_dir(&info.file_path)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
              fs::remove_dir_all(&path)?;
              continue;
            }

            // For files, preserve if they look like downloaded archives/installers
            let keep = path
              .file_name()
              .and_then(|n| n.to_str())
              .map(|name| {
                // Match suffixes (handles multi-part extensions like .tar.xz)
                archive_exts
                  .iter()
                  .any(|ext| name.to_lowercase().ends_with(&ext.to_lowercase()))
              })
              .unwrap_or(false);

            if !keep {
              fs::remove_file(&path)?;
            }
          }
        } else {
          // It's a file. If it's not an archive, remove it; otherwise preserve it.
          let file_name = info
            .file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
          let archive_exts = [
            "zip", "dmg", "tar.xz", "tar.gz", "tar.bz2", "AppImage", "exe", "pkg", "msi",
          ];
          let is_archive = archive_exts
            .iter()
            .any(|ext| file_name.to_lowercase().ends_with(&ext.to_lowercase()));
          if !is_archive {
            fs::remove_file(&info.file_path)?;
          }
        }
      }
    }
    Ok(())
  }

  /// Find and remove unused browser binaries that are not referenced by any active profiles
  fn cleanup_unused_binaries_internal(
    &self,
    active_profiles: &[(String, String)], // (browser, version) pairs
    running_profiles: &[(String, String)], // (browser, version) pairs for running profiles
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let active_set: std::collections::HashSet<(String, String)> =
      active_profiles.iter().cloned().collect();
    let running_set: std::collections::HashSet<(String, String)> =
      running_profiles.iter().cloned().collect();
    let mut cleaned_up = Vec::new();

    // Get pending update versions from auto updater
    let pending_updates = match self.auto_updater.get_pending_update_versions() {
      Ok(updates) => updates,
      Err(e) => {
        log::warn!("Warning: Failed to get pending updates for cleanup: {e}");
        std::collections::HashSet::new()
      }
    };

    // Collect all downloaded browsers that are not in active profiles
    let mut to_remove = Vec::new();
    {
      let data = self.data.lock().unwrap();
      for (browser, versions) in &data.browsers {
        for version in versions.keys() {
          let browser_version = (browser.clone(), version.clone());

          // Don't remove if it's used by any active profile
          if active_set.contains(&browser_version) {
            log::info!("Keeping: {browser} {version} (in use by profile)");
            continue;
          }

          // Don't remove if it's currently running (even if not in active profiles)
          if running_set.contains(&browser_version) {
            log::info!("Keeping: {browser} {version} (currently running)");
            continue;
          }

          // Don't remove if this version has a pending update for a running profile
          // This handles the case where a running profile has an update downloaded but not yet applied
          if pending_updates.contains(&browser_version) {
            // Check if there are any running profiles for this browser that could be updated
            let has_running_profile_for_browser =
              running_profiles.iter().any(|(b, _)| b == browser);
            if has_running_profile_for_browser {
              log::info!("Keeping: {browser} {version} (pending update for running profile)");
              continue;
            }
          }

          // Mark for removal
          to_remove.push(browser_version);
          log::info!("Marking for removal: {browser} {version} (not used by any profile)");
        }
      }
    }

    // For each browser where every registered version would be removed (no
    // profile uses any), keep the newest one by semver. Without this, the
    // version preserved depends on HashMap iteration order, so a freshly
    // downloaded version can be deleted in favor of an older orphan — leaving
    // the UI stuck on "needs to be downloaded".
    {
      let data = self.data.lock().unwrap();
      let mut removal_versions_by_browser: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
      for (browser, version) in &to_remove {
        removal_versions_by_browser
          .entry(browser.clone())
          .or_default()
          .push(version.clone());
      }
      let mut keep_per_browser: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
      for (browser, versions) in &removal_versions_by_browser {
        let total = data
          .browsers
          .get(browser.as_str())
          .map(|v| v.len())
          .unwrap_or(0);
        if versions.len() >= total {
          if let Some(latest) = versions
            .iter()
            .max_by(|a, b| crate::api::api_client::compare_versions(a, b))
          {
            keep_per_browser.insert(browser.clone(), latest.clone());
          }
        }
      }
      drop(data);
      to_remove.retain(|(browser, version)| {
        if keep_per_browser
          .get(browser)
          .is_some_and(|keep| keep == version)
        {
          log::info!("Keeping latest available version: {browser} {version}");
          return false;
        }
        true
      });
    }

    // Remove unused binaries and their version folders
    for (browser, version) in to_remove {
      if let Err(e) = self.cleanup_failed_download(&browser, &version) {
        log::error!("Failed to cleanup unused binary {browser}:{version}: {e}");
      } else {
        // After removing the binary, also remove the empty version folder
        if let Err(e) = self.remove_empty_version_folder(&browser, &version) {
          log::error!("Failed to remove empty version folder for {browser}:{version}: {e}");
        }
        cleaned_up.push(format!("{browser} {version}"));
        log::info!("Successfully removed unused binary: {browser} {version}");
      }
    }

    if cleaned_up.is_empty() {
      log::info!("No unused binaries found to clean up");
    } else {
      log::info!("Cleaned up {} unused binaries", cleaned_up.len());
    }

    Ok(cleaned_up)
  }

  /// Get all browsers and versions referenced by active profiles
  pub fn get_active_browser_versions(
    &self,
    profiles: &[crate::profile::BrowserProfile],
  ) -> Vec<(String, String)> {
    profiles
      .iter()
      .map(|profile| (profile.browser.clone(), profile.version.clone()))
      .collect()
  }

  /// Verify that all registered browsers actually exist on disk and clean up stale entries
  pub fn verify_and_cleanup_stale_entries(
    &self,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    use crate::browser::{create_browser, BrowserType};
    let mut cleaned_up = Vec::new();
    let binaries_dir = self.profile_manager.get_binaries_dir();

    let browsers_to_check: Vec<(String, String)> = {
      let data = self.data.lock().unwrap();
      data
        .browsers
        .iter()
        .flat_map(|(browser, versions)| {
          versions
            .keys()
            .map(|version| (browser.clone(), version.clone()))
        })
        .collect()
    };

    for (browser_str, version) in browsers_to_check {
      if let Ok(browser_type) = BrowserType::from_str(&browser_str) {
        let browser = create_browser(browser_type);
        if !browser.is_version_downloaded(&version, &binaries_dir) {
          // Files don't exist, remove from registry
          if let Some(_removed) = self.remove_browser(&browser_str, &version) {
            cleaned_up.push(format!("{browser_str} {version}"));
            log::info!("Removed stale registry entry for {browser_str} {version}");
          }
        }
      }
    }

    if !cleaned_up.is_empty() {
      self.save()?;
    }

    Ok(cleaned_up)
  }

  /// Get all browsers and versions that are currently running
  pub fn get_running_browser_versions(
    &self,
    profiles: &[crate::profile::BrowserProfile],
  ) -> Vec<(String, String)> {
    profiles
      .iter()
      .filter(|profile| profile.process_id.is_some())
      .map(|profile| (profile.browser.clone(), profile.version.clone()))
      .collect()
  }

  /// Scan the binaries directory and sync with registry
  /// This ensures the registry reflects what's actually on disk
  pub fn sync_with_binaries_directory(
    &self,
    binaries_dir: &std::path::Path,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let mut changes = Vec::new();

    if !binaries_dir.exists() {
      return Ok(changes);
    }

    // Scan for actual browser directories
    for browser_entry in fs::read_dir(binaries_dir)? {
      let browser_entry = browser_entry?;
      let browser_path = browser_entry.path();

      if !browser_path.is_dir() {
        continue;
      }

      let browser_name = browser_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

      if browser_name.is_empty() || browser_name.starts_with('.') {
        continue;
      }

      // Scan for version directories within this browser
      for version_entry in fs::read_dir(&browser_path)? {
        let version_entry = version_entry?;
        let version_path = version_entry.path();

        if !version_path.is_dir() {
          continue;
        }

        let version_name = version_path
          .file_name()
          .and_then(|n| n.to_str())
          .unwrap_or("");

        if version_name.is_empty() || version_name.starts_with('.') {
          continue;
        }

        // Only add to registry if this looks like a valid installed browser, not just an archive
        if !self.is_browser_downloaded(browser_name, version_name) {
          if let Ok(browser_type) = crate::browser::BrowserType::from_str(browser_name) {
            let browser = crate::browser::create_browser(browser_type);
            if browser.is_version_downloaded(version_name, binaries_dir) {
              let info = DownloadedBrowserInfo {
                browser: browser_name.to_string(),
                version: version_name.to_string(),
                file_path: version_path.clone(),
              };
              self.add_browser(info);
              changes.push(format!("Added {browser_name} {version_name} to registry"));
            }
          }
        }
      }
    }

    if !changes.is_empty() {
      self.save()?;
    }

    Ok(changes)
  }

  /// Comprehensive cleanup that removes unused binaries and syncs registry
  fn comprehensive_cleanup(
    &self,
    binaries_dir: &std::path::Path,
    active_profiles: &[(String, String)],
    running_profiles: &[(String, String)],
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let mut cleanup_results = Vec::new();

    // First, sync registry with actual binaries on disk
    let sync_results = self.sync_with_binaries_directory(binaries_dir)?;
    cleanup_results.extend(sync_results);

    // Then perform the regular cleanup
    let regular_cleanup =
      self.cleanup_unused_binaries_internal(active_profiles, running_profiles)?;
    cleanup_results.extend(regular_cleanup);

    // Verify and cleanup stale entries
    let stale_cleanup = self.verify_and_cleanup_stale_entries()?;
    cleanup_results.extend(stale_cleanup);

    // Clean up any remaining empty folders
    let empty_folder_cleanup = self.cleanup_empty_folders(binaries_dir)?;
    cleanup_results.extend(empty_folder_cleanup);

    if !cleanup_results.is_empty() {
      self.save()?;
    }

    Ok(cleanup_results)
  }

  /// Remove empty version folder after cleanup
  fn remove_empty_version_folder(
    &self,
    browser: &str,
    version: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Never remove a directory if a download is in progress for this browser/version
    if crate::browser::downloader::is_downloading(browser, version) {
      return Ok(());
    }

    let binaries_dir = crate::settings::app_dirs::binaries_dir();

    let version_dir = binaries_dir.join(browser).join(version);

    // Only remove if the directory exists and is empty
    if version_dir.exists() && version_dir.is_dir() {
      if let Ok(mut entries) = fs::read_dir(&version_dir) {
        if entries.next().is_none() {
          // Directory is empty, remove it
          fs::remove_dir(&version_dir)?;
          log::info!("Removed empty version folder: {}", version_dir.display());

          // Also check if the browser folder is now empty and remove it too
          let browser_dir = binaries_dir.join(browser);
          if browser_dir.exists() && browser_dir.is_dir() {
            if let Ok(mut browser_entries) = fs::read_dir(&browser_dir) {
              if browser_entries.next().is_none() {
                fs::remove_dir(&browser_dir)?;
                log::info!("Removed empty browser folder: {}", browser_dir.display());
              }
            }
          }
        }
      }
    }

    Ok(())
  }
}

include!("downloaded_browsers_registry_cleanup.rs");
include!("downloaded_browsers_registry_tests.rs");
