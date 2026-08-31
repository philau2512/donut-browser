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
      vless_uri: None,
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

  /// PR-02: single profile create with disk materialize (no AppHandle).
  /// Mirrors create_profile_with_group dirs + metadata without fingerprint/events.
  #[test]
  #[serial_test::serial]
  fn smoke_create_single_profile_eager_disk() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let id = uuid::Uuid::new_v4();
    let profiles_dir = mgr.get_profiles_dir();
    let uuid_dir = profiles_dir.join(id.to_string());
    let data_dir = uuid_dir.join("profile");

    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, false, false).unwrap();
    assert!(uuid_dir.is_dir());
    assert!(data_dir.is_dir(), "eager create must materialize profile/ data dir");

    let profile = BrowserProfile {
      id,
      name: "Smoke Single Create".into(),
      browser: "wayfern".into(),
      version: "1.0.0".into(),
      release_type: "stable".into(),
      host_os: Some("windows".into()),
      created_at: Some(1),
      updated_at: Some(1),
      ..Default::default()
    };
    mgr.save_profile(&profile).unwrap();

    let listed = mgr.list_profiles().unwrap();
    let found = listed.iter().find(|p| p.id == id).expect("profile listed");
    assert_eq!(found.name, "Smoke Single Create");
    assert!(found.get_profile_data_path(&profiles_dir).is_dir());
    assert!(uuid_dir.join("metadata.json").is_file());
  }

  /// PR-05: first open materializes lazy profile data dir (launch contract).
  #[test]
  #[serial_test::serial]
  fn smoke_first_open_materializes_lazy_profile_data_dir() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let id = uuid::Uuid::new_v4();
    let profiles_dir = mgr.get_profiles_dir();
    let uuid_dir = profiles_dir.join(id.to_string());
    let data_dir = uuid_dir.join("profile");

    // Quick Create / lazy path
    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, false, true).unwrap();
    let profile = BrowserProfile {
      id,
      name: "Lazy First Open".into(),
      browser: "wayfern".into(),
      version: "1.0.0".into(),
      release_type: "stable".into(),
      host_os: Some("windows".into()),
      created_at: Some(1),
      updated_at: Some(1),
      ..Default::default()
    };
    mgr.save_profile(&profile).unwrap();
    assert!(!data_dir.exists(), "lazy create must not create profile/ yet");

    // Same step as browser_runner_launch_wayfern / camoufox launch
    let profile_data_path = profile.get_profile_data_path(&profiles_dir);
    std::fs::create_dir_all(&profile_data_path).unwrap();
    assert!(
      profile_data_path.is_dir(),
      "first open must materialize profile data dir"
    );

    let listed = mgr.list_profiles().unwrap();
    let found = listed.iter().find(|p| p.id == id).expect("listed after materialize");
    assert_eq!(found.name, "Lazy First Open");
    assert!(found.get_profile_data_path(&profiles_dir).is_dir());
  }

  /// PX-03: assign / clear proxy_id on profile metadata (core of update_profile_proxy).
  #[test]
  #[serial_test::serial]
  fn smoke_assign_proxy_id_to_profile_metadata() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let id = uuid::Uuid::new_v4();
    let profiles_dir = mgr.get_profiles_dir();
    let uuid_dir = profiles_dir.join(id.to_string());
    let data_dir = uuid_dir.join("profile");
    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, false, false).unwrap();

    let mut profile = BrowserProfile {
      id,
      name: "Proxy Assign".into(),
      browser: "wayfern".into(),
      version: "1.0.0".into(),
      release_type: "stable".into(),
      proxy_id: None,
      created_at: Some(1),
      updated_at: Some(1),
      ..Default::default()
    };
    mgr.save_profile(&profile).unwrap();

    profile.proxy_id = Some("proxy-smoke-1".into());
    profile.updated_at = Some(2);
    mgr.save_profile(&profile).unwrap();

    let listed = mgr.list_profiles().unwrap();
    let found = listed.iter().find(|p| p.id == id).expect("listed");
    assert_eq!(found.proxy_id.as_deref(), Some("proxy-smoke-1"));

    profile.proxy_id = None;
    profile.updated_at = Some(3);
    mgr.save_profile(&profile).unwrap();
    let cleared = mgr
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == id)
      .expect("listed");
    assert!(cleared.proxy_id.is_none());
  }

  fn seed_profile(name: &str) -> (uuid::Uuid, BrowserProfile) {
    let mgr = ProfileManager::instance();
    let id = uuid::Uuid::new_v4();
    let profiles_dir = mgr.get_profiles_dir();
    let uuid_dir = profiles_dir.join(id.to_string());
    let data_dir = uuid_dir.join("profile");
    ProfileManager::create_profile_directories(&uuid_dir, &data_dir, false, false).unwrap();
    let profile = BrowserProfile {
      id,
      name: name.into(),
      browser: "wayfern".into(),
      version: "1.0.0".into(),
      release_type: "stable".into(),
      host_os: Some("windows".into()),
      created_at: Some(1),
      updated_at: Some(1),
      ..Default::default()
    };
    mgr.save_profile(&profile).unwrap();
    (id, profile)
  }

  /// PR-06: rename (metadata) + local delete without AppHandle.
  #[test]
  #[serial_test::serial]
  fn smoke_rename_and_delete_profile() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let (id, mut profile) = seed_profile("Before Rename");
    profile.name = "After Rename".into();
    profile.updated_at = Some(2);
    mgr.save_profile(&profile).unwrap();

    let found = mgr
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == id)
      .expect("renamed profile");
    assert_eq!(found.name, "After Rename");

    mgr
      .delete_profile_local_only(&id.to_string())
      .expect("local delete");
    assert!(
      mgr
        .list_profiles()
        .unwrap()
        .iter()
        .all(|p| p.id != id),
      "deleted profile must not list"
    );
    assert!(!mgr.get_profiles_dir().join(id.to_string()).exists());
  }

  /// PR-07: clone_profile copies metadata and clears fingerprint linkage.
  #[test]
  #[serial_test::serial]
  fn smoke_clone_profile() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let (id, mut profile) = seed_profile("Clone Source");
    profile.tags = vec!["a".into()];
    profile.proxy_id = Some("px-1".into());
    profile.wayfern_config = Some(crate::browser::wayfern_manager::WayfernConfig {
      fingerprint: Some(r#"{"canvas":"seed"}"#.into()),
      os: Some("windows".into()),
      ..Default::default()
    });
    mgr.save_profile(&profile).unwrap();

    let cloned = mgr
      .clone_profile(&id.to_string(), Some("Clone Dest".into()))
      .expect("clone");
    assert_ne!(cloned.id, id);
    assert_eq!(cloned.name, "Clone Dest");
    assert_eq!(cloned.proxy_id.as_deref(), Some("px-1"));
    assert_eq!(cloned.tags, vec!["a".to_string()]);
    assert!(
      cloned
        .wayfern_config
        .as_ref()
        .and_then(|c| c.fingerprint.as_ref())
        .is_none(),
      "clone must clear fingerprint for unlink"
    );
    assert!(
      mgr
        .list_profiles()
        .unwrap()
        .iter()
        .any(|p| p.id == cloned.id)
    );
  }

  /// VN-03: assign / clear vpn_id (mutually exclusive with proxy in product path).
  #[test]
  #[serial_test::serial]
  fn smoke_assign_vpn_id_to_profile_metadata() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let (id, mut profile) = seed_profile("VPN Assign");
    profile.vpn_id = Some("vpn-smoke-1".into());
    profile.proxy_id = None;
    profile.updated_at = Some(2);
    mgr.save_profile(&profile).unwrap();

    let found = mgr
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == id)
      .expect("listed");
    assert_eq!(found.vpn_id.as_deref(), Some("vpn-smoke-1"));
    assert!(found.proxy_id.is_none());

    profile.vpn_id = None;
    profile.updated_at = Some(3);
    mgr.save_profile(&profile).unwrap();
    let cleared = mgr
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == id)
      .expect("listed");
    assert!(cleared.vpn_id.is_none());
  }

  /// EX-03: assign extension group via ProfileManager API.
  #[test]
  #[serial_test::serial]
  fn smoke_assign_extension_group_to_profile() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let (id, _) = seed_profile("Ext Group Assign");
    let updated = mgr
      .update_profile_extension_group(&id.to_string(), Some("eg-1".into()))
      .expect("assign");
    assert_eq!(updated.extension_group_id.as_deref(), Some("eg-1"));

    let cleared = mgr
      .update_profile_extension_group(&id.to_string(), None)
      .expect("clear");
    assert!(cleared.extension_group_id.is_none());
  }

  /// SY-05: enable sync mode flags on profile metadata.
  #[test]
  #[serial_test::serial]
  fn smoke_enable_sync_mode_on_profile() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileManager::instance();

    let (id, mut profile) = seed_profile("Sync Mode");
    assert!(!profile.is_sync_enabled());

    profile.sync_mode = crate::profile::types::SyncMode::Regular;
    mgr.save_profile(&profile).unwrap();
    let regular = mgr
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == id)
      .expect("listed");
    assert!(regular.is_sync_enabled());
    assert!(!regular.is_encrypted_sync());

    profile.sync_mode = crate::profile::types::SyncMode::Encrypted;
    mgr.save_profile(&profile).unwrap();
    let enc = mgr
      .list_profiles()
      .unwrap()
      .into_iter()
      .find(|p| p.id == id)
      .expect("listed");
    assert!(enc.is_sync_enabled());
    assert!(enc.is_encrypted_sync());
  }
}

