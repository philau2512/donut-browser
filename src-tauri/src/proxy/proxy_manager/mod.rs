use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_shell::ShellExt;

use crate::browser::ProxySettings;
use crate::events;
use crate::proxy::ip_utils;

// Export data format for JSON export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyExportData {
  pub version: String,
  pub proxies: Vec<ExportedProxy>,
  pub exported_at: String,
  pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedProxy {
  pub name: String,
  #[serde(rename = "type")]
  pub proxy_type: String,
  pub host: String,
  pub port: u16,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub username: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyImportResult {
  pub imported_count: usize,
  pub skipped_count: usize,
  pub errors: Vec<String>,
  pub proxies: Vec<StoredProxy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedProxyLine {
  pub proxy_type: String,
  pub host: String,
  pub port: u16,
  pub username: Option<String>,
  pub password: Option<String>,
  pub original_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum ProxyParseResult {
  #[serde(rename = "parsed")]
  Parsed(ParsedProxyLine),
  #[serde(rename = "ambiguous")]
  Ambiguous {
    line: String,
    possible_formats: Vec<String>,
  },
  #[serde(rename = "invalid")]
  Invalid { line: String, reason: String },
}

// Store active proxy information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyInfo {
  pub id: String,
  pub local_url: String,
  pub upstream_host: String,
  pub upstream_port: u16,
  pub upstream_type: String,
  pub local_port: u16,
  // Optional profile ID to which this proxy instance is logically tied
  pub profile_id: Option<String>,
  pub blocklist_file: Option<String>,
}

// Proxy check result cache
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyCheckResult {
  pub ip: String,
  pub city: Option<String>,
  pub country: Option<String>,
  pub country_code: Option<String>,
  pub timestamp: u64,
  pub is_valid: bool,
}

pub const CLOUD_PROXY_ID: &str = "cloud-included-proxy";

// Stored proxy configuration with name and ID for reuse
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredProxy {
  pub id: String,
  pub name: String,
  pub proxy_settings: ProxySettings,
  #[serde(default)]
  pub sync_enabled: bool,
  #[serde(default)]
  pub last_sync: Option<u64>,
  /// Unix seconds of the last meaningful user edit. Source of truth for sync
  /// conflict resolution (last-write-wins) — bumped on config edits only, never
  /// by sync bookkeeping. `None` on legacy files is treated as 0.
  #[serde(default)]
  pub updated_at: Option<u64>,
  #[serde(default)]
  pub is_cloud_managed: bool,
  #[serde(default)]
  pub is_cloud_derived: bool,
  #[serde(default)]
  pub is_profile_specific: bool,
  #[serde(default)]
  pub geo_country: Option<String>,
  // Legacy field kept for deserialization compat; mapped to geo_region on load
  #[serde(default)]
  pub geo_state: Option<String>,
  #[serde(default)]
  pub geo_region: Option<String>,
  #[serde(default)]
  pub geo_city: Option<String>,
  #[serde(default)]
  pub geo_isp: Option<String>,
  #[serde(default)]
  pub dynamic_proxy_url: Option<String>,
  #[serde(default)]
  pub dynamic_proxy_format: Option<String>,
}

/// Current unix time in whole seconds. Used to stamp `updated_at` on edits.
pub fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

impl StoredProxy {
  pub fn new(name: String, proxy_settings: ProxySettings) -> Self {
    let sync_enabled = crate::sync::is_sync_configured();
    Self {
      id: uuid::Uuid::new_v4().to_string(),
      name,
      proxy_settings,
      sync_enabled,
      last_sync: None,
      updated_at: Some(now_secs()),
      is_cloud_managed: false,
      is_cloud_derived: false,
      is_profile_specific: false,
      geo_country: None,
      geo_state: None,
      geo_region: None,
      geo_city: None,
      geo_isp: None,
      dynamic_proxy_url: None,
      dynamic_proxy_format: None,
    }
  }

  /// Migrate legacy geo_state to geo_region
  pub fn migrate_geo_fields(&mut self) {
    if self.geo_region.is_none() && self.geo_state.is_some() {
      self.geo_region = self.geo_state.take();
    }
  }

  /// Get the effective region (prefers geo_region, falls back to geo_state for compat)
  pub fn effective_region(&self) -> Option<&String> {
    self.geo_region.as_ref().or(self.geo_state.as_ref())
  }

  pub fn update_settings(&mut self, proxy_settings: ProxySettings) {
    self.proxy_settings = proxy_settings;
    self.updated_at = Some(now_secs());
  }

  pub fn update_name(&mut self, name: String) {
    self.name = name;
    self.updated_at = Some(now_secs());
  }
}

// Global proxy manager to track active proxies and stored proxy configurations
pub struct ProxyManager {
  active_proxies: Mutex<HashMap<u32, ProxyInfo>>, // Maps browser process ID to proxy info
  // Store proxy info by profile name for persistence across browser restarts
  profile_proxies: Mutex<HashMap<String, ProxySettings>>, // Maps profile name to proxy settings
  // Track active proxy IDs by profile name for targeted cleanup
  profile_active_proxy_ids: Mutex<HashMap<String, String>>, // Maps profile name to proxy id
  stored_proxies: Mutex<HashMap<String, StoredProxy>>,      // Maps proxy ID to stored proxy
  // Consecutive cleanup passes during which a browser PID looked dead.
  // We only reap a worker after it has been missed in N consecutive scans —
  // a single sysinfo blip under load shouldn't kill a still-running worker.
  dead_browser_misses: Mutex<HashMap<u32, u8>>,
}

impl ProxyManager {
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    let manager = Self {
      active_proxies: Mutex::new(HashMap::new()),
      profile_proxies: Mutex::new(HashMap::new()),
      profile_active_proxy_ids: Mutex::new(HashMap::new()),
      stored_proxies: Mutex::new(HashMap::new()),
      dead_browser_misses: Mutex::new(HashMap::new()),
    };

    // Load stored proxies on initialization
    if let Err(e) = manager.load_stored_proxies() {
      log::warn!("Failed to load stored proxies: {e}");
    }

    manager
  }

  fn get_proxies_dir(&self) -> PathBuf {
    crate::settings::app_dirs::proxies_dir()
  }

  fn get_proxy_check_cache_dir(&self) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let path = crate::settings::app_dirs::cache_dir().join("proxy_checks");
    fs::create_dir_all(&path)?;
    Ok(path)
  }

  // Get the path to a specific proxy check cache file
  fn get_proxy_check_cache_file(
    &self,
    proxy_id: &str,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let cache_dir = self.get_proxy_check_cache_dir()?;
    Ok(cache_dir.join(format!("{proxy_id}.json")))
  }

  // Load cached proxy check result
  fn load_proxy_check_cache(&self, proxy_id: &str) -> Option<ProxyCheckResult> {
    let cache_file = match self.get_proxy_check_cache_file(proxy_id) {
      Ok(file) => file,
      Err(_) => return None,
    };

    if !cache_file.exists() {
      return None;
    }

    let content = match fs::read_to_string(&cache_file) {
      Ok(content) => content,
      Err(_) => return None,
    };

    serde_json::from_str::<ProxyCheckResult>(&content).ok()
  }

  // Save proxy check result to cache
  fn save_proxy_check_cache(
    &self,
    proxy_id: &str,
    result: &ProxyCheckResult,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let cache_file = self.get_proxy_check_cache_file(proxy_id)?;
    let content = serde_json::to_string_pretty(result)?;
    fs::write(&cache_file, content)?;
    Ok(())
  }

  // Get current timestamp
  fn get_current_timestamp() -> u64 {
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_secs()
  }

  pub async fn get_ip_geolocation(
    ip: &str,
  ) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    // Use ip-api.com (free, no API key required)
    let url = format!(
      "http://ip-api.com/json/{}?fields=status,message,country,countryCode,city",
      ip
    );

    let client = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(5))
      .build()
      .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    match client.get(&url).send().await {
      Ok(response) => {
        if response.status().is_success() {
          match response.json::<serde_json::Value>().await {
            Ok(json) => {
              if json.get("status").and_then(|s| s.as_str()) == Some("success") {
                let country = json
                  .get("country")
                  .and_then(|v| v.as_str())
                  .map(|s| s.to_string());
                let country_code = json
                  .get("countryCode")
                  .and_then(|v| v.as_str())
                  .map(|s| s.to_string());
                let city = json
                  .get("city")
                  .and_then(|v| v.as_str())
                  .map(|s| s.to_string());
                Ok((city, country, country_code))
              } else {
                Ok((None, None, None))
              }
            }
            Err(e) => Err(format!("Failed to parse geolocation response: {e}")),
          }
        } else {
          Ok((None, None, None))
        }
      }
      Err(e) => Err(format!("Failed to fetch geolocation: {e}")),
    }
  }
}

include!("crud.rs");
include!("connection.rs");
