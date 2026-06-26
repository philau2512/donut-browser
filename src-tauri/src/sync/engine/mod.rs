use super::client::SyncClient;
use super::encryption;
use super::manifest::{compute_diff, generate_manifest, get_cache_path, HashCache, SyncManifest};
use super::types::*;
use crate::events;
use crate::profile::types::{BrowserProfile, SyncMode};
use crate::profile::ProfileManager;
use crate::settings::settings_manager::SettingsManager;
use chrono::{DateTime, Utc};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;
use tokio::sync::{Mutex as TokioMutex, Semaphore};

/// S3 object-metadata key (stored as `x-amz-meta-updated-at`) holding an
/// entity's user-edit timestamp in unix seconds. Used to resolve sync conflicts
/// (last-write-wins) from a HEAD request without downloading the object body.
const UPDATED_AT_META_KEY: &str = "updated-at";

lazy_static::lazy_static! {
  static ref SYNC_CANCEL_FLAGS: StdMutex<HashMap<String, Arc<AtomicBool>>> =
    StdMutex::new(HashMap::new());
}

fn register_sync_cancel(profile_id: &str) -> Arc<AtomicBool> {
  let mut map = SYNC_CANCEL_FLAGS.lock().unwrap();
  let flag = Arc::new(AtomicBool::new(false));
  map.insert(profile_id.to_string(), flag.clone());
  flag
}

fn clear_sync_cancel(profile_id: &str) {
  SYNC_CANCEL_FLAGS.lock().unwrap().remove(profile_id);
}

pub fn request_sync_cancel(profile_id: &str) -> bool {
  if let Some(flag) = SYNC_CANCEL_FLAGS.lock().unwrap().get(profile_id) {
    flag.store(true, Ordering::SeqCst);
    true
  } else {
    false
  }
}

struct SyncCancelGuard(String);
impl Drop for SyncCancelGuard {
  fn drop(&mut self) {
    clear_sync_cancel(&self.0);
  }
}

#[tauri::command]
pub async fn cancel_profile_sync(profile_id: String) -> Result<bool, String> {
  Ok(request_sync_cancel(&profile_id))
}

/// Upload/download concurrency limit
const SYNC_CONCURRENCY: usize = 32;

/// Max retries for individual file uploads/downloads
const MAX_FILE_RETRIES: u32 = 3;

/// Critical file patterns — if any of these fail to upload/download, the sync is aborted.
const CRITICAL_FILE_PATTERNS: &[&str] = &[
  "Cookies",
  "Login Data",
  "Local Storage",
  "Local State",
  "Preferences",
  "Secure Preferences",
  "Web Data",
  "Extension Cookies",
  // Firefox/Camoufox equivalents
  "cookies.sqlite",
  "key4.db",
  "logins.json",
  "cert9.db",
  "places.sqlite",
  "formhistory.sqlite",
  "permissions.sqlite",
  "prefs.js",
  "storage.sqlite",
];

fn is_critical_file(path: &str) -> bool {
  CRITICAL_FILE_PATTERNS
    .iter()
    .any(|pattern| path.contains(pattern))
}

/// Checkpoint all SQLite WAL files in a profile directory.
///
/// When a browser crashes or is killed, SQLite WAL files may contain
/// uncommitted data (e.g. cookies, login data). Since WAL files are
/// excluded from sync, we must checkpoint them into the main database
/// files before generating the manifest to avoid data loss.
fn checkpoint_sqlite_wal_files(profile_dir: &Path) {
  fn find_wal_files(dir: &Path, wal_files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
      return;
    };
    for entry in entries.flatten() {
      let path = entry.path();
      if path.is_dir() {
        find_wal_files(&path, wal_files);
      } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name.ends_with("-wal") {
          wal_files.push(path);
        }
      }
    }
  }

  let mut wal_files = Vec::new();
  find_wal_files(profile_dir, &mut wal_files);

  for wal_path in &wal_files {
    // Only checkpoint non-empty WAL files
    let is_non_empty = fs::metadata(wal_path).map(|m| m.len() > 0).unwrap_or(false);
    if !is_non_empty {
      continue;
    }

    // Derive the main database path by stripping the "-wal" suffix
    let db_path_str = wal_path.to_string_lossy();
    let db_path = PathBuf::from(db_path_str.strip_suffix("-wal").unwrap());

    if !db_path.exists() {
      continue;
    }

    match rusqlite::Connection::open(&db_path) {
      Ok(conn) => match conn.pragma_update(None, "wal_checkpoint", "TRUNCATE") {
        Ok(_) => {
          log::info!(
            "Checkpointed WAL for: {}",
            db_path.file_name().unwrap_or_default().to_string_lossy()
          );
        }
        Err(e) => {
          log::warn!("Failed to checkpoint WAL for {}: {}", db_path.display(), e);
        }
      },
      Err(e) => {
        log::warn!(
          "Failed to open DB for WAL checkpoint {}: {}",
          db_path.display(),
          e
        );
      }
    }
  }
}

/// Resume state persisted to disk so interrupted syncs can continue
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SyncResumeState {
  profile_id: String,
  direction: String,
  started_at: String,
  completed_files: HashSet<String>,
}

impl SyncResumeState {
  fn path(profile_dir: &Path) -> std::path::PathBuf {
    profile_dir.join(".donut-sync").join("resume-state.json")
  }

  fn load(profile_dir: &Path) -> Option<Self> {
    let path = Self::path(profile_dir);
    let content = fs::read_to_string(&path).ok()?;
    let state: Self = serde_json::from_str(&content).ok()?;
    // Discard if older than 12 hours (presigned URLs expire in 1h but files may still be there)
    if let Ok(started) = DateTime::parse_from_rfc3339(&state.started_at) {
      let age = Utc::now() - started.with_timezone(&Utc);
      if age.num_hours() > 12 {
        let _ = fs::remove_file(&path);
        return None;
      }
    }
    Some(state)
  }

  fn save(&self, profile_dir: &Path) -> SyncResult<()> {
    let path = Self::path(profile_dir);
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)
        .map_err(|e| SyncError::IoError(format!("Failed to create resume state dir: {e}")))?;
    }
    let json = serde_json::to_string(self).map_err(|e| {
      SyncError::SerializationError(format!("Failed to serialize resume state: {e}"))
    })?;
    fs::write(&path, json)
      .map_err(|e| SyncError::IoError(format!("Failed to write resume state: {e}")))?;
    Ok(())
  }

  fn delete(profile_dir: &Path) {
    let path = Self::path(profile_dir);
    let _ = fs::remove_file(&path);
  }
}

/// Tracks live sync progress and emits throttled events to the frontend
struct SyncProgressTracker {
  profile_id: String,
  profile_name: String,
  phase: String,
  total_files: u64,
  total_bytes: u64,
  completed_files: AtomicU64,
  completed_bytes: AtomicU64,
  failed_count: AtomicU64,
  start_time: Instant,
  last_emit: TokioMutex<Instant>,
}

impl SyncProgressTracker {
  fn new(
    profile_id: String,
    profile_name: String,
    phase: &str,
    total_files: u64,
    total_bytes: u64,
  ) -> Self {
    Self {
      profile_id,
      profile_name,
      phase: phase.to_string(),
      total_files,
      total_bytes,
      completed_files: AtomicU64::new(0),
      completed_bytes: AtomicU64::new(0),
      failed_count: AtomicU64::new(0),
      start_time: Instant::now(),
      last_emit: TokioMutex::new(Instant::now() - std::time::Duration::from_secs(1)),
    }
  }

  fn record_success(&self, bytes: u64) {
    self.completed_files.fetch_add(1, Ordering::Relaxed);
    self.completed_bytes.fetch_add(bytes, Ordering::Relaxed);
    self.maybe_emit();
  }

  fn record_failure(&self) {
    self.completed_files.fetch_add(1, Ordering::Relaxed);
    self.failed_count.fetch_add(1, Ordering::Relaxed);
    self.maybe_emit();
  }

  fn maybe_emit(&self) {
    let Ok(mut last) = self.last_emit.try_lock() else {
      return;
    };
    if last.elapsed().as_millis() < 250 {
      return;
    }
    *last = Instant::now();
    self.emit_progress();
  }

  fn emit_final(&self) {
    self.emit_progress();
  }

  fn emit_progress(&self) {
    let completed_bytes = self.completed_bytes.load(Ordering::Relaxed);
    let elapsed = self.start_time.elapsed().as_secs_f64().max(0.1);
    let speed = (completed_bytes as f64 / elapsed) as u64;
    let remaining_bytes = self.total_bytes.saturating_sub(completed_bytes);
    let eta = remaining_bytes.checked_div(speed).unwrap_or(0);

    let _ = events::emit(
      "profile-sync-progress",
      serde_json::json!({
        "profile_id": self.profile_id,
        "profile_name": self.profile_name,
        "phase": self.phase,
        "completed_files": self.completed_files.load(Ordering::Relaxed),
        "total_files": self.total_files,
        "completed_bytes": completed_bytes,
        "total_bytes": self.total_bytes,
        "speed_bytes_per_sec": speed,
        "eta_seconds": eta,
        "failed_count": self.failed_count.load(Ordering::Relaxed),
      }),
    );
  }
}

/// Check if sync is configured (cloud or self-hosted)
pub fn is_sync_configured() -> bool {
  // Cloud backup is a plan capability. Every paid plan (incl. the future
  // "starter" tier) grants it, but gating on the capability — not just "is paid"
  // — keeps this correct if a plan without cloud backup is ever added.
  if crate::api::cloud_auth::CLOUD_AUTH.can_use_cloud_backup_sync() {
    return true;
  }
  let manager = SettingsManager::instance();
  if let Ok(settings) = manager.load_settings() {
    return settings.sync_server_url.is_some();
  }
  false
}

pub struct SyncEngine {
  client: SyncClient,
}

impl SyncEngine {
  pub fn new(server_url: String, token: String) -> Self {
    Self {
      client: SyncClient::new(server_url, token),
    }
  }

  pub async fn create_from_settings(app_handle: &tauri::AppHandle) -> Result<Self, String> {
    // Cloud auth takes priority
    if crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await {
      let url = crate::api::cloud_auth::CLOUD_SYNC_URL.to_string();
      let token = crate::api::cloud_auth::CLOUD_AUTH
        .get_or_refresh_sync_token()
        .await
        .map_err(|e| format!("Failed to get cloud sync token: {e}"))?
        .ok_or_else(|| "Cloud sync token not available".to_string())?;
      return Ok(Self::new(url, token));
    }

    // Fall back to self-hosted settings
    let manager = SettingsManager::instance();
    let settings = manager
      .load_settings()
      .map_err(|e| format!("Failed to load settings: {e}"))?;

    let server_url = settings
      .sync_server_url
      .ok_or_else(|| "Sync server URL not configured".to_string())?;

    let token = manager
      .get_sync_token(app_handle)
      .await
      .map_err(|e| format!("Failed to get sync token: {e}"))?
      .ok_or_else(|| "Sync token not configured".to_string())?;

    Ok(Self::new(server_url, token))
  }

  /// Get the key prefix for team profiles. Returns empty string for personal profiles.
  async fn get_team_key_prefix(profile: &BrowserProfile) -> String {
    if profile.created_by_id.is_some() {
      if let Some(auth) = crate::api::cloud_auth::CLOUD_AUTH.get_user().await {
        if let Some(team_id) = &auth.user.team_id {
          return format!("teams/{}/", team_id);
        }
      }
    }
    String::new()
  }

  /// Check if this is a self-hosted sync (no cloud login).
  async fn is_self_hosted_sync() -> bool {
    !crate::api::cloud_auth::CLOUD_AUTH.is_logged_in().await
  }

  /// Resolve a remote config object's user-edit timestamp (`updated_at`) for
  /// conflict resolution. Prefers the value from S3 object metadata returned by
  /// the HEAD (`stat`) — no body transfer. Falls back to downloading and
  /// decrypting the small JSON body and reading its embedded `updated_at` (for
  /// older self-hosted servers that don't surface metadata). Legacy objects with
  /// neither resolve to 0, so any real local edit (`updated_at` > 0) wins.
  async fn remote_updated_at(&self, stat: &StatResponse, remote_key: &str) -> u64 {
    if let Some(meta) = &stat.metadata {
      if let Some(v) = meta
        .get(UPDATED_AT_META_KEY)
        .and_then(|s| s.parse::<u64>().ok())
      {
        return v;
      }
    }
    // Fallback: read updated_at from the (small) JSON body.
    if let Ok(presign) = self.client.presign_download(remote_key).await {
      if let Ok(raw) = self.client.download_bytes(&presign.url).await {
        if let Ok(data) = encryption::maybe_unseal_after_download(&raw) {
          if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&data) {
            if let Some(u) = val.get("updated_at").and_then(|x| x.as_u64()) {
              return u;
            }
          }
        }
      }
    }
    0
  }

  /// Upload a small config JSON blob (proxy/vpn/group/extension/extension-group/
  /// profile metadata), signing its `updated_at` into S3 object metadata so
  /// future reconciles can compare via HEAD without downloading the body. The
  /// body is sealed (E2E) exactly as before; only a plaintext unix timestamp
  /// lives in the object metadata.
  async fn upload_config_json(
    &self,
    remote_key: &str,
    json: &str,
    updated_at: u64,
  ) -> SyncResult<()> {
    let (payload, content_type) = encryption::maybe_seal_for_upload(json.as_bytes())
      .map_err(|e| SyncError::InvalidData(format!("Failed to seal config: {e}")))?;
    let mut meta = HashMap::new();
    meta.insert(UPDATED_AT_META_KEY.to_string(), updated_at.to_string());
    let presign = self
      .client
      .presign_upload_with_metadata(remote_key, Some(content_type), Some(meta))
      .await?;
    self
      .client
      .upload_bytes_with_metadata(
        &presign.url,
        &payload,
        Some(content_type),
        presign.metadata.as_ref(),
      )
      .await?;
    Ok(())
  }
}

include!("profile.rs");
include!("profile_files.rs");
include!("profile_missing.rs");
include!("configs.rs");
include!("configs_commands.rs");
include!("configs_commands2.rs");
