use crate::api::cloud_auth::CLOUD_AUTH;
use crate::automation::pipeline::context::ExecutionContext;
use crate::automation::pipeline::AutomationEngine;
use crate::browser::camoufox_manager::{CamoufoxConfig, CamoufoxManager};
use crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry;
use crate::browser::platform_browser;
use crate::browser::wayfern_manager::{WayfernConfig, WayfernManager};
use crate::browser::ProxySettings;
use crate::events;
use crate::profile::{BrowserProfile, ProfileManager};
use crate::proxy::proxy_manager::PROXY_MANAGER;
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::System;

pub struct BrowserRunner {
  pub profile_manager: &'static ProfileManager,
  pub downloaded_browsers_registry: &'static DownloadedBrowsersRegistry,
  auto_updater: &'static crate::updater::auto_updater::AutoUpdater,
  camoufox_manager: &'static CamoufoxManager,
  wayfern_manager: &'static WayfernManager,
}

impl BrowserRunner {
  fn new() -> Self {
    Self {
      profile_manager: ProfileManager::instance(),
      downloaded_browsers_registry: DownloadedBrowsersRegistry::instance(),
      auto_updater: crate::updater::auto_updater::AutoUpdater::instance(),
      camoufox_manager: CamoufoxManager::instance(),
      wayfern_manager: WayfernManager::instance(),
    }
  }

  pub fn instance() -> &'static BrowserRunner {
    &BROWSER_RUNNER
  }

  pub fn get_binaries_dir(&self) -> PathBuf {
    crate::settings::app_dirs::binaries_dir()
  }

  // Helper methods (blocklist, proxy, launch hooks, automation) → browser_runner_helpers.rs

  pub async fn launch_browser(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
    url: Option<String>,
    local_proxy_settings: Option<&ProxySettings>,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
    self
      .launch_browser_internal(app_handle, profile, url, local_proxy_settings, None, false)
      .await
  }

  async fn launch_browser_internal(
    &self,
    app_handle: tauri::AppHandle,
    profile: &BrowserProfile,
    url: Option<String>,
    _local_proxy_settings: Option<&ProxySettings>,
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<BrowserProfile, Box<dyn std::error::Error + Send + Sync>> {
    match profile.browser.as_str() {
      "camoufox" => {
        self
          .launch_camoufox_internal(
            app_handle,
            profile,
            url,
            _local_proxy_settings,
            remote_debugging_port,
            headless,
          )
          .await
      }

      "wayfern" => {
        self
          .launch_wayfern_internal(
            app_handle,
            profile,
            url,
            _local_proxy_settings,
            remote_debugging_port,
            headless,
          )
          .await
      }
      _ => Err(format!("Unsupported browser type: {}", profile.browser).into()),
    }
  }
}

// Browser lifecycle helper methods → browser_runner_helpers.rs
// Camoufox launch orchestration → browser_runner_launch_camoufox.rs
// Wayfern launch orchestration → browser_runner_launch_wayfern.rs
// Post-exit cleanup and automation → browser_runner_cleanup.rs

include!("browser_runner_helpers.rs");
include!("browser_runner_launch_camoufox.rs");
include!("browser_runner_launch_wayfern.rs");
include!("browser_runner_cleanup.rs");
include!("browser_runner_url.rs");
include!("browser_runner_kill.rs");
include!("browser_runner_kill2.rs");
include!("browser_runner_find.rs");
include!("browser_runner_commands.rs");
