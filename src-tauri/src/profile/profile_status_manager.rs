use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ProfileStatusConfig {
  pub label: String,
  pub color: String, // hex color e.g. "#ef4444"
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ProfileStatusesData {
  statuses: Vec<ProfileStatusConfig>,
}

pub struct ProfileStatusManager;

impl Default for ProfileStatusManager {
  fn default() -> Self {
    Self::new()
  }
}

fn default_statuses() -> Vec<ProfileStatusConfig> {
  vec![
    ProfileStatusConfig {
      label: "Ban".to_string(),
      color: "#ef4444".to_string(),
    },
    ProfileStatusConfig {
      label: "Ready".to_string(),
      color: "#22c55e".to_string(),
    },
    ProfileStatusConfig {
      label: "New".to_string(),
      color: "#3b82f6".to_string(),
    },
  ]
}

impl ProfileStatusManager {
  pub fn new() -> Self {
    Self
  }

  fn get_file_path(&self) -> std::path::PathBuf {
    crate::settings::app_dirs::data_subdir().join("profile_statuses.json")
  }

  fn load_data(&self) -> Result<ProfileStatusesData, Box<dyn std::error::Error>> {
    let file_path = self.get_file_path();
    if !file_path.exists() {
      return Ok(ProfileStatusesData {
        statuses: default_statuses(),
      });
    }
    let content = fs::read_to_string(file_path)?;
    let data: ProfileStatusesData = serde_json::from_str(&content)?;
    Ok(data)
  }

  fn save_data(&self, data: &ProfileStatusesData) -> Result<(), Box<dyn std::error::Error>> {
    let file_path = self.get_file_path();
    if let Some(parent) = file_path.parent() {
      fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(data)?;
    fs::write(file_path, json)?;
    Ok(())
  }

  pub fn get_all(&self) -> Result<Vec<ProfileStatusConfig>, Box<dyn std::error::Error>> {
    Ok(self.load_data()?.statuses)
  }

  pub fn save_all(
    &self,
    statuses: Vec<ProfileStatusConfig>,
  ) -> Result<Vec<ProfileStatusConfig>, Box<dyn std::error::Error>> {
    self.save_data(&ProfileStatusesData {
      statuses: statuses.clone(),
    })?;
    Ok(statuses)
  }
}

lazy_static::lazy_static! {
  pub static ref PROFILE_STATUS_MANAGER: std::sync::Mutex<ProfileStatusManager> =
    std::sync::Mutex::new(ProfileStatusManager::new());
}

// --- Tauri commands ---

#[tauri::command]
pub fn get_profile_statuses() -> Result<Vec<ProfileStatusConfig>, String> {
  let mgr = PROFILE_STATUS_MANAGER.lock().unwrap();
  mgr
    .get_all()
    .map_err(|e| format!("Failed to get profile statuses: {e}"))
}

#[tauri::command]
pub fn save_profile_statuses(
  statuses: Vec<ProfileStatusConfig>,
) -> Result<Vec<ProfileStatusConfig>, String> {
  let mgr = PROFILE_STATUS_MANAGER.lock().unwrap();
  mgr
    .save_all(statuses)
    .map_err(|e| format!("Failed to save profile statuses: {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  #[test]
  #[serial_test::serial]
  fn smoke_default_statuses_when_file_missing() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileStatusManager::new();
    let statuses = mgr.get_all().unwrap();
    assert_eq!(statuses.len(), 3);
    assert!(statuses.iter().any(|s| s.label == "Ban"));
    assert!(statuses.iter().any(|s| s.label == "Ready"));
    assert!(statuses.iter().any(|s| s.label == "New"));
  }

  #[test]
  #[serial_test::serial]
  fn smoke_save_and_reload_statuses() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = ProfileStatusManager::new();

    let custom = vec![
      ProfileStatusConfig {
        label: "Warm".into(),
        color: "#f59e0b".into(),
      },
      ProfileStatusConfig {
        label: "Cold".into(),
        color: "#3b82f6".into(),
      },
    ];
    let saved = mgr.save_all(custom.clone()).unwrap();
    assert_eq!(saved.len(), 2);

    let reloaded = mgr.get_all().unwrap();
    assert_eq!(reloaded, custom);

    // Tauri command wrappers
    let via_cmd = get_profile_statuses().unwrap();
    assert_eq!(via_cmd.len(), 2);
    let via_save = save_profile_statuses(vec![ProfileStatusConfig {
      label: "Only".into(),
      color: "#000".into(),
    }])
    .unwrap();
    assert_eq!(via_save.len(), 1);
    assert_eq!(get_profile_statuses().unwrap()[0].label, "Only");
  }
}
