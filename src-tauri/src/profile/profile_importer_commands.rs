#[tauri::command]
pub async fn detect_existing_profiles() -> Result<Vec<DetectedProfile>, String> {
  let importer = ProfileImporter::instance();
  importer
    .detect_existing_profiles()
    .map_err(|e| format!("Failed to detect existing profiles: {e}"))
}

#[tauri::command]
pub async fn import_browser_profile(
  app_handle: tauri::AppHandle,
  source_path: String,
  browser_type: String,
  new_profile_name: String,
  proxy_id: Option<String>,
  camoufox_config: Option<CamoufoxConfig>,
  wayfern_config: Option<WayfernConfig>,
) -> Result<(), String> {
  if map_browser_type(&browser_type) == "camoufox" {
    return Err(serde_json::json!({ "code": "CAMOUFOX_IMPORT_DEPRECATED" }).to_string());
  }

  let fingerprint_os = camoufox_config
    .as_ref()
    .and_then(|c| c.os.as_deref())
    .or_else(|| wayfern_config.as_ref().and_then(|c| c.os.as_deref()));

  if !crate::api::cloud_auth::CLOUD_AUTH
    .is_fingerprint_os_allowed(fingerprint_os)
    .await
  {
    return Err("Fingerprint OS spoofing requires an active Pro subscription".to_string());
  }

  let importer = ProfileImporter::instance();
  importer
    .import_profile(
      &app_handle,
      &source_path,
      &browser_type,
      &new_profile_name,
      proxy_id,
      camoufox_config,
      wayfern_config,
    )
    .await
    .map_err(|e| format!("Failed to import profile: {e}"))
}

lazy_static::lazy_static! {
  static ref PROFILE_IMPORTER: ProfileImporter = ProfileImporter::new();
}
