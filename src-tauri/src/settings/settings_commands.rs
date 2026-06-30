#[tauri::command]
pub async fn get_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
  let manager = SettingsManager::instance();
  let mut settings = manager
    .load_settings()
    .map_err(|e| format!("Failed to load settings: {e}"))?;

  // Always load tokens for display purposes if they exist
  settings.api_token = manager
    .get_api_token(&app_handle)
    .await
    .map_err(|e| format!("Failed to load API token: {e}"))?;

  settings.mcp_token = manager
    .get_mcp_token(&app_handle)
    .await
    .map_err(|e| format!("Failed to load MCP token: {e}"))?;

  Ok(settings)
}

#[tauri::command]
pub async fn save_app_settings(
  app_handle: tauri::AppHandle,
  mut settings: AppSettings,
) -> Result<AppSettings, String> {
  let manager = SettingsManager::instance();

  // Handle API token
  if settings.api_enabled {
    if let Some(ref token) = settings.api_token {
      manager
        .store_api_token(&app_handle, token)
        .await
        .map_err(|e| format!("Failed to store API token: {e}"))?;
    } else {
      // Check if a token already exists on disk before generating a new one
      let existing = manager.get_api_token(&app_handle).await.ok().flatten();
      if let Some(t) = existing {
        settings.api_token = Some(t);
      } else {
        let token = manager
          .generate_api_token(&app_handle)
          .await
          .map_err(|e| format!("Failed to generate API token: {e}"))?;
        settings.api_token = Some(token);
      }
    }
  }

  if !settings.api_enabled {
    manager
      .remove_api_token(&app_handle)
      .await
      .map_err(|e| format!("Failed to remove API token: {e}"))?;
    settings.api_token = None;
  }

  // Handle MCP token
  if settings.mcp_enabled {
    if let Some(ref token) = settings.mcp_token {
      manager
        .store_mcp_token(&app_handle, token)
        .await
        .map_err(|e| format!("Failed to store MCP token: {e}"))?;
    } else {
      // Check if a token already exists on disk before generating a new one
      let existing = manager.get_mcp_token(&app_handle).await.ok().flatten();
      if let Some(t) = existing {
        settings.mcp_token = Some(t);
      } else {
        let token = manager
          .generate_mcp_token(&app_handle)
          .await
          .map_err(|e| format!("Failed to generate MCP token: {e}"))?;
        settings.mcp_token = Some(token);
      }
    }
  }

  if !settings.mcp_enabled {
    manager
      .remove_mcp_token(&app_handle)
      .await
      .map_err(|e| format!("Failed to remove MCP token: {e}"))?;
    settings.mcp_token = None;
  }

  // Preserve server-managed flags that the frontend may not have up-to-date.
  // Read directly from file to avoid load_settings' save-on-load behavior.
  if let Ok(content) = std::fs::read_to_string(manager.get_settings_file()) {
    if let Ok(current) = serde_json::from_str::<AppSettings>(&content) {
      settings.window_resize_warning_dismissed = current.window_resize_warning_dismissed;
    }
  }

  let mut persist_settings = settings.clone();
  persist_settings.api_token = None;
  persist_settings.mcp_token = None;

  log::info!(
    "[settings] Saving settings: theme={}, custom_theme_keys={}",
    persist_settings.theme,
    persist_settings
      .custom_theme
      .as_ref()
      .map(|t| t.len())
      .unwrap_or(0)
  );

  manager
    .save_settings(&persist_settings)
    .map_err(|e| format!("Failed to save settings: {e}"))?;

  Ok(settings)
}

/// Read the most recent N log files concatenated into a single string,
/// suitable for paste-into-issue-tracker. Newest entries appear LAST so the
/// reader sees fresh context at the bottom of the buffer. Capped at 5 MB to
/// keep clipboard payloads sane.
#[tauri::command]
pub async fn read_log_files(app_handle: tauri::AppHandle) -> Result<String, String> {
  let dir = crate::settings::app_dirs::log_dir(&app_handle);
  if !dir.exists() {
    return Err("Log directory does not exist yet".to_string());
  }

  let mut entries: Vec<(std::path::PathBuf, std::time::SystemTime)> = std::fs::read_dir(&dir)
    .map_err(|e| format!("Failed to read log dir: {e}"))?
    .filter_map(|r| r.ok())
    .filter_map(|e| {
      let p = e.path();
      let m = e.metadata().ok()?.modified().ok()?;
      let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
      if p.is_file() && (ext == "log" || ext == "txt") {
        Some((p, m))
      } else {
        None
      }
    })
    .collect();

  entries.sort_by_key(|(_, m)| *m);

  const MAX_BYTES: usize = 5 * 1024 * 1024;
  let mut out = String::with_capacity(64 * 1024);
  for (path, _) in entries.iter().rev() {
    let header = format!("===== {} =====\n", path.display());
    if out.len() + header.len() >= MAX_BYTES {
      break;
    }
    out.push_str(&header);
    if let Ok(content) = std::fs::read_to_string(path) {
      let take = MAX_BYTES.saturating_sub(out.len());
      if take == 0 {
        break;
      }
      if content.len() > take {
        // Tail truncation — keep the END of older files so newest data is preserved.
        out.push_str("[…truncated — older content elided…]\n");
        out.push_str(&content[content.len() - take + 64..]);
      } else {
        out.push_str(&content);
      }
      if !out.ends_with('\n') {
        out.push('\n');
      }
    }
  }

  // Reverse the per-file order so chronological newest is at the bottom.
  // (We pushed newest-first above to budget the tail; flip now.)
  let mut sections: Vec<&str> = out.split("===== ").filter(|s| !s.is_empty()).collect();
  sections.reverse();
  let final_out = sections
    .into_iter()
    .map(|s| format!("===== {s}"))
    .collect::<String>();

  Ok(final_out)
}

/// Reveal the log directory in the OS file manager.
#[tauri::command]
pub async fn open_log_directory(app_handle: tauri::AppHandle) -> Result<(), String> {
  let dir = crate::settings::app_dirs::log_dir(&app_handle);
  if !dir.exists() {
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create log dir: {e}"))?;
  }
  let path = dir.to_string_lossy().to_string();

  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&path)
      .spawn()
      .map_err(|e| format!("Failed to open log dir: {e}"))?;
  }
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&path)
      .spawn()
      .map_err(|e| format!("Failed to open log dir: {e}"))?;
  }
  #[cfg(target_os = "linux")]
  {
    std::process::Command::new("xdg-open")
      .arg(&path)
      .spawn()
      .map_err(|e| format!("Failed to open log dir: {e}"))?;
  }
  Ok(())
}

#[tauri::command]
pub async fn get_table_sorting_settings() -> Result<TableSortingSettings, String> {
  let manager = SettingsManager::instance();
  manager
    .load_table_sorting()
    .map_err(|e| format!("Failed to load table sorting settings: {e}"))
}

#[tauri::command]
pub async fn save_table_sorting_settings(sorting: TableSortingSettings) -> Result<(), String> {
  let manager = SettingsManager::instance();
  manager
    .save_table_sorting(&sorting)
    .map_err(|e| format!("Failed to save table sorting settings: {e}"))
}

#[tauri::command]
pub async fn get_sync_settings(app_handle: tauri::AppHandle) -> Result<SyncSettings, String> {
  // Cloud auth takes priority over self-hosted settings
  if crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await {
    let sync_token = crate::api::cloud_auth::CLOUD_AUTH
      .get_or_refresh_sync_token()
      .await
      .map_err(|e| format!("Failed to get cloud sync token: {e}"))?;
    return Ok(SyncSettings {
      sync_server_url: Some(crate::api::cloud_auth::CLOUD_SYNC_URL.to_string()),
      sync_token,
    });
  }

  // Fall back to self-hosted settings
  let manager = SettingsManager::instance();
  let mut sync_settings = manager
    .get_sync_settings()
    .map_err(|e| format!("Failed to load sync settings: {e}"))?;

  sync_settings.sync_token = manager
    .get_sync_token(&app_handle)
    .await
    .map_err(|e| format!("Failed to load sync token: {e}"))?;

  Ok(sync_settings)
}

#[tauri::command]
pub async fn save_sync_settings(
  app_handle: tauri::AppHandle,
  sync_server_url: Option<String>,
  sync_token: Option<String>,
) -> Result<SyncSettings, String> {
  // Cloud login and self-hosted sync share the same sync engine and a
  // profile can't be sync'd to two backends at once. Block any *write*
  // (non-null URL or token) while the user is signed into their cloud
  // account — the clearing path (both `None`) is always allowed so logged-
  // in users can wipe a stale self-hosted config that pre-dates their
  // sign-in.
  let is_setting_self_hosted = sync_server_url.is_some() || sync_token.is_some();
  if is_setting_self_hosted && crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await {
    return Err(serde_json::json!({ "code": "SELF_HOSTED_REQUIRES_LOGOUT" }).to_string());
  }

  let manager = SettingsManager::instance();

  manager
    .save_sync_server_url(sync_server_url.clone())
    .map_err(|e| format!("Failed to save sync server URL: {e}"))?;

  if let Some(ref token) = sync_token {
    manager
      .store_sync_token(&app_handle, token)
      .await
      .map_err(|e| format!("Failed to store sync token: {e}"))?;
  } else {
    manager
      .remove_sync_token(&app_handle)
      .await
      .map_err(|e| format!("Failed to remove sync token: {e}"))?;
  }

  Ok(SyncSettings {
    sync_server_url,
    sync_token,
  })
}

#[tauri::command]
pub async fn dismiss_window_resize_warning() -> Result<(), String> {
  let manager = SettingsManager::instance();
  let mut settings = manager
    .load_settings()
    .map_err(|e| format!("Failed to load settings: {e}"))?;
  settings.window_resize_warning_dismissed = true;
  manager
    .save_settings(&settings)
    .map_err(|e| format!("Failed to save settings: {e}"))
}

#[tauri::command]
pub async fn get_window_resize_warning_dismissed() -> Result<bool, String> {
  let manager = SettingsManager::instance();
  let settings = manager
    .load_settings()
    .map_err(|e| format!("Failed to load settings: {e}"))?;
  Ok(settings.window_resize_warning_dismissed)
}

#[tauri::command]
pub async fn get_onboarding_completed() -> Result<bool, String> {
  let manager = SettingsManager::instance();
  let settings = manager
    .load_settings()
    .map_err(|e| format!("Failed to load settings: {e}"))?;
  Ok(settings.onboarding_completed)
}

#[tauri::command]
pub async fn complete_onboarding() -> Result<(), String> {
  let manager = SettingsManager::instance();
  let mut settings = manager
    .load_settings()
    .map_err(|e| format!("Failed to load settings: {e}"))?;
  settings.onboarding_completed = true;
  manager
    .save_settings(&settings)
    .map_err(|e| format!("Failed to save settings: {e}"))
}

#[tauri::command]
pub fn get_system_language() -> String {
  sys_locale::get_locale()
    .map(|locale| {
      // Extract just the language code (e.g., "en" from "en-US")
      locale
        .split(['-', '_'])
        .next()
        .unwrap_or("en")
        .to_lowercase()
    })
    .unwrap_or_else(|| "en".to_string())
}

#[derive(Debug, Serialize, Clone)]
pub struct SystemInfo {
  pub app_version: String,
  pub os: String,
  pub arch: String,
  pub portable: bool,
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
  let os = if cfg!(target_os = "macos") {
    "macOS"
  } else if cfg!(target_os = "windows") {
    "Windows"
  } else if cfg!(target_os = "linux") {
    "Linux"
  } else {
    "Unknown"
  };

  let arch = if cfg!(target_arch = "x86_64") {
    "x86_64"
  } else if cfg!(target_arch = "aarch64") {
    "aarch64"
  } else {
    "unknown"
  };

  SystemInfo {
    app_version: crate::updater::app_auto_updater::AppAutoUpdater::get_current_version(),
    os: os.to_string(),
    arch: arch.to_string(),
    portable: crate::settings::app_dirs::is_portable(),
  }
}

// Global singleton instance

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  fn create_test_settings_manager() -> (
    SettingsManager,
    TempDir,
    crate::settings::app_dirs::TestDirGuard,
  ) {
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let guard = crate::settings::app_dirs::set_test_data_dir(temp_dir.path().to_path_buf());
    let manager = SettingsManager::new();
    (manager, temp_dir, guard)
  }

  #[test]
  fn test_settings_manager_creation() {
    let (_manager, _temp_dir, _guard) = create_test_settings_manager();
  }

  #[test]
  fn test_default_app_settings() {
    let default_settings = AppSettings::default();

    assert!(
      !default_settings.set_as_default_browser,
      "Default should not set as default browser"
    );
    assert_eq!(
      default_settings.theme, "system",
      "Default theme should be system"
    );
  }

  #[test]
  fn test_default_table_sorting_settings() {
    let default_sorting = TableSortingSettings::default();

    assert_eq!(
      default_sorting.column, "name",
      "Default sort column should be name"
    );
    assert_eq!(
      default_sorting.direction, "asc",
      "Default sort direction should be asc"
    );
  }

  #[test]
  fn test_load_settings_nonexistent_file() {
    let (manager, _temp_dir, _guard) = create_test_settings_manager();

    let result = manager.load_settings();
    assert!(
      result.is_ok(),
      "Should handle nonexistent settings file gracefully"
    );

    let settings = result.unwrap();
    assert!(
      !settings.set_as_default_browser,
      "Should return default settings"
    );
    assert_eq!(settings.theme, "system", "Should return default theme");
  }

  #[test]
  fn test_save_and_load_settings() {
    let (manager, _temp_dir, _guard) = create_test_settings_manager();

    let test_settings = AppSettings {
      set_as_default_browser: true,
      theme: "dark".to_string(),
      custom_theme: None,
      api_enabled: false,
      api_port: 10108,
      api_token: None,
      sync_server_url: None,
      first_launch_timestamp: None,
      commercial_trial_acknowledged: false,
      mcp_enabled: false,
      mcp_port: None,
      mcp_token: None,
      language: None,
      window_resize_warning_dismissed: false,
      onboarding_completed: false,
      disable_auto_updates: false,
      keep_decrypted_profiles_in_ram: false,
    };

    let save_result = manager.save_settings(&test_settings);
    assert!(save_result.is_ok(), "Should save settings successfully");

    let load_result = manager.load_settings();
    assert!(load_result.is_ok(), "Should load settings successfully");

    let loaded_settings = load_result.unwrap();
    assert!(
      loaded_settings.set_as_default_browser,
      "Loaded settings should match saved"
    );
    assert_eq!(
      loaded_settings.theme, "dark",
      "Loaded theme should match saved"
    );
  }

  #[test]
  fn test_load_table_sorting_nonexistent_file() {
    let (manager, _temp_dir, _guard) = create_test_settings_manager();

    let result = manager.load_table_sorting();
    assert!(
      result.is_ok(),
      "Should handle nonexistent sorting file gracefully"
    );

    let sorting = result.unwrap();
    assert_eq!(sorting.column, "name", "Should return default sorting");
    assert_eq!(sorting.direction, "asc", "Should return default direction");
  }

  #[test]
  fn test_save_and_load_table_sorting() {
    let (manager, _temp_dir, _guard) = create_test_settings_manager();

    let test_sorting = TableSortingSettings {
      column: "browser".to_string(),
      direction: "desc".to_string(),
    };

    let save_result = manager.save_table_sorting(&test_sorting);
    assert!(save_result.is_ok(), "Should save sorting successfully");

    let load_result = manager.load_table_sorting();
    assert!(load_result.is_ok(), "Should load sorting successfully");

    let loaded_sorting = load_result.unwrap();
    assert_eq!(
      loaded_sorting.column, "browser",
      "Loaded column should match saved"
    );
    assert_eq!(
      loaded_sorting.direction, "desc",
      "Loaded direction should match saved"
    );
  }

  #[test]
  fn test_load_corrupted_settings_file() {
    let (manager, _temp_dir, _guard) = create_test_settings_manager();

    let settings_dir = manager.get_settings_dir();
    fs::create_dir_all(&settings_dir).expect("Should create settings directory");

    let settings_file = manager.get_settings_file();
    fs::write(&settings_file, "{ invalid json }").expect("Should write corrupted file");

    let result = manager.load_settings();
    assert!(
      result.is_ok(),
      "Should handle corrupted settings file gracefully"
    );

    let settings = result.unwrap();
    assert!(
      !settings.set_as_default_browser,
      "Should return default settings for corrupted file"
    );
    assert_eq!(
      settings.theme, "system",
      "Should return default theme for corrupted file"
    );
  }

  #[test]
  fn test_settings_file_paths() {
    let (manager, _temp_dir, _guard) = create_test_settings_manager();

    let settings_dir = manager.get_settings_dir();
    let settings_file = manager.get_settings_file();
    let sorting_file = manager.get_table_sorting_file();

    assert!(
      settings_dir.to_string_lossy().contains("settings"),
      "Settings dir should contain 'settings'"
    );
    assert!(
      settings_file
        .to_string_lossy()
        .ends_with("app_settings.json"),
      "Settings file should end with app_settings.json"
    );
    assert!(
      sorting_file
        .to_string_lossy()
        .ends_with("table_sorting.json"),
      "Sorting file should end with table_sorting.json"
    );
  }
}
