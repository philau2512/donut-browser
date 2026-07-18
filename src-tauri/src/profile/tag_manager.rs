use crate::profile::BrowserProfile;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct TagsData {
  tags: Vec<String>,
}

pub struct TagManager;

impl Default for TagManager {
  fn default() -> Self {
    Self::new()
  }
}

impl TagManager {
  pub fn new() -> Self {
    Self
  }

  fn get_tags_file_path(&self) -> std::path::PathBuf {
    crate::settings::app_dirs::data_subdir().join("tags.json")
  }

  fn load_tags_data(&self) -> Result<TagsData, Box<dyn std::error::Error>> {
    let file_path = self.get_tags_file_path();
    if !file_path.exists() {
      return Ok(TagsData::default());
    }
    let content = fs::read_to_string(file_path)?;
    let data: TagsData = serde_json::from_str(&content)?;
    Ok(data)
  }

  fn save_tags_data(&self, data: &TagsData) -> Result<(), Box<dyn std::error::Error>> {
    let file_path = self.get_tags_file_path();
    if let Some(parent) = file_path.parent() {
      fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(data)?;
    fs::write(file_path, json)?;
    Ok(())
  }

  pub fn get_all_tags(&self) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut all = self.load_tags_data()?.tags;
    // Ensure deterministic order
    all.sort();
    all.dedup();
    Ok(all)
  }

  pub fn rebuild_from_profiles(
    &self,
    profiles: &[BrowserProfile],
  ) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    // Build a set of all tags, starting with existing global tags to preserve them
    let mut set: BTreeSet<String> = BTreeSet::new();
    if let Ok(existing) = self.load_tags_data() {
      for tag in existing.tags {
        set.insert(tag);
      }
    }

    for profile in profiles {
      for tag in &profile.tags {
        // Store exactly as provided (no normalization) to preserve characters
        set.insert(tag.clone());
      }
    }
    let combined: Vec<String> = set.into_iter().collect();
    self.save_tags_data(&TagsData {
      tags: combined.clone(),
    })?;
    Ok(combined)
  }

  pub fn delete_tag(&self, tag: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut data = self.load_tags_data()?;
    data.tags.retain(|t| t != tag);
    self.save_tags_data(&data)?;
    Ok(())
  }
}

#[tauri::command]
pub fn get_all_tags() -> Result<Vec<String>, String> {
  let tag_manager = crate::profile::tag_manager::TAG_MANAGER.lock().unwrap();
  tag_manager
    .get_all_tags()
    .map_err(|e| format!("Failed to get tags: {e}"))
}

#[tauri::command]
pub fn delete_tag(app_handle: tauri::AppHandle, tag: String) -> Result<(), String> {
  let profile_manager = crate::profile::ProfileManager::instance();
  profile_manager
    .delete_tag_globally(&app_handle, &tag)
    .map_err(|e| format!("Failed to delete tag: {e}"))
}

lazy_static::lazy_static! {
  pub static ref TAG_MANAGER: std::sync::Mutex<TagManager> = std::sync::Mutex::new(TagManager::new());
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::profile::types::BrowserProfile;
  use tempfile::TempDir;

  fn profile_with_tags(tags: &[&str]) -> BrowserProfile {
    BrowserProfile {
      id: uuid::Uuid::new_v4(),
      name: "t".into(),
      browser: "wayfern".into(),
      version: "1".into(),
      tags: tags.iter().map(|s| (*s).to_string()).collect(),
      ..Default::default()
    }
  }

  #[test]
  #[serial_test::serial]
  fn smoke_empty_tags_then_rebuild_from_profiles() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = TagManager::new();

    assert!(mgr.get_all_tags().unwrap().is_empty());

    let profiles = vec![
      profile_with_tags(&["alpha", "beta"]),
      profile_with_tags(&["beta", "gamma"]),
    ];
    let all = mgr.rebuild_from_profiles(&profiles).unwrap();
    assert_eq!(all, vec!["alpha", "beta", "gamma"]);

    // Preserve global tags not on profiles
    let _ = mgr.rebuild_from_profiles(&[profile_with_tags(&["delta"])]);
    let after = mgr.get_all_tags().unwrap();
    assert!(after.contains(&"alpha".to_string()));
    assert!(after.contains(&"delta".to_string()));
  }

  #[test]
  #[serial_test::serial]
  fn smoke_delete_tag() {
    let temp = TempDir::new().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(temp.path().to_path_buf());
    let mgr = TagManager::new();
    mgr
      .rebuild_from_profiles(&[profile_with_tags(&["keep", "drop"])])
      .unwrap();
    mgr.delete_tag("drop").unwrap();
    let tags = mgr.get_all_tags().unwrap();
    assert!(tags.contains(&"keep".to_string()));
    assert!(!tags.contains(&"drop".to_string()));
  }
}
