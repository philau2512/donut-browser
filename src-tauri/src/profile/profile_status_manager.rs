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
