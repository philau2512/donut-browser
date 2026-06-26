impl DownloadedBrowsersRegistry {
  /// Clean up existing empty version and browser folders
  pub fn cleanup_empty_folders(
    &self,
    binaries_dir: &std::path::Path,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let mut cleaned_up = Vec::new();

    if !binaries_dir.exists() {
      return Ok(cleaned_up);
    }

    // Scan for browser directories
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

      let mut empty_version_dirs = Vec::new();
      let mut has_non_empty_versions = false;

      // Scan for version directories within this browser
      for version_entry in fs::read_dir(&browser_path)? {
        let version_entry = version_entry?;
        let version_path = version_entry.path();

        if !version_path.is_dir() {
          has_non_empty_versions = true; // Non-directory files count as non-empty
          continue;
        }

        let version_name = version_path
          .file_name()
          .and_then(|n| n.to_str())
          .unwrap_or("");

        if version_name.is_empty() || version_name.starts_with('.') {
          continue;
        }

        // Skip if a download is in progress for this browser/version
        if crate::browser::downloader::is_downloading(browser_name, version_name) {
          has_non_empty_versions = true;
          continue;
        }

        // Check if version directory is empty
        match fs::read_dir(&version_path) {
          Ok(mut entries) => {
            if entries.next().is_none() {
              // Directory is empty
              empty_version_dirs.push((version_path.clone(), version_name.to_string()));
            } else {
              has_non_empty_versions = true;
            }
          }
          Err(_) => {
            has_non_empty_versions = true; // Assume non-empty if we can't read
          }
        }
      }

      // Remove empty version directories
      for (version_path, version_name) in empty_version_dirs {
        if let Err(e) = fs::remove_dir(&version_path) {
          log::error!(
            "Failed to remove empty version folder {}: {e}",
            version_path.display()
          );
        } else {
          cleaned_up.push(format!(
            "Removed empty version folder: {browser_name}/{version_name}"
          ));
          log::info!("Removed empty version folder: {}", version_path.display());
        }
      }

      // If browser directory is now empty, remove it too
      if !has_non_empty_versions {
        if let Ok(mut entries) = fs::read_dir(&browser_path) {
          if entries.next().is_none() {
            if let Err(e) = fs::remove_dir(&browser_path) {
              log::error!(
                "Failed to remove empty browser folder {}: {e}",
                browser_path.display()
              );
            } else {
              cleaned_up.push(format!("Removed empty browser folder: {browser_name}"));
              log::info!("Removed empty browser folder: {}", browser_path.display());
            }
          }
        }
      }
    }

    Ok(cleaned_up)
  }

  /// Consolidate browser versions - keep only the latest version per browser
  pub fn consolidate_browser_versions(
    &self,
    app_handle: &tauri::AppHandle,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Starting browser version consolidation...");

    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    let binaries_dir = self.profile_manager.get_binaries_dir();
    let mut consolidated = Vec::new();

    // Group profiles by browser
    let mut browser_profiles: std::collections::HashMap<String, Vec<&BrowserProfile>> =
      std::collections::HashMap::new();
    for profile in &profiles {
      browser_profiles
        .entry(profile.browser.clone())
        .or_default()
        .push(profile);
    }

    for (browser_name, browser_profiles) in browser_profiles.iter() {
      // Find the latest version among all profiles for this browser that actually exists on disk
      let mut available_versions: Vec<String> = Vec::new();

      for profile in browser_profiles {
        // Only consider versions that actually exist on disk
        let browser_type = match crate::browser::BrowserType::from_str(browser_name) {
          Ok(bt) => bt,
          Err(_) => continue,
        };
        let browser = crate::browser::create_browser(browser_type.clone());

        if browser.is_version_downloaded(&profile.version, &binaries_dir) {
          available_versions.push(profile.version.clone());
        } else {
          log::info!(
            "Profile '{}' references version {} that doesn't exist on disk",
            profile.name,
            profile.version
          );
        }
      }

      if available_versions.is_empty() {
        log::info!("No available versions found for {browser_name}, skipping consolidation");
        continue;
      }

      // Sort available versions to find the latest
      available_versions.sort_by(|a, b| {
        // Sort versions using semantic versioning logic
        crate::api::api_client::compare_versions(b, a)
      });

      let latest_version = &available_versions[0];
      log::info!("Latest available version for {browser_name}: {latest_version}");

      // Check which profiles need to be updated to the latest version
      let mut profiles_to_update = Vec::new();
      let mut older_versions_to_remove = std::collections::HashSet::<String>::new();

      for profile in browser_profiles {
        if profile.version != *latest_version {
          // Only update if profile is not currently running
          if profile.process_id.is_none() {
            profiles_to_update.push(profile);
            older_versions_to_remove.insert(profile.version.clone());
          } else {
            log::info!(
              "Skipping version update for running profile: {} ({})",
              profile.name,
              profile.version
            );
          }
        }

        // Update profiles to latest version
        for profile in &profiles_to_update {
          match self.profile_manager.update_profile_version(
            app_handle,
            &profile.id.to_string(),
            latest_version,
          ) {
            Ok(_) => {
              consolidated.push(format!(
                "Updated profile '{}' from {} to {}",
                profile.name, profile.version, latest_version
              ));
            }
            Err(e) => {
              log::error!("Failed to update profile '{}': {}", profile.name, e);
            }
          }
        }

        // Remove older version binaries that are no longer needed
        for old_version in &older_versions_to_remove {
          log::info!("Consolidating: removing old version {browser_name} {old_version}");
          match self.cleanup_failed_download(browser_name, old_version) {
            Ok(_) => {
              consolidated.push(format!("Removed old version: {browser_name} {old_version}"));
              log::info!("Successfully removed old version: {browser_name} {old_version}");
            }
            Err(e) => {
              log::error!("Failed to cleanup old version {browser_name} {old_version}: {e}");
            }
          }
        }
      }
    }

    // Save registry after consolidation
    self
      .save()
      .map_err(|e| format!("Failed to save registry after consolidation: {e}"))?;

    log::info!(
      "Browser version consolidation completed: {} actions taken",
      consolidated.len()
    );
    Ok(consolidated)
  }

  /// Check if browser binaries exist for all profiles and return missing binaries
  pub async fn check_missing_binaries(
    &self,
  ) -> Result<Vec<(String, String, String)>, Box<dyn std::error::Error + Send + Sync>> {
    use crate::browser::{create_browser, BrowserType};
    // Get all profiles
    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;
    let mut missing_binaries = Vec::new();

    for profile in profiles {
      let browser_type = match BrowserType::from_str(&profile.browser) {
        Ok(bt) => bt,
        Err(_) => {
          log::info!(
            "Warning: Invalid browser type '{}' for profile '{}'",
            profile.browser,
            profile.name
          );
          continue;
        }
      };

      let browser = create_browser(browser_type.clone());

      let binaries_dir = crate::settings::app_dirs::binaries_dir();

      log::info!(
        "binaries_dir: {binaries_dir:?} for profile: {}",
        profile.name
      );

      // Check if the version is downloaded
      if !browser.is_version_downloaded(&profile.version, &binaries_dir) {
        missing_binaries.push((profile.name, profile.browser, profile.version));
      }
    }

    Ok(missing_binaries)
  }

  /// Automatically download missing binaries for all profiles
  pub async fn ensure_all_binaries_exist(
    &self,
    app_handle: &tauri::AppHandle,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    // First, clean up any stale registry entries
    if let Ok(cleaned_up) = self.verify_and_cleanup_stale_entries() {
      if !cleaned_up.is_empty() {
        log::info!(
          "Cleaned up {} stale registry entries: {}",
          cleaned_up.len(),
          cleaned_up.join(", ")
        );
      }
    }

    // Consolidate browser versions - keep only latest version per browser
    if let Ok(consolidated) = self.consolidate_browser_versions(app_handle) {
      if !consolidated.is_empty() {
        log::info!("Version consolidation results:");
        for action in &consolidated {
          log::info!("  {action}");
        }
      }
    }

    let missing_binaries = self.check_missing_binaries().await?;
    let mut downloaded = Vec::new();

    for (profile_name, browser, version) in missing_binaries {
      log::info!("Downloading missing binary for profile '{profile_name}': {browser} {version}");

      match crate::browser::downloader::download_browser(
        app_handle.clone(),
        browser.clone(),
        version.clone(),
      )
      .await
      {
        Ok(_) => {
          downloaded.push(format!(
            "{browser} {version} (for profile '{profile_name}')"
          ));

          // After successful download, update profiles that use this browser to the new version
          match self
            .update_profiles_to_version(app_handle, &browser, &version)
            .await
          {
            Ok(updated_profiles) => {
              if !updated_profiles.is_empty() {
                log::info!(
                  "Successfully updated {} profiles to version {}:",
                  updated_profiles.len(),
                  version
                );
                for update_msg in updated_profiles {
                  log::info!("  {update_msg}");
                }
              }
            }
            Err(e) => {
              log::error!("CRITICAL: Failed to update profiles to version {version}: {e}");
              log::error!("This may cause profile version inconsistencies and cleanup issues");
            }
          }
        }
        Err(e) => {
          log::error!("Failed to download {browser} {version} for profile '{profile_name}': {e}");
        }
      }
    }

    // Check if GeoIP database is missing for Camoufox profiles
    if self.geoip_downloader.check_missing_geoip_database()? {
      log::info!("GeoIP database is missing for Camoufox profiles, downloading...");

      match self
        .geoip_downloader
        .download_geoip_database(app_handle)
        .await
      {
        Ok(_) => {
          downloaded.push("GeoIP database for Camoufox".to_string());
          log::info!("GeoIP database downloaded successfully");
        }
        Err(e) => {
          log::error!("Failed to download GeoIP database: {e}");
          // Don't fail the entire operation if GeoIP download fails
        }
      }
    }

    Ok(downloaded)
  }

  /// Update all profiles using a specific browser to a new version
  async fn update_profiles_to_version(
    &self,
    app_handle: &tauri::AppHandle,
    browser: &str,
    version: &str,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    let mut updated_profiles = Vec::new();

    for profile in profiles {
      if profile.browser == browser && profile.version != version {
        // Check if profile is currently running
        if profile.process_id.is_some() {
          log::info!(
            "Skipping version update for running profile: {} ({})",
            profile.name,
            profile.version
          );
          continue;
        }

        // Update the profile version
        match self.profile_manager.update_profile_version(
          app_handle,
          &profile.id.to_string(),
          version,
        ) {
          Ok(_) => {
            updated_profiles.push(format!(
              "Updated profile '{}' from {} to {}",
              profile.name, profile.version, version
            ));
            log::info!(
              "Successfully updated profile '{}' to version {}",
              profile.name,
              version
            );

            // Save registry after each profile update to ensure consistency
            if let Err(e) = self.save() {
              log::warn!("Warning: Failed to save registry after profile update: {e}");
            }
          }
          Err(e) => {
            log::error!("Failed to update profile '{}': {}", profile.name, e);
          }
        }
      }
    }

    Ok(updated_profiles)
  }

  /// Cleanup unused binaries based on active and running profiles
  pub fn cleanup_unused_binaries(
    &self,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    // Load current profiles using injected ProfileManager
    let profiles = self
      .profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;

    // Get active browser versions (all profiles)
    let active_versions = self.get_active_browser_versions(&profiles);

    // Get running browser versions (only running profiles)
    let running_versions = self.get_running_browser_versions(&profiles);

    // Get binaries directory from profile manager
    let binaries_dir = self.profile_manager.get_binaries_dir();

    // Use comprehensive cleanup that syncs registry with disk and removes unused binaries
    let cleaned_up =
      self.comprehensive_cleanup(&binaries_dir, &active_versions, &running_versions)?;

    // Registry is already saved by comprehensive_cleanup
    Ok(cleaned_up)
  }
}
