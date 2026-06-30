use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::events;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extension {
  pub id: String,
  pub name: String,
  pub file_name: String,
  pub file_type: String,
  pub browser_compatibility: Vec<String>,
  pub created_at: u64,
  pub updated_at: u64,
  #[serde(default)]
  pub sync_enabled: bool,
  #[serde(default)]
  pub last_sync: Option<u64>,
  #[serde(default)]
  pub version: Option<String>,
  #[serde(default)]
  pub description: Option<String>,
  #[serde(default)]
  pub author: Option<String>,
  #[serde(default)]
  pub homepage_url: Option<String>,
  /// Firefox extension ID from `browser_specific_settings.gecko.id` (or
  /// `applications.gecko.id` in old manifests). Firefox refuses to load a
  /// sideloaded .xpi unless the filename matches this value.
  #[serde(default)]
  pub gecko_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionGroup {
  pub id: String,
  pub name: String,
  pub extension_ids: Vec<String>,
  pub created_at: u64,
  pub updated_at: u64,
  #[serde(default)]
  pub sync_enabled: bool,
  #[serde(default)]
  pub last_sync: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExtensionGroupsData {
  groups: Vec<ExtensionGroup>,
}

fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

fn extensions_base_dir() -> PathBuf {
  crate::settings::app_dirs::extensions_dir()
}

fn extension_groups_file() -> PathBuf {
  crate::settings::app_dirs::data_subdir().join("extension_groups.json")
}

fn determine_browser_compatibility(file_type: &str) -> Vec<String> {
  match file_type {
    "xpi" => vec!["firefox".to_string()],
    "crx" => vec!["chromium".to_string()],
    "zip" => vec!["chromium".to_string(), "firefox".to_string()],
    _ => vec![],
  }
}

fn get_file_type(file_name: &str) -> Option<String> {
  let ext = file_name.rsplit('.').next()?.to_lowercase();
  match ext.as_str() {
    "xpi" | "crx" | "zip" => Some(ext),
    _ => None,
  }
}

fn find_zip_start(data: &[u8]) -> usize {
  for i in 0..data.len().saturating_sub(3) {
    if data[i] == 0x50 && data[i + 1] == 0x4B && data[i + 2] == 0x03 && data[i + 3] == 0x04 {
      return i;
    }
  }
  0
}

#[allow(clippy::type_complexity)]
fn extract_manifest_metadata(
  file_data: &[u8],
  file_type: &str,
) -> (
  Option<String>,
  Option<String>,
  Option<String>,
  Option<String>,
  Option<String>,
) {
  let zip_start = if file_type == "crx" {
    find_zip_start(file_data)
  } else {
    0
  };

  let cursor = std::io::Cursor::new(&file_data[zip_start..]);
  let mut archive = match zip::ZipArchive::new(cursor) {
    Ok(a) => a,
    Err(_) => return (None, None, None, None, None),
  };

  let manifest_content = if let Ok(mut file) = archive.by_name("manifest.json") {
    let mut contents = String::new();
    if std::io::Read::read_to_string(&mut file, &mut contents).is_ok() {
      Some(contents)
    } else {
      None
    }
  } else {
    None
  };

  let manifest_content = match manifest_content {
    Some(c) => c,
    None => return (None, None, None, None, None),
  };

  let manifest: serde_json::Value = match serde_json::from_str(&manifest_content) {
    Ok(v) => v,
    Err(_) => return (None, None, None, None, None),
  };

  let name = manifest
    .get("name")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let version = manifest
    .get("version")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let description = manifest
    .get("description")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let author = manifest
    .get("author")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let homepage_url = manifest
    .get("homepage_url")
    .or_else(|| manifest.get("homepage"))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());

  (name, version, description, author, homepage_url)
}

/// Read `browser_specific_settings.gecko.id` (or the legacy
/// `applications.gecko.id`) from the extension's manifest.json. Firefox uses
/// this value as the canonical add-on ID; sideloaded .xpi files must be named
/// `<gecko_id>.xpi` to be picked up.
fn extract_gecko_id(file_data: &[u8], file_type: &str) -> Option<String> {
  let zip_start = if file_type == "crx" {
    find_zip_start(file_data)
  } else {
    0
  };
  let cursor = std::io::Cursor::new(&file_data[zip_start..]);
  let mut archive = zip::ZipArchive::new(cursor).ok()?;
  let mut manifest_content = String::new();
  std::io::Read::read_to_string(
    &mut archive.by_name("manifest.json").ok()?,
    &mut manifest_content,
  )
  .ok()?;
  let manifest: serde_json::Value = serde_json::from_str(&manifest_content).ok()?;
  manifest
    .pointer("/browser_specific_settings/gecko/id")
    .or_else(|| manifest.pointer("/applications/gecko/id"))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string())
}

fn extract_icon_from_archive(file_data: &[u8], file_type: &str) -> Option<(Vec<u8>, String)> {
  let zip_start = if file_type == "crx" {
    find_zip_start(file_data)
  } else {
    0
  };

  let cursor = std::io::Cursor::new(&file_data[zip_start..]);
  let mut archive = match zip::ZipArchive::new(cursor) {
    Ok(a) => a,
    Err(_) => return None,
  };

  let icon_path = {
    let manifest_content = if let Ok(mut file) = archive.by_name("manifest.json") {
      let mut contents = String::new();
      if std::io::Read::read_to_string(&mut file, &mut contents).is_ok() {
        Some(contents)
      } else {
        None
      }
    } else {
      None
    };

    let manifest_content = manifest_content?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_content).ok()?;

    let mut best_path: Option<String> = None;
    let mut best_size: u32 = 0;

    if let Some(icons) = manifest.get("icons").and_then(|v| v.as_object()) {
      for (size_str, path_val) in icons {
        if let (Ok(size), Some(path)) = (size_str.parse::<u32>(), path_val.as_str()) {
          if size > best_size {
            best_size = size;
            best_path = Some(path.to_string());
          }
        }
      }
    }

    if best_path.is_none() {
      for key in &["action", "browser_action"] {
        if let Some(action) = manifest.get(*key) {
          if let Some(icon) = action.get("default_icon") {
            if let Some(path) = icon.as_str() {
              best_path = Some(path.to_string());
            } else if let Some(icons) = icon.as_object() {
              for (size_str, path_val) in icons {
                if let (Ok(size), Some(path)) = (size_str.parse::<u32>(), path_val.as_str()) {
                  if size > best_size {
                    best_size = size;
                    best_path = Some(path.to_string());
                  }
                }
              }
            }
          }
        }
      }
    }

    best_path
  };

  let icon_path = icon_path?;

  let clean_path = icon_path.trim_start_matches('/');
  let mut file = archive.by_name(clean_path).ok()?;
  let mut data = Vec::new();
  std::io::Read::read_to_end(&mut file, &mut data).ok()?;

  let ext = clean_path
    .rsplit('.')
    .next()
    .unwrap_or("png")
    .to_lowercase();

  Some((data, ext))
}

pub struct ExtensionManager;

impl Default for ExtensionManager {
  fn default() -> Self {
    Self::new()
  }
}

impl ExtensionManager {
  pub fn new() -> Self {
    Self
  }

  fn get_extension_dir(&self, ext_id: &str) -> PathBuf {
    extensions_base_dir().join(ext_id)
  }

  fn get_metadata_path(&self, ext_id: &str) -> PathBuf {
    self.get_extension_dir(ext_id).join("metadata.json")
  }

  fn get_file_dir(&self, ext_id: &str) -> PathBuf {
    self.get_extension_dir(ext_id).join("file")
  }

  pub fn get_file_dir_public(&self, ext_id: &str) -> PathBuf {
    self.get_file_dir(ext_id)
  }

  // Extension CRUD

  pub fn add_extension(
    &self,
    name: String,
    file_name: String,
    file_data: Vec<u8>,
  ) -> Result<Extension, Box<dyn std::error::Error>> {
    let file_type =
      get_file_type(&file_name).ok_or_else(|| format!("Unsupported file type: {file_name}"))?;

    let browser_compatibility = determine_browser_compatibility(&file_type);
    let now = now_secs();

    let (manifest_name, version, description, author, homepage_url) =
      extract_manifest_metadata(&file_data, &file_type);

    let final_name = if manifest_name.is_some() {
      manifest_name.clone().unwrap_or(name)
    } else {
      name
    };

    let gecko_id = extract_gecko_id(&file_data, &file_type);
    let ext = Extension {
      id: uuid::Uuid::new_v4().to_string(),
      name: final_name,
      file_name: file_name.clone(),
      file_type,
      browser_compatibility,
      created_at: now,
      updated_at: now,
      sync_enabled: crate::sync::is_sync_configured(),
      last_sync: None,
      version,
      description,
      author,
      homepage_url,
      gecko_id,
    };

    let file_dir = self.get_file_dir(&ext.id);
    fs::create_dir_all(&file_dir)?;
    fs::write(file_dir.join(&file_name), &file_data)?;

    if let Some((icon_data, icon_ext)) = extract_icon_from_archive(&file_data, &ext.file_type) {
      let icon_path = self
        .get_extension_dir(&ext.id)
        .join(format!("icon.{icon_ext}"));
      let _ = fs::write(icon_path, icon_data);
    }

    let metadata_path = self.get_metadata_path(&ext.id);
    let json = serde_json::to_string_pretty(&ext)?;
    fs::write(metadata_path, json)?;

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    if ext.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let id = ext.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_extension_sync(id).await;
        });
      }
    }

    Ok(ext)
  }

  pub fn get_extension(&self, id: &str) -> Result<Extension, Box<dyn std::error::Error>> {
    let metadata_path = self.get_metadata_path(id);
    if !metadata_path.exists() {
      return Err(format!("Extension with id '{id}' not found").into());
    }
    let content = fs::read_to_string(metadata_path)?;
    let ext: Extension = serde_json::from_str(&content)?;
    Ok(ext)
  }

  pub fn list_extensions(&self) -> Result<Vec<Extension>, Box<dyn std::error::Error>> {
    let base = extensions_base_dir();
    if !base.exists() {
      return Ok(Vec::new());
    }

    let mut extensions = Vec::new();
    for entry in fs::read_dir(base)? {
      let entry = entry?;
      if entry.file_type()?.is_dir() {
        let metadata_path = entry.path().join("metadata.json");
        if metadata_path.exists() {
          let content = fs::read_to_string(&metadata_path)?;
          if let Ok(ext) = serde_json::from_str::<Extension>(&content) {
            extensions.push(ext);
          }
        }
      }
    }

    extensions.sort_by_key(|a| a.created_at);
    Ok(extensions)
  }

  pub fn update_extension(
    &self,
    id: &str,
    name: Option<String>,
    file_name: Option<String>,
    file_data: Option<Vec<u8>>,
  ) -> Result<Extension, Box<dyn std::error::Error>> {
    let mut ext = self.get_extension(id)?;

    let explicit_name_provided = name.is_some();
    if let Some(new_name) = name {
      ext.name = new_name;
    }

    if let (Some(new_file_name), Some(data)) = (file_name, file_data) {
      let new_file_type = get_file_type(&new_file_name)
        .ok_or_else(|| format!("Unsupported file type: {new_file_name}"))?;

      // Remove old file
      let file_dir = self.get_file_dir(id);
      if file_dir.exists() {
        fs::remove_dir_all(&file_dir)?;
      }
      fs::create_dir_all(&file_dir)?;
      fs::write(file_dir.join(&new_file_name), &data)?;

      ext.file_name = new_file_name;
      ext.file_type = new_file_type.clone();
      ext.browser_compatibility = determine_browser_compatibility(&new_file_type);

      let (manifest_name, version, description, author, homepage_url) =
        extract_manifest_metadata(&data, &new_file_type);
      if let Some(v) = version {
        ext.version = Some(v);
      }
      if let Some(d) = description {
        ext.description = Some(d);
      }
      if let Some(a) = author {
        ext.author = Some(a);
      }
      if let Some(h) = homepage_url {
        ext.homepage_url = Some(h);
      }
      if let Some(mn) = manifest_name {
        if !explicit_name_provided {
          ext.name = mn;
        }
      }
      ext.gecko_id = extract_gecko_id(&data, &new_file_type);

      if let Some((icon_data, icon_ext)) = extract_icon_from_archive(&data, &new_file_type) {
        let icon_path = self.get_extension_dir(id).join(format!("icon.{icon_ext}"));
        let _ = fs::write(icon_path, icon_data);
      }
    }

    ext.updated_at = now_secs();

    let metadata_path = self.get_metadata_path(id);
    let json = serde_json::to_string_pretty(&ext)?;
    fs::write(metadata_path, json)?;

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    if ext.sync_enabled {
      if let Some(scheduler) = crate::sync::get_global_scheduler() {
        let eid = ext.id.clone();
        tauri::async_runtime::spawn(async move {
          scheduler.queue_extension_sync(eid).await;
        });
      }
    }

    Ok(ext)
  }

  pub fn delete_extension(
    &self,
    app_handle: &tauri::AppHandle,
    id: &str,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let ext = self.get_extension(id)?;
    let ext_dir = self.get_extension_dir(id);
    if ext_dir.exists() {
      fs::remove_dir_all(&ext_dir)?;
    }

    // Remove from all groups
    let mut groups_data = self.load_groups_data()?;
    for group in &mut groups_data.groups {
      group.extension_ids.retain(|eid| eid != id);
    }
    self.save_groups_data(&groups_data)?;

    if let Err(e) = events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }

    if ext.sync_enabled {
      let ext_id = id.to_string();
      let app_handle_clone = app_handle.clone();
      tauri::async_runtime::spawn(async move {
        match crate::sync::SyncEngine::create_from_settings(&app_handle_clone).await {
          Ok(engine) => {
            if let Err(e) = engine.delete_extension(&ext_id).await {
              log::warn!("Failed to delete extension {} from sync: {}", ext_id, e);
            }
          }
          Err(e) => {
            log::debug!("Sync not configured, skipping remote deletion: {}", e);
          }
        }
      });
    }

    Ok(())
  }

  // Extension Group CRUD

  fn load_groups_data(&self) -> Result<ExtensionGroupsData, Box<dyn std::error::Error>> {
    let path = extension_groups_file();
    if !path.exists() {
      return Ok(ExtensionGroupsData { groups: Vec::new() });
    }
    let content = fs::read_to_string(path)?;
    let data: ExtensionGroupsData = serde_json::from_str(&content)?;
    Ok(data)
  }

  fn save_groups_data(&self, data: &ExtensionGroupsData) -> Result<(), Box<dyn std::error::Error>> {
    let path = extension_groups_file();
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(data)?;
    fs::write(path, json)?;
    Ok(())
  }
}

include!("extension_manager_groups.rs");
include!("extension_manager_commands.rs");
