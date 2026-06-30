#[cfg(test)]
mod tests {
  use super::*;

  use tempfile::TempDir;

  fn create_test_profile_manager() -> (&'static ProfileManager, TempDir) {
    let temp_dir = TempDir::new().unwrap();

    // Mock the base directories by setting environment variables
    unsafe {
      std::env::set_var("HOME", temp_dir.path());
    }

    let profile_manager = ProfileManager::instance();
    (profile_manager, temp_dir)
  }

  #[test]
  fn test_profile_manager_creation() {
    let (_manager, _temp_dir) = create_test_profile_manager();
    // If we get here without panicking, the test passes
  }

  #[test]
  fn test_get_profiles_dir() {
    let (manager, _temp_dir) = create_test_profile_manager();
    let profiles_dir = manager.get_profiles_dir();

    assert!(
      profiles_dir.to_string_lossy().contains("DonutBrowser"),
      "Profiles dir should contain DonutBrowser"
    );
    assert!(
      profiles_dir.to_string_lossy().contains("profiles"),
      "Profiles dir should contain profiles"
    );
  }

  #[test]
  fn test_get_common_firefox_preferences() {
    let (manager, _temp_dir) = create_test_profile_manager();

    let prefs = manager.get_common_firefox_preferences();
    assert!(!prefs.is_empty(), "Should return non-empty preferences");

    // Check for some expected preferences
    let prefs_string = prefs.join("\n");
    assert!(
      prefs_string.contains("browser.shell.checkDefaultBrowser"),
      "Should contain default browser check preference"
    );
    assert!(
      prefs_string.contains("app.update.enabled"),
      "Should contain update preference"
    );
  }

  #[test]
  fn test_get_binaries_dir() {
    let (manager, _temp_dir) = create_test_profile_manager();

    let binaries_dir = manager.get_binaries_dir();
    let path_str = binaries_dir.to_string_lossy();

    assert!(
      path_str.contains("DonutBrowser"),
      "Binaries dir should contain DonutBrowser"
    );
    assert!(
      path_str.contains("binaries"),
      "Binaries dir should contain binaries"
    );
  }

  #[test]
  fn test_disable_proxy_settings_in_profile() {
    let (manager, temp_dir) = create_test_profile_manager();

    // Create a test profile directory
    let profile_dir = temp_dir.path().join("test_profile");
    fs::create_dir_all(&profile_dir).expect("Should create profile directory");

    let result = manager.disable_proxy_settings_in_profile(&profile_dir);
    assert!(result.is_ok(), "Should successfully disable proxy settings");

    // Check that user.js was created
    let user_js_path = profile_dir.join("user.js");
    assert!(user_js_path.exists(), "user.js should be created");

    let content = fs::read_to_string(&user_js_path).expect("Should read user.js");
    assert!(
      content.contains("network.proxy.type"),
      "Should contain proxy type setting"
    );
    assert!(
      content.contains("0"),
      "Should set proxy type to 0 (no proxy)"
    );
  }

  #[test]
  fn test_apply_proxy_settings_to_profile() {
    let (manager, temp_dir) = create_test_profile_manager();

    // Create a test profile directory structure
    let uuid_dir = temp_dir.path().join("test_uuid");
    let profile_dir = uuid_dir.join("profile");
    fs::create_dir_all(&profile_dir).expect("Should create profile directory");

    let proxy_settings = ProxySettings {
      proxy_type: "http".to_string(),
      host: "proxy.example.com".to_string(),
      port: 8080,
      username: Some("user".to_string()),
      password: Some("pass".to_string()),
    };

    let result = manager.apply_proxy_settings_to_profile(&profile_dir, &proxy_settings, None);
    assert!(result.is_ok(), "Should successfully apply proxy settings");

    // Check that user.js was created
    let user_js_path = profile_dir.join("user.js");
    assert!(user_js_path.exists(), "user.js should be created");

    let content = fs::read_to_string(&user_js_path).expect("Should read user.js");

    // Check for manual proxy configuration (type 1) instead of PAC (type 2)
    // Manual proxy is used because PAC file:// URLs are blocked by privacy browsers like Zen
    assert!(
      content.contains("network.proxy.type\", 1"),
      "Should set proxy type to 1 (manual)"
    );
    assert!(
      content.contains("network.proxy.http\", \"proxy.example.com\""),
      "Should set HTTP proxy host"
    );
    assert!(
      content.contains("network.proxy.http_port\", 8080"),
      "Should set HTTP proxy port"
    );
    assert!(
      content.contains("network.proxy.ssl\", \"proxy.example.com\""),
      "Should set SSL proxy host"
    );
    assert!(
      content.contains("network.proxy.ssl_port\", 8080"),
      "Should set SSL proxy port"
    );
  }

  #[test]
  fn test_pac_url_encodes_spaces_in_path() {
    let (manager, temp_dir) = create_test_profile_manager();

    let uuid_dir = temp_dir.path().join("path with spaces");
    let profile_dir = uuid_dir.join("profile");
    fs::create_dir_all(&profile_dir).expect("Should create profile directory");

    let result = manager.disable_proxy_settings_in_profile(&profile_dir);
    assert!(result.is_ok(), "Should handle paths with spaces");

    let user_js = fs::read_to_string(profile_dir.join("user.js")).unwrap();
    let pac_line = user_js
      .lines()
      .find(|l| l.contains("autoconfig_url"))
      .expect("Should have autoconfig_url preference");

    assert!(
      !pac_line.contains("path with spaces"),
      "PAC URL should not contain raw spaces: {pac_line}"
    );
    assert!(
      pac_line.contains("path%20with%20spaces"),
      "PAC URL should percent-encode spaces: {pac_line}"
    );
  }

  #[test]
  fn test_normalize_launch_hook_accepts_http_and_https() {
    let http =
      ProfileManager::normalize_launch_hook(Some(" http://localhost:3000/hook ".to_string()))
        .unwrap();
    let https = ProfileManager::normalize_launch_hook(Some(
      "https://example.com/hooks/profile-launch".to_string(),
    ))
    .unwrap();

    assert_eq!(http.as_deref(), Some("http://localhost:3000/hook"));
    assert_eq!(
      https.as_deref(),
      Some("https://example.com/hooks/profile-launch")
    );
  }

  #[test]
  fn test_normalize_launch_hook_clears_empty_values() {
    let result = ProfileManager::normalize_launch_hook(Some("   ".to_string())).unwrap();
    assert!(result.is_none());
  }

  #[test]
  fn test_normalize_launch_hook_rejects_invalid_scheme() {
    let err = ProfileManager::normalize_launch_hook(Some("ftp://example.com/hook".to_string()))
      .unwrap_err();
    assert!(err.to_string().contains("http or https"));
  }

  #[test]
  fn test_validate_launch_hook_accepts_https_url() {
    let result = super::validate_launch_hook(Some("https://example.com/track")).unwrap();
    assert_eq!(result.as_deref(), Some("https://example.com/track"));
  }

  #[test]
  fn test_validate_launch_hook_rejects_garbage_with_code() {
    let err = super::validate_launch_hook(Some("not a url")).unwrap_err();
    let parsed: serde_json::Value = serde_json::from_str(&err).expect("error must be JSON");
    assert_eq!(parsed["code"], "INVALID_LAUNCH_HOOK_URL");
  }

  #[test]
  fn test_validate_launch_hook_rejects_non_http_scheme_with_code() {
    let err = super::validate_launch_hook(Some("ftp://example.com/hook")).unwrap_err();
    let parsed: serde_json::Value = serde_json::from_str(&err).expect("error must be JSON");
    assert_eq!(parsed["code"], "INVALID_LAUNCH_HOOK_URL");
  }

  #[test]
  fn test_validate_launch_hook_empty_clears_hook() {
    let result = super::validate_launch_hook(Some("")).unwrap();
    assert!(result.is_none());

    let result_ws = super::validate_launch_hook(Some("   ")).unwrap();
    assert!(result_ws.is_none());

    let result_none = super::validate_launch_hook(None).unwrap();
    assert!(result_none.is_none());
  }
}

