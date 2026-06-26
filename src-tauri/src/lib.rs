// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_log::{Target, TargetKind};

// Store pending URLs that need to be handled when the window is ready
static PENDING_URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());

// Set to true once the user has confirmed they want to quit, so the close
// interceptor lets the next CloseRequested through instead of looping back
// to the confirmation dialog.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

pub mod api;
pub use api::{api_client, api_server, cloud_auth};
pub mod updater;
pub use updater::{app_auto_updater, auto_updater, geoip_downloader, version_updater};
pub mod browser;
pub mod profile;
pub mod proxy;
pub mod settings;
pub use proxy::{proxy_runner, proxy_server, proxy_storage, socks5_local, traffic_stats};
pub mod events;
pub mod mcp;
pub mod sync;
pub use mcp::{mcp_integrations, mcp_server};
pub mod vpn;

use browser::extension_manager;
pub use profile::dns_blocklist;
use profile::{cookie_manager, team_lock};
use proxy::ip_utils;
pub use settings::app_dirs;
use settings::{commercial_license, settings_manager};
use sync::synchronizer;
pub use vpn::{vpn_worker_runner, vpn_worker_storage};

use browser::browser_runner::{
  check_browser_exists, kill_browser_profile, launch_browser_profile, open_url_with_profile,
};

use profile::manager::{
  check_browser_status, clone_profile, create_browser_profile_new, delete_profile,
  list_browser_profiles, rename_profile, update_camoufox_config, update_profile_dns_blocklist,
  update_profile_launch_hook, update_profile_note, update_profile_proxy,
  update_profile_proxy_bypass_rules, update_profile_tags, update_profile_vpn,
  update_wayfern_config,
};

use profile::password::{
  change_profile_password, is_profile_locked, lock_profile, remove_profile_password,
  set_profile_password, unlock_profile, verify_profile_password,
};

use browser::browser_version_manager::{
  fetch_browser_versions_cached_first, fetch_browser_versions_with_count,
  fetch_browser_versions_with_count_cached_first, get_supported_browsers,
  is_browser_supported_on_platform,
};

use browser::downloaded_browsers_registry::{
  check_missing_binaries, ensure_active_browsers_downloaded, ensure_all_binaries_exist,
  get_downloaded_browser_versions,
};

use browser::downloader::{cancel_download, download_browser};

use settings_manager::{
  complete_onboarding, dismiss_window_resize_warning, get_app_settings, get_onboarding_completed,
  get_sync_settings, get_system_info, get_system_language, get_table_sorting_settings,
  get_window_resize_warning_dismissed, open_log_directory, read_log_files, save_app_settings,
  save_sync_settings, save_table_sorting_settings,
};

use sync::{
  cancel_profile_sync, check_has_e2e_password, delete_e2e_password, enable_sync_for_all_entities,
  get_unsynced_entity_counts, is_group_in_use_by_synced_profile, is_proxy_in_use_by_synced_profile,
  is_vpn_in_use_by_synced_profile, request_profile_sync, rollover_encryption_for_all_entities,
  set_e2e_password, set_extension_group_sync_enabled, set_extension_sync_enabled,
  set_group_sync_enabled, set_profile_sync_mode, set_proxy_sync_enabled, set_vpn_sync_enabled,
  verify_e2e_password,
};

use profile::tag_manager::get_all_tags;

use browser::default_browser::{is_default_browser, set_as_default_browser};
use updater::version_updater::{
  clear_all_version_cache_and_refetch, get_version_update_status, get_version_updater,
  trigger_manual_version_update,
};

use updater::auto_updater::{
  check_for_browser_updates, complete_browser_update_with_auto_update, dismiss_update_notification,
};

use updater::app_auto_updater::{
  check_for_app_updates, check_for_app_updates_manual, download_and_prepare_app_update,
  restart_application,
};

use profile::profile_importer::{detect_existing_profiles, import_browser_profile};

use browser::extension_manager::{
  add_extension, add_extension_to_group, assign_extension_group_to_profile, create_extension_group,
  delete_extension, delete_extension_group, get_extension_group_for_profile, get_extension_icon,
  list_extension_groups, list_extensions, remove_extension_from_group, update_extension,
  update_extension_group,
};

use profile::group_manager::{
  assign_profiles_to_group, create_profile_group, delete_profile_group, delete_selected_profiles,
  get_groups_with_profile_counts, get_profile_groups, update_profile_group,
};

use updater::geoip_downloader::{check_missing_geoip_database, GeoIPDownloader};

use browser::browser_version_manager::get_browser_release_types;

use api::api_server::{get_api_server_status, start_api_server, stop_api_server};

// Trait to extend WebviewWindow with transparent titlebar functionality
pub trait WindowExt {
  #[cfg(target_os = "macos")]
  fn set_transparent_titlebar(&self, transparent: bool) -> Result<(), String>;
  #[cfg(target_os = "macos")]
  fn disable_native_fullscreen(&self) -> Result<(), String>;
}

impl<R: Runtime> WindowExt for WebviewWindow<R> {
  #[cfg(target_os = "macos")]
  fn set_transparent_titlebar(&self, transparent: bool) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSWindow, NSWindowStyleMask, NSWindowTitleVisibility};

    unsafe {
      let ns_window: Retained<NSWindow> =
        Retained::retain(self.ns_window().unwrap().cast()).unwrap();

      if transparent {
        // Hide the title text
        ns_window.setTitleVisibility(NSWindowTitleVisibility(1)); // NSWindowTitleHidden

        // Make titlebar transparent
        ns_window.setTitlebarAppearsTransparent(true);

        // Set full size content view
        let current_mask = ns_window.styleMask();
        let new_mask = NSWindowStyleMask(current_mask.0 | (1 << 15)); // NSFullSizeContentViewWindowMask
        ns_window.setStyleMask(new_mask);
      } else {
        // Show the title text
        ns_window.setTitleVisibility(NSWindowTitleVisibility(0)); // NSWindowTitleVisible

        // Make titlebar opaque
        ns_window.setTitlebarAppearsTransparent(false);

        // Remove full size content view
        let current_mask = ns_window.styleMask();
        let new_mask = NSWindowStyleMask(current_mask.0 & !(1 << 15));
        ns_window.setStyleMask(new_mask);
      }
    }

    Ok(())
  }

  #[cfg(target_os = "macos")]
  fn disable_native_fullscreen(&self) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    unsafe {
      let ns_window: Retained<NSWindow> =
        Retained::retain(self.ns_window().unwrap().cast()).unwrap();

      // Make the green title-bar button (and titlebar double-click) "zoom"
      // the window to fill the screen as an ordinary window instead of
      // entering immersive native fullscreen that hides the menu bar and
      // moves to its own Space. Mirrors Electron's `fullscreenable: false`:
      // clear FullScreenPrimary and set FullScreenNone. AppKit then maps the
      // green button to the standard zoom, expanding to the visible screen
      // frame while keeping the window chrome and the current Space.
      const FULL_SCREEN_PRIMARY: usize = 1 << 7;
      const FULL_SCREEN_NONE: usize = 1 << 9;
      let current = ns_window.collectionBehavior();
      let updated =
        NSWindowCollectionBehavior((current.0 & !FULL_SCREEN_PRIMARY) | FULL_SCREEN_NONE);
      ns_window.setCollectionBehavior(updated);
    }

    Ok(())
  }
}

// Called internally for deep-link / startup URL handling — not invoked from the
// frontend, so it is intentionally not a `#[tauri::command]`.
async fn handle_url_open(app: tauri::AppHandle, url: String) -> Result<(), String> {
  log::info!("handle_url_open called with URL: {url}");

  // Check if the main window exists and is ready
  if let Some(window) = app.get_webview_window("main") {
    log::debug!("Main window exists");

    // Try to show and focus the window first
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.unminimize();

    events::emit("show-profile-selector", url.clone())
      .map_err(|e| format!("Failed to emit URL open event: {e}"))?;
  } else {
    // Window doesn't exist yet - add to pending URLs
    log::debug!("Main window doesn't exist, adding URL to pending list");
    let mut pending = PENDING_URLS.lock().unwrap();
    pending.push(url);
  }

  Ok(())
}

#[tauri::command]
async fn create_stored_proxy(
  app_handle: tauri::AppHandle,
  name: String,
  proxy_settings: Option<crate::browser::ProxySettings>,
) -> Result<crate::proxy::proxy_manager::StoredProxy, String> {
  if let Some(settings) = proxy_settings {
    crate::proxy::proxy_manager::PROXY_MANAGER
      .create_stored_proxy(&app_handle, name, settings)
      .map_err(|e| format!("Failed to create stored proxy: {e}"))
  } else {
    Err("proxy_settings is required".to_string())
  }
}

#[tauri::command]
async fn get_stored_proxies() -> Result<Vec<crate::proxy::proxy_manager::StoredProxy>, String> {
  Ok(crate::proxy::proxy_manager::PROXY_MANAGER.get_stored_proxies())
}

#[tauri::command]
async fn update_stored_proxy(
  app_handle: tauri::AppHandle,
  proxy_id: String,
  name: Option<String>,
  proxy_settings: Option<crate::browser::ProxySettings>,
) -> Result<crate::proxy::proxy_manager::StoredProxy, String> {
  crate::proxy::proxy_manager::PROXY_MANAGER
    .update_stored_proxy(&app_handle, &proxy_id, name, proxy_settings)
    .map_err(|e| format!("Failed to update stored proxy: {e}"))
}

#[tauri::command]
async fn delete_stored_proxy(app_handle: tauri::AppHandle, proxy_id: String) -> Result<(), String> {
  crate::proxy::proxy_manager::PROXY_MANAGER
    .delete_stored_proxy(&app_handle, &proxy_id)
    .map_err(|e| format!("Failed to delete stored proxy: {e}"))
}

#[tauri::command]
async fn check_proxy_validity(
  proxy_id: String,
  proxy_settings: Option<crate::browser::ProxySettings>,
) -> Result<crate::proxy::proxy_manager::ProxyCheckResult, String> {
  let settings = if let Some(s) = proxy_settings {
    s
  } else {
    crate::proxy::proxy_manager::PROXY_MANAGER
      .get_proxy_settings_by_id(&proxy_id)
      .ok_or_else(|| format!("Proxy '{proxy_id}' not found"))?
  };
  crate::proxy::proxy_manager::PROXY_MANAGER
    .check_proxy_validity(&proxy_id, &settings)
    .await
}

#[tauri::command]
fn get_cached_proxy_check(
  proxy_id: String,
) -> Option<crate::proxy::proxy_manager::ProxyCheckResult> {
  crate::proxy::proxy_manager::PROXY_MANAGER.get_cached_proxy_check(&proxy_id)
}

#[tauri::command]
fn export_proxies(format: String) -> Result<String, String> {
  match format.as_str() {
    "json" => crate::proxy::proxy_manager::PROXY_MANAGER.export_proxies_json(),
    "txt" => Ok(crate::proxy::proxy_manager::PROXY_MANAGER.export_proxies_txt()),
    _ => Err(format!("Unsupported export format: {format}")),
  }
}

#[tauri::command]
async fn import_proxies_json(
  app_handle: tauri::AppHandle,
  content: String,
) -> Result<crate::proxy::proxy_manager::ProxyImportResult, String> {
  crate::proxy::proxy_manager::PROXY_MANAGER
    .import_proxies_json(&app_handle, &content)
    .map_err(|e| format!("Failed to import proxies: {e}"))
}

#[tauri::command]
fn parse_txt_proxies(content: String) -> Vec<crate::proxy::proxy_manager::ProxyParseResult> {
  crate::proxy::proxy_manager::ProxyManager::parse_txt_proxies(&content)
}

#[tauri::command]
async fn import_proxies_from_parsed(
  app_handle: tauri::AppHandle,
  parsed_proxies: Vec<crate::proxy::proxy_manager::ParsedProxyLine>,
  name_prefix: Option<String>,
) -> Result<crate::proxy::proxy_manager::ProxyImportResult, String> {
  crate::proxy::proxy_manager::PROXY_MANAGER
    .import_proxies_from_parsed(&app_handle, parsed_proxies, name_prefix)
    .map_err(|e| format!("Failed to import proxies: {e}"))
}

#[tauri::command]
async fn read_profile_cookies(
  profile_id: String,
) -> Result<cookie_manager::CookieReadResult, String> {
  tokio::task::spawn_blocking(move || cookie_manager::CookieManager::read_cookies(&profile_id))
    .await
    .map_err(|e| format!("Failed to read profile cookies: {e}"))?
}

#[tauri::command]
async fn get_profile_cookie_stats(
  profile_id: String,
) -> Result<cookie_manager::CookieStats, String> {
  tokio::task::spawn_blocking(move || cookie_manager::CookieManager::read_stats(&profile_id))
    .await
    .map_err(|e| format!("Failed to read profile cookie stats: {e}"))?
}

#[tauri::command]
async fn copy_profile_cookies(
  app_handle: tauri::AppHandle,
  request: cookie_manager::CookieCopyRequest,
) -> Result<Vec<cookie_manager::CookieCopyResult>, String> {
  let target_ids = request.target_profile_ids.clone();
  let results = cookie_manager::CookieManager::copy_cookies(&app_handle, request).await?;

  // Trigger sync for target profiles that have sync enabled
  if let Some(scheduler) = crate::sync::get_global_scheduler() {
    let profile_manager = profile::manager::ProfileManager::instance();
    if let Ok(profiles) = profile_manager.list_profiles() {
      let sync_ids: Vec<String> = target_ids
        .iter()
        .filter(|tid| {
          profiles
            .iter()
            .any(|p| p.id.to_string() == **tid && p.is_sync_enabled())
        })
        .cloned()
        .collect();
      if !sync_ids.is_empty() {
        tauri::async_runtime::spawn(async move {
          for id in sync_ids {
            scheduler.queue_profile_sync(id).await;
          }
        });
      }
    }
  }

  Ok(results)
}

#[tauri::command]
async fn import_cookies_from_file(
  app_handle: tauri::AppHandle,
  profile_id: String,
  content: String,
) -> Result<cookie_manager::CookieImportResult, String> {
  let result =
    cookie_manager::CookieManager::import_cookies(&app_handle, &profile_id, &content).await?;

  // Trigger sync for the profile if sync is enabled
  if let Some(scheduler) = crate::sync::get_global_scheduler() {
    let profile_manager = profile::manager::ProfileManager::instance();
    if let Ok(profiles) = profile_manager.list_profiles() {
      if let Some(profile) = profiles.iter().find(|p| p.id.to_string() == profile_id) {
        if profile.is_sync_enabled() {
          let pid = profile_id.clone();
          tauri::async_runtime::spawn(async move {
            scheduler.queue_profile_sync(pid).await;
          });
        }
      }
    }
  }

  Ok(result)
}

#[tauri::command]
async fn export_profile_cookies(profile_id: String, format: String) -> Result<String, String> {
  cookie_manager::CookieManager::export_cookies(&profile_id, &format)
}

#[tauri::command]
fn check_wayfern_terms_accepted() -> bool {
  browser::wayfern_terms::WayfernTermsManager::instance().is_terms_accepted()
}

#[tauri::command]
fn check_wayfern_downloaded() -> bool {
  browser::wayfern_terms::WayfernTermsManager::instance().is_wayfern_downloaded()
}

#[tauri::command]
async fn accept_wayfern_terms() -> Result<(), String> {
  browser::wayfern_terms::WayfernTermsManager::instance()
    .accept_terms()
    .await
}

#[tauri::command]
async fn get_commercial_trial_status(
  app_handle: tauri::AppHandle,
) -> Result<commercial_license::TrialStatus, String> {
  commercial_license::CommercialLicenseManager::instance()
    .get_trial_status(&app_handle)
    .await
}

#[tauri::command]
async fn acknowledge_trial_expiration(app_handle: tauri::AppHandle) -> Result<(), String> {
  commercial_license::CommercialLicenseManager::instance()
    .acknowledge_expiration(&app_handle)
    .await
}

#[tauri::command]
fn has_acknowledged_trial_expiration(app_handle: tauri::AppHandle) -> Result<bool, String> {
  commercial_license::CommercialLicenseManager::instance().has_acknowledged(&app_handle)
}

#[tauri::command]
async fn start_mcp_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
  mcp_server::McpServer::instance().start(app_handle).await
}

#[tauri::command]
async fn stop_mcp_server() -> Result<(), String> {
  mcp_server::McpServer::instance().stop().await
}

#[tauri::command]
fn get_mcp_server_status() -> bool {
  mcp_server::McpServer::instance().is_running()
}

#[derive(serde::Serialize)]
struct McpConfig {
  port: u16,
  token: String,
}

#[tauri::command]
async fn get_mcp_config(app_handle: tauri::AppHandle) -> Result<Option<McpConfig>, String> {
  let mcp_server = mcp_server::McpServer::instance();
  if !mcp_server.is_running() {
    return Ok(None);
  }

  let port = mcp_server
    .get_port()
    .ok_or("MCP server port not available")?;

  let settings_manager = settings_manager::SettingsManager::instance();
  let token = settings_manager
    .get_mcp_token(&app_handle)
    .await
    .map_err(|e| format!("Failed to get MCP token: {e}"))?
    .ok_or("MCP token not found")?;

  Ok(Some(McpConfig { port, token }))
}

fn claude_desktop_extension_dir() -> Option<std::path::PathBuf> {
  #[cfg(target_os = "macos")]
  {
    dirs::home_dir().map(|h| {
      h.join("Library")
        .join("Application Support")
        .join("Claude")
        .join("Claude Extensions")
        .join("local.mcpb.donut-browser.donut-browser")
    })
  }
  #[cfg(target_os = "windows")]
  {
    std::env::var("APPDATA").ok().map(|appdata| {
      std::path::PathBuf::from(appdata)
        .join("Claude")
        .join("Claude Extensions")
        .join("local.mcpb.donut-browser.donut-browser")
    })
  }
  #[cfg(target_os = "linux")]
  {
    dirs::config_dir().map(|c| {
      c.join("Claude")
        .join("Claude Extensions")
        .join("local.mcpb.donut-browser.donut-browser")
    })
  }
}

fn is_mcp_in_claude_desktop_internal() -> bool {
  let Some(dir) = claude_desktop_extension_dir() else {
    return false;
  };
  dir.join("manifest.json").exists()
}

async fn add_mcp_to_claude_desktop_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
  let mcp_server = mcp_server::McpServer::instance();
  let port = mcp_server.get_port().ok_or("MCP server is not running")?;

  let settings_manager = settings_manager::SettingsManager::instance();
  let token = settings_manager
    .get_mcp_token(app_handle)
    .await
    .map_err(|e| format!("Failed to get MCP token: {e}"))?
    .ok_or("MCP token not found")?;

  let ext_dir = claude_desktop_extension_dir().ok_or("Unsupported platform")?;
  let server_dir = ext_dir.join("server");
  std::fs::create_dir_all(&server_dir)
    .map_err(|e| format!("Failed to create extension directory: {e}"))?;

  let mcp_url = format!("http://127.0.0.1:{port}/mcp/{token}");

  let manifest = serde_json::json!({
    "manifest_version": "0.3",
    "name": "donut-browser",
    "display_name": "Donut Browser",
    "version": env!("CARGO_PKG_VERSION"),
    "description": "Control Donut Browser profiles, proxies, and automation via MCP",
    "author": { "name": "Donut Browser" },
    "tools_generated": true,
    "server": {
      "type": "node",
      "entry_point": "server/index.js",
      "mcp_config": {
        "command": "node",
        "args": ["${__dirname}/server/index.js"],
        "env": {}
      }
    },
    "license": "AGPL-3.0"
  });
  std::fs::write(
    ext_dir.join("manifest.json"),
    serde_json::to_string_pretty(&manifest)
      .map_err(|e| format!("Failed to serialize manifest: {e}"))?,
  )
  .map_err(|e| format!("Failed to write manifest: {e}"))?;

  let bridge_js = format!(
    r#"#!/usr/bin/env node
const http = require("http");
const readline = require("readline");
const MCP_URL = "{mcp_url}";
let sid = null;
function post(line) {{
  return new Promise((resolve, reject) => {{
    const u = new URL(MCP_URL);
    const o = {{
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: {{ "Content-Type": "application/json", Accept: "application/json" }},
    }};
    if (sid) o.headers["mcp-session-id"] = sid;
    const r = http.request(o, (res) => {{
      const s = res.headers["mcp-session-id"];
      if (s) sid = s;
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve(b));
    }});
    r.on("error", reject);
    r.write(line);
    r.end();
  }});
}}
const rl = readline.createInterface({{ input: process.stdin, crlfDelay: Infinity }});
rl.on("line", (line) => {{
  if (!line.trim()) return;
  let notif = false;
  try {{ notif = JSON.parse(line).id == null; }} catch {{}}
  post(line).then((b) => {{
    if (!notif && b.trim()) process.stdout.write(b.trim() + "\n");
  }}).catch((e) => {{
    if (!notif) process.stdout.write(JSON.stringify({{
      jsonrpc: "2.0", id: null, error: {{ code: -32000, message: "HTTP error: " + e.message }}
    }}) + "\n");
  }});
}});
rl.on("close", () => setTimeout(() => process.exit(0), 500));
"#
  );
  std::fs::write(server_dir.join("index.js"), bridge_js)
    .map_err(|e| format!("Failed to write bridge script: {e}"))?;

  // Update the extensions-installations.json registry so Claude Desktop picks it up
  update_claude_extensions_registry("local.mcpb.donut-browser.donut-browser", Some(manifest))?;

  Ok(())
}

fn remove_mcp_from_claude_desktop_internal() -> Result<(), String> {
  let ext_dir = claude_desktop_extension_dir().ok_or("Unsupported platform")?;
  if ext_dir.exists() {
    std::fs::remove_dir_all(&ext_dir).map_err(|e| format!("Failed to remove extension: {e}"))?;
  }
  update_claude_extensions_registry("local.mcpb.donut-browser.donut-browser", None)?;
  Ok(())
}

fn update_claude_extensions_registry(
  ext_id: &str,
  manifest: Option<serde_json::Value>,
) -> Result<(), String> {
  let registry_path = claude_desktop_extension_dir()
    .ok_or("Unsupported platform")?
    .parent()
    .and_then(|p| p.parent())
    .map(|p| p.join("extensions-installations.json"))
    .ok_or("Failed to resolve registry path")?;

  let mut registry: serde_json::Value = if registry_path.exists() {
    let content = std::fs::read_to_string(&registry_path)
      .map_err(|e| format!("Failed to read registry: {e}"))?;
    serde_json::from_str(&content).unwrap_or(serde_json::json!({"extensions": {}}))
  } else {
    serde_json::json!({"extensions": {}})
  };

  if registry.get("extensions").is_none() {
    registry["extensions"] = serde_json::json!({});
  }

  match manifest {
    Some(m) => {
      registry["extensions"][ext_id] = serde_json::json!({
        "id": ext_id,
        "version": m.get("version").and_then(|v| v.as_str()).unwrap_or("0.0.0"),
        "hash": "",
        "installedAt": chrono::Utc::now().to_rfc3339(),
        "manifest": m,
        "signatureInfo": { "status": "unsigned" },
        "source": "local"
      });
    }
    None => {
      if let Some(exts) = registry
        .get_mut("extensions")
        .and_then(|e| e.as_object_mut())
      {
        exts.remove(ext_id);
      }
    }
  }

  let output =
    serde_json::to_string(&registry).map_err(|e| format!("Failed to serialize registry: {e}"))?;
  let tmp = registry_path.with_extension("json.tmp");
  std::fs::write(&tmp, &output).map_err(|e| format!("Failed to write registry: {e}"))?;
  std::fs::rename(&tmp, &registry_path).map_err(|e| format!("Failed to save registry: {e}"))?;
  Ok(())
}

async fn current_mcp_url(app_handle: &tauri::AppHandle) -> Result<String, String> {
  let mcp_server = mcp_server::McpServer::instance();
  let port = mcp_server.get_port().ok_or("MCP server is not running")?;
  let settings_manager = settings_manager::SettingsManager::instance();
  let token = settings_manager
    .get_mcp_token(app_handle)
    .await
    .map_err(|e| format!("Failed to get MCP token: {e}"))?
    .ok_or("MCP token not found")?;
  Ok(format!("http://127.0.0.1:{port}/mcp/{token}"))
}

include!("lib_commands_proxy.rs");
include!("lib_commands_sync.rs");
include!("lib_commands_tray.rs");
