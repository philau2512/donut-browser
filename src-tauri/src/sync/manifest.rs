use chrono::{DateTime, Utc};
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::Path;
use std::time::SystemTime;

use super::types::{SyncError, SyncResult};
use crate::profile::types::BrowserProfile;

/// Default exclude patterns for volatile browser profile files.
/// Patterns use `**/` prefix to match at any directory depth, since the sync
/// engine scans from `profiles/{uuid}/` which contains `profile/Default/...`.
pub const DEFAULT_EXCLUDE_PATTERNS: &[&str] = &[
  "**/Cache/**",
  "**/Code Cache/**",
  "**/GPUCache/**",
  "**/GrShaderCache/**",
  "**/ShaderCache/**",
  "**/DawnCache/**",
  "**/DawnGraphiteCache/**",
  "**/Service Worker/CacheStorage/**",
  "**/Service Worker/ScriptCache/**",
  "**/Session Storage/**",
  "**/blob_storage/**",
  "**/Crashpad/**",
  "**/Crash Reports/**",
  "**/BrowserMetrics/**",
  "**/optimization_guide_model_store/**",
  "**/Safe Browsing/**",
  "**/component_crx_cache/**",
  "**/cache2/**",
  "**/startupCache/**",
  "**/safebrowsing/**",
  "**/storage/temporary/**",
  "**/storage/default/*/cache/**",
  "**/datareporting/**",
  "**/saved-telemetry-pings/**",
  "**/sessionstore-backups/**",
  "**/sessions/**",
  "**/serviceworker.txt",
  "**/AlternateServices.bin",
  "**/SiteSecurityServiceState.bin",
  "**/favicons.sqlite",
  "**/favicons.sqlite-*",
  "**/crashes/**",
  "**/minidumps/**",
  "*.tmp",
  "**/LOG",
  "**/LOG.old",
  "**/LOCK",
  "**/*-journal",
  "**/*-wal",
  "**/SingletonLock",
  "**/SingletonSocket",
  "**/SingletonCookie",
  "**/Secure Preferences",
  "**/GraphiteDawnCache/**",
  "**/DawnWebGPUCache/**",
  "**/BrowserMetrics*",
  "**/.DS_Store",
  ".donut-sync/**",
  // Orphaned local-only marker from earlier rollover-based fingerprint
  // regeneration. Keep excluding it so any markers left on disk from
  // prior builds never get uploaded.
  ".last-fp-refresh",
];

/// A single file entry in the manifest
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestFileEntry {
  pub path: String,
  pub size: u64,
  pub mtime: i64,
  pub hash: String,
}

/// The sync manifest for a profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
  pub version: u32,
  #[serde(rename = "profileId")]
  pub profile_id: String,
  #[serde(rename = "generatedAt")]
  pub generated_at: String,
  #[serde(rename = "updatedAt")]
  pub updated_at: String,
  #[serde(rename = "excludeGlobs")]
  pub exclude_globs: Vec<String>,
  pub files: Vec<ManifestFileEntry>,
  #[serde(default)]
  pub encrypted: bool,
}

impl SyncManifest {
  pub fn new(profile_id: String, exclude_globs: Vec<String>) -> Self {
    let now = Utc::now().to_rfc3339();
    Self {
      version: 1,
      profile_id,
      generated_at: now.clone(),
      updated_at: now,
      exclude_globs,
      files: Vec::new(),
      encrypted: false,
    }
  }

  pub fn updated_at_datetime(&self) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&self.updated_at)
      .ok()
      .map(|dt| dt.with_timezone(&Utc))
  }
}

/// Local hash cache to avoid re-hashing unchanged files
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HashCache {
  pub entries: HashMap<String, HashCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashCacheEntry {
  pub size: u64,
  pub mtime: i64,
  pub hash: String,
}

impl HashCache {
  pub fn load(cache_path: &Path) -> Self {
    if !cache_path.exists() {
      return Self::default();
    }

    match fs::read_to_string(cache_path) {
      Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
      Err(_) => Self::default(),
    }
  }

  pub fn save(&self, cache_path: &Path) -> SyncResult<()> {
    if let Some(parent) = cache_path.parent() {
      fs::create_dir_all(parent).map_err(|e| {
        SyncError::IoError(format!(
          "Failed to create cache directory {}: {e}",
          parent.display()
        ))
      })?;
    }

    let json = serde_json::to_string_pretty(self)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize hash cache: {e}")))?;

    fs::write(cache_path, json).map_err(|e| {
      SyncError::IoError(format!(
        "Failed to write hash cache {}: {e}",
        cache_path.display()
      ))
    })?;

    Ok(())
  }

  pub fn get(&self, path: &str, size: u64, mtime: i64) -> Option<&str> {
    self.entries.get(path).and_then(|entry| {
      if entry.size == size && entry.mtime == mtime {
        Some(entry.hash.as_str())
      } else {
        None
      }
    })
  }

  pub fn insert(&mut self, path: String, size: u64, mtime: i64, hash: String) {
    self
      .entries
      .insert(path, HashCacheEntry { size, mtime, hash });
  }
}

/// Build a GlobSet from exclude patterns
fn build_exclude_globset(patterns: &[String]) -> SyncResult<GlobSet> {
  let mut builder = GlobSetBuilder::new();
  for pattern in patterns {
    let glob = Glob::new(pattern)
      .map_err(|e| SyncError::InvalidData(format!("Invalid exclude pattern '{}': {e}", pattern)))?;
    builder.add(glob);
  }
  builder
    .build()
    .map_err(|e| SyncError::InvalidData(format!("Failed to build exclude globset: {e}")))
}

/// Compute blake3 hash of a file
/// Returns None if the file doesn't exist (was deleted)
fn hash_file(path: &Path) -> Result<Option<String>, SyncError> {
  let file = match File::open(path) {
    Ok(f) => f,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(e) => {
      return Err(SyncError::IoError(format!(
        "Failed to open {}: {e}",
        path.display()
      )));
    }
  };

  let mut reader = BufReader::new(file);
  let mut hasher = blake3::Hasher::new();
  let mut buffer = [0u8; 65536]; // 64KB buffer

  loop {
    let bytes_read = reader
      .read(&mut buffer)
      .map_err(|e| SyncError::IoError(format!("Failed to read {}: {e}", path.display())))?;
    if bytes_read == 0 {
      break;
    }
    hasher.update(&buffer[..bytes_read]);
  }

  Ok(Some(hasher.finalize().to_hex().to_string()))
}

/// Compute blake3 hash of metadata.json after sanitizing volatile fields.
/// This prevents infinite sync loops where updating last_sync triggers a new sync.
fn hash_sanitized_metadata(path: &Path) -> Result<Option<String>, SyncError> {
  let content = match fs::read_to_string(path) {
    Ok(c) => c,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(e) => {
      return Err(SyncError::IoError(format!(
        "Failed to read metadata at {}: {e}",
        path.display()
      )));
    }
  };

  let mut profile: BrowserProfile = serde_json::from_str(&content).map_err(|e| {
    SyncError::SerializationError(format!("Failed to parse metadata for hashing: {e}"))
  })?;

  // Sanitize volatile fields that should not trigger a re-sync
  profile.last_sync = None;
  profile.process_id = None;
  profile.last_launch = None;

  let sanitized_json = serde_json::to_string(&profile).map_err(|e| {
    SyncError::SerializationError(format!("Failed to serialize sanitized metadata: {e}"))
  })?;

  let mut hasher = blake3::Hasher::new();
  hasher.update(sanitized_json.as_bytes());

  Ok(Some(hasher.finalize().to_hex().to_string()))
}

/// Get mtime as unix timestamp
/// Returns None if the file doesn't exist (was deleted)
fn get_mtime(path: &Path) -> Result<Option<i64>, SyncError> {
  let metadata = match path.metadata() {
    Ok(m) => m,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(e) => {
      return Err(SyncError::IoError(format!(
        "Failed to get metadata for {}: {e}",
        path.display()
      )));
    }
  };

  let mtime = metadata
    .modified()
    .map_err(|e| SyncError::IoError(format!("Failed to get mtime for {}: {e}", path.display())))?;

  Ok(Some(
    mtime
      .duration_since(SystemTime::UNIX_EPOCH)
      .map(|d| d.as_secs() as i64)
      .unwrap_or(0),
  ))
}

/// Generate a manifest for a profile directory
pub fn generate_manifest(
  profile_id: &str,
  profile_dir: &Path,
  cache: &mut HashCache,
) -> SyncResult<SyncManifest> {
  let exclude_patterns: Vec<String> = DEFAULT_EXCLUDE_PATTERNS
    .iter()
    .map(|s| s.to_string())
    .collect();
  let globset = build_exclude_globset(&exclude_patterns)?;

  let mut manifest = SyncManifest::new(profile_id.to_string(), exclude_patterns);
  let mut max_mtime: i64 = 0;

  if !profile_dir.exists() {
    log::debug!(
      "Profile directory doesn't exist: {}, creating empty manifest",
      profile_dir.display()
    );
    return Ok(manifest);
  }

  fn walk_dir(
    dir: &Path,
    base_dir: &Path,
    globset: &GlobSet,
    cache: &mut HashCache,
    files: &mut Vec<ManifestFileEntry>,
    max_mtime: &mut i64,
  ) -> SyncResult<()> {
    let entries = fs::read_dir(dir).map_err(|e| {
      SyncError::IoError(format!("Failed to read directory {}: {e}", dir.display()))
    })?;

    for entry in entries {
      let entry = entry.map_err(|e| {
        SyncError::IoError(format!("Failed to read entry in {}: {e}", dir.display()))
      })?;

      let path = entry.path();
      let relative_path = path
        .strip_prefix(base_dir)
        .map_err(|_| SyncError::IoError("Failed to compute relative path".to_string()))?
        .to_string_lossy()
        .replace('\\', "/");

      // Check if excluded
      if globset.is_match(&relative_path) {
        continue;
      }

      // Get metadata - skip if file was deleted between directory read and metadata access
      let metadata = match path.metadata() {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
          log::debug!(
            "File disappeared during manifest generation, skipping: {}",
            path.display()
          );
          continue;
        }
        Err(e) => {
          return Err(SyncError::IoError(format!(
            "Failed to get metadata for {}: {e}",
            path.display()
          )));
        }
      };

      if metadata.is_dir() {
        walk_dir(&path, base_dir, globset, cache, files, max_mtime)?;
      } else if metadata.is_file() {
        let size = metadata.len();
        let mtime = match get_mtime(&path)? {
          Some(m) => m,
          None => {
            // File was deleted, skip it
            log::debug!(
              "File disappeared during manifest generation, skipping: {}",
              path.display()
            );
            continue;
          }
        };

        *max_mtime = (*max_mtime).max(mtime);

        // Check cache for existing hash
        let hash = if relative_path == "metadata.json" {
          // Special case: sanitize metadata.json before hashing to prevent sync loops
          match hash_sanitized_metadata(&path)? {
            Some(computed_hash) => computed_hash,
            None => {
              log::debug!(
                "File disappeared during manifest generation, skipping: {}",
                path.display()
              );
              continue;
            }
          }
        } else if let Some(cached_hash) = cache.get(&relative_path, size, mtime) {
          cached_hash.to_string()
        } else {
          match hash_file(&path)? {
            Some(computed_hash) => {
              cache.insert(relative_path.clone(), size, mtime, computed_hash.clone());
              computed_hash
            }
            None => {
              // File was deleted, skip it
              log::debug!(
                "File disappeared during manifest generation, skipping: {}",
                path.display()
              );
              continue;
            }
          }
        };

        files.push(ManifestFileEntry {
          path: relative_path,
          size,
          mtime,
          hash,
        });
      }
    }

    Ok(())
  }

  walk_dir(
    profile_dir,
    profile_dir,
    &globset,
    cache,
    &mut manifest.files,
    &mut max_mtime,
  )?;

  // Sort files for deterministic manifest
  manifest.files.sort_by(|a, b| a.path.cmp(&b.path));

  // Update the updatedAt timestamp to max mtime
  if max_mtime > 0 {
    if let Some(dt) = DateTime::from_timestamp(max_mtime, 0) {
      manifest.updated_at = dt.to_rfc3339();
    }
  }

  Ok(manifest)
}

include!("manifest_diff.rs");
