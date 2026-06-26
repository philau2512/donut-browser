//! Tauri commands for profile password lifecycle: set, change, remove,
//! unlock, lock, status.
//!
//! All error responses returned to the frontend are JSON-encoded
//! `{ "code": "<ERROR_CODE>", "params"?: { ... } }` so the UI can render a
//! localized message. Helpers `err_code` / `err_with` build them. The set of
//! codes is documented at `BackendErrorCode` in TypeScript; keep them in sync.

use crate::events;
use crate::profile::encryption::{
  cache_key, decrypt_profile_dir, drop_cached_key, encrypt_profile_dir, fresh_salt, get_cached_key,
  has_cached_key, rekey_profile_dir, unlock as unlock_dir, verify_key_against_dir,
};
use crate::profile::ProfileManager;
use crate::sync::encryption::derive_profile_key;
use crate::sync::manifest::DEFAULT_EXCLUDE_PATTERNS;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// Build a JSON error payload with just a code.
fn err_code(code: &'static str) -> String {
  json!({ "code": code }).to_string()
}

/// Build a JSON error payload with a code and params.
fn err_with(code: &'static str, params: &[(&str, String)]) -> String {
  let mut map = serde_json::Map::new();
  for (k, v) in params {
    map.insert((*k).to_string(), serde_json::Value::String(v.clone()));
  }
  json!({ "code": code, "params": serde_json::Value::Object(map) }).to_string()
}

/// Internal-error wrapper used for unexpected failures; the detail string is
/// raw English (developer-facing) but the surrounding template translates.
fn err_internal(detail: impl std::fmt::Display) -> String {
  err_with("INTERNAL_ERROR", &[("detail", detail.to_string())])
}

lazy_static::lazy_static! {
  /// Per-profile snapshot of plaintext file mtimes captured at launch time.
  /// Used by `complete_after_quit` to skip re-encrypting unchanged files.
  static ref LAUNCH_SNAPSHOTS: Mutex<HashMap<uuid::Uuid, HashMap<String, SystemTime>>> =
    Mutex::new(HashMap::new());

  /// Profile IDs whose ephemeral dir is currently populated and matches the
  /// on-disk encrypted state, so we can skip re-decrypting on the next launch
  /// when `keep_decrypted_profiles_in_ram` is enabled.
  static ref POPULATED_EPHEMERAL: Mutex<HashSet<uuid::Uuid>> = Mutex::new(HashSet::new());

  /// Per-profile failed unlock attempt tracking for rate-limiting.
  static ref FAILED_ATTEMPTS: Mutex<HashMap<uuid::Uuid, FailureRecord>> = Mutex::new(HashMap::new());
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
struct FailureRecord {
  count: u32,
  /// Stored as epoch seconds for portable on-disk persistence.
  last_failed_at_secs: u64,
}

impl FailureRecord {
  fn last_failed_at(&self) -> SystemTime {
    SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(self.last_failed_at_secs)
  }
}

fn now_epoch_secs() -> u64 {
  SystemTime::now()
    .duration_since(SystemTime::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

fn lockout_sidecar_path(profile_id: &uuid::Uuid) -> PathBuf {
  ProfileManager::instance()
    .get_profiles_dir()
    .join(profile_id.to_string())
    .join(".unlock-attempts.json")
}

fn load_persisted_record(profile_id: &uuid::Uuid) -> Option<FailureRecord> {
  let path = lockout_sidecar_path(profile_id);
  let content = std::fs::read_to_string(&path).ok()?;
  serde_json::from_str(&content).ok()
}

fn persist_record(profile_id: &uuid::Uuid, record: &FailureRecord) {
  let path = lockout_sidecar_path(profile_id);
  if let Some(parent) = path.parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  if let Ok(json) = serde_json::to_string(record) {
    let _ = std::fs::write(&path, json);
  }
}

fn clear_persisted_record(profile_id: &uuid::Uuid) {
  let path = lockout_sidecar_path(profile_id);
  let _ = std::fs::remove_file(&path);
}

/// Read the current FailureRecord, falling back to disk if the in-memory
/// cache doesn't have one (e.g. fresh app launch).
fn current_record(profile_id: &uuid::Uuid) -> Option<FailureRecord> {
  if let Ok(guard) = FAILED_ATTEMPTS.lock() {
    if let Some(rec) = guard.get(profile_id) {
      return Some(*rec);
    }
  }
  let from_disk = load_persisted_record(profile_id)?;
  if let Ok(mut guard) = FAILED_ATTEMPTS.lock() {
    guard.insert(*profile_id, from_disk);
  }
  Some(from_disk)
}

/// Lockout schedule. Index is the failure count (1-based); returns the
/// duration the user must wait before the next attempt is allowed.
/// Attempts 1-4 have no lockout; attempt 5 onward triggers progressive
/// back-off, capped at 24 hours.
fn lockout_for_count(count: u32) -> Option<std::time::Duration> {
  use std::time::Duration;
  let secs: u64 = match count {
    0..=4 => return None,
    5 => 60,
    6 => 5 * 60,
    7 => 15 * 60,
    8 => 60 * 60,
    9 => 2 * 60 * 60,
    10 => 4 * 60 * 60,
    11 => 8 * 60 * 60,
    _ => 24 * 60 * 60,
  };
  Some(Duration::from_secs(secs))
}

/// Returns Ok(()) if no lockout is active, or Err with remaining seconds.
fn check_lockout(profile_id: &uuid::Uuid) -> Result<(), u64> {
  let Some(record) = current_record(profile_id) else {
    return Ok(());
  };
  let Some(lockout) = lockout_for_count(record.count) else {
    return Ok(());
  };
  let elapsed = SystemTime::now()
    .duration_since(record.last_failed_at())
    .unwrap_or_default();
  if elapsed >= lockout {
    Ok(())
  } else {
    Err((lockout - elapsed).as_secs().max(1))
  }
}

fn record_failed_attempt(profile_id: uuid::Uuid) {
  let updated = if let Ok(mut guard) = FAILED_ATTEMPTS.lock() {
    let entry = guard.entry(profile_id).or_insert(FailureRecord {
      count: 0,
      last_failed_at_secs: now_epoch_secs(),
    });
    entry.count = entry.count.saturating_add(1);
    entry.last_failed_at_secs = now_epoch_secs();
    Some(*entry)
  } else {
    None
  };
  if let Some(record) = updated {
    persist_record(&profile_id, &record);
  }
}

fn clear_failed_attempts(profile_id: &uuid::Uuid) {
  if let Ok(mut guard) = FAILED_ATTEMPTS.lock() {
    guard.remove(profile_id);
  }
  clear_persisted_record(profile_id);
}

const MIN_PASSWORD_LEN: usize = 8;

fn validate_password(password: &str) -> Result<(), String> {
  if password.len() < MIN_PASSWORD_LEN {
    return Err(err_with(
      "PASSWORD_TOO_SHORT",
      &[("min", MIN_PASSWORD_LEN.to_string())],
    ));
  }
  Ok(())
}

fn parse_uuid(profile_id: &str) -> Result<uuid::Uuid, String> {
  uuid::Uuid::parse_str(profile_id).map_err(|_| err_code("INVALID_PROFILE_ID"))
}

fn load_profile(profile_id: &uuid::Uuid) -> Result<crate::profile::BrowserProfile, String> {
  let manager = ProfileManager::instance();
  let profiles = manager.list_profiles().map_err(err_internal)?;
  profiles
    .into_iter()
    .find(|p| p.id == *profile_id)
    .ok_or_else(|| err_code("PROFILE_NOT_FOUND"))
}

fn profile_data_dir(profile: &crate::profile::BrowserProfile) -> PathBuf {
  profile.get_profile_data_path(&ProfileManager::instance().get_profiles_dir())
}

fn emit_profiles_changed() {
  let _ = events::emit_empty("profiles-changed");
}

#[tauri::command]
pub async fn is_profile_locked(profile_id: String) -> Result<bool, String> {
  let id = parse_uuid(&profile_id)?;
  let profile = load_profile(&id)?;
  if !profile.password_protected {
    return Ok(false);
  }
  Ok(!has_cached_key(&id))
}

#[tauri::command]
pub async fn set_profile_password(profile_id: String, password: String) -> Result<(), String> {
  validate_password(&password)?;
  let id = parse_uuid(&profile_id)?;
  let mut profile = load_profile(&id)?;

  if profile.password_protected {
    return Err(err_code("PROFILE_ALREADY_PROTECTED"));
  }

  // Ephemeral profiles live in RAM-backed dirs that get wiped on quit, so
  // there's no on-disk data to encrypt. The two features are mutually
  // exclusive by design — fail loudly rather than silently producing a
  // half-broken state where `password_protected` is true but the encrypted
  // dir vanishes between launches.
  if profile.ephemeral {
    return Err(err_code("PROFILE_EPHEMERAL"));
  }

  if profile
    .process_id
    .is_some_and(crate::proxy::proxy_storage::is_process_running)
  {
    return Err(err_code("PROFILE_RUNNING"));
  }

  let plaintext_dir = profile_data_dir(&profile);
  // An empty/missing profile dir is fine — we just produce an encrypted dir
  // that contains only the verifier file. This lets callers attach a password
  // immediately on creation, before the browser has run.
  if !plaintext_dir.exists() {
    std::fs::create_dir_all(&plaintext_dir).map_err(err_internal)?;
  }

  let salt = fresh_salt();
  let key = derive_profile_key(&password, &salt).map_err(err_internal)?;

  // Encrypt into a sibling staging dir, then atomically swap.
  let staging = plaintext_dir.with_extension("encrypting");
  if staging.exists() {
    let _ = std::fs::remove_dir_all(&staging);
  }
  encrypt_profile_dir(&key, &plaintext_dir, &staging, DEFAULT_EXCLUDE_PATTERNS)
    .map_err(err_internal)?;

  // Move plaintext aside, swap in encrypted, then delete plaintext.
  let backup = plaintext_dir.with_extension("plaintext-backup");
  if backup.exists() {
    let _ = std::fs::remove_dir_all(&backup);
  }
  std::fs::rename(&plaintext_dir, &backup).map_err(err_internal)?;
  if let Err(e) = std::fs::rename(&staging, &plaintext_dir) {
    let _ = std::fs::rename(&backup, &plaintext_dir);
    return Err(err_internal(e));
  }
  if let Err(e) = std::fs::remove_dir_all(&backup) {
    log::warn!(
      "Failed to remove plaintext backup at {}: {e}",
      backup.display()
    );
  }

  profile.password_protected = true;
  profile.encryption_salt = Some(salt);
  ProfileManager::instance()
    .save_profile(&profile)
    .map_err(err_internal)?;

  cache_key(id, key);
  crate::sync::queue_profile_sync_if_eligible(&profile);
  emit_profiles_changed();
  Ok(())
}

/// Verify a profile password without unlocking. Used by the Settings UI's
/// "Validate" button so users can confirm they remember the password without
/// performing a destructive change. Honors the same lockout schedule as
/// `unlock_profile` so a brute-force attacker can't bypass rate-limiting by
/// hammering this command.
#[tauri::command]
pub async fn verify_profile_password(profile_id: String, password: String) -> Result<(), String> {
  let id = parse_uuid(&profile_id)?;
  let profile = load_profile(&id)?;
  if !profile.password_protected {
    return Err(err_code("PROFILE_NOT_PROTECTED"));
  }
  if let Err(secs) = check_lockout(&id) {
    return Err(err_with("LOCKED_OUT", &[("seconds", secs.to_string())]));
  }
  let salt = profile
    .encryption_salt
    .as_deref()
    .ok_or_else(|| err_code("PROFILE_MISSING_SALT"))?;
  let key = derive_profile_key(&password, salt).map_err(err_internal)?;
  let dir = profile_data_dir(&profile);
  match verify_key_against_dir(&key, &dir) {
    Ok(()) => {
      clear_failed_attempts(&id);
      Ok(())
    }
    Err(crate::profile::encryption::PasswordError::WrongPassword) => {
      record_failed_attempt(id);
      Err(err_code("INCORRECT_PASSWORD"))
    }
    Err(other) => Err(err_internal(other)),
  }
}

#[tauri::command]
pub async fn unlock_profile(profile_id: String, password: String) -> Result<(), String> {
  let id = parse_uuid(&profile_id)?;
  let profile = load_profile(&id)?;
  if !profile.password_protected {
    return Err(err_code("PROFILE_NOT_PROTECTED"));
  }
  if let Err(secs) = check_lockout(&id) {
    return Err(err_with("LOCKED_OUT", &[("seconds", secs.to_string())]));
  }
  let salt = profile
    .encryption_salt
    .as_deref()
    .ok_or_else(|| err_code("PROFILE_MISSING_SALT"))?;

  match unlock_dir(id, &password, salt, &profile_data_dir(&profile)) {
    Ok(()) => {
      clear_failed_attempts(&id);
      Ok(())
    }
    Err(crate::profile::encryption::PasswordError::WrongPassword) => {
      record_failed_attempt(id);
      Err(err_code("INCORRECT_PASSWORD"))
    }
    Err(other) => Err(err_internal(other)),
  }
}

#[tauri::command]
pub async fn lock_profile(profile_id: String) -> Result<(), String> {
  let id = parse_uuid(&profile_id)?;
  let profile = load_profile(&id)?;
  if !profile.password_protected {
    return Ok(());
  }
  if profile
    .process_id
    .is_some_and(crate::proxy::proxy_storage::is_process_running)
  {
    return Err(err_code("PROFILE_RUNNING"));
  }
  drop_cached_key(&id);
  // Purge any leftover ephemeral dir in case keep_decrypted_profiles_in_ram was on.
  crate::browser::ephemeral_dirs::remove_ephemeral_dir(&id.to_string());
  emit_profiles_changed();
  Ok(())
}

#[tauri::command]
pub async fn change_profile_password(
  profile_id: String,
  old_password: String,
  new_password: String,
) -> Result<(), String> {
  validate_password(&new_password)?;
  let id = parse_uuid(&profile_id)?;
  let mut profile = load_profile(&id)?;

  if !profile.password_protected {
    return Err(err_code("PROFILE_NOT_PROTECTED"));
  }
  if profile
    .process_id
    .is_some_and(crate::proxy::proxy_storage::is_process_running)
  {
    return Err(err_code("PROFILE_RUNNING"));
  }

  if let Err(secs) = check_lockout(&id) {
    return Err(err_with("LOCKED_OUT", &[("seconds", secs.to_string())]));
  }

  let old_salt = profile
    .encryption_salt
    .as_deref()
    .ok_or_else(|| err_code("PROFILE_MISSING_SALT"))?;
  let old_key = derive_profile_key(&old_password, old_salt).map_err(err_internal)?;
  let dir = profile_data_dir(&profile);
  if let Err(e) = verify_key_against_dir(&old_key, &dir) {
    return match e {
      crate::profile::encryption::PasswordError::WrongPassword => {
        record_failed_attempt(id);
        Err(err_code("INCORRECT_PASSWORD"))
      }
      other => Err(err_internal(other)),
    };
  }
  clear_failed_attempts(&id);

  let new_salt = fresh_salt();
  let new_key = derive_profile_key(&new_password, &new_salt).map_err(err_internal)?;
  rekey_profile_dir(&old_key, &new_key, &dir).map_err(err_internal)?;

  profile.encryption_salt = Some(new_salt);
  ProfileManager::instance()
    .save_profile(&profile)
    .map_err(err_internal)?;

  drop_cached_key(&id);
  cache_key(id, new_key);
  crate::sync::queue_profile_sync_if_eligible(&profile);
  emit_profiles_changed();
  Ok(())
}

#[tauri::command]
pub async fn remove_profile_password(profile_id: String, password: String) -> Result<(), String> {
  let id = parse_uuid(&profile_id)?;
  let mut profile = load_profile(&id)?;
  if !profile.password_protected {
    return Err(err_code("PROFILE_NOT_PROTECTED"));
  }
  if profile
    .process_id
    .is_some_and(crate::proxy::proxy_storage::is_process_running)
  {
    return Err(err_code("PROFILE_RUNNING"));
  }

  if let Err(secs) = check_lockout(&id) {
    return Err(err_with("LOCKED_OUT", &[("seconds", secs.to_string())]));
  }

  let salt = profile
    .encryption_salt
    .as_deref()
    .ok_or_else(|| err_code("PROFILE_MISSING_SALT"))?;
  let key = derive_profile_key(&password, salt).map_err(err_internal)?;
  let encrypted_dir = profile_data_dir(&profile);
  if let Err(e) = verify_key_against_dir(&key, &encrypted_dir) {
    return match e {
      crate::profile::encryption::PasswordError::WrongPassword => {
        record_failed_attempt(id);
        Err(err_code("INCORRECT_PASSWORD"))
      }
      other => Err(err_internal(other)),
    };
  }
  clear_failed_attempts(&id);

  let staging = encrypted_dir.with_extension("decrypting");
  if staging.exists() {
    let _ = std::fs::remove_dir_all(&staging);
  }
  decrypt_profile_dir(&key, &encrypted_dir, &staging).map_err(err_internal)?;

  let backup = encrypted_dir.with_extension("encrypted-backup");
  if backup.exists() {
    let _ = std::fs::remove_dir_all(&backup);
  }
  std::fs::rename(&encrypted_dir, &backup).map_err(err_internal)?;
  if let Err(e) = std::fs::rename(&staging, &encrypted_dir) {
    let _ = std::fs::rename(&backup, &encrypted_dir);
    return Err(err_internal(e));
  }
  if let Err(e) = std::fs::remove_dir_all(&backup) {
    log::warn!(
      "Failed to remove encrypted backup at {}: {e}",
      backup.display()
    );
  }

  profile.password_protected = false;
  profile.encryption_salt = None;
  ProfileManager::instance()
    .save_profile(&profile)
    .map_err(err_internal)?;

  drop_cached_key(&id);
  crate::sync::queue_profile_sync_if_eligible(&profile);
  emit_profiles_changed();
  Ok(())
}

// ---------- helpers used by browser_runner ----------

/// Capture a per-file mtime snapshot of the given decrypted dir.
fn snapshot_mtimes(plaintext_dir: &Path) -> HashMap<String, SystemTime> {
  let mut out: HashMap<String, SystemTime> = HashMap::new();
  fn walk(
    base: &Path,
    current: &Path,
    out: &mut HashMap<String, SystemTime>,
  ) -> std::io::Result<()> {
    for entry in std::fs::read_dir(current)? {
      let entry = entry?;
      let path = entry.path();
      let meta = entry.metadata()?;
      if meta.is_dir() {
        walk(base, &path, out)?;
      } else if meta.is_file() {
        let rel = path
          .strip_prefix(base)
          .map(|p| p.to_string_lossy().replace('\\', "/"))
          .unwrap_or_default();
        if let Ok(m) = meta.modified() {
          out.insert(rel, m);
        }
      }
    }
    Ok(())
  }
  let _ = walk(plaintext_dir, plaintext_dir, &mut out);
  out
}

include!("password_launch.rs");
include!("password_tests.rs");
