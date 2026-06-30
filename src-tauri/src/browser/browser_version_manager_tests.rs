#[tauri::command]
pub async fn get_browser_release_types(
  browser_str: String,
) -> Result<crate::browser::browser_version_manager::BrowserReleaseTypes, String> {
  let service = BrowserVersionManager::instance();
  service
    .get_browser_release_types(&browser_str)
    .await
    .map_err(|e| format!("Failed to get release types: {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  use wiremock::MockServer;

  async fn setup_mock_server() -> MockServer {
    MockServer::start().await
  }

  fn create_test_api_client(server: &MockServer) -> ApiClient {
    let base_url = server.uri();
    ApiClient::new_with_base_urls(
      base_url.clone(), // firefox_api_base
      base_url.clone(), // firefox_dev_api_base
      base_url.clone(), // github_api_base
      base_url.clone(), // chromium_api_base
    )
  }

  fn create_test_service(_api_client: ApiClient) -> &'static BrowserVersionManager {
    BrowserVersionManager::instance()
  }

  #[tokio::test]
  async fn test_browser_version_manager_creation() {
    let _ = BrowserVersionManager::instance();
    // Test passes if we can create the service without panicking
  }

  #[tokio::test]
  async fn test_unsupported_browser() {
    let server = setup_mock_server().await;
    let api_client = create_test_api_client(&server);
    let service = create_test_service(api_client);

    let result = service.fetch_browser_versions("unsupported", false).await;
    assert!(
      result.is_err(),
      "Should return error for unsupported browser"
    );

    if let Err(e) = result {
      assert!(
        e.to_string().contains("Unsupported browser"),
        "Error should mention unsupported browser"
      );
    }
  }

  #[test]
  fn test_get_download_info() {
    let service = BrowserVersionManager::instance();

    // Test Firefox - platform-specific expectations
    let firefox_info = service.get_download_info("firefox", "139.0").unwrap();

    #[cfg(target_os = "macos")]
    {
      assert_eq!(firefox_info.filename, "Firefox 139.0.dmg");
      assert!(firefox_info.is_archive);
    }

    #[cfg(target_os = "linux")]
    {
      assert_eq!(firefox_info.filename, "firefox-139.0.tar.xz");
      assert!(firefox_info.is_archive);
    }

    #[cfg(target_os = "windows")]
    {
      assert_eq!(firefox_info.filename, "Firefox Setup 139.0.exe");
      assert!(!firefox_info.is_archive);
    }

    assert!(firefox_info
      .url
      .contains("download-installer.cdn.mozilla.net"));
    assert!(firefox_info.url.contains("/pub/firefox/releases/139.0/"));

    // Test Firefox Developer
    let firefox_dev_info = service
      .get_download_info("firefox-developer", "139.0b1")
      .unwrap();

    #[cfg(target_os = "macos")]
    {
      assert_eq!(firefox_dev_info.filename, "Firefox 139.0b1.dmg");
      assert!(firefox_dev_info.is_archive);
    }

    #[cfg(target_os = "linux")]
    {
      assert_eq!(firefox_dev_info.filename, "firefox-139.0b1.tar.xz");
      assert!(firefox_dev_info.is_archive);
    }

    #[cfg(target_os = "windows")]
    {
      assert_eq!(firefox_dev_info.filename, "Firefox Setup 139.0b1.exe");
      assert!(!firefox_dev_info.is_archive);
    }

    assert!(firefox_dev_info
      .url
      .contains("download-installer.cdn.mozilla.net"));
    assert!(firefox_dev_info
      .url
      .contains("/pub/devedition/releases/139.0b1/"));

    // Test Zen Browser
    let zen_info = service.get_download_info("zen", "1.11b").unwrap();

    #[cfg(target_os = "macos")]
    {
      assert_eq!(zen_info.filename, "zen-1.11b.dmg");
      assert!(zen_info.url.contains("zen.macos-universal.dmg"));
      assert!(zen_info.is_archive);
    }

    #[cfg(target_os = "linux")]
    {
      assert_eq!(zen_info.filename, "zen-1.11b-x86_64.tar.xz");
      assert!(zen_info.url.contains("zen.linux-x86_64.tar.xz"));
      assert!(zen_info.is_archive);
    }

    #[cfg(target_os = "windows")]
    {
      assert_eq!(zen_info.filename, "zen-1.11b.exe");
      assert!(zen_info.url.contains("zen.installer.exe"));
      assert!(!zen_info.is_archive);
    }

    // Test Chromium
    let chromium_info = service.get_download_info("chromium", "1465660").unwrap();

    #[cfg(target_os = "macos")]
    {
      assert_eq!(chromium_info.filename, "chromium-1465660-mac.zip");
      assert!(chromium_info.url.contains("chrome-mac.zip"));
    }

    #[cfg(target_os = "linux")]
    {
      assert_eq!(chromium_info.filename, "chromium-1465660-linux.zip");
      assert!(chromium_info.url.contains("chrome-linux.zip"));
    }

    #[cfg(target_os = "windows")]
    {
      assert_eq!(chromium_info.filename, "chromium-1465660-win.zip");
      assert!(chromium_info.url.contains("chrome-win.zip"));
    }

    assert!(chromium_info.is_archive);

    // Test Brave - Note: Brave uses dynamic URL resolution, so get_download_info provides a template URL
    let brave_info = service.get_download_info("brave", "v1.81.9").unwrap();

    #[cfg(target_os = "macos")]
    {
      assert_eq!(brave_info.filename, "Brave-Browser-universal.dmg");
      assert_eq!(brave_info.url, "https://github.com/brave/brave-browser/releases/download/v1.81.9/Brave-Browser-universal.dmg");
      assert!(brave_info.is_archive);
    }

    #[cfg(target_os = "linux")]
    {
      assert_eq!(brave_info.filename, "brave-browser-v1.81.9-linux-amd64.zip");
      assert_eq!(brave_info.url, "https://github.com/brave/brave-browser/releases/download/v1.81.9/brave-browser-v1.81.9-linux-amd64.zip");
      assert!(brave_info.is_archive);
    }

    #[cfg(target_os = "windows")]
    {
      assert_eq!(brave_info.filename, "brave-v1.81.9.exe");
      assert_eq!(
        brave_info.url,
        "https://github.com/brave/brave-browser/releases/download/v1.81.9/brave-v1.81.9.exe"
      );
      assert!(!brave_info.is_archive);
    }

    // Test unsupported browser
    let unsupported_result = service.get_download_info("unsupported", "1.0.0");
    assert!(unsupported_result.is_err());

    log::info!("Download info test passed for all browsers");
  }
}

#[tauri::command]
pub fn get_supported_browsers() -> Result<Vec<String>, String> {
  let service = BrowserVersionManager::instance();
  Ok(service.get_supported_browsers())
}

#[tauri::command]
pub fn is_browser_supported_on_platform(browser_str: String) -> Result<bool, String> {
  let service = BrowserVersionManager::instance();
  service
    .is_browser_supported(&browser_str)
    .map_err(|e| format!("Failed to check browser support: {e}"))
}

#[tauri::command]
pub async fn fetch_browser_versions_cached_first(
  browser_str: String,
) -> Result<Vec<BrowserVersionInfo>, String> {
  let service = BrowserVersionManager::instance();

  // Get cached versions immediately if available
  if let Some(cached_versions) = service.get_cached_browser_versions_detailed(&browser_str) {
    // Check if we should update cache in background
    if service.should_update_cache(&browser_str) {
      // Start background update but return cached data immediately
      let service_clone = BrowserVersionManager::instance();
      let browser_str_clone = browser_str.clone();
      tokio::spawn(async move {
        if let Err(e) = service_clone
          .fetch_browser_versions_detailed(&browser_str_clone, false)
          .await
        {
          log::error!("Background version update failed for {browser_str_clone}: {e}");
        }
      });
    }
    Ok(cached_versions)
  } else {
    // No cache available, fetch fresh
    service
      .fetch_browser_versions_detailed(&browser_str, false)
      .await
      .map_err(|e| format!("Failed to fetch detailed browser versions: {e}"))
  }
}

#[tauri::command]
pub async fn fetch_browser_versions_with_count_cached_first(
  browser_str: String,
) -> Result<BrowserVersionsResult, String> {
  let service = BrowserVersionManager::instance();

  // Get cached versions immediately if available
  if let Some(cached_versions) = service.get_cached_browser_versions(&browser_str) {
    // Check if we should update cache in background
    if service.should_update_cache(&browser_str) {
      // Start background update but return cached data immediately
      let service_clone = BrowserVersionManager::instance();
      let browser_str_clone = browser_str.clone();
      tokio::spawn(async move {
        if let Err(e) = service_clone
          .fetch_browser_versions_with_count(&browser_str_clone, false)
          .await
        {
          log::error!("Background version update failed for {browser_str_clone}: {e}");
        }
      });
    }

    // Return cached data in the expected format
    Ok(BrowserVersionsResult {
      versions: cached_versions.clone(),
      new_versions_count: None, // No new versions when returning cached data
      total_versions_count: cached_versions.len(),
    })
  } else {
    // No cache available, fetch fresh
    service
      .fetch_browser_versions_with_count(&browser_str, false)
      .await
      .map_err(|e| format!("Failed to fetch browser versions: {e}"))
  }
}

#[tauri::command]
pub async fn fetch_browser_versions_with_count(
  browser_str: String,
) -> Result<BrowserVersionsResult, String> {
  let service = BrowserVersionManager::instance();
  service
    .fetch_browser_versions_with_count(&browser_str, false)
    .await
    .map_err(|e| format!("Failed to fetch browser versions: {e}"))
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref BROWSER_VERSION_SERVICE: BrowserVersionManager = BrowserVersionManager::new();
}
