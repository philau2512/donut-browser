// Global singleton instance
lazy_static::lazy_static! {
  static ref DOWNLOADED_BROWSERS_REGISTRY: DownloadedBrowsersRegistry = {
    let registry = DownloadedBrowsersRegistry::new();
    if let Err(e) = registry.load() {
      log::warn!("Warning: Failed to load downloaded browsers registry: {e}");
    }
    registry
  };
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_registry_creation() {
    // Create a mock profile manager for testing
    let registry = DownloadedBrowsersRegistry::new();
    let data = registry.data.lock().unwrap();
    assert!(data.browsers.is_empty());
  }

  #[test]
  fn test_add_and_get_browser() {
    let registry = DownloadedBrowsersRegistry::new();
    let info = DownloadedBrowserInfo {
      browser: "firefox".to_string(),
      version: "139.0".to_string(),
      file_path: PathBuf::from("/test/path"),
    };

    registry.add_browser(info.clone());

    assert!(registry.is_browser_registered("firefox", "139.0"));
    assert!(!registry.is_browser_registered("firefox", "140.0"));
    assert!(!registry.is_browser_registered("chrome", "139.0"));
  }

  #[test]
  fn test_get_downloaded_versions() {
    let registry = DownloadedBrowsersRegistry::new();

    let info1 = DownloadedBrowserInfo {
      browser: "firefox".to_string(),
      version: "139.0".to_string(),
      file_path: PathBuf::from("/test/path1"),
    };

    let info2 = DownloadedBrowserInfo {
      browser: "firefox".to_string(),
      version: "140.0".to_string(),
      file_path: PathBuf::from("/test/path2"),
    };

    let info3 = DownloadedBrowserInfo {
      browser: "firefox".to_string(),
      version: "141.0".to_string(),
      file_path: PathBuf::from("/test/path3"),
    };

    registry.add_browser(info1);
    registry.add_browser(info2);
    registry.add_browser(info3);

    let versions = registry.get_downloaded_versions("firefox");
    assert_eq!(versions.len(), 3);
    assert!(versions.contains(&"139.0".to_string()));
    assert!(versions.contains(&"140.0".to_string()));
    assert!(versions.contains(&"141.0".to_string()));
  }

  #[test]
  fn test_mark_download_lifecycle() {
    let registry = DownloadedBrowsersRegistry::new();

    // Mark download started
    registry.mark_download_started("firefox", "139.0", PathBuf::from("/test/path"));

    // Should NOT be registered until verification completes
    assert!(
      !registry.is_browser_registered("firefox", "139.0"),
      "Browser should NOT be registered after marking as started (only after verification)"
    );

    // Mark as completed (after verification)
    registry
      .mark_download_completed("firefox", "139.0", PathBuf::from("/test/path"))
      .expect("Failed to mark download as completed");

    // Should now be registered
    assert!(
      registry.is_browser_registered("firefox", "139.0"),
      "Browser should be registered after verification completes"
    );
  }

  #[test]
  fn test_remove_browser() {
    let registry = DownloadedBrowsersRegistry::new();
    let info = DownloadedBrowserInfo {
      browser: "firefox".to_string(),
      version: "139.0".to_string(),
      file_path: PathBuf::from("/test/path"),
    };

    registry.add_browser(info);
    assert!(
      registry.is_browser_registered("firefox", "139.0"),
      "Browser should be registered after adding"
    );

    let removed = registry.remove_browser("firefox", "139.0");
    assert!(
      removed.is_some(),
      "Remove operation should return the removed browser info"
    );
    assert!(
      !registry.is_browser_registered("firefox", "139.0"),
      "Browser should not be registered after removal"
    );
  }

  #[test]
  fn test_twilight_download() {
    let registry = DownloadedBrowsersRegistry::new();

    // Mark twilight download started
    registry.mark_download_started("zen", "twilight", PathBuf::from("/test/zen-twilight"));

    // Should NOT be registered until verification completes
    assert!(
      !registry.is_browser_registered("zen", "twilight"),
      "Zen twilight version should NOT be registered until verification completes"
    );

    // Mark as completed (after verification)
    registry
      .mark_download_completed("zen", "twilight", PathBuf::from("/test/zen-twilight"))
      .expect("Failed to mark twilight download as completed");

    // Now it should be registered
    assert!(
      registry.is_browser_registered("zen", "twilight"),
      "Zen twilight version should be registered after verification completes"
    );
  }

  #[test]
  fn test_last_version_kept_during_cleanup() {
    let registry = DownloadedBrowsersRegistry::new();

    // Add a single version for "firefox"
    registry.add_browser(DownloadedBrowserInfo {
      browser: "firefox".to_string(),
      version: "139.0".to_string(),
      file_path: PathBuf::from("/test/firefox/139.0"),
    });

    // Add two versions for "chromium"
    registry.add_browser(DownloadedBrowserInfo {
      browser: "chromium".to_string(),
      version: "120.0".to_string(),
      file_path: PathBuf::from("/test/chromium/120.0"),
    });
    registry.add_browser(DownloadedBrowserInfo {
      browser: "chromium".to_string(),
      version: "121.0".to_string(),
      file_path: PathBuf::from("/test/chromium/121.0"),
    });

    // No active or running profiles
    let result = registry
      .cleanup_unused_binaries_internal(&[], &[])
      .expect("cleanup should succeed");

    // firefox 139.0 should be kept (last version), chromium should lose one but keep one
    // The exact one kept depends on iteration order, but at least one must remain
    assert!(
      !result.contains(&"firefox 139.0".to_string()),
      "Last version of firefox should not be cleaned up"
    );
    // At most one chromium version should have been cleaned up
    let chromium_cleaned: Vec<_> = result
      .iter()
      .filter(|r| r.starts_with("chromium"))
      .collect();
    assert!(
      chromium_cleaned.len() <= 1,
      "At most one chromium version should be cleaned up, got: {:?}",
      chromium_cleaned
    );

    // Verify firefox is still registered
    assert!(
      registry.is_browser_registered("firefox", "139.0"),
      "Last firefox version should still be registered"
    );
  }

  #[test]
  fn test_is_browser_registered_vs_downloaded() {
    let registry = DownloadedBrowsersRegistry::new();
    let info = DownloadedBrowserInfo {
      browser: "firefox".to_string(),
      version: "139.0".to_string(),
      file_path: PathBuf::from("/test/path"),
    };

    // Add browser to registry
    registry.add_browser(info);

    // Should be registered (in-memory check)
    assert!(
      registry.is_browser_registered("firefox", "139.0"),
      "Browser should be registered after adding to registry"
    );

    // is_browser_downloaded should return false in test environment because files don't exist
    // This tests the difference between registered (in registry) vs downloaded (files exist)
    assert!(
      !registry.is_browser_downloaded("firefox", "139.0"),
      "Browser should not be considered downloaded when files don't exist on disk"
    );
  }
}

#[tauri::command]
pub async fn ensure_active_browsers_downloaded(
  app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
  let registry = DownloadedBrowsersRegistry::instance();
  let version_manager = crate::browser::browser_version_manager::BrowserVersionManager::instance();
  let mut downloaded = Vec::new();

  for browser in &["wayfern", "camoufox"] {
    // Check if any version is already downloaded
    let existing = registry.get_downloaded_versions(browser);
    if !existing.is_empty() {
      log::info!(
        "ensure_active: Skipping {browser}: already have {} version(s) downloaded",
        existing.len()
      );
      continue;
    }
    log::info!("ensure_active: No {browser} versions found, will download");

    // Get the latest release type for this browser
    let release_types = match version_manager.get_browser_release_types(browser).await {
      Ok(rt) => rt,
      Err(e) => {
        log::warn!("Failed to get release types for {browser}: {e}");
        continue;
      }
    };

    // Use stable version (the only release type for these browsers)
    let version = match release_types.stable {
      Some(v) => v,
      None => {
        log::debug!("No stable version available for {browser} on this platform, skipping");
        continue;
      }
    };

    log::info!("Auto-downloading {browser} {version} (no versions found locally)");

    // Retry transient failures a few times. Each attempt is wrapped in an overall
    // timeout so that a hang anywhere in the download pipeline (version resolution,
    // a stalled stream, extraction) cannot block the next browser forever. This is
    // the core of the bug fix: Wayfern going first must never starve Camoufox.
    const MAX_ATTEMPTS: u32 = 3;
    const ATTEMPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
    let mut succeeded = false;
    for attempt in 1..=MAX_ATTEMPTS {
      let result = tokio::time::timeout(
        ATTEMPT_TIMEOUT,
        crate::browser::downloader::download_browser(
          app_handle.clone(),
          browser.to_string(),
          version.clone(),
        ),
      )
      .await;

      match result {
        Ok(Ok(_)) => {
          downloaded.push(format!("{browser} {version}"));
          log::info!("Successfully auto-downloaded {browser} {version}");
          succeeded = true;
          break;
        }
        Ok(Err(e)) => {
          log::warn!(
            "Failed to auto-download {browser} {version} (attempt {attempt}/{MAX_ATTEMPTS}): {e}"
          );
        }
        Err(_) => {
          // The download future itself hung past the overall timeout and was dropped,
          // so its own cleanup never ran. Clear any leftover in-progress bookkeeping
          // (the future may have re-resolved to a different version, so clear by
          // browser prefix) and emit a terminal error event so the UI stops spinning.
          log::warn!(
            "Auto-download of {browser} {version} timed out after {}s (attempt {attempt}/{MAX_ATTEMPTS})",
            ATTEMPT_TIMEOUT.as_secs()
          );
          crate::browser::downloader::clear_download_state_for_browser(browser);
          let progress = crate::browser::downloader::DownloadProgress {
            browser: (*browser).to_string(),
            version: version.clone(),
            downloaded_bytes: 0,
            total_bytes: None,
            percentage: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: None,
            stage: "error".to_string(),
          };
          let _ = crate::events::emit("download-progress", &progress);
        }
      }

      if attempt < MAX_ATTEMPTS {
        // Short backoff before retrying a transient failure.
        let backoff = std::time::Duration::from_secs(2u64.pow(attempt - 1));
        tokio::time::sleep(backoff).await;
      }
    }

    if !succeeded {
      // Do NOT abort the whole routine: continue so the next browser (Camoufox)
      // still gets its chance even though this one failed/timed out.
      log::warn!("Giving up on auto-download of {browser} {version} after {MAX_ATTEMPTS} attempts");
    }
  }

  Ok(downloaded)
}

#[tauri::command]
pub fn get_downloaded_browser_versions(browser_str: String) -> Result<Vec<String>, String> {
  let registry = DownloadedBrowsersRegistry::instance();
  Ok(registry.get_downloaded_versions(&browser_str))
}

#[tauri::command]
pub fn is_browser_downloaded(browser_str: String, version: String) -> bool {
  let registry = DownloadedBrowsersRegistry::instance();
  registry.is_browser_downloaded(&browser_str, &version)
}

#[tauri::command]
pub async fn check_missing_binaries() -> Result<Vec<(String, String, String)>, String> {
  let registry = DownloadedBrowsersRegistry::instance();
  registry
    .check_missing_binaries()
    .await
    .map_err(|e| format!("Failed to check missing binaries: {e}"))
}

#[tauri::command]
pub async fn ensure_all_binaries_exist(
  app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
  let registry = DownloadedBrowsersRegistry::instance();
  registry
    .ensure_all_binaries_exist(&app_handle)
    .await
    .map_err(|e| format!("Failed to ensure all binaries exist: {e}"))
}
