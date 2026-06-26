use aes_gcm::{
  aead::{Aead, AeadCore, KeyInit, OsRng},
  Aes256Gcm, Key, Nonce,
};
use argon2::{password_hash::SaltString, Argon2, PasswordHasher};
use chrono::Utc;
use lazy_static::lazy_static;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::browser::ProxySettings;
use crate::proxy::proxy_manager::PROXY_MANAGER;
use crate::settings::settings_manager::SettingsManager;
use crate::sync;

pub const CLOUD_API_URL: &str = "https://api.donutbrowser.com";
pub const CLOUD_SYNC_URL: &str = "https://sync.donutbrowser.com";

/// Default per-hour cap on local automation API / MCP requests. Mirrors the
/// backend's DEFAULT_REQUESTS_PER_HOUR. Not enforced yet — see the inert
/// rate-limit chokepoints in api_server / mcp_server.
const DEFAULT_REQUESTS_PER_HOUR: i64 = 100;

/// Capability + limit set the account is entitled to, derived from its plan.
/// Mirrors `apps/backend/src/plans/entitlements.ts`. Features are gated on these
/// flags instead of a single "is paid?" boolean, so a plan like the future
/// "starter" tier (cross-OS fingerprints + cloud backup, no automation) is just
/// data here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entitlements {
  #[serde(default)]
  pub active: bool,
  #[serde(rename = "browserAutomation", default)]
  pub browser_automation: bool,
  #[serde(rename = "crossOsFingerprints", default)]
  pub cross_os_fingerprints: bool,
  #[serde(rename = "cloudBackup", default)]
  pub cloud_backup: bool,
  #[serde(rename = "teamCollaboration", default)]
  pub team_collaboration: bool,
  #[serde(rename = "profileLimit", default)]
  pub profile_limit: i64,
  #[serde(rename = "requestsPerHour", default)]
  pub requests_per_hour: i64,
}

/// Local fallback mirror of the backend plan -> capability matrix, used only when
/// the server hasn't sent an entitlements object (older cached state / backend).
///
/// NOTE: All entitlements are currently unlocked for all users regardless of
/// plan. This bypasses the original paywall logic.
fn derive_entitlements(
  _plan: &str,
  _plan_period: Option<&str>,
  _subscription_status: &str,
  profile_limit: i64,
) -> Entitlements {
  // All features unlocked for all users
  Entitlements {
    active: true,
    browser_automation: true,
    cross_os_fingerprints: true,
    cloud_backup: true,
    team_collaboration: true,
    profile_limit,
    requests_per_hour: DEFAULT_REQUESTS_PER_HOUR,
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudUser {
  pub id: String,
  pub email: String,
  pub plan: String,
  #[serde(rename = "planPeriod")]
  pub plan_period: Option<String>,
  #[serde(rename = "subscriptionStatus")]
  pub subscription_status: String,
  #[serde(rename = "profileLimit")]
  pub profile_limit: i64,
  #[serde(rename = "cloudProfilesUsed")]
  pub cloud_profiles_used: i64,
  #[serde(rename = "proxyBandwidthLimitMb")]
  pub proxy_bandwidth_limit_mb: i64,
  #[serde(rename = "proxyBandwidthUsedMb")]
  pub proxy_bandwidth_used_mb: i64,
  #[serde(rename = "proxyBandwidthExtraMb", default)]
  pub proxy_bandwidth_extra_mb: i64,
  #[serde(rename = "teamId", default)]
  pub team_id: Option<String>,
  #[serde(rename = "teamName", default)]
  pub team_name: Option<String>,
  #[serde(rename = "teamRole", default)]
  pub team_role: Option<String>,
  // This desktop session's position among the user's active devices, oldest
  // first. Ordinal 1 is the primary device — the only one that can run browser
  // automation. `default` keeps older login/state payloads (which lack these
  // fields) deserializing cleanly.
  #[serde(rename = "deviceOrdinal", default)]
  pub device_ordinal: Option<i64>,
  #[serde(rename = "deviceCount", default)]
  pub device_count: Option<i64>,
  #[serde(rename = "isPrimaryDevice", default)]
  pub is_primary_device: Option<bool>,
  /// Capability/limit set derived from the plan by the backend. `default` (None)
  /// keeps older login/state payloads deserializing; resolve via `entitlements()`.
  #[serde(default)]
  pub entitlements: Option<Entitlements>,
}

impl CloudUser {
  /// Authoritative entitlements: the server-sent set when present, else derived
  /// locally from the plan fields (keeps older cached state / backends working).
  ///
  /// NOTE: Currently bypasses server-sent entitlements to unlock all features
  /// for all users. Passes profile_limit through for informational purposes.
  pub fn entitlements(&self) -> Entitlements {
    // Bypass server-sent entitlements; always derive locally (all unlocked)
    derive_entitlements(
      &self.plan,
      self.plan_period.as_deref(),
      &self.subscription_status,
      self.profile_limit,
    )
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudAuthState {
  pub user: CloudUser,
  pub logged_in_at: String,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeChallengeResponse {
  #[serde(rename = "challengeId")]
  challenge_id: String,
  prefix: String,
  difficulty: u32,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeExchangeResponse {
  #[serde(rename = "accessToken")]
  access_token: String,
  #[serde(rename = "refreshToken")]
  refresh_token: String,
  user: CloudUser,
}

#[derive(Debug, Deserialize)]
struct RefreshTokenResponse {
  #[serde(rename = "accessToken")]
  access_token: String,
  #[serde(rename = "refreshToken")]
  refresh_token: String,
}

#[derive(Debug, Deserialize)]
struct SyncTokenResponse {
  #[serde(rename = "syncToken")]
  sync_token: String,
}

#[derive(Debug, Deserialize)]
struct WayfernTokenResponse {
  token: String,
  #[serde(rename = "expiresIn")]
  #[allow(dead_code)]
  expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationItem {
  pub code: String,
  pub name: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct CloudProxyConfigResponse {
  host: String,
  port: u16,
  username: Option<String>,
  password: Option<String>,
  protocol: String,
  #[serde(rename = "bandwidthLimitMb")]
  bandwidth_limit_mb: i64,
  #[serde(rename = "bandwidthUsedMb")]
  bandwidth_used_mb: i64,
}

pub struct CloudAuthManager {
  client: Client,
  state: Mutex<Option<CloudAuthState>>,
  refresh_lock: tokio::sync::Mutex<()>,
  wayfern_token: Mutex<Option<String>>,
}

lazy_static! {
  pub static ref CLOUD_AUTH: CloudAuthManager = CloudAuthManager::new();
}

impl CloudAuthManager {
  fn new() -> Self {
    let state = Self::load_auth_state_from_disk();
    // Bound every cloud API call so no single slow / hung request can stall
    // the startup chain (sync-token → proxy-config → wayfern-token), which
    // otherwise gates Wayfern launch behind whichever endpoint is slowest.
    let client = Client::builder()
      .timeout(std::time::Duration::from_secs(15))
      .connect_timeout(std::time::Duration::from_secs(5))
      .build()
      .unwrap_or_else(|_| Client::new());
    Self {
      client,
      state: Mutex::new(state),
      refresh_lock: tokio::sync::Mutex::new(()),
      wayfern_token: Mutex::new(None),
    }
  }

  // --- Settings directory (reuse SettingsManager path) ---

  fn get_settings_dir() -> PathBuf {
    SettingsManager::instance().get_settings_dir()
  }

  fn get_vault_password() -> String {
    env!("DONUT_BROWSER_VAULT_PASSWORD").to_string()
  }

  // --- Encrypted file storage (same pattern as settings_manager.rs) ---

  fn encrypt_and_store(file_path: &PathBuf, header: &[u8; 5], data: &str) -> Result<(), String> {
    if let Some(parent) = file_path.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    let vault_password = Self::get_vault_password();
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
      .hash_password(vault_password.as_bytes(), &salt)
      .map_err(|e| format!("Argon2 key derivation failed: {e}"))?;
    let hash_value = password_hash.hash.unwrap();
    let hash_bytes = hash_value.as_bytes();
    let key_bytes: [u8; 32] = hash_bytes[..32]
      .try_into()
      .map_err(|_| "Invalid key length".to_string())?;
    let key = Key::<Aes256Gcm>::from(key_bytes);
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
      .encrypt(&nonce, data.as_bytes())
      .map_err(|e| format!("Encryption failed: {e}"))?;

    let mut file_data = Vec::new();
    file_data.extend_from_slice(header);
    file_data.push(2u8);
    let salt_str = salt.as_str();
    file_data.push(salt_str.len() as u8);
    file_data.extend_from_slice(salt_str.as_bytes());
    file_data.extend_from_slice(&nonce);
    file_data.extend_from_slice(&(ciphertext.len() as u32).to_le_bytes());
    file_data.extend_from_slice(&ciphertext);

    fs::write(file_path, file_data).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
  }

  fn decrypt_from_file(file_path: &PathBuf, header: &[u8; 5]) -> Result<Option<String>, String> {
    if !file_path.exists() {
      return Ok(None);
    }

    let file_data = fs::read(file_path).map_err(|e| format!("Failed to read file: {e}"))?;

    if file_data.len() < 6 || &file_data[0..5] != header {
      return Ok(None);
    }

    let version = file_data[5];
    if version != 2 {
      return Ok(None);
    }

    let mut offset = 6;
    if offset >= file_data.len() {
      return Ok(None);
    }
    let salt_len = file_data[offset] as usize;
    offset += 1;

    if offset + salt_len > file_data.len() {
      return Ok(None);
    }
    let salt_bytes = &file_data[offset..offset + salt_len];
    let salt_str = std::str::from_utf8(salt_bytes).map_err(|_| "Invalid salt encoding")?;
    let salt = SaltString::from_b64(salt_str).map_err(|_| "Invalid salt format")?;
    offset += salt_len;

    if offset + 12 > file_data.len() {
      return Ok(None);
    }
    let nonce_bytes: [u8; 12] = file_data[offset..offset + 12]
      .try_into()
      .map_err(|_| "Invalid nonce length".to_string())?;
    let nonce = Nonce::from(nonce_bytes);
    offset += 12;

    if offset + 4 > file_data.len() {
      return Ok(None);
    }
    let ciphertext_len = u32::from_le_bytes([
      file_data[offset],
      file_data[offset + 1],
      file_data[offset + 2],
      file_data[offset + 3],
    ]) as usize;
    offset += 4;

    if offset + ciphertext_len > file_data.len() {
      return Ok(None);
    }
    let ciphertext = &file_data[offset..offset + ciphertext_len];

    let vault_password = Self::get_vault_password();
    let argon2 = Argon2::default();
    let password_hash = argon2
      .hash_password(vault_password.as_bytes(), &salt)
      .map_err(|e| format!("Argon2 key derivation failed: {e}"))?;
    let hash_value = password_hash.hash.unwrap();
    let hash_bytes = hash_value.as_bytes();
    let key_bytes: [u8; 32] = hash_bytes[..32]
      .try_into()
      .map_err(|_| "Invalid key length".to_string())?;
    let key = Key::<Aes256Gcm>::from(key_bytes);
    let cipher = Aes256Gcm::new(&key);
    let plaintext = cipher
      .decrypt(&nonce, ciphertext)
      .map_err(|_| "Decryption failed".to_string())?;

    match String::from_utf8(plaintext) {
      Ok(token) => Ok(Some(token)),
      Err(_) => Ok(None),
    }
  }

  // --- Token storage methods ---

  fn store_access_token(token: &str) -> Result<(), String> {
    let path = Self::get_settings_dir().join("cloud_access_token.dat");
    Self::encrypt_and_store(&path, b"DBCAT", token)
  }

  pub(crate) fn load_access_token() -> Result<Option<String>, String> {
    let path = Self::get_settings_dir().join("cloud_access_token.dat");
    Self::decrypt_from_file(&path, b"DBCAT")
  }

  fn store_refresh_token(token: &str) -> Result<(), String> {
    let path = Self::get_settings_dir().join("cloud_refresh_token.dat");
    Self::encrypt_and_store(&path, b"DBCRT", token)
  }

  fn load_refresh_token() -> Result<Option<String>, String> {
    let path = Self::get_settings_dir().join("cloud_refresh_token.dat");
    Self::decrypt_from_file(&path, b"DBCRT")
  }

  fn store_cloud_sync_token(token: &str) -> Result<(), String> {
    let path = Self::get_settings_dir().join("cloud_sync_token.dat");
    Self::encrypt_and_store(&path, b"DBCST", token)
  }

  fn load_cloud_sync_token() -> Result<Option<String>, String> {
    let path = Self::get_settings_dir().join("cloud_sync_token.dat");
    Self::decrypt_from_file(&path, b"DBCST")
  }

  fn store_auth_state(state: &CloudAuthState) -> Result<(), String> {
    let path = Self::get_settings_dir().join("cloud_auth_state.json");
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let json =
      serde_json::to_string_pretty(state).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write auth state: {e}"))?;
    Ok(())
  }

  fn load_auth_state_from_disk() -> Option<CloudAuthState> {
    let path = Self::get_settings_dir().join("cloud_auth_state.json");
    if !path.exists() {
      return None;
    }
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
  }

  fn delete_all_cloud_files() {
    let dir = Self::get_settings_dir();
    let files = [
      "cloud_access_token.dat",
      "cloud_refresh_token.dat",
      "cloud_sync_token.dat",
      "cloud_auth_state.json",
    ];
    for f in &files {
      let path = dir.join(f);
      if path.exists() {
        let _ = fs::remove_file(path);
      }
    }
  }

  // --- JWT expiry check ---

  fn is_jwt_expiring_soon(token: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
      return true;
    }

    use base64::{engine::general_purpose, Engine as _};
    let payload = match general_purpose::URL_SAFE_NO_PAD.decode(parts[1]) {
      Ok(bytes) => bytes,
      Err(_) => {
        // Try standard base64 with padding
        match general_purpose::STANDARD.decode(parts[1]) {
          Ok(bytes) => bytes,
          Err(_) => return true,
        }
      }
    };

    let json: serde_json::Value = match serde_json::from_slice(&payload) {
      Ok(v) => v,
      Err(_) => return true,
    };

    let exp = match json.get("exp").and_then(|v| v.as_i64()) {
      Some(exp) => exp,
      None => return true,
    };

    let now = Utc::now().timestamp();
    exp - now < 120
  }

  // --- API methods ---

  pub async fn exchange_device_code(&self, code: &str) -> Result<CloudAuthState, String> {
    let challenge_url = format!("{CLOUD_API_URL}/api/auth/device-code/challenge");
    let challenge_response = self
      .client
      .post(&challenge_url)
      .send()
      .await
      .map_err(|e| format!("Failed to fetch challenge: {e}"))?;

    if !challenge_response.status().is_success() {
      let status = challenge_response.status();
      let body = challenge_response.text().await.unwrap_or_default();
      return Err(format!("Challenge request failed ({status}): {body}"));
    }

    let challenge: DeviceCodeChallengeResponse = challenge_response
      .json()
      .await
      .map_err(|e| format!("Failed to parse challenge: {e}"))?;

    let nonce = solve_pow(&challenge.prefix, challenge.difficulty)
      .ok_or_else(|| "Failed to solve proof-of-work".to_string())?;

    let exchange_url = format!("{CLOUD_API_URL}/api/auth/device-code/exchange");
    let response = self
      .client
      .post(&exchange_url)
      .json(&serde_json::json!({
        "code": code,
        "challengeId": challenge.challenge_id,
        "nonce": nonce,
      }))
      .send()
      .await
      .map_err(|e| format!("Failed to verify code: {e}"))?;

    if !response.status().is_success() {
      let status = response.status();
      let body = response.text().await.unwrap_or_default();
      // The backend returns { message, code, … } for 4xx (e.g. the 3-device
      // limit or a temporary security block). Surface the human-readable
      // message rather than the raw JSON so the sign-in screen is clear.
      let message = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| {
          v.get("message")
            .and_then(|m| m.as_str())
            .map(std::string::ToString::to_string)
        })
        .unwrap_or_else(|| format!("Login failed ({status})"));
      return Err(message);
    }

    let result: DeviceCodeExchangeResponse = response
      .json()
      .await
      .map_err(|e| format!("Failed to parse response: {e}"))?;

    // Store tokens
    log::info!(
      "Storing access token (len={}) and refresh token (len={})",
      result.access_token.len(),
      result.refresh_token.len()
    );
    Self::store_access_token(&result.access_token)?;
    Self::store_refresh_token(&result.refresh_token)?;

    // Verify tokens survived the encrypt/decrypt round-trip
    match Self::load_access_token() {
      Ok(Some(loaded)) if loaded == result.access_token => {
        log::info!(
          "Access token verified after store/load (len={})",
          loaded.len()
        );
      }
      Ok(Some(loaded)) => {
        log::error!(
          "Access token CORRUPTED during store/load: original_len={}, loaded_len={}",
          result.access_token.len(),
          loaded.len()
        );
      }
      Ok(None) => {
        log::error!("Access token missing immediately after store");
      }
      Err(e) => {
        log::error!("Failed to load access token for verification: {e}");
      }
    }

    // Build and persist auth state
    let auth_state = CloudAuthState {
      user: result.user,
      logged_in_at: Utc::now().to_rfc3339(),
    };
    Self::store_auth_state(&auth_state)?;

    log::info!(
      "Login successful: plan={}, subscription_status={}, proxy_bandwidth_limit={}MB",
      auth_state.user.plan,
      auth_state.user.subscription_status,
      auth_state.user.proxy_bandwidth_limit_mb
    );

    // Update in-memory state
    let mut state = self.state.lock().await;
    *state = Some(auth_state.clone());

    Ok(auth_state)
  }

  pub async fn refresh_access_token(&self) -> Result<(), String> {
    let _guard = self.refresh_lock.lock().await;
    log::info!("Refreshing access token (holding lock)...");

    let refresh_token =
      Self::load_refresh_token()?.ok_or_else(|| "No refresh token stored".to_string())?;

    let url = format!("{CLOUD_API_URL}/api/auth/token/refresh");
    let response = self
      .client
      .post(&url)
      .json(&serde_json::json!({ "refreshToken": refresh_token }))
      .send()
      .await
      .map_err(|e| format!("Failed to refresh token: {e}"))?;

    if !response.status().is_success() {
      let status = response.status();
      let body = response.text().await.unwrap_or_default();
      log::warn!("Token refresh failed ({status}): {body}");
      return Err(format!("Token refresh failed ({status}): {body}"));
    }

    let result: RefreshTokenResponse = response
      .json()
      .await
      .map_err(|e| format!("Failed to parse response: {e}"))?;

    Self::store_access_token(&result.access_token)?;
    Self::store_refresh_token(&result.refresh_token)?;

    log::info!("Access token refreshed successfully");
    Ok(())
  }

  /// Invalidate the session: clear all auth state and notify the frontend.
  /// Only call this when the session is definitively dead (explicit logout
  /// or repeated background refresh failures).
  pub async fn invalidate_session(&self) {
    log::warn!("Invalidating session — clearing all auth state");
    PROXY_MANAGER.remove_cloud_proxy();
    self.clear_auth().await;
    let _ = crate::events::emit_empty("cloud-auth-expired");
  }

  pub async fn fetch_profile(&self) -> Result<CloudUser, String> {
    let user = self
      .api_call_with_retry(|access_token| {
        let url = format!("{CLOUD_API_URL}/api/auth/me");
        let client = self.client.clone();
        async move {
          let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch profile: {e}"))?;

          if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Profile fetch failed ({status}): {body}"));
          }

          response
            .json::<CloudUser>()
            .await
            .map_err(|e| format!("Failed to parse profile: {e}"))
        }
      })
      .await?;

    // Update cached state
    let mut state = self.state.lock().await;
    if let Some(auth_state) = state.as_mut() {
      auth_state.user = user.clone();
      let _ = Self::store_auth_state(auth_state);
    }

    Ok(user)
  }
}

include!("cloud_auth_methods.rs");
include!("cloud_auth_commands.rs");
