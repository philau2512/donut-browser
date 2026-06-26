use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[cfg(target_os = "linux")]
#[derive(Debug, Clone)]
pub(super) enum LinuxInstallationMethod {
  Deb,
  Rpm,
  AppImage,
  Manual,
  Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppReleaseAsset {
  pub name: String,
  pub browser_download_url: String,
  pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppRelease {
  pub tag_name: String,
  pub name: String,
  pub body: String,
  pub published_at: String,
  pub prerelease: bool,
  pub assets: Vec<AppReleaseAsset>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppUpdateInfo {
  pub current_version: String,
  pub new_version: String,
  pub release_notes: String,
  pub download_url: String,
  pub is_nightly: bool,
  pub published_at: String,
  pub manual_update_required: bool,
  pub release_page_url: Option<String>,
  /// True when a system package manager repo is configured (apt/dnf/zypper)
  pub repo_update: bool,
}

pub struct AppAutoUpdater {
  pub(super) client: Client,
  pub(super) extractor: &'static crate::browser::extraction::Extractor,
}

lazy_static::lazy_static! {
  pub(super) static ref APP_AUTO_UPDATER: AppAutoUpdater = AppAutoUpdater::new();
  pub(super) static ref PENDING_INSTALLER_PATH: std::sync::Mutex<Option<PathBuf>> =
    std::sync::Mutex::new(None);
}
