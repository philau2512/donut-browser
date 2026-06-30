use crate::profile::manager::ProfileManager;
use crate::profile::BrowserProfile;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Chromium cookie decryption support for reading existing encrypted cookies.
/// Writes always go through the plaintext `value` column (see `write_chrome_cookies`),
/// so no encryption path is needed here — Chromium reads plaintext when
/// `encrypted_value` is empty, regardless of what other cookies store.
pub mod chrome_decrypt {
  use aes::cipher::{block_padding::Pkcs7, BlockModeDecrypt, KeyIvInit};
  use ring::pbkdf2;
  use sha2::{Digest, Sha256};
  use std::num::NonZeroU32;
  use std::path::Path;

  type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

  /// PBKDF2 iteration count for deriving the AES key from the password stored
  /// in `os_crypt_key`. Must match Chromium's `OSCryptImpl` on each platform:
  /// macOS uses 1003 iterations, Linux uses 1. Getting this wrong produces a
  /// different AES key → silent decryption failure → empty cookie values.
  /// See `components/os_crypt/sync/os_crypt_{mac.mm,linux.cc}` in Chromium.
  #[cfg(target_os = "macos")]
  const PBKDF2_ITERATIONS: u32 = 1003;
  #[cfg(not(target_os = "macos"))]
  const PBKDF2_ITERATIONS: u32 = 1;

  const KEY_LEN: usize = 16; // AES-128
  const SALT: &[u8] = b"saltysalt";
  const IV: [u8; 16] = [b' '; 16]; // 16 spaces
  const HOST_HASH_LEN: usize = 32; // SHA-256 output length

  fn derive_key(password: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    // Using ring::pbkdf2 instead of the `pbkdf2` crate to avoid digest
    // version conflicts between sha1 0.11 (digest 0.11) and pbkdf2 0.12
    // (digest 0.10). ring's implementation is self-contained.
    pbkdf2::derive(
      pbkdf2::PBKDF2_HMAC_SHA1,
      NonZeroU32::new(PBKDF2_ITERATIONS).expect("iterations must be non-zero"),
      SALT,
      password,
      &mut key,
    );
    key
  }

  pub fn get_encryption_key(profile_data_path: &Path) -> Option<[u8; KEY_LEN]> {
    let key_file = profile_data_path.join("os_crypt_key");
    // Read as raw bytes and do NOT trim — Chromium's `ReadFileToString`
    // passes the exact file contents to `Pbkdf2(file_contents)`. Any
    // normalisation we do here would produce a different derived key.
    let contents = std::fs::read(&key_file).ok()?;
    if contents.is_empty() {
      return None;
    }
    Some(derive_key(&contents))
  }

  /// Decrypt a Chrome encrypted cookie value.
  ///
  /// Chromium prefixes encrypted values with "v10" / "v11" and, since ~M100,
  /// prepends `SHA-256(host_key)` to the plaintext before encryption as an
  /// integrity check. After decryption we verify and strip those 32 bytes
  /// when present. Passing `host_key` is required to do that verification —
  /// without it we'd return 32 bytes of hash noise plus the actual value,
  /// which is not valid UTF-8 and gets thrown away.
  pub fn decrypt(encrypted: &[u8], host_key: &str, key: &[u8; KEY_LEN]) -> Option<String> {
    if encrypted.len() < 3 {
      return None;
    }
    let prefix = &encrypted[..3];
    if prefix != b"v10" && prefix != b"v11" {
      return None;
    }
    let ciphertext = &encrypted[3..];
    if ciphertext.is_empty() {
      return Some(String::new());
    }

    let mut buf = ciphertext.to_vec();
    let decrypted = Aes128CbcDec::new(key.into(), &IV.into())
      .decrypt_padded::<Pkcs7>(&mut buf)
      .ok()?;

    // Strip the SHA-256(host_key) integrity prefix if present. Older cookies
    // (pre-M100) didn't have this prefix, so we fall back to the raw bytes
    // when the first 32 bytes don't match the expected hash.
    if decrypted.len() >= HOST_HASH_LEN {
      let expected: [u8; HOST_HASH_LEN] = Sha256::digest(host_key.as_bytes()).into();
      if decrypted[..HOST_HASH_LEN] == expected {
        return String::from_utf8(decrypted[HOST_HASH_LEN..].to_vec()).ok();
      }
    }

    String::from_utf8(decrypted.to_vec()).ok()
  }
}

/// Unified cookie representation that works across both browser types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedCookie {
  pub name: String,
  pub value: String,
  pub domain: String,
  pub path: String,
  pub expires: i64,
  pub is_secure: bool,
  pub is_http_only: bool,
  pub same_site: i32,
  pub creation_time: i64,
  pub last_accessed: i64,
}

/// Cookies grouped by domain for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainCookies {
  pub domain: String,
  pub cookies: Vec<UnifiedCookie>,
  pub cookie_count: usize,
}

/// Result of reading cookies from a profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieReadResult {
  pub profile_id: String,
  pub browser_type: String,
  pub domains: Vec<DomainCookies>,
  pub total_count: usize,
}

/// Lightweight cookie metadata for the profile-info dialog. Computed without
/// decrypting any cookie values, so it stays cheap even for multi-MB Chromium
/// cookie stores and never blocks the runtime for noticeable time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieStats {
  pub profile_id: String,
  pub browser_type: String,
  pub total_count: usize,
  /// Every domain the profile has cookies for, sorted by cookie count desc.
  pub domains: Vec<DomainCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainCount {
  pub domain: String,
  pub count: usize,
}

/// Request to copy specific cookies
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieCopyRequest {
  pub source_profile_id: String,
  pub target_profile_ids: Vec<String>,
  pub selected_cookies: Vec<SelectedCookie>,
}

/// Identifies a specific cookie to copy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedCookie {
  pub domain: String,
  pub name: String,
}

/// Result of a copy operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieCopyResult {
  pub target_profile_id: String,
  pub cookies_copied: usize,
  pub cookies_replaced: usize,
  pub errors: Vec<String>,
}

/// Result of a cookie import operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieImportResult {
  pub cookies_imported: usize,
  pub cookies_replaced: usize,
  pub errors: Vec<String>,
}

pub struct CookieManager;

impl CookieManager {
  /// Windows epoch offset: seconds between 1601-01-01 and 1970-01-01
  const WINDOWS_EPOCH_DIFF: i64 = 11644473600;

  fn get_chrome_encryption_key(profile: &BrowserProfile, profiles_dir: &Path) -> Option<[u8; 16]> {
    let profile_data_path = profile.get_profile_data_path(profiles_dir);
    chrome_decrypt::get_encryption_key(&profile_data_path)
  }

  fn wayfern_cookie_path(profile_data_path: &Path) -> PathBuf {
    let default_dir = profile_data_path.join("Default");
    #[cfg(target_os = "windows")]
    {
      default_dir.join("Network").join("Cookies")
    }
    #[cfg(not(target_os = "windows"))]
    {
      default_dir.join("Cookies")
    }
  }

  /// Get the cookie database path for a profile (read-side: errors if missing).
  fn get_cookie_db_path(profile: &BrowserProfile, profiles_dir: &Path) -> Result<PathBuf, String> {
    let profile_data_path = profile.get_profile_data_path(profiles_dir);

    match profile.browser.as_str() {
      "wayfern" => {
        let path = Self::wayfern_cookie_path(&profile_data_path);
        if path.exists() {
          Ok(path)
        } else {
          Err(format!("Cookie database not found at: {}", path.display()))
        }
      }
      "camoufox" => {
        let path = profile_data_path.join("cookies.sqlite");
        if path.exists() {
          Ok(path)
        } else {
          Err(format!("Cookie database not found at: {}", path.display()))
        }
      }
      _ => Err(format!(
        "Unsupported browser type for cookie operations: {}",
        profile.browser
      )),
    }
  }

  /// Get the cookie database path for a profile, creating an empty
  /// browser-compatible database if it doesn't exist yet. Use this for write
  /// paths (copy / import) so we can populate the cookie store of a profile
  /// that has never been launched.
  fn ensure_cookie_db_path(
    profile: &BrowserProfile,
    profiles_dir: &Path,
  ) -> Result<PathBuf, String> {
    let profile_data_path = profile.get_profile_data_path(profiles_dir);

    match profile.browser.as_str() {
      "wayfern" => {
        let path = Self::wayfern_cookie_path(&profile_data_path);
        if !path.exists() {
          Self::create_empty_chrome_cookies_db(&path)?;
        }
        Ok(path)
      }
      "camoufox" => {
        let path = profile_data_path.join("cookies.sqlite");
        if !path.exists() {
          Self::create_empty_firefox_cookies_db(&path)?;
        }
        Ok(path)
      }
      _ => Err(format!(
        "Unsupported browser type for cookie operations: {}",
        profile.browser
      )),
    }
  }

  /// Create an empty Chromium-format Cookies SQLite database at `path`.
  ///
  /// Schema matches what recent Chromium versions write on first launch:
  /// the `cookies` table, the `meta` table with version info, and the
  /// `host_key/top_frame_site_key/name/path` unique index. Chromium's cookie
  /// store migration code will upgrade this forward when Wayfern first
  /// launches the profile.
  fn create_empty_chrome_cookies_db(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create cookie directory: {e}"))?;
    }
    let conn =
      Connection::open(path).map_err(|e| format!("Failed to create cookie database: {e}"))?;
    conn
      .execute_batch(
        "CREATE TABLE cookies(
          creation_utc INTEGER NOT NULL,
          host_key TEXT NOT NULL,
          top_frame_site_key TEXT NOT NULL,
          name TEXT NOT NULL,
          value TEXT NOT NULL,
          encrypted_value BLOB NOT NULL DEFAULT '',
          path TEXT NOT NULL,
          expires_utc INTEGER NOT NULL,
          is_secure INTEGER NOT NULL,
          is_httponly INTEGER NOT NULL,
          last_access_utc INTEGER NOT NULL,
          has_expires INTEGER NOT NULL DEFAULT 1,
          is_persistent INTEGER NOT NULL DEFAULT 1,
          priority INTEGER NOT NULL DEFAULT 1,
          samesite INTEGER NOT NULL DEFAULT -1,
          source_scheme INTEGER NOT NULL DEFAULT 0,
          source_port INTEGER NOT NULL DEFAULT -1,
          last_update_utc INTEGER NOT NULL DEFAULT 0,
          source_type INTEGER NOT NULL DEFAULT 0,
          has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX cookies_unique_index
          ON cookies(host_key, top_frame_site_key, name, path);
        CREATE TABLE meta(
          key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY,
          value LONGVARCHAR
        );
        INSERT INTO meta VALUES('version', '23');
        INSERT INTO meta VALUES('last_compatible_version', '23');",
      )
      .map_err(|e| format!("Failed to initialize cookie database schema: {e}"))?;
    Ok(())
  }

  /// Create an empty Firefox-format cookies.sqlite database at `path`.
  fn create_empty_firefox_cookies_db(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create cookie directory: {e}"))?;
    }
    let conn =
      Connection::open(path).map_err(|e| format!("Failed to create cookie database: {e}"))?;
    conn
      .execute_batch(
        "CREATE TABLE moz_cookies (
          id INTEGER PRIMARY KEY,
          originAttributes TEXT NOT NULL DEFAULT '',
          name TEXT,
          value TEXT,
          host TEXT,
          path TEXT,
          expiry INTEGER,
          lastAccessed INTEGER,
          creationTime INTEGER,
          isSecure INTEGER,
          isHttpOnly INTEGER,
          inBrowserElement INTEGER DEFAULT 0,
          sameSite INTEGER DEFAULT 0,
          rawSameSite INTEGER DEFAULT 0,
          schemeMap INTEGER DEFAULT 0,
          CONSTRAINT moz_uniqueid UNIQUE (name, host, path, originAttributes)
        );",
      )
      .map_err(|e| format!("Failed to initialize cookie database schema: {e}"))?;
    Ok(())
  }

  /// Convert Chrome timestamp (Windows epoch, microseconds) to Unix timestamp (seconds)
  fn chrome_time_to_unix(chrome_time: i64) -> i64 {
    if chrome_time == 0 {
      return 0;
    }
    (chrome_time / 1_000_000) - Self::WINDOWS_EPOCH_DIFF
  }

  /// Convert Unix timestamp (seconds) to Chrome timestamp (Windows epoch, microseconds)
  fn unix_to_chrome_time(unix_time: i64) -> i64 {
    if unix_time == 0 {
      return 0;
    }
    (unix_time + Self::WINDOWS_EPOCH_DIFF) * 1_000_000
  }

  /// Read cookies from a Firefox/Camoufox profile
  fn read_firefox_cookies(db_path: &Path) -> Result<Vec<UnifiedCookie>, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;

    let mut stmt = conn
      .prepare(
        "SELECT name, value, host, path, expiry, isSecure, isHttpOnly,
                        sameSite, creationTime, lastAccessed
                 FROM moz_cookies",
      )
      .map_err(|e| format!("Failed to prepare statement: {e}"))?;

    let cookies = stmt
      .query_map([], |row| {
        Ok(UnifiedCookie {
          name: row.get(0)?,
          value: row.get(1)?,
          domain: row.get(2)?,
          path: row.get(3)?,
          expires: row.get(4)?,
          is_secure: row.get::<_, i32>(5)? != 0,
          is_http_only: row.get::<_, i32>(6)? != 0,
          same_site: row.get(7)?,
          creation_time: row.get::<_, i64>(8)? / 1_000_000,
          last_accessed: row.get::<_, i64>(9)? / 1_000_000,
        })
      })
      .map_err(|e| format!("Failed to query cookies: {e}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|e| format!("Failed to collect cookies: {e}"))?;

    Ok(cookies)
  }

  /// Read cookies from a Chrome/Wayfern profile.
  /// Handles encrypted cookies by decrypting encrypted_value using the profile's encryption key.
  fn read_chrome_cookies(
    db_path: &Path,
    encryption_key: Option<&[u8; 16]>,
  ) -> Result<Vec<UnifiedCookie>, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;

    let mut stmt = conn
      .prepare(
        "SELECT name, value, host_key, path, expires_utc, is_secure,
                is_httponly, samesite, creation_utc, last_access_utc, encrypted_value
         FROM cookies",
      )
      .map_err(|e| format!("Failed to prepare statement: {e}"))?;

    let cookies = stmt
      .query_map([], |row| {
        let name: String = row.get(0)?;
        let plaintext_value: String = row.get(1)?;
        let domain: String = row.get(2)?;
        let path: String = row.get(3)?;
        let expires_utc: i64 = row.get(4)?;
        let is_secure: i32 = row.get(5)?;
        let is_httponly: i32 = row.get(6)?;
        let samesite: i32 = row.get(7)?;
        let creation_utc: i64 = row.get(8)?;
        let last_access_utc: i64 = row.get(9)?;
        let encrypted_value: Vec<u8> = row.get(10)?;

        // Use plaintext value if available, otherwise decrypt encrypted_value.
        // Decryption needs the host_key (domain) to verify and strip the
        // SHA-256 integrity prefix Chromium prepends before encryption.
        let value = if !plaintext_value.is_empty() {
          plaintext_value
        } else if !encrypted_value.is_empty() {
          encryption_key
            .and_then(|key| chrome_decrypt::decrypt(&encrypted_value, &domain, key))
            .unwrap_or_default()
        } else {
          String::new()
        };

        Ok(UnifiedCookie {
          name,
          value,
          domain,
          path,
          expires: Self::chrome_time_to_unix(expires_utc),
          is_secure: is_secure != 0,
          is_http_only: is_httponly != 0,
          same_site: samesite,
          creation_time: Self::chrome_time_to_unix(creation_utc),
          last_accessed: Self::chrome_time_to_unix(last_access_utc),
        })
      })
      .map_err(|e| format!("Failed to query cookies: {e}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|e| format!("Failed to collect cookies: {e}"))?;

    Ok(cookies)
  }

  /// Write cookies to a Firefox/Camoufox profile.
  ///
  /// Firefox's `moz_cookies.expiry` is "seconds since Unix epoch", so `expiry = 0`
  /// is interpreted as 1970-01-01 and purged on read. To let imported session
  /// cookies survive browser restart, we rewrite them to a far-future expiry.
  ///
  /// `schemeMap` is a bitfield (1 = HTTP, 2 = HTTPS, 3 = both). Setting it based
  /// on `is_secure` preserves Firefox's scheme-bound cookie enforcement.
  fn write_firefox_cookies(
    db_path: &Path,
    cookies: &[UnifiedCookie],
  ) -> Result<(usize, usize), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;

    let mut copied = 0;
    let mut replaced = 0;

    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs() as i64;
    // Session cookies get 30 days of persistence so they survive restart.
    let session_cookie_expiry = now + 30 * 86400;

    for cookie in cookies {
      let expiry = if cookie.expires > 0 {
        cookie.expires
      } else {
        session_cookie_expiry
      };
      // schemeMap bitfield: 1 = HTTP, 2 = HTTPS
      let scheme_map: i32 = if cookie.is_secure { 2 } else { 1 };

      let existing: Option<i64> = conn
        .query_row(
          "SELECT id FROM moz_cookies WHERE host = ?1 AND name = ?2 AND path = ?3",
          params![&cookie.domain, &cookie.name, &cookie.path],
          |row| row.get(0),
        )
        .ok();

      if existing.is_some() {
        conn
          .execute(
            "UPDATE moz_cookies SET value = ?1, expiry = ?2, isSecure = ?3,
                     isHttpOnly = ?4, sameSite = ?5, rawSameSite = ?5,
                     lastAccessed = ?6, schemeMap = ?7
                     WHERE host = ?8 AND name = ?9 AND path = ?10",
            params![
              &cookie.value,
              expiry,
              cookie.is_secure as i32,
              cookie.is_http_only as i32,
              cookie.same_site,
              cookie.last_accessed * 1_000_000,
              scheme_map,
              &cookie.domain,
              &cookie.name,
              &cookie.path,
            ],
          )
          .map_err(|e| format!("Failed to update cookie: {e}"))?;
        replaced += 1;
      } else {
        conn
          .execute(
            "INSERT INTO moz_cookies
                     (originAttributes, name, value, host, path, expiry, lastAccessed,
                      creationTime, isSecure, isHttpOnly, sameSite, rawSameSite, schemeMap)
                     VALUES ('', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)",
            params![
              &cookie.name,
              &cookie.value,
              &cookie.domain,
              &cookie.path,
              expiry,
              cookie.last_accessed * 1_000_000,
              cookie.creation_time * 1_000_000,
              cookie.is_secure as i32,
              cookie.is_http_only as i32,
              cookie.same_site,
              scheme_map,
            ],
          )
          .map_err(|e| format!("Failed to insert cookie: {e}"))?;
        copied += 1;
      }
    }

    Ok((copied, replaced))
  }

  /// Write cookies to a Chrome/Wayfern profile.
  ///
  /// Always writes values as plaintext in the `value` column with an empty
  /// `encrypted_value`. Chromium reads plaintext on a per-row basis when
  /// `encrypted_value` is empty, so this mixes cleanly with any pre-existing
  /// encrypted cookies in the database. We avoid encrypting on write because
  /// the os_crypt key derivation between Wayfern's runtime and an external
  /// writer is not guaranteed to match, and a ciphertext Chromium can't
  /// decrypt silently produces an empty cookie value at runtime.
  fn write_chrome_cookies(
    db_path: &Path,
    cookies: &[UnifiedCookie],
  ) -> Result<(usize, usize), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;

    let mut copied = 0;
    let mut replaced = 0;

    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs() as i64;

    for cookie in cookies {
      // Session cookies (no expiry) must have has_expires/is_persistent = 0.
      // Otherwise Chromium interprets expires_utc=0 as 1601-01-01 (expired).
      let has_expires = if cookie.expires > 0 { 1 } else { 0 };
      let is_persistent = has_expires;
      // HTTPS cookies use 443, HTTP uses 80. source_port participates in
      // Chromium's scheme-bound cookie enforcement.
      let source_port: i32 = if cookie.is_secure { 443 } else { 80 };
      let source_scheme: i32 = if cookie.is_secure { 2 } else { 1 };

      let existing: Option<i64> = conn
        .query_row(
          "SELECT rowid FROM cookies WHERE host_key = ?1 AND name = ?2 AND path = ?3",
          params![&cookie.domain, &cookie.name, &cookie.path],
          |row| row.get(0),
        )
        .ok();

      if existing.is_some() {
        conn
          .execute(
            "UPDATE cookies SET value = ?1, encrypted_value = x'', expires_utc = ?2, is_secure = ?3,
                     is_httponly = ?4, samesite = ?5, last_access_utc = ?6, last_update_utc = ?7,
                     has_expires = ?8, is_persistent = ?9, source_scheme = ?10, source_port = ?11
                     WHERE host_key = ?12 AND name = ?13 AND path = ?14",
            params![
              &cookie.value,
              Self::unix_to_chrome_time(cookie.expires),
              cookie.is_secure as i32,
              cookie.is_http_only as i32,
              cookie.same_site,
              Self::unix_to_chrome_time(cookie.last_accessed),
              Self::unix_to_chrome_time(now),
              has_expires,
              is_persistent,
              source_scheme,
              source_port,
              &cookie.domain,
              &cookie.name,
              &cookie.path,
            ],
          )
          .map_err(|e| format!("Failed to update cookie: {e}"))?;
        replaced += 1;
      } else {
        conn
          .execute(
            "INSERT INTO cookies
                     (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value,
                      path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires,
                      is_persistent, priority, samesite, source_scheme, source_port, source_type,
                      has_cross_site_ancestor, last_update_utc)
                     VALUES (?1, ?2, '', ?3, ?4, x'', ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?13, ?14, 0, 0, ?15)",
            params![
              Self::unix_to_chrome_time(cookie.creation_time),
              &cookie.domain,
              &cookie.name,
              &cookie.value,
              &cookie.path,
              Self::unix_to_chrome_time(cookie.expires),
              cookie.is_secure as i32,
              cookie.is_http_only as i32,
              Self::unix_to_chrome_time(cookie.last_accessed),
              has_expires,
              is_persistent,
              cookie.same_site,
              source_scheme,
              source_port,
              Self::unix_to_chrome_time(now),
            ],
          )
          .map_err(|e| format!("Failed to insert cookie: {e}"))?;
        copied += 1;
      }
    }

    Ok((copied, replaced))
  }
}

include!("cookie_manager_io.rs");
include!("cookie_manager_tests.rs");
include!("cookie_manager_tests2.rs");
