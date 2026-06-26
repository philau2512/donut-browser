#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use tempfile::TempDir;

  #[test]
  fn test_browser_type_conversions() {
    // Test as_str
    assert_eq!(BrowserType::Camoufox.as_str(), "camoufox");
    assert_eq!(BrowserType::Wayfern.as_str(), "wayfern");

    // Test from_str
    assert_eq!(
      BrowserType::from_str("camoufox").expect("camoufox should be valid"),
      BrowserType::Camoufox
    );
    assert_eq!(
      BrowserType::from_str("wayfern").expect("wayfern should be valid"),
      BrowserType::Wayfern
    );

    // Test invalid browser type - these should properly fail
    let invalid_result = BrowserType::from_str("invalid");
    assert!(
      invalid_result.is_err(),
      "Invalid browser type should return error"
    );

    let empty_result = BrowserType::from_str("");
    assert!(empty_result.is_err(), "Empty string should return error");

    assert!(
      BrowserType::from_str("firefox").is_err(),
      "Removed browser types should return error"
    );
    assert!(
      BrowserType::from_str("chromium").is_err(),
      "Removed browser types should return error"
    );
  }

  #[test]
  fn test_camoufox_launch_args() {
    let browser = CamoufoxBrowser::new();
    let args = browser
      .create_launch_args("/path/to/profile", None, None, None, false)
      .expect("Failed to create launch args for Camoufox");
    assert!(args.contains(&"-profile".to_string()));
    assert!(args.contains(&"/path/to/profile".to_string()));
    assert!(args.contains(&"-no-remote".to_string()));

    let args = browser
      .create_launch_args(
        "/path/to/profile",
        None,
        Some("https://example.com".to_string()),
        None,
        false,
      )
      .expect("Failed to create launch args for Camoufox with URL");
    assert!(args.contains(&"https://example.com".to_string()));

    // Test with remote debugging
    let args = browser
      .create_launch_args("/path/to/profile", None, None, Some(9222), false)
      .expect("Failed to create launch args for Camoufox with remote debugging");
    assert!(args.contains(&"--start-debugger-server".to_string()));
    assert!(args.contains(&"9222".to_string()));

    // Test headless mode
    let args = browser
      .create_launch_args("/path/to/profile", None, None, None, true)
      .expect("Failed to create launch args for Camoufox headless");
    assert!(
      args.contains(&"--headless".to_string()),
      "Browser should include headless flag when requested"
    );
  }

  #[test]
  fn test_wayfern_launch_args() {
    let browser = WayfernBrowser::new();
    let args = browser
      .create_launch_args("/path/to/profile", None, None, None, false)
      .expect("Failed to create launch args for Wayfern");

    assert!(
      args.contains(&"--user-data-dir=/path/to/profile".to_string()),
      "Wayfern args should contain user-data-dir"
    );
    assert!(
      args.contains(&"--no-default-browser-check".to_string()),
      "Wayfern args should contain no-default-browser-check"
    );
    assert!(
      args.contains(&"--disable-background-mode".to_string()),
      "Wayfern args should contain disable-background-mode"
    );
    assert!(
      args.contains(&"--disable-component-update".to_string()),
      "Wayfern args should contain disable-component-update"
    );

    let args_with_url = browser
      .create_launch_args(
        "/path/to/profile",
        None,
        Some("https://example.com".to_string()),
        None,
        false,
      )
      .expect("Failed to create launch args for Wayfern with URL");
    assert!(
      args_with_url.contains(&"https://example.com".to_string()),
      "Wayfern args should contain the URL"
    );
    assert_eq!(
      args_with_url.last().expect("Args should not be empty"),
      "https://example.com"
    );

    // Test remote debugging
    let args_with_debug = browser
      .create_launch_args("/path/to/profile", None, None, Some(9222), false)
      .expect("Failed to create launch args for Wayfern with remote debugging");
    assert!(
      args_with_debug.contains(&"--remote-debugging-port=9222".to_string()),
      "Wayfern args should contain remote debugging port"
    );

    // Test headless mode
    let args_headless = browser
      .create_launch_args("/path/to/profile", None, None, None, true)
      .expect("Failed to create launch args for Wayfern headless");
    assert!(
      args_headless.contains(&"--headless=new".to_string()),
      "Wayfern args should contain headless flag when requested"
    );
  }

  #[test]
  fn test_proxy_settings_creation() {
    let proxy = ProxySettings {
      proxy_type: "http".to_string(),
      host: "127.0.0.1".to_string(),
      port: 8080,
      username: None,
      password: None,
    };

    assert_eq!(proxy.proxy_type, "http");
    assert_eq!(proxy.host, "127.0.0.1");
    assert_eq!(proxy.port, 8080);

    // Test different proxy types
    let socks_proxy = ProxySettings {
      proxy_type: "socks5".to_string(),
      host: "proxy.example.com".to_string(),
      port: 1080,
      username: None,
      password: None,
    };

    assert_eq!(socks_proxy.proxy_type, "socks5");
    assert_eq!(socks_proxy.host, "proxy.example.com");
    assert_eq!(socks_proxy.port, 1080);
  }

  #[test]
  fn test_version_downloaded_check() {
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let binaries_dir = temp_dir.path();

    // Create a mock Camoufox browser installation
    let browser_dir = binaries_dir.join("camoufox").join("135.0.1");
    fs::create_dir_all(&browser_dir).expect("Failed to create browser directory");

    #[cfg(target_os = "macos")]
    {
      let app_dir = browser_dir.join("Camoufox.app");
      fs::create_dir_all(&app_dir).expect("Failed to create Camoufox.app directory");
    }

    #[cfg(target_os = "linux")]
    {
      let executable_path = browser_dir.join("camoufox");
      fs::write(&executable_path, "mock executable").expect("Failed to write mock executable");

      use std::os::unix::fs::PermissionsExt;
      let mut permissions = executable_path
        .metadata()
        .expect("Failed to get file metadata")
        .permissions();
      permissions.set_mode(0o755);
      fs::set_permissions(&executable_path, permissions)
        .expect("Failed to set executable permissions");
    }

    #[cfg(target_os = "windows")]
    {
      let executable_path = browser_dir.join("firefox.exe");
      fs::write(&executable_path, "mock executable").expect("Failed to write mock executable");
    }

    let browser = CamoufoxBrowser::new();
    assert!(browser.is_version_downloaded("135.0.1", binaries_dir));
    assert!(!browser.is_version_downloaded("999.0", binaries_dir));

    // Test with Wayfern browser
    let wayfern_dir = binaries_dir.join("wayfern").join("1.0.0");
    fs::create_dir_all(&wayfern_dir).expect("Failed to create wayfern directory");

    #[cfg(target_os = "macos")]
    {
      let wayfern_app_dir = wayfern_dir.join("Chromium.app");
      fs::create_dir_all(wayfern_app_dir.join("Contents").join("MacOS"))
        .expect("Failed to create Chromium.app structure");

      let executable_path = wayfern_app_dir
        .join("Contents")
        .join("MacOS")
        .join("Chromium");
      fs::write(&executable_path, "mock executable")
        .expect("Failed to write mock Wayfern executable");
    }

    #[cfg(target_os = "linux")]
    {
      let executable_path = wayfern_dir.join("chromium");
      fs::write(&executable_path, "mock executable")
        .expect("Failed to write mock wayfern executable");

      use std::os::unix::fs::PermissionsExt;
      let mut permissions = executable_path
        .metadata()
        .expect("Failed to get wayfern metadata")
        .permissions();
      permissions.set_mode(0o755);
      fs::set_permissions(&executable_path, permissions)
        .expect("Failed to set wayfern permissions");
    }

    #[cfg(target_os = "windows")]
    {
      let executable_path = wayfern_dir.join("chromium.exe");
      fs::write(&executable_path, "mock executable").expect("Failed to write mock chromium.exe");
    }

    let wayfern_browser = WayfernBrowser::new();
    assert!(
      wayfern_browser.is_version_downloaded("1.0.0", binaries_dir),
      "Wayfern version should be detected as downloaded"
    );
    assert!(
      !wayfern_browser.is_version_downloaded("9.9.9", binaries_dir),
      "Non-existent Wayfern version should not be detected as downloaded"
    );
  }

  #[test]
  fn test_version_downloaded_no_app_directory() {
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let binaries_dir = temp_dir.path();

    // Create browser directory but no proper executable structure
    let browser_dir = binaries_dir.join("camoufox").join("135.0.1");
    fs::create_dir_all(&browser_dir).expect("Failed to create browser directory");

    // Create some other files but no proper executable structure
    fs::write(browser_dir.join("readme.txt"), "Some content").expect("Failed to write readme file");

    let browser = CamoufoxBrowser::new();
    assert!(
      !browser.is_version_downloaded("135.0.1", binaries_dir),
      "Camoufox version should not be detected without proper executable structure"
    );
  }

  #[test]
  fn test_browser_type_clone_and_debug() {
    let browser_type = BrowserType::Camoufox;
    let cloned = browser_type.clone();
    assert_eq!(browser_type, cloned);

    // Test Debug trait
    let debug_str = format!("{browser_type:?}");
    assert!(debug_str.contains("Camoufox"));
  }

  #[test]
  fn test_proxy_settings_serialization() {
    let proxy = ProxySettings {
      proxy_type: "http".to_string(),
      host: "127.0.0.1".to_string(),
      port: 8080,
      username: None,
      password: None,
    };

    // Test that it can be serialized (implements Serialize)
    let json = serde_json::to_string(&proxy).expect("Failed to serialize proxy settings");
    assert!(json.contains("127.0.0.1"), "JSON should contain host IP");
    assert!(json.contains("8080"), "JSON should contain port number");
    assert!(json.contains("http"), "JSON should contain proxy type");

    // Test that it can be deserialized (implements Deserialize)
    let deserialized: ProxySettings =
      serde_json::from_str(&json).expect("Failed to deserialize proxy settings");
    assert_eq!(
      deserialized.proxy_type, proxy.proxy_type,
      "Proxy type should match"
    );
    assert_eq!(deserialized.host, proxy.host, "Host should match");
    assert_eq!(deserialized.port, proxy.port, "Port should match");
  }

  #[test]
  fn test_wayfern_config_has_no_executable_path() {
    // Verify WayfernConfig does not store executable_path
    let config = crate::browser::wayfern_manager::WayfernConfig::default();
    let json = serde_json::to_value(&config).unwrap();
    assert!(
      json.get("executable_path").is_none(),
      "WayfernConfig should not have executable_path field"
    );
  }

  #[test]
  fn test_camoufox_config_has_no_executable_path() {
    // Verify CamoufoxConfig does not store executable_path
    let config = crate::browser::camoufox_manager::CamoufoxConfig::default();
    let json = serde_json::to_value(&config).unwrap();
    assert!(
      json.get("executable_path").is_none(),
      "CamoufoxConfig should not have executable_path field"
    );
  }

  #[test]
  fn test_profile_data_path_is_dynamic() {
    use crate::profile::BrowserProfile;
    let profiles_dir = std::path::PathBuf::from("/fake/profiles");
    let profile = BrowserProfile {
      id: uuid::Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap(),
      name: "test".to_string(),
      browser: "wayfern".to_string(),
      version: "1.0.0".to_string(),
      proxy_id: None,
      vpn_id: None,
      launch_hook: None,
      process_id: None,
      last_launch: None,
      release_type: "stable".to_string(),
      camoufox_config: None,
      wayfern_config: None,
      group_id: None,
      tags: Vec::new(),
      note: None,
      sync_mode: crate::profile::types::SyncMode::Disabled,
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

    let path = profile.get_profile_data_path(&profiles_dir);
    assert_eq!(
      path,
      profiles_dir
        .join("12345678-1234-1234-1234-123456789abc")
        .join("profile")
    );
  }
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref BROWSER_FACTORY: BrowserFactory = BrowserFactory::new();
}
