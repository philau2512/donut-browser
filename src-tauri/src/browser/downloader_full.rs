impl Downloader {
  /// Download a browser binary, verify it, and register it in the downloaded browsers registry
  pub async fn download_browser_full(
    &self,
    app_handle: &tauri::AppHandle,
    browser_str: String,
    version: String,
  ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Only check Wayfern terms if Wayfern is already downloaded
    let terms_manager = crate::browser::wayfern_terms::WayfernTermsManager::instance();
    if terms_manager.is_wayfern_downloaded() && !terms_manager.is_terms_accepted() {
      return Err("Please accept Wayfern Terms and Conditions before downloading browsers".into());
    }

    // For Wayfern/Camoufox, resolve the actual available version from the API
    let version = if browser_str == "wayfern" {
      match self
        .api_client
        .fetch_wayfern_version_with_caching(true)
        .await
      {
        Ok(info) if info.version != version => {
          log::info!(
            "Wayfern: requested {version}, using available {}",
            info.version
          );
          info.version
        }
        _ => version,
      }
    } else if browser_str == "camoufox" {
      match self
        .api_client
        .fetch_camoufox_releases_with_caching(true)
        .await
      {
        Ok(releases) if !releases.is_empty() && releases[0].tag_name != version => {
          log::info!(
            "Camoufox: requested {version}, using available {}",
            releases[0].tag_name
          );
          releases[0].tag_name.clone()
        }
        _ => version,
      }
    } else {
      version
    };

    // Check if this browser-version pair is already being downloaded
    let download_key = format!("{browser_str}-{version}");
    let cancel_token = {
      let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
      if downloading.contains(&download_key) {
        return Err(format!("Browser '{browser_str}' version '{version}' is already being downloaded. Please wait for the current download to complete.").into());
      }
      // Mark this browser-version pair as being downloaded
      downloading.insert(download_key.clone());

      let token = CancellationToken::new();
      let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
      tokens.insert(download_key.clone(), token.clone());
      token
    };

    let browser_type =
      BrowserType::from_str(&browser_str).map_err(|e| format!("Invalid browser type: {e}"))?;
    let browser = create_browser(browser_type.clone());

    // Use injected registry instance

    let binaries_dir = crate::settings::app_dirs::binaries_dir();

    // Check if registry thinks it's downloaded, but also verify files actually exist
    if self.registry.is_browser_downloaded(&browser_str, &version) {
      let actually_exists = browser.is_version_downloaded(&version, &binaries_dir);

      if actually_exists {
        // Remove from downloading set since it's already downloaded
        let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
        downloading.remove(&download_key);
        drop(downloading);
        let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
        tokens.remove(&download_key);
        return Ok(version);
      } else {
        // Registry says it's downloaded but files don't exist - clean up registry
        log::info!("Registry indicates {browser_str} {version} is downloaded, but files are missing. Cleaning up registry entry.");
        self.registry.remove_browser(&browser_str, &version);
        self
          .registry
          .save()
          .map_err(|e| format!("Failed to save cleaned registry: {e}"))?;
      }
    }

    // Check if browser is supported on current platform before attempting download
    if !self
      .version_service
      .is_browser_supported(&browser_str)
      .unwrap_or(false)
    {
      // Remove from downloading set on error
      let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
      downloading.remove(&download_key);
      drop(downloading);
      let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
      tokens.remove(&download_key);
      return Err(
        format!(
          "Browser '{}' is not supported on your platform ({} {}). Supported browsers: {}",
          browser_str,
          std::env::consts::OS,
          std::env::consts::ARCH,
          self.version_service.get_supported_browsers().join(", ")
        )
        .into(),
      );
    }

    let download_info = self
      .version_service
      .get_download_info(&browser_str, &version)
      .map_err(|e| format!("Failed to get download info: {e}"))?;

    // Create browser directory
    let mut browser_dir = binaries_dir.clone();
    browser_dir.push(&browser_str);
    browser_dir.push(&version);

    std::fs::create_dir_all(&browser_dir)
      .map_err(|e| format!("Failed to create browser directory: {e}"))?;

    // Mark download as started (but don't add to registry yet)
    self
      .registry
      .mark_download_started(&browser_str, &version, browser_dir.clone());

    // Attempt to download the archive. If the download fails but an archive with the
    // expected filename already exists (manual download), continue using that file.
    let download_path: PathBuf = match self
      .download_browser(
        app_handle,
        browser_type.clone(),
        &version,
        &download_info,
        &browser_dir,
        Some(&cancel_token),
      )
      .await
    {
      Ok(path) => path,
      Err(e) => {
        // Do NOT continue with extraction on failed downloads. Partial files may exist but are invalid.
        // Clean registry entry and stop here so the UI can show a single, clear error.
        let _ = self.registry.remove_browser(&browser_str, &version);
        let _ = self.registry.save();
        let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
        downloading.remove(&download_key);
        drop(downloading);
        let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
        tokens.remove(&download_key);

        // Emit a terminal stage so the UI stops spinning. A user cancellation maps to
        // "cancelled"; any other failure (network error, stall timeout, bad status)
        // maps to "error" so the frontend can show a concrete error toast.
        let stage = if cancel_token.is_cancelled() {
          "cancelled"
        } else {
          "error"
        };
        let progress = DownloadProgress {
          browser: browser_str.clone(),
          version: version.clone(),
          downloaded_bytes: 0,
          total_bytes: None,
          percentage: 0.0,
          speed_bytes_per_sec: 0.0,
          eta_seconds: None,
          stage: stage.to_string(),
        };
        let _ = events::emit("download-progress", &progress);

        return Err(format!("Failed to download browser: {e}").into());
      }
    };

    // Use the extraction module
    if download_info.is_archive {
      match self
        .extractor
        .extract_browser(
          app_handle,
          browser_type.clone(),
          &version,
          &download_path,
          &browser_dir,
        )
        .await
      {
        Ok(_) => {
          // Do not remove the archive here. We keep it until verification succeeds.
        }
        Err(e) => {
          log::error!("Extraction failed for {browser_str} {version}: {e}");

          // Delete the corrupt/invalid archive so a fresh download happens next time
          if download_path.exists() {
            log::info!("Deleting corrupt archive: {}", download_path.display());
            let _ = std::fs::remove_file(&download_path);
          }

          let _ = self.registry.remove_browser(&browser_str, &version);
          let _ = self.registry.save();
          {
            let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
            downloading.remove(&download_key);
          }
          {
            let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
            tokens.remove(&download_key);
          }

          // Emit error stage so the UI shows a toast
          let progress = DownloadProgress {
            browser: browser_str.clone(),
            version: version.clone(),
            downloaded_bytes: 0,
            total_bytes: None,
            percentage: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: None,
            stage: "error".to_string(),
          };
          let _ = events::emit("download-progress", &progress);

          return Err(format!("Failed to extract browser: {e}").into());
        }
      }

      // Give filesystem a moment to settle after extraction
      tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    // Emit verification progress
    let progress = DownloadProgress {
      browser: browser_str.clone(),
      version: version.clone(),
      downloaded_bytes: 0,
      total_bytes: None,
      percentage: 100.0,
      speed_bytes_per_sec: 0.0,
      eta_seconds: None,
      stage: "verifying".to_string(),
    };
    let _ = events::emit("download-progress", &progress);

    // Verify the browser was downloaded correctly
    log::info!("Verifying download for browser: {browser_str}, version: {version}");

    // Use the browser's own verification method
    if !browser.is_version_downloaded(&version, &binaries_dir) {
      // Provide detailed error information for debugging
      let browser_dir = binaries_dir.join(&browser_str).join(&version);
      let mut error_details = format!(
        "Browser download completed but verification failed for {} {}. Expected directory: {}",
        browser_str,
        version,
        browser_dir.display()
      );

      // List what files actually exist
      if browser_dir.exists() {
        error_details.push_str("\nFiles found in directory:");
        if let Ok(entries) = std::fs::read_dir(&browser_dir) {
          for entry in entries.flatten() {
            let path = entry.path();
            let file_type = if path.is_dir() { "DIR" } else { "FILE" };
            error_details.push_str(&format!("\n  {} {}", file_type, path.display()));
          }
        } else {
          error_details.push_str("\n  (Could not read directory contents)");
        }
      } else {
        error_details.push_str("\nDirectory does not exist!");
      }

      // For Camoufox on Linux, provide specific expected files
      if browser_str == "camoufox" && cfg!(target_os = "linux") {
        let camoufox_subdir = browser_dir.join("camoufox");
        error_details.push_str("\nExpected Camoufox executable locations:");
        error_details.push_str(&format!("\n  {}/camoufox-bin", camoufox_subdir.display()));
        error_details.push_str(&format!("\n  {}/camoufox", camoufox_subdir.display()));

        if camoufox_subdir.exists() {
          error_details.push_str(&format!(
            "\nCamoufox subdirectory exists: {}",
            camoufox_subdir.display()
          ));
          if let Ok(entries) = std::fs::read_dir(&camoufox_subdir) {
            error_details.push_str("\nFiles in camoufox subdirectory:");
            for entry in entries.flatten() {
              let path = entry.path();
              let file_type = if path.is_dir() { "DIR" } else { "FILE" };
              error_details.push_str(&format!("\n  {} {}", file_type, path.display()));
            }
          }
        } else {
          error_details.push_str(&format!(
            "\nCamoufox subdirectory does not exist: {}",
            camoufox_subdir.display()
          ));
        }
      }

      // Do not delete files on verification failure; keep archive for manual retry.
      let _ = self.registry.remove_browser(&browser_str, &version);
      let _ = self.registry.save();

      // Emit a terminal error stage so the UI shows an error instead of spinning.
      let progress = DownloadProgress {
        browser: browser_str.clone(),
        version: version.clone(),
        downloaded_bytes: 0,
        total_bytes: None,
        percentage: 0.0,
        speed_bytes_per_sec: 0.0,
        eta_seconds: None,
        stage: "error".to_string(),
      };
      let _ = events::emit("download-progress", &progress);

      // Remove browser-version pair from downloading set on verification failure
      {
        let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
        downloading.remove(&download_key);
      }
      {
        let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
        tokens.remove(&download_key);
      }
      return Err(error_details.into());
    }

    // Mark completion in registry - only now add to registry after verification
    if let Err(e) =
      self
        .registry
        .mark_download_completed(&browser_str, &version, browser_dir.clone())
    {
      log::warn!("Warning: Could not mark {browser_str} {version} as completed in registry: {e}");
    }
    self
      .registry
      .save()
      .map_err(|e| format!("Failed to save registry: {e}"))?;

    // Now that verification succeeded, remove the archive file if it exists
    if download_info.is_archive {
      let archive_path = browser_dir.join(&download_info.filename);
      if archive_path.exists() {
        if let Err(e) = std::fs::remove_file(&archive_path) {
          log::warn!("Warning: Could not delete archive file after verification: {e}");
        }
      }
    }

    // If this is Camoufox, automatically download GeoIP database and create version.json
    if browser_str == "camoufox" {
      // Check if GeoIP database is already available
      if !crate::updater::geoip_downloader::GeoIPDownloader::is_geoip_database_available() {
        log::info!("Downloading GeoIP database for Camoufox...");

        match self
          .geoip_downloader
          .download_geoip_database(app_handle)
          .await
        {
          Ok(_) => {
            log::info!("GeoIP database downloaded successfully");
          }
          Err(e) => {
            log::error!("Failed to download GeoIP database: {e}");
            // Don't fail the browser download if GeoIP download fails
          }
        }
      } else {
        log::info!("GeoIP database already available");
      }

      // Create version.json if it doesn't exist
      if let Err(e) = self
        .ensure_camoufox_version_json(&browser_dir, &version)
        .await
      {
        log::warn!("Failed to create version.json for Camoufox: {e}");
      }
    }

    // Emit completion
    let progress = DownloadProgress {
      browser: browser_str.clone(),
      version: version.clone(),
      downloaded_bytes: 0,
      total_bytes: None,
      percentage: 100.0,
      speed_bytes_per_sec: 0.0,
      eta_seconds: Some(0.0),
      stage: "completed".to_string(),
    };
    let _ = events::emit("download-progress", &progress);

    // Remove browser-version pair from downloading set and cancel token
    {
      let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
      downloading.remove(&download_key);
    }
    {
      let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
      tokens.remove(&download_key);
    }

    // Auto-update non-running profiles to the latest installed version and cleanup unused binaries
    {
      let app_handle_for_update = app_handle.clone();
      tauri::async_runtime::spawn(async move {
        let auto_updater = crate::updater::auto_updater::AutoUpdater::instance();
        match auto_updater.update_profiles_to_latest_installed(&app_handle_for_update) {
          Ok(updated) => {
            if !updated.is_empty() {
              log::info!(
                "Auto-updated {} profiles to latest installed versions: {:?}",
                updated.len(),
                updated
              );
            }
          }
          Err(e) => {
            log::error!("Failed to auto-update profile versions: {e}");
          }
        }

        let registry =
          crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance();
        match registry.cleanup_unused_binaries() {
          Ok(cleaned) => {
            if !cleaned.is_empty() {
              log::info!("Cleaned up unused binaries after download: {:?}", cleaned);
            }
          }
          Err(e) => {
            log::error!("Failed to cleanup unused binaries: {e}");
          }
        }
      });
    }

    Ok(version)
  }
}
