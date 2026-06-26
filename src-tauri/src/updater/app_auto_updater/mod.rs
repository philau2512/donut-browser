mod app_updater_core;
mod app_updater_install;
mod app_updater_platform;
mod app_updater_restart;
pub mod app_updater_types;

pub use app_updater_types::{AppAutoUpdater, AppRelease, AppReleaseAsset, AppUpdateInfo};

// Tauri commands

#[tauri::command]
pub async fn check_for_app_updates() -> Result<Option<AppUpdateInfo>, String> {
  if crate::settings::app_dirs::is_portable() {
    log::info!("App auto-updates disabled in portable mode");
    return Ok(None);
  }
  // The disable_auto_updates setting controls app self-updates only
  let disabled = crate::settings::settings_manager::SettingsManager::instance()
    .load_settings()
    .map(|s| s.disable_auto_updates)
    .unwrap_or(false);
  if disabled {
    log::info!("App auto-updates disabled by user setting");
    return Ok(None);
  }

  let updater = AppAutoUpdater::instance();
  updater
    .check_for_updates()
    .await
    .map_err(|e| format!("Failed to check for app updates: {e}"))
}

#[tauri::command]
pub async fn download_and_prepare_app_update(
  app_handle: tauri::AppHandle,
  update_info: AppUpdateInfo,
) -> Result<(), String> {
  let updater = AppAutoUpdater::instance();
  updater
    .download_and_prepare_update(&app_handle, &update_info)
    .await
    .map_err(|e| format!("Failed to download and prepare app update: {e}"))
}

#[tauri::command]
pub async fn restart_application() -> Result<(), String> {
  let updater = AppAutoUpdater::instance();
  updater
    .restart_application()
    .await
    .map_err(|e| format!("Failed to restart application: {e}"))
}

#[tauri::command]
pub async fn check_for_app_updates_manual() -> Result<Option<AppUpdateInfo>, String> {
  log::info!("Manual app update check triggered");
  let updater = AppAutoUpdater::instance();
  updater
    .check_for_updates()
    .await
    .map_err(|e| format!("Failed to check for app updates: {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_is_nightly_build() {
    // This will depend on whether STABLE_RELEASE is set during test compilation
    let is_nightly = AppAutoUpdater::is_nightly_build();
    log::info!("Is nightly build: {is_nightly}");

    // The result should be true for test builds since STABLE_RELEASE is not set
    // unless the test is run in a stable release environment
    assert!(is_nightly || option_env!("STABLE_RELEASE").is_some());
  }

  #[test]
  fn test_version_comparison() {
    let updater = AppAutoUpdater::instance();

    // Test semantic version comparison
    assert!(updater.is_version_newer("v1.1.0", "v1.0.0"));
    assert!(updater.is_version_newer("v2.0.0", "v1.9.9"));
    assert!(updater.is_version_newer("v1.0.1", "v1.0.0"));
    assert!(!updater.is_version_newer("v1.0.0", "v1.0.0"));
    assert!(!updater.is_version_newer("v1.0.0", "v1.0.1"));
  }

  #[test]
  fn test_parse_semver() {
    let updater = AppAutoUpdater::instance();

    assert_eq!(updater.parse_semver("v1.2.3"), (1, 2, 3));
    assert_eq!(updater.parse_semver("1.2.3"), (1, 2, 3));
    assert_eq!(updater.parse_semver("v2.0.0"), (2, 0, 0));
    assert_eq!(updater.parse_semver("0.1.0"), (0, 1, 0));
  }

  #[test]
  fn test_should_update_stable() {
    let updater = AppAutoUpdater::instance();

    // Stable version updates
    assert!(updater.should_update("v1.0.0", "v1.1.0", false));
    assert!(updater.should_update("v1.0.0", "v2.0.0", false));
    assert!(!updater.should_update("v1.1.0", "v1.0.0", false));
    assert!(!updater.should_update("v1.0.0", "v1.0.0", false));
  }

  #[test]
  fn test_should_update_nightly() {
    let updater = AppAutoUpdater::instance();

    // Nightly version updates
    assert!(updater.should_update("nightly-abc123", "nightly-def456", true));
    assert!(!updater.should_update("nightly-abc123", "nightly-abc123", true));

    // Upgrade from stable to nightly
    assert!(updater.should_update("v1.0.0", "nightly-abc123", true));

    // Don't upgrade dev, ever
    assert!(!updater.should_update("dev-0.1.0", "nightly-xyz987", false));
    assert!(!updater.should_update("dev-0.1.0", "nightly-xyz987", true));
    assert!(!updater.should_update("dev-0.1.0", "v1.2.3", false));
  }

  #[test]
  fn test_should_update_edge_cases() {
    let updater = AppAutoUpdater::instance();

    // Test with different nightly formats
    assert!(updater.should_update("nightly-abc123", "nightly-def456", true));
    assert!(!updater.should_update("nightly-abc123", "nightly-abc123", true));

    // Test stable version edge cases
    assert!(updater.should_update("v0.9.9", "v1.0.0", false));
    assert!(!updater.should_update("v1.0.0", "v0.9.9", false));
    assert!(!updater.should_update("v1.0.0", "v1.0.0", false));

    // Test version without 'v' prefix
    assert!(updater.should_update("0.9.9", "v1.0.0", false));
    assert!(updater.should_update("v0.9.9", "1.0.0", false));
  }

  #[test]
  fn test_extract_update_uses_extractor() {
    // This test verifies that the extract_update method properly uses the Extractor
    // We can't run the actual extraction in unit tests without real DMG files,
    // but we can verify the method signature and basic logic
    let updater = AppAutoUpdater::instance();

    // Test that unsupported formats would be rejected
    let temp_dir = std::env::temp_dir();
    let unsupported_file = temp_dir.join("test.rar");

    // Create a mock runtime to test the logic
    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

    // This would fail because .rar is not supported, which proves
    // our method is using the Extractor logic
    let result = rt.block_on(async { updater.extract_update(&unsupported_file, &temp_dir).await });

    // Should fail with unsupported format error
    assert!(result.is_err(), "Unsupported format should return error");
    let error_msg = result.expect_err("Should have error").to_string();
    assert!(
      error_msg.contains("Unsupported archive format: rar")
        || error_msg.contains("unknown")
        || error_msg.contains("unsupported"),
      "Error should mention unsupported format, got: {error_msg}"
    );
  }

  #[test]
  fn test_platform_specific_download_urls() {
    let updater = AppAutoUpdater::instance();

    // Create comprehensive assets for all platforms
    let all_assets = vec![
      // macOS assets
      AppReleaseAsset {
        name: "Donut.Browser_0.1.0_aarch64.dmg".to_string(),
        browser_download_url: "https://example.com/aarch64.dmg".to_string(),
        size: 12345,
      },
      AppReleaseAsset {
        name: "Donut.Browser_0.1.0_x64.dmg".to_string(),
        browser_download_url: "https://example.com/x64.dmg".to_string(),
        size: 12345,
      },
      // Windows assets (NSIS naming: _ARCH-setup.exe)
      AppReleaseAsset {
        name: "Donut_0.1.0_x64-setup.exe".to_string(),
        browser_download_url: "https://example.com/x64-setup.exe".to_string(),
        size: 12345,
      },
      // Linux assets
      AppReleaseAsset {
        name: "donutbrowser_0.1.0_amd64.deb".to_string(),
        browser_download_url: "https://example.com/amd64.deb".to_string(),
        size: 12345,
      },
      AppReleaseAsset {
        name: "donutbrowser-0.1.0-1.x86_64.rpm".to_string(),
        browser_download_url: "https://example.com/x86_64.rpm".to_string(),
        size: 12345,
      },
      AppReleaseAsset {
        name: "Donut.Browser-0.1.0-x86_64.AppImage".to_string(),
        browser_download_url: "https://example.com/x86_64.AppImage".to_string(),
        size: 12345,
      },
    ];

    // Test that the method returns a URL for the current platform
    let url = updater.get_download_url_for_platform(&all_assets);
    assert!(
      url.is_some(),
      "Should find a suitable download URL for current platform"
    );

    // Test platform-specific behavior
    #[cfg(target_os = "macos")]
    {
      let url = url.unwrap();
      assert!(url.contains(".dmg"), "macOS should prefer DMG files");
    }

    #[cfg(target_os = "windows")]
    {
      let url = url.unwrap();
      assert!(
        url.contains(".msi") || url.contains(".exe") || url.contains(".zip"),
        "Windows should prefer MSI, EXE, or ZIP files"
      );
    }

    #[cfg(target_os = "linux")]
    {
      let url = url.unwrap();
      assert!(
        url.contains(".deb")
          || url.contains(".rpm")
          || url.contains(".appimage")
          || url.contains(".tar.gz"),
        "Linux should prefer DEB, RPM, AppImage, or TAR.GZ files"
      );
    }
  }

  #[test]
  fn test_supported_file_extensions() {
    let updater = AppAutoUpdater::instance();
    let temp_dir = std::env::temp_dir();
    let rt = tokio::runtime::Runtime::new().unwrap();

    // Test that all supported extensions are handled
    let supported_extensions = ["dmg", "msi", "exe", "deb", "rpm", "appimage", "zip"];

    for ext in &supported_extensions {
      let test_file = temp_dir.join(format!("test.{ext}"));
      let result = rt.block_on(async { updater.extract_update(&test_file, &temp_dir).await });

      // The result should either succeed or fail with a platform-specific error,
      // but not with "Unsupported archive format"
      if let Err(e) = result {
        let error_msg = e.to_string();
        assert!(
          !error_msg.contains("Unsupported archive format"),
          "Extension {ext} should be supported but got: {error_msg}"
        );
      }
    }

    // Test tar.gz compound extension
    let tar_gz_file = temp_dir.join("test.tar.gz");
    let result = rt.block_on(async { updater.extract_update(&tar_gz_file, &temp_dir).await });

    if let Err(e) = result {
      let error_msg = e.to_string();
      assert!(
        !error_msg.contains("Unsupported archive format"),
        "tar.gz should be supported but got: {error_msg}"
      );
    }
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn test_appimage_detection() {
    let updater = AppAutoUpdater::instance();

    // Test that AppImage detection works with various scenarios
    // Note: These tests can't fully simulate AppImage environment without actual AppImage

    // Test that the method exists and doesn't panic
    let _is_appimage = updater.is_running_from_appimage();

    // Test installation method detection
    let _method = updater.detect_linux_installation_method();
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn test_appimage_auto_update_disabled() {
    let updater = AppAutoUpdater::instance();

    // Create mock assets including AppImage
    let assets = vec![
      AppReleaseAsset {
        name: "donutbrowser_0.1.0_amd64.deb".to_string(),
        browser_download_url: "https://example.com/amd64.deb".to_string(),
        size: 12345,
      },
      AppReleaseAsset {
        name: "Donut.Browser-0.1.0-x86_64.AppImage".to_string(),
        browser_download_url: "https://example.com/x86_64.AppImage".to_string(),
        size: 12345,
      },
    ];

    // If we're running from AppImage, should return None (disabled)
    // If not, should return a suitable download URL
    let url = updater.get_download_url_for_platform(&assets);

    // The test should pass regardless of whether we're in AppImage or not
    // If in AppImage: url should be None
    // If not in AppImage: url should be Some(...)
    if updater.is_running_from_appimage() {
      assert!(
        url.is_none(),
        "Auto-updates should be disabled for AppImages"
      );
    } else {
      // Should find a suitable non-AppImage download
      if let Some(url_str) = url {
        assert!(
          !url_str.contains("AppImage"),
          "Should not select AppImage when not running from AppImage"
        );
      }
    }
  }

  #[test]
  fn test_appimage_detection_logic() {
    let updater = AppAutoUpdater::instance();

    // Test that the get_download_url_for_platform method properly handles AppImage detection
    // This test can run on all platforms

    // Create comprehensive assets for all platforms including AppImage
    let all_assets = vec![
      // macOS assets
      AppReleaseAsset {
        name: "Donut.Browser_0.1.0_aarch64.dmg".to_string(),
        browser_download_url: "https://example.com/aarch64.dmg".to_string(),
        size: 12345,
      },
      // Windows assets
      AppReleaseAsset {
        name: "Donut.Browser_0.1.0_x64.msi".to_string(),
        browser_download_url: "https://example.com/x64.msi".to_string(),
        size: 12345,
      },
      // Linux assets
      AppReleaseAsset {
        name: "donutbrowser_0.1.0_amd64.deb".to_string(),
        browser_download_url: "https://example.com/amd64.deb".to_string(),
        size: 12345,
      },
      AppReleaseAsset {
        name: "Donut.Browser-0.1.0-x86_64.AppImage".to_string(),
        browser_download_url: "https://example.com/x86_64.AppImage".to_string(),
        size: 12345,
      },
    ];

    // Test that the method returns a URL for the current platform
    let url = updater.get_download_url_for_platform(&all_assets);

    // On non-Linux platforms, should always return a URL
    #[cfg(not(target_os = "linux"))]
    {
      assert!(
        url.is_some(),
        "Should find a suitable download URL for non-Linux platforms"
      );
      let url_str = url.unwrap();
      assert!(
        !url_str.contains("AppImage"),
        "Non-Linux platforms should not get AppImage downloads"
      );
    }

    // On Linux platforms, behavior depends on AppImage detection
    #[cfg(target_os = "linux")]
    {
      // The URL might be None if AppImage is detected, or Some if not
      // This is expected behavior based on our implementation
      if let Some(url_str) = url {
        // If we get a URL, it should not be an AppImage
        assert!(
          !url_str.contains("AppImage"),
          "Should not select AppImage format"
        );
      }
      // If url is None, it means AppImage was detected and auto-updates are disabled
    }
  }

  #[test]
  #[cfg(target_os = "linux")]
  fn test_repo_detection_returns_bool() {
    // These just verify the functions run without panicking.
    // Actual values depend on the host system configuration.
    let _deb = AppAutoUpdater::is_deb_repo_configured();
    let _rpm = AppAutoUpdater::is_rpm_repo_configured();
  }
}
