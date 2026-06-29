pub mod auto_updater_core;

pub use auto_updater_core::{AutoUpdateState, AutoUpdater, UpdateNotification};

// Tauri commands

#[tauri::command]
pub async fn check_for_browser_updates() -> Result<Vec<UpdateNotification>, String> {
  let updater = AutoUpdater::instance();
  let notifications = updater
    .check_for_updates()
    .await
    .map_err(|e| format!("Failed to check for updates: {e}"))?;
  let grouped = updater.group_update_notifications(notifications);
  Ok(grouped)
}

#[tauri::command]
pub async fn dismiss_update_notification(notification_id: String) -> Result<(), String> {
  let updater = AutoUpdater::instance();
  updater
    .dismiss_update_notification(&notification_id)
    .map_err(|e| format!("Failed to dismiss notification: {e}"))
}

#[tauri::command]
pub async fn complete_browser_update_with_auto_update(
  app_handle: tauri::AppHandle,
  browser: String,
  new_version: String,
) -> Result<Vec<String>, String> {
  let updater = AutoUpdater::instance();
  updater
    .complete_browser_update_with_auto_update(&app_handle, &browser, &new_version)
    .await
    .map_err(|e| format!("Failed to complete browser update: {e}"))
}

#[tauri::command]
pub async fn check_for_updates_with_progress(app_handle: tauri::AppHandle) {
  let updater = AutoUpdater::instance();
  updater.check_for_updates_with_progress(&app_handle).await;
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::browser::browser_version_manager::BrowserVersionInfo;
  use crate::profile::BrowserProfile;

  fn create_test_profile(name: &str, browser: &str, version: &str) -> BrowserProfile {
    BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: name.to_string(),
      browser: browser.to_string(),
      version: version.to_string(),
      process_id: None,
      proxy_id: None,
      vpn_id: None,
      launch_hook: None,
      automation: None,
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
      profile_status: None,
    }
  }

  fn create_test_version_info(version: &str, is_prerelease: bool) -> BrowserVersionInfo {
    BrowserVersionInfo {
      version: version.to_string(),
      is_prerelease,
      date: "2024-01-01".to_string(),
    }
  }

  #[test]
  fn test_compare_versions() {
    let updater = AutoUpdater::instance();

    assert_eq!(
      updater.compare_versions("1.0.0", "1.0.0"),
      std::cmp::Ordering::Equal
    );
    assert_eq!(
      updater.compare_versions("1.0.1", "1.0.0"),
      std::cmp::Ordering::Greater
    );
    assert_eq!(
      updater.compare_versions("1.0.0", "1.0.1"),
      std::cmp::Ordering::Less
    );
    assert_eq!(
      updater.compare_versions("2.0.0", "1.9.9"),
      std::cmp::Ordering::Greater
    );
    assert_eq!(
      updater.compare_versions("1.10.0", "1.9.0"),
      std::cmp::Ordering::Greater
    );
  }

  #[test]
  fn test_is_version_newer() {
    let updater = AutoUpdater::instance();

    assert!(updater.is_version_newer("1.0.1", "1.0.0"));
    assert!(updater.is_version_newer("2.0.0", "1.9.9"));
    assert!(!updater.is_version_newer("1.0.0", "1.0.1"));
    assert!(!updater.is_version_newer("1.0.0", "1.0.0"));
  }

  #[test]
  fn test_camoufox_beta_version_comparison() {
    let updater = AutoUpdater::instance();

    // Test the exact user-reported scenario: 135.0.1beta24 vs 135.0beta22
    assert!(
      updater.is_version_newer("135.0.1beta24", "135.0beta22"),
      "135.0.1beta24 should be newer than 135.0beta22"
    );

    assert_eq!(
      updater.compare_versions("135.0.1beta24", "135.0beta22"),
      std::cmp::Ordering::Greater,
      "135.0.1beta24 should compare as greater than 135.0beta22"
    );

    // Test other camoufox beta version combinations
    assert!(
      updater.is_version_newer("135.0.5beta24", "135.0.5beta22"),
      "135.0.5beta24 should be newer than 135.0.5beta22"
    );

    assert!(
      updater.is_version_newer("135.0.1beta1", "135.0beta1"),
      "135.0.1beta1 should be newer than 135.0beta1 due to patch version"
    );

    // Test that older versions are not considered newer
    assert!(
      !updater.is_version_newer("135.0beta22", "135.0.1beta24"),
      "135.0beta22 should NOT be newer than 135.0.1beta24"
    );
  }

  #[test]
  fn test_beta_version_ordering_comprehensive() {
    let updater = AutoUpdater::instance();

    // Test various beta version patterns that could appear in camoufox
    let test_cases = vec![
      ("135.0.1beta24", "135.0beta22", true),   // User reported case
      ("135.0.5beta24", "135.0.5beta22", true), // Same patch, different beta
      ("135.1beta1", "135.0beta99", true),      // Higher minor beats beta number
      ("136.0beta1", "135.9.9beta99", true),    // Higher major beats everything
      ("135.0.1beta1", "135.0beta1", true),     // Patch version matters
      ("135.0beta22", "135.0.1beta24", false),  // Reverse of user case
    ];

    for (newer, older, should_be_newer) in test_cases {
      let result = updater.is_version_newer(newer, older);
      assert_eq!(
        result,
        should_be_newer,
        "Expected {} {} {} but got {}",
        newer,
        if should_be_newer { ">" } else { "<=" },
        older,
        if result { "true" } else { "false" }
      );
    }
  }

  #[test]
  fn test_check_profile_update_stable_to_stable() {
    let updater = AutoUpdater::instance();
    let profile = create_test_profile("test", "firefox", "1.0.0");
    let versions = vec![
      create_test_version_info("1.0.1", false), // stable, newer
      create_test_version_info("1.1.0-alpha", true), // alpha, should be ignored
      create_test_version_info("0.9.0", false), // stable, older
    ];

    let result = updater.check_profile_update(&profile, &versions).unwrap();
    assert!(result.is_some());

    let update = result.unwrap();
    assert_eq!(update.new_version, "1.0.1");
    assert!(update.is_stable_update);
  }

  #[test]
  fn test_check_profile_update_alpha_to_alpha() {
    let updater = AutoUpdater::instance();
    let profile = create_test_profile("test", "firefox", "1.0.0-alpha");
    let versions = vec![
      create_test_version_info("1.0.1", false), // stable, should be included
      create_test_version_info("1.1.0-alpha", true), // alpha, newer
      create_test_version_info("0.9.0-alpha", true), // alpha, older
    ];

    let result = updater.check_profile_update(&profile, &versions).unwrap();
    assert!(result.is_some());

    let update = result.unwrap();
    // Should pick the newest version (alpha user can upgrade to stable or newer alpha)
    assert_eq!(update.new_version, "1.1.0-alpha");
    assert!(!update.is_stable_update);
  }

  #[test]
  fn test_check_profile_update_no_update_available() {
    let updater = AutoUpdater::instance();
    let profile = create_test_profile("test", "firefox", "1.0.0");
    let versions = vec![
      create_test_version_info("0.9.0", false), // older
      create_test_version_info("1.0.0", false), // same version
    ];

    let result = updater.check_profile_update(&profile, &versions).unwrap();
    assert!(result.is_none());
  }

  #[test]
  fn test_group_update_notifications() {
    let updater = AutoUpdater::instance();
    let notifications = vec![
      UpdateNotification {
        id: "firefox_1.0.0_to_1.1.0_profile1".to_string(),
        browser: "firefox".to_string(),
        current_version: "1.0.0".to_string(),
        new_version: "1.1.0".to_string(),
        affected_profiles: vec!["profile1".to_string()],
        is_stable_update: true,
        timestamp: 1000,
      },
      UpdateNotification {
        id: "firefox_1.0.0_to_1.1.0_profile2".to_string(),
        browser: "firefox".to_string(),
        current_version: "1.0.0".to_string(),
        new_version: "1.1.0".to_string(),
        affected_profiles: vec!["profile2".to_string()],
        is_stable_update: true,
        timestamp: 1001,
      },
      UpdateNotification {
        id: "chrome_1.0.0_to_1.1.0-alpha".to_string(),
        browser: "chrome".to_string(),
        current_version: "1.0.0".to_string(),
        new_version: "1.1.0-alpha".to_string(),
        affected_profiles: vec!["profile3".to_string()],
        is_stable_update: false,
        timestamp: 1002,
      },
    ];

    let grouped = updater.group_update_notifications(notifications);

    assert_eq!(grouped.len(), 2);

    // Find the Firefox notification
    let firefox_notification = grouped.iter().find(|n| n.browser == "firefox").unwrap();
    assert_eq!(firefox_notification.affected_profiles.len(), 2);
    assert!(firefox_notification
      .affected_profiles
      .contains(&"profile1".to_string()));
    assert!(firefox_notification
      .affected_profiles
      .contains(&"profile2".to_string()));

    // Stable updates should come first
    assert!(grouped[0].is_stable_update);
  }

  #[test]
  fn test_auto_update_state_persistence() {
    use std::sync::Once;
    use tempfile::TempDir;

    static INIT: Once = Once::new();
    INIT.call_once(|| {
      // Initialize any required static data
    });

    // Create a temporary directory for testing
    let temp_dir = TempDir::new().unwrap();

    // Create a mock settings manager that uses the temp directory
    struct TestSettingsManager {
      settings_dir: std::path::PathBuf,
    }

    impl TestSettingsManager {
      fn new(settings_dir: std::path::PathBuf) -> Self {
        Self { settings_dir }
      }

      fn get_settings_dir(&self) -> std::path::PathBuf {
        self.settings_dir.clone()
      }
    }

    let test_settings_manager = TestSettingsManager::new(temp_dir.path().to_path_buf());

    let mut state = AutoUpdateState::default();
    state.disabled_browsers.insert("firefox".to_string());
    state
      .auto_update_downloads
      .insert("firefox-1.1.0".to_string());
    state.pending_updates.push(UpdateNotification {
      id: "test".to_string(),
      browser: "firefox".to_string(),
      current_version: "1.0.0".to_string(),
      new_version: "1.1.0".to_string(),
      affected_profiles: vec!["profile1".to_string()],
      is_stable_update: true,
      timestamp: 1000,
    });

    // Test save and load
    let state_file = test_settings_manager
      .get_settings_dir()
      .join("auto_update_state.json");
    std::fs::create_dir_all(test_settings_manager.get_settings_dir())
      .expect("Failed to create settings directory");
    let json = serde_json::to_string_pretty(&state).expect("Failed to serialize state");
    std::fs::write(&state_file, json).expect("Failed to write state file");

    // Load state
    let content = std::fs::read_to_string(&state_file).expect("Failed to read state file");
    let loaded_state: AutoUpdateState =
      serde_json::from_str(&content).expect("Failed to deserialize state");

    assert_eq!(loaded_state.disabled_browsers.len(), 1);
    assert!(loaded_state.disabled_browsers.contains("firefox"));
    assert_eq!(loaded_state.auto_update_downloads.len(), 1);
    assert!(loaded_state.auto_update_downloads.contains("firefox-1.1.0"));
    assert_eq!(loaded_state.pending_updates.len(), 1);
    assert_eq!(loaded_state.pending_updates[0].id, "test");
  }

  #[tokio::test]
  async fn test_browser_disable_enable_cycle() {
    use tempfile::TempDir;

    // Create a temporary directory for testing
    let temp_dir = TempDir::new().unwrap();

    // Create a mock settings manager that uses the temp directory
    struct TestSettingsManager {
      settings_dir: std::path::PathBuf,
    }

    impl TestSettingsManager {
      fn new(settings_dir: std::path::PathBuf) -> Self {
        Self { settings_dir }
      }

      fn get_settings_dir(&self) -> std::path::PathBuf {
        self.settings_dir.clone()
      }
    }

    let test_settings_manager = TestSettingsManager::new(temp_dir.path().to_path_buf());

    // Test browser disable/enable cycle with manual state management
    let state_file = test_settings_manager
      .get_settings_dir()
      .join("auto_update_state.json");
    std::fs::create_dir_all(test_settings_manager.get_settings_dir())
      .expect("Failed to create settings directory");

    // Initially not disabled (empty state file means default state)
    let state = AutoUpdateState::default();
    assert!(
      !state.disabled_browsers.contains("firefox"),
      "Firefox should not be disabled initially"
    );

    // Start update (should disable)
    let mut state = AutoUpdateState::default();
    state.disabled_browsers.insert("firefox".to_string());
    state
      .auto_update_downloads
      .insert("firefox-1.1.0".to_string());
    let json = serde_json::to_string_pretty(&state).expect("Failed to serialize state");
    std::fs::write(&state_file, json).expect("Failed to write state file");

    // Check that it's disabled
    let content = std::fs::read_to_string(&state_file).expect("Failed to read state file");
    let loaded_state: AutoUpdateState =
      serde_json::from_str(&content).expect("Failed to deserialize state");
    assert!(
      loaded_state.disabled_browsers.contains("firefox"),
      "Firefox should be disabled"
    );
    assert!(
      loaded_state.auto_update_downloads.contains("firefox-1.1.0"),
      "Firefox download should be tracked"
    );

    // Complete update (should enable)
    let mut state = loaded_state;
    state.disabled_browsers.remove("firefox");
    state.auto_update_downloads.remove("firefox-1.1.0");
    let json = serde_json::to_string_pretty(&state).expect("Failed to serialize final state");
    std::fs::write(&state_file, json).expect("Failed to write final state file");

    // Check that it's enabled again
    let content = std::fs::read_to_string(&state_file).expect("Failed to read final state file");
    let final_state: AutoUpdateState =
      serde_json::from_str(&content).expect("Failed to deserialize final state");
    assert!(
      !final_state.disabled_browsers.contains("firefox"),
      "Firefox should be enabled again"
    );
    assert!(
      !final_state.auto_update_downloads.contains("firefox-1.1.0"),
      "Firefox download should not be tracked anymore"
    );
  }

  #[test]
  fn test_dismiss_update_notification() {
    use tempfile::TempDir;

    // Create a temporary directory for testing
    let temp_dir = TempDir::new().unwrap();

    // Create a mock settings manager that uses the temp directory
    struct TestSettingsManager {
      settings_dir: std::path::PathBuf,
    }

    impl TestSettingsManager {
      fn new(settings_dir: std::path::PathBuf) -> Self {
        Self { settings_dir }
      }

      fn get_settings_dir(&self) -> std::path::PathBuf {
        self.settings_dir.clone()
      }
    }

    let test_settings_manager = TestSettingsManager::new(temp_dir.path().to_path_buf());

    let mut state = AutoUpdateState::default();
    state.pending_updates.push(UpdateNotification {
      id: "test_notification".to_string(),
      browser: "firefox".to_string(),
      current_version: "1.0.0".to_string(),
      new_version: "1.1.0".to_string(),
      affected_profiles: vec!["profile1".to_string()],
      is_stable_update: true,
      timestamp: 1000,
    });

    // Save initial state
    let state_file = test_settings_manager
      .get_settings_dir()
      .join("auto_update_state.json");
    std::fs::create_dir_all(test_settings_manager.get_settings_dir())
      .expect("Failed to create settings directory");
    let json = serde_json::to_string_pretty(&state).expect("Failed to serialize initial state");
    std::fs::write(&state_file, json).expect("Failed to write initial state file");

    // Dismiss notification (remove from pending updates)
    state
      .pending_updates
      .retain(|n| n.id != "test_notification");
    let json = serde_json::to_string_pretty(&state).expect("Failed to serialize updated state");
    std::fs::write(&state_file, json).expect("Failed to write updated state file");

    // Check that it's removed
    let content = std::fs::read_to_string(&state_file).expect("Failed to read updated state file");
    let loaded_state: AutoUpdateState =
      serde_json::from_str(&content).expect("Failed to deserialize updated state");
    assert_eq!(
      loaded_state.pending_updates.len(),
      0,
      "Pending updates should be empty after dismissal"
    );
  }
}
