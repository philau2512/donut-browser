
// Global instance
lazy_static::lazy_static! {
  pub static ref EXTENSION_MANAGER: Mutex<ExtensionManager> = Mutex::new(ExtensionManager::new());
}

// Tauri commands

#[tauri::command]
pub async fn list_extensions() -> Result<Vec<Extension>, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .list_extensions()
    .map_err(|e| format!("Failed to list extensions: {e}"))
}

#[tauri::command]
pub fn get_extension_icon(extension_id: String) -> Option<String> {
  let manager = crate::browser::extension_manager::ExtensionManager::new();
  manager.get_extension_icon(&extension_id)
}

#[tauri::command]
pub async fn add_extension(
  name: String,
  file_name: String,
  file_data: Vec<u8>,
) -> Result<Extension, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .add_extension(name, file_name, file_data)
    .map_err(|e| format!("Failed to add extension: {e}"))
}

#[tauri::command]
pub async fn update_extension(
  extension_id: String,
  name: Option<String>,
  file_name: Option<String>,
  file_data: Option<Vec<u8>>,
) -> Result<Extension, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .update_extension(&extension_id, name, file_name, file_data)
    .map_err(|e| format!("Failed to update extension: {e}"))
}

#[tauri::command]
pub async fn delete_extension(
  app_handle: tauri::AppHandle,
  extension_id: String,
) -> Result<(), String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .delete_extension(&app_handle, &extension_id)
    .map_err(|e| format!("Failed to delete extension: {e}"))
}

#[tauri::command]
pub async fn list_extension_groups() -> Result<Vec<ExtensionGroup>, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .list_groups()
    .map_err(|e| format!("Failed to list extension groups: {e}"))
}

#[tauri::command]
pub async fn create_extension_group(name: String) -> Result<ExtensionGroup, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .create_group(name)
    .map_err(|e| format!("Failed to create extension group: {e}"))
}

#[tauri::command]
pub async fn update_extension_group(
  group_id: String,
  name: Option<String>,
  extension_ids: Option<Vec<String>>,
) -> Result<ExtensionGroup, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .update_group(&group_id, name, extension_ids)
    .map_err(|e| format!("Failed to update extension group: {e}"))
}

#[tauri::command]
pub async fn delete_extension_group(
  app_handle: tauri::AppHandle,
  group_id: String,
) -> Result<(), String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .delete_group(&app_handle, &group_id)
    .map_err(|e| format!("Failed to delete extension group: {e}"))
}

#[tauri::command]
pub async fn add_extension_to_group(
  group_id: String,
  extension_id: String,
) -> Result<ExtensionGroup, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .add_extension_to_group(&group_id, &extension_id)
    .map_err(|e| format!("Failed to add extension to group: {e}"))
}

#[tauri::command]
pub async fn remove_extension_from_group(
  group_id: String,
  extension_id: String,
) -> Result<ExtensionGroup, String> {
  let mgr = EXTENSION_MANAGER.lock().unwrap();
  mgr
    .remove_extension_from_group(&group_id, &extension_id)
    .map_err(|e| format!("Failed to remove extension from group: {e}"))
}

#[tauri::command]
pub async fn assign_extension_group_to_profile(
  profile_id: String,
  extension_group_id: Option<String>,
) -> Result<crate::profile::BrowserProfile, String> {
  // Validate compatibility if assigning a group
  if let Some(ref group_id) = extension_group_id {
    let profile_manager = crate::profile::ProfileManager::instance();
    let profiles = profile_manager
      .list_profiles()
      .map_err(|e| format!("Failed to list profiles: {e}"))?;
    let profile = profiles
      .iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| format!("Profile '{profile_id}' not found"))?;

    let mgr = EXTENSION_MANAGER.lock().unwrap();
    mgr
      .validate_group_compatibility(group_id, &profile.browser)
      .map_err(|e| format!("{e}"))?;
  }

  let profile_manager = crate::profile::ProfileManager::instance();
  profile_manager
    .update_profile_extension_group(&profile_id, extension_group_id)
    .map_err(|e| format!("Failed to assign extension group: {e}"))
}

#[tauri::command]
pub async fn get_extension_group_for_profile(
  profile_id: String,
) -> Result<Option<ExtensionGroup>, String> {
  let profile_manager = crate::profile::ProfileManager::instance();
  let profiles = profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?;
  let profile = profiles
    .iter()
    .find(|p| p.id.to_string() == profile_id)
    .ok_or_else(|| format!("Profile '{profile_id}' not found"))?;

  match &profile.extension_group_id {
    Some(group_id) => {
      let mgr = EXTENSION_MANAGER.lock().unwrap();
      match mgr.get_group(group_id) {
        Ok(group) => Ok(Some(group)),
        Err(_) => Ok(None),
      }
    }
    None => Ok(None),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_get_file_type() {
    assert_eq!(get_file_type("ublock.xpi"), Some("xpi".to_string()));
    assert_eq!(get_file_type("ext.crx"), Some("crx".to_string()));
    assert_eq!(get_file_type("ext.zip"), Some("zip".to_string()));
    assert_eq!(get_file_type("readme.txt"), None);
    assert_eq!(get_file_type("noext"), None);
  }

  #[test]
  fn test_determine_browser_compatibility() {
    assert_eq!(
      determine_browser_compatibility("xpi"),
      vec!["firefox".to_string()]
    );
    assert_eq!(
      determine_browser_compatibility("crx"),
      vec!["chromium".to_string()]
    );
    assert_eq!(
      determine_browser_compatibility("zip"),
      vec!["chromium".to_string(), "firefox".to_string()]
    );
  }

  #[test]
  fn test_extension_manager_crud() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(tmp.path().to_path_buf());

    let mgr = ExtensionManager::new();

    // List empty
    let exts = mgr.list_extensions().unwrap();
    assert!(exts.is_empty());

    // Add
    let ext = mgr
      .add_extension(
        "Test Ext".to_string(),
        "test.xpi".to_string(),
        vec![0, 1, 2, 3],
      )
      .unwrap();
    assert_eq!(ext.name, "Test Ext");
    assert_eq!(ext.file_type, "xpi");
    assert_eq!(ext.browser_compatibility, vec!["firefox".to_string()]);

    // Get
    let fetched = mgr.get_extension(&ext.id).unwrap();
    assert_eq!(fetched.name, "Test Ext");

    // List
    let exts = mgr.list_extensions().unwrap();
    assert_eq!(exts.len(), 1);

    // Update name
    let updated = mgr
      .update_extension(&ext.id, Some("Updated".to_string()), None, None)
      .unwrap();
    assert_eq!(updated.name, "Updated");

    // Delete
    mgr.delete_extension_internal(&ext.id).unwrap();
    let exts = mgr.list_extensions().unwrap();
    assert!(exts.is_empty());
  }

  #[test]
  fn test_extension_group_crud() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(tmp.path().to_path_buf());

    let mgr = ExtensionManager::new();

    // Create group
    let group = mgr.create_group("My Group".to_string()).unwrap();
    assert_eq!(group.name, "My Group");
    assert!(group.extension_ids.is_empty());

    // List groups
    let groups = mgr.list_groups().unwrap();
    assert_eq!(groups.len(), 1);

    // Add extension
    let ext = mgr
      .add_extension(
        "Test Ext".to_string(),
        "test.xpi".to_string(),
        vec![0, 1, 2, 3],
      )
      .unwrap();

    // Add to group
    let updated = mgr.add_extension_to_group(&group.id, &ext.id).unwrap();
    assert_eq!(updated.extension_ids.len(), 1);

    // Remove from group
    let updated = mgr.remove_extension_from_group(&group.id, &ext.id).unwrap();
    assert!(updated.extension_ids.is_empty());

    // Duplicate name check
    let err = mgr.create_group("My Group".to_string());
    assert!(err.is_err());
  }

  #[test]
  fn test_validate_group_compatibility() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(tmp.path().to_path_buf());

    let mgr = ExtensionManager::new();

    let ext = mgr
      .add_extension(
        "Firefox Ext".to_string(),
        "test.xpi".to_string(),
        vec![0, 1, 2, 3],
      )
      .unwrap();

    let group = mgr.create_group("Firefox Group".to_string()).unwrap();
    mgr.add_extension_to_group(&group.id, &ext.id).unwrap();

    // Compatible with camoufox (firefox-based)
    assert!(mgr
      .validate_group_compatibility(&group.id, "camoufox")
      .is_ok());

    // Incompatible with wayfern (chromium-based)
    assert!(mgr
      .validate_group_compatibility(&group.id, "wayfern")
      .is_err());
  }

  #[test]
  fn test_find_zip_start() {
    let data = vec![0x00, 0x00, 0x50, 0x4B, 0x03, 0x04, 0xFF];
    assert_eq!(ExtensionManager::find_zip_start(&data), Some(2));

    let data = vec![0x50, 0x4B, 0x03, 0x04, 0xFF];
    assert_eq!(ExtensionManager::find_zip_start(&data), Some(0));

    let data = vec![0x00, 0x00, 0x00];
    assert_eq!(ExtensionManager::find_zip_start(&data), None);
  }

  #[test]
  fn test_delete_extension_removes_from_groups() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = crate::settings::app_dirs::set_test_data_dir(tmp.path().to_path_buf());

    let mgr = ExtensionManager::new();

    let ext = mgr
      .add_extension("Test".to_string(), "test.xpi".to_string(), vec![0, 1, 2, 3])
      .unwrap();

    let group = mgr.create_group("G1".to_string()).unwrap();
    mgr.add_extension_to_group(&group.id, &ext.id).unwrap();

    // Delete extension should remove from group
    mgr.delete_extension_internal(&ext.id).unwrap();

    let updated_group = mgr.get_group(&group.id).unwrap();
    assert!(updated_group.extension_ids.is_empty());
  }
}
