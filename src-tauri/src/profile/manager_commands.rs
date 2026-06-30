#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_browser_profile_with_group(
  app_handle: tauri::AppHandle,
  name: String,
  browser: String,
  version: String,
  release_type: String,
  proxy_id: Option<String>,
  vpn_id: Option<String>,
  camoufox_config: Option<CamoufoxConfig>,
  wayfern_config: Option<WayfernConfig>,
  group_id: Option<String>,
  ephemeral: bool,
  dns_blocklist: Option<String>,
  launch_hook: Option<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .create_profile_with_group(
      &app_handle,
      &name,
      &browser,
      &version,
      &release_type,
      proxy_id,
      vpn_id,
      camoufox_config,
      wayfern_config,
      group_id,
      ephemeral,
      dns_blocklist,
      launch_hook,
    )
    .await
    .map_err(|e| format!("Failed to create profile: {e}"))
}

#[tauri::command]
pub fn list_browser_profiles() -> Result<Vec<BrowserProfile>, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))
}

#[tauri::command]
pub async fn update_profile_proxy(
  app_handle: tauri::AppHandle,
  profile_id: String,
  proxy_id: Option<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_proxy(app_handle, &profile_id, proxy_id)
    .await
    .map_err(|e| format!("Failed to update profile: {e}"))
}

#[tauri::command]
pub async fn update_profile_vpn(
  app_handle: tauri::AppHandle,
  profile_id: String,
  vpn_id: Option<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_vpn(app_handle, &profile_id, vpn_id)
    .await
    .map_err(|e| format!("Failed to update profile VPN: {e}"))
}

#[tauri::command]
pub fn update_profile_tags(
  app_handle: tauri::AppHandle,
  profile_id: String,
  tags: Vec<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_tags(&app_handle, &profile_id, tags)
    .map_err(|e| format!("Failed to update profile tags: {e}"))
}

#[tauri::command]
pub fn update_profile_note(
  app_handle: tauri::AppHandle,
  profile_id: String,
  note: Option<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_note(&app_handle, &profile_id, note)
    .map_err(|e| format!("Failed to update profile note: {e}"))
}

#[tauri::command]
pub fn update_profile_status(
  app_handle: tauri::AppHandle,
  profile_id: String,
  profile_status: Option<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_status(&app_handle, &profile_id, profile_status)
    .map_err(|e| format!("Failed to update profile status: {e}"))
}

/// Validate a launch hook value. Returns `Ok(None)` for "clear the hook"
/// (`None`, empty, or whitespace-only), `Ok(Some(_))` for a valid http(s)
/// URL, or `Err` with the `INVALID_LAUNCH_HOOK_URL` code payload.
pub(crate) fn validate_launch_hook(launch_hook: Option<&str>) -> Result<Option<String>, String> {
  let Some(raw) = launch_hook else {
    return Ok(None);
  };
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return Ok(None);
  }
  let ok = url::Url::parse(trimmed)
    .ok()
    .map(|u| matches!(u.scheme(), "http" | "https"))
    .unwrap_or(false);
  if !ok {
    return Err(serde_json::json!({ "code": "INVALID_LAUNCH_HOOK_URL" }).to_string());
  }
  Ok(Some(trimmed.to_string()))
}

#[tauri::command]
pub fn update_profile_launch_hook(
  app_handle: tauri::AppHandle,
  profile_id: String,
  launch_hook: Option<String>,
) -> Result<BrowserProfile, String> {
  validate_launch_hook(launch_hook.as_deref())?;
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_launch_hook(&app_handle, &profile_id, launch_hook)
    .map_err(|e| format!("Failed to update profile launch hook: {e}"))
}

#[tauri::command]
pub fn update_profile_proxy_bypass_rules(
  app_handle: tauri::AppHandle,
  profile_id: String,
  rules: Vec<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_proxy_bypass_rules(&app_handle, &profile_id, rules)
    .map_err(|e| format!("Failed to update proxy bypass rules: {e}"))
}

#[tauri::command]
pub fn update_profile_dns_blocklist(
  profile_id: String,
  dns_blocklist: Option<String>,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_profile_dns_blocklist(&profile_id, dns_blocklist)
    .map_err(|e| format!("Failed to update DNS blocklist: {e}"))
}

#[tauri::command]
pub async fn check_browser_status(
  app_handle: tauri::AppHandle,
  profile: BrowserProfile,
) -> Result<bool, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .check_browser_status(app_handle, &profile)
    .await
    .map_err(|e| format!("Failed to check browser status: {e}"))
}

#[tauri::command]
pub fn rename_profile(
  app_handle: tauri::AppHandle,
  profile_id: String,
  new_name: String,
) -> Result<BrowserProfile, String> {
  let profile_manager = ProfileManager::instance();
  profile_manager
    .rename_profile(&app_handle, &profile_id, &new_name)
    .map_err(|e| format!("Failed to rename profile: {e}"))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_browser_profile_new(
  app_handle: tauri::AppHandle,
  name: String,
  browser_str: String,
  version: String,
  release_type: String,
  proxy_id: Option<String>,
  vpn_id: Option<String>,
  camoufox_config: Option<CamoufoxConfig>,
  wayfern_config: Option<WayfernConfig>,
  group_id: Option<String>,
  ephemeral: Option<bool>,
  dns_blocklist: Option<String>,
  launch_hook: Option<String>,
) -> Result<BrowserProfile, String> {
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

  // A dead/unreachable proxy or VPN (or a 402 from an expired proxy
  // subscription) cancels creation with a translatable error.
  crate::validate_profile_network(proxy_id.as_deref(), vpn_id.as_deref()).await?;

  let browser_type =
    BrowserType::from_str(&browser_str).map_err(|e| format!("Invalid browser type: {e}"))?;
  create_browser_profile_with_group(
    app_handle,
    name,
    browser_type.as_str().to_string(),
    version,
    release_type,
    proxy_id,
    vpn_id,
    camoufox_config,
    wayfern_config,
    group_id,
    ephemeral.unwrap_or(false),
    dns_blocklist,
    launch_hook,
  )
  .await
}

#[tauri::command]
pub async fn update_camoufox_config(
  app_handle: tauri::AppHandle,
  profile_id: String,
  config: CamoufoxConfig,
) -> Result<(), String> {
  if config.fingerprint.is_some()
    && !crate::api::cloud_auth::CLOUD_AUTH
      .can_use_cross_os_fingerprints()
      .await
  {
    return Err(serde_json::json!({ "code": "FINGERPRINT_REQUIRES_PRO" }).to_string());
  }

  if !crate::api::cloud_auth::CLOUD_AUTH
    .is_fingerprint_os_allowed(config.os.as_deref())
    .await
  {
    return Err("Fingerprint OS spoofing requires an active Pro subscription".to_string());
  }

  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_camoufox_config(app_handle, &profile_id, config)
    .await
    .map_err(|e| format!("Failed to update Camoufox config: {e}"))
}

#[tauri::command]
pub async fn update_wayfern_config(
  app_handle: tauri::AppHandle,
  profile_id: String,
  config: WayfernConfig,
) -> Result<(), String> {
  if config.fingerprint.is_some()
    && !crate::api::cloud_auth::CLOUD_AUTH
      .can_use_cross_os_fingerprints()
      .await
  {
    return Err(serde_json::json!({ "code": "FINGERPRINT_REQUIRES_PRO" }).to_string());
  }

  if !crate::api::cloud_auth::CLOUD_AUTH
    .is_fingerprint_os_allowed(config.os.as_deref())
    .await
  {
    return Err("Fingerprint OS spoofing requires an active Pro subscription".to_string());
  }

  let profile_manager = ProfileManager::instance();
  profile_manager
    .update_wayfern_config(app_handle, &profile_id, config)
    .await
    .map_err(|e| format!("Failed to update Wayfern config: {e}"))
}

#[tauri::command]
pub fn clone_profile(profile_id: String, name: Option<String>) -> Result<BrowserProfile, String> {
  ProfileManager::instance()
    .clone_profile(&profile_id, name)
    .map_err(|e| format!("Failed to clone profile: {e}"))
}

#[tauri::command]
pub fn delete_profile(app_handle: tauri::AppHandle, profile_id: String) -> Result<(), String> {
  ProfileManager::instance()
    .delete_profile(&app_handle, &profile_id)
    .map_err(|e| format!("Failed to delete profile: {e}"))
}

lazy_static::lazy_static! {
  static ref PROFILE_MANAGER: ProfileManager = ProfileManager::new();
}
