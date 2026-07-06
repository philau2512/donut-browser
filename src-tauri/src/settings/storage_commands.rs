use super::storage_settings::StorageSettings;
use super::storage_validator::{validate_storage_path, StorageValidationResult};
use std::path::PathBuf;

/// Get the current custom storage path (if set)
#[tauri::command]
pub fn get_custom_storage_path() -> Option<PathBuf> {
  match StorageSettings::load() {
    Ok(settings) => settings.custom_path,
    Err(e) => {
      log::error!("Failed to load storage settings: {e}");
      None
    }
  }
}

/// Validate a custom storage path without applying it
#[tauri::command]
pub fn validate_custom_storage_path(path: String) -> StorageValidationResult {
  let path_buf = PathBuf::from(path);
  validate_storage_path(&path_buf)
}

/// Set a custom storage path (requires app restart to take effect)
#[tauri::command]
pub async fn set_custom_storage_path(path: String) -> Result<StorageValidationResult, String> {
  let path_buf = PathBuf::from(&path);

  // Validate the path first
  let validation = validate_storage_path(&path_buf);
  if !validation.is_valid {
    return Ok(validation);
  }

  // Get the absolute path from validation
  let absolute_path = validation
    .absolute_path
    .clone()
    .ok_or("Validation did not return absolute path")?;

  // Create and save settings
  let mut settings = StorageSettings::load().unwrap_or_default();
  settings.custom_path = Some(absolute_path);
  settings.modified_at = Some(chrono::Utc::now().to_rfc3339());

  settings.save()?;

  log::info!("Custom storage path set to: {path}");
  log::warn!("Application restart required for storage path change to take effect");

  Ok(validation)
}

/// Clear the custom storage path (revert to default)
#[tauri::command]
pub async fn clear_custom_storage_path() -> Result<(), String> {
  let mut settings = StorageSettings::load().unwrap_or_default();
  settings.custom_path = None;
  settings.modified_at = Some(chrono::Utc::now().to_rfc3339());

  settings.save()?;

  log::info!("Custom storage path cleared, reverting to default");
  log::warn!("Application restart required for storage path change to take effect");

  Ok(())
}

/// Check if a custom storage path is currently active
#[tauri::command]
pub fn is_custom_storage_active() -> bool {
  super::storage_settings::is_storage_override_active()
}

/// Get information about current storage location
#[derive(serde::Serialize)]
pub struct StorageInfo {
  pub is_custom: bool,
  pub current_path: PathBuf,
  pub default_path: PathBuf,
  pub custom_path: Option<PathBuf>,
}

#[tauri::command]
pub fn get_storage_info() -> StorageInfo {
  let default_path = {
    // Calculate default path without override
    use directories::BaseDirs;
    let base_dirs = BaseDirs::new().expect("Failed to get base directories");
    let app_name = super::app_dirs::app_name();
    base_dirs.data_local_dir().join(app_name)
  };

  let current_path = super::app_dirs::data_dir();
  let custom_path = super::storage_settings::get_storage_override();
  let is_custom = custom_path.is_some();

  StorageInfo {
    is_custom,
    current_path,
    default_path,
    custom_path,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_get_storage_info() {
    let info = get_storage_info();
    assert!(info.current_path.exists() || !info.current_path.to_string_lossy().is_empty());
    assert!(!info.default_path.to_string_lossy().is_empty());
  }
}
