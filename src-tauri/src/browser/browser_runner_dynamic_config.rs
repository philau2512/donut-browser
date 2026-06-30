// Dynamic proxy launch for openProfile flow nodes (standalone module — not include! in browser_runner.rs).

use std::time::Duration;

use crate::browser::browser_runner::{launch_browser_profile_impl, BrowserRunner};
use crate::profile::BrowserProfile;

/// Result of launching a profile with dynamic configuration.
#[derive(Debug, Clone)]
pub struct LaunchResult {
  pub cdp_port: u16,
  pub browser_pid: u32,
}

fn find_profile_by_id(profile_id: &str) -> Result<BrowserProfile, String> {
  let pm = BrowserRunner::instance().profile_manager;
  let profiles = pm
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?;
  profiles
    .into_iter()
    .find(|p| p.id.to_string() == profile_id)
    .ok_or_else(|| format!("Profile not found: {profile_id}"))
}

async fn resolve_and_verify_cdp_port(profile: &BrowserProfile) -> Option<u16> {
  let profiles_dir = crate::settings::app_dirs::profiles_dir();
  let profile_path = profile.get_profile_data_path(&profiles_dir);
  let profile_path_str = profile_path.to_string_lossy().to_string();

  for _attempt in 0..20 {
    let port = crate::browser::wayfern_manager::WayfernManager::instance()
      .get_cdp_port(&profile_path_str)
      .await;
    if let Some(p) = port {
      let url = format!("http://127.0.0.1:{p}/json/version");
      if reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
      {
        return Some(p);
      }
    }
    tokio::time::sleep(Duration::from_millis(250)).await;
  }
  None
}

/// Launch profile after optional dynamic proxy fetch (proxy IP is applied via profile proxy settings in a later iteration).
pub async fn launch_with_dynamic_config(
  app_handle: tauri::AppHandle,
  profile_id: &str,
  proxy_ip: Option<String>,
) -> Result<LaunchResult, Box<dyn std::error::Error + Send + Sync>> {
  log::info!(
    "[AUTOMATION] [PROFILE_NODE] launch_with_dynamic_config profile={profile_id} proxy={proxy_ip:?}"
  );

  let profile = find_profile_by_id(profile_id).map_err(|e| e.to_string())?;

  let launched = launch_browser_profile_impl(app_handle, profile.clone(), None, None, false, true)
    .await
    .map_err(|e| format!("Profile launch failed: {e}"))?;

  let browser_pid = launched.process_id.unwrap_or(0);
  let cdp_port = resolve_and_verify_cdp_port(&launched).await.unwrap_or(9222);

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Profile {profile_id} launched CDP={cdp_port} pid={browser_pid}"
  );

  Ok(LaunchResult {
    cdp_port,
    browser_pid,
  })
}
