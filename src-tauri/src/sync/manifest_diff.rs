#[derive(Debug, Default)]
pub struct ManifestDiff {
  pub files_to_upload: Vec<ManifestFileEntry>,
  pub files_to_download: Vec<ManifestFileEntry>,
  pub files_to_delete_local: Vec<String>,
  pub files_to_delete_remote: Vec<String>,
}

impl ManifestDiff {
  pub fn is_empty(&self) -> bool {
    self.files_to_upload.is_empty()
      && self.files_to_download.is_empty()
      && self.files_to_delete_local.is_empty()
      && self.files_to_delete_remote.is_empty()
  }
}

/// Compute what needs to be synced between local and remote
pub fn compute_diff(local: &SyncManifest, remote: Option<&SyncManifest>) -> ManifestDiff {
  let mut diff = ManifestDiff::default();

  let Some(remote) = remote else {
    // No remote manifest - upload everything
    diff.files_to_upload = local.files.clone();
    return diff;
  };

  // Build hash maps for quick lookup
  let local_files: HashMap<&str, &ManifestFileEntry> =
    local.files.iter().map(|f| (f.path.as_str(), f)).collect();
  let remote_files: HashMap<&str, &ManifestFileEntry> =
    remote.files.iter().map(|f| (f.path.as_str(), f)).collect();

  // Safety: if local is empty but remote has files, always download from remote.
  // This prevents data loss when profile data files are deleted but metadata
  // survives — the newly generated manifest would have updated_at=NOW, which
  // would appear "newer" and cause all remote files to be deleted.
  if local.files.is_empty() && !remote.files.is_empty() {
    log::info!(
      "Local manifest is empty but remote has {} files — downloading from remote to recover",
      remote.files.len()
    );
    diff.files_to_download = remote.files.clone();
    return diff;
  }

  // Compare timestamps to determine direction
  let local_updated = local.updated_at_datetime();
  let remote_updated = remote.updated_at_datetime();

  let local_is_newer = match (local_updated, remote_updated) {
    (Some(l), Some(r)) => l > r,
    (Some(_), None) => true,
    (None, Some(_)) => false,
    (None, None) => true, // Default to uploading
  };

  if local_is_newer {
    // Upload changed/new files, delete remote files that don't exist locally
    for (path, local_entry) in &local_files {
      match remote_files.get(path) {
        Some(remote_entry) if remote_entry.hash != local_entry.hash => {
          diff.files_to_upload.push((*local_entry).clone());
        }
        None => {
          diff.files_to_upload.push((*local_entry).clone());
        }
        _ => {}
      }
    }

    for path in remote_files.keys() {
      if !local_files.contains_key(path) {
        diff.files_to_delete_remote.push(path.to_string());
      }
    }
  } else {
    // Download changed/new files, delete local files that don't exist remotely
    for (path, remote_entry) in &remote_files {
      match local_files.get(path) {
        Some(local_entry) if local_entry.hash != remote_entry.hash => {
          diff.files_to_download.push((*remote_entry).clone());
        }
        None => {
          diff.files_to_download.push((*remote_entry).clone());
        }
        _ => {}
      }
    }

    for path in local_files.keys() {
      if !remote_files.contains_key(path) {
        diff.files_to_delete_local.push(path.to_string());
      }
    }
  }

  diff
}

/// Get the path to the hash cache file for a profile
pub fn get_cache_path(profile_dir: &Path) -> std::path::PathBuf {
  profile_dir.join(".donut-sync").join("cache.json")
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  #[test]
  fn test_hash_cache_operations() {
    let cache_dir = TempDir::new().unwrap();
    let cache_path = cache_dir.path().join("cache.json");

    let mut cache = HashCache::default();
    cache.insert(
      "test.txt".to_string(),
      100,
      1234567890,
      "abc123".to_string(),
    );

    assert_eq!(cache.get("test.txt", 100, 1234567890), Some("abc123"));
    assert_eq!(cache.get("test.txt", 100, 999), None); // Different mtime
    assert_eq!(cache.get("test.txt", 50, 1234567890), None); // Different size

    cache.save(&cache_path).unwrap();

    let loaded = HashCache::load(&cache_path);
    assert_eq!(loaded.get("test.txt", 100, 1234567890), Some("abc123"));
  }

  #[test]
  fn test_generate_manifest_empty_dir() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    assert_eq!(manifest.profile_id, "test-profile");
    assert_eq!(manifest.version, 1);
    assert!(manifest.files.is_empty());
  }

  #[test]
  fn test_generate_manifest_with_files() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    fs::write(profile_dir.join("file1.txt"), "hello").unwrap();
    fs::write(profile_dir.join("file2.txt"), "world").unwrap();
    fs::create_dir_all(profile_dir.join("subdir")).unwrap();
    fs::write(profile_dir.join("subdir/file3.txt"), "nested").unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    assert_eq!(manifest.files.len(), 3);
    assert!(manifest.files.iter().any(|f| f.path == "file1.txt"));
    assert!(manifest.files.iter().any(|f| f.path == "file2.txt"));
    assert!(manifest.files.iter().any(|f| f.path == "subdir/file3.txt"));
  }

  #[test]
  fn test_generate_manifest_excludes_cache() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    fs::write(profile_dir.join("file1.txt"), "keep").unwrap();
    fs::create_dir_all(profile_dir.join("Cache")).unwrap();
    fs::write(profile_dir.join("Cache/data"), "exclude").unwrap();
    fs::create_dir_all(profile_dir.join("Code Cache")).unwrap();
    fs::write(profile_dir.join("Code Cache/wasm"), "exclude").unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    assert_eq!(manifest.files.len(), 1);
    assert_eq!(manifest.files[0].path, "file1.txt");
  }

  #[test]
  fn test_generate_manifest_excludes_nested_caches() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile_root");
    fs::create_dir_all(&profile_dir).unwrap();

    // Simulate real Chromium structure: profile/Default/Cache/...
    let default_dir = profile_dir.join("profile/Default");
    fs::create_dir_all(&default_dir).unwrap();
    fs::write(default_dir.join("Cookies"), "keep").unwrap();
    fs::create_dir_all(default_dir.join("Cache")).unwrap();
    fs::write(default_dir.join("Cache/data_0"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("Code Cache/js")).unwrap();
    fs::write(default_dir.join("Code Cache/js/abc"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("GPUCache")).unwrap();
    fs::write(default_dir.join("GPUCache/data_0"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("Session Storage")).unwrap();
    fs::write(default_dir.join("Session Storage/000003.log"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("Local Storage/leveldb")).unwrap();
    fs::write(default_dir.join("Local Storage/leveldb/000001.ldb"), "keep").unwrap();

    // Caches at user-data-dir level
    fs::create_dir_all(profile_dir.join("profile/ShaderCache")).unwrap();
    fs::write(profile_dir.join("profile/ShaderCache/data"), "exclude").unwrap();
    fs::create_dir_all(profile_dir.join("profile/Crashpad")).unwrap();
    fs::write(profile_dir.join("profile/Crashpad/report"), "exclude").unwrap();

    // metadata.json at root
    let profile = BrowserProfile::default();
    fs::write(
      profile_dir.join("metadata.json"),
      serde_json::to_string(&profile).unwrap(),
    )
    .unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    let paths: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    assert!(
      paths.contains(&"metadata.json"),
      "metadata.json should be synced"
    );
    assert!(
      paths.contains(&"profile/Default/Cookies"),
      "Cookies should be synced"
    );
    assert!(
      paths.contains(&"profile/Default/Local Storage/leveldb/000001.ldb"),
      "Local Storage should be synced"
    );
    assert!(
      !paths.iter().any(|p| p.contains("Cache")),
      "Cache directories should be excluded: {paths:?}"
    );
    assert!(
      !paths.iter().any(|p| p.contains("Session Storage")),
      "Session Storage should be excluded: {paths:?}"
    );
    assert!(
      !paths.iter().any(|p| p.contains("Crashpad")),
      "Crashpad should be excluded: {paths:?}"
    );
  }

  #[test]
  fn test_compute_diff_upload_all_when_no_remote() {
    let local = SyncManifest {
      version: 1,
      profile_id: "test".to_string(),
      generated_at: Utc::now().to_rfc3339(),
      updated_at: Utc::now().to_rfc3339(),
      exclude_globs: vec![],
      files: vec![
        ManifestFileEntry {
          path: "file1.txt".to_string(),
          size: 10,
          mtime: 1000,
          hash: "abc".to_string(),
        },
        ManifestFileEntry {
          path: "file2.txt".to_string(),
          size: 20,
          mtime: 2000,
          hash: "def".to_string(),
        },
      ],
      encrypted: false,
    };

    let diff = compute_diff(&local, None);

    assert_eq!(diff.files_to_upload.len(), 2);
    assert!(diff.files_to_download.is_empty());
    assert!(diff.files_to_delete_local.is_empty());
    assert!(diff.files_to_delete_remote.is_empty());
  }

  #[test]
  fn test_compute_diff_detect_changes() {
    let old_time = "2024-01-01T00:00:00Z";
    let new_time = "2024-01-02T00:00:00Z";

    let local = SyncManifest {
      version: 1,
      profile_id: "test".to_string(),
      generated_at: new_time.to_string(),
      updated_at: new_time.to_string(),
      exclude_globs: vec![],
      files: vec![
        ManifestFileEntry {
          path: "unchanged.txt".to_string(),
          size: 10,
          mtime: 1000,
          hash: "same".to_string(),
        },
        ManifestFileEntry {
          path: "changed.txt".to_string(),
          size: 10,
          mtime: 2000,
          hash: "new_hash".to_string(),
        },
        ManifestFileEntry {
          path: "new_file.txt".to_string(),
          size: 5,
          mtime: 3000,
          hash: "new".to_string(),
        },
      ],
      encrypted: false,
    };

    let remote = SyncManifest {
      version: 1,
      profile_id: "test".to_string(),
      generated_at: old_time.to_string(),
      updated_at: old_time.to_string(),
      exclude_globs: vec![],
      files: vec![
        ManifestFileEntry {
          path: "unchanged.txt".to_string(),
          size: 10,
          mtime: 1000,
          hash: "same".to_string(),
        },
        ManifestFileEntry {
          path: "changed.txt".to_string(),
          size: 10,
          mtime: 1000,
          hash: "old_hash".to_string(),
        },
        ManifestFileEntry {
          path: "deleted.txt".to_string(),
          size: 8,
          mtime: 500,
          hash: "gone".to_string(),
        },
      ],
      encrypted: false,
    };

    let diff = compute_diff(&local, Some(&remote));

    // Local is newer, so we upload changed/new and delete remote-only
    assert_eq!(diff.files_to_upload.len(), 2); // changed + new
    assert!(diff.files_to_upload.iter().any(|f| f.path == "changed.txt"));
    assert!(diff
      .files_to_upload
      .iter()
      .any(|f| f.path == "new_file.txt"));
    assert!(diff.files_to_download.is_empty());
    assert!(diff.files_to_delete_local.is_empty());
    assert_eq!(diff.files_to_delete_remote.len(), 1);
    assert!(diff
      .files_to_delete_remote
      .contains(&"deleted.txt".to_string()));
  }

  #[test]
  fn test_manifest_encrypted_flag_default() {
    let json = r#"{"version":1,"profileId":"test","generatedAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z","excludeGlobs":[],"files":[]}"#;
    let manifest: SyncManifest = serde_json::from_str(json).unwrap();
    assert!(!manifest.encrypted);
  }

  #[test]
  fn test_manifest_with_encrypted_flag() {
    let json = r#"{"version":1,"profileId":"test","generatedAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z","excludeGlobs":[],"files":[],"encrypted":true}"#;
    let manifest: SyncManifest = serde_json::from_str(json).unwrap();
    assert!(manifest.encrypted);

    let serialized = serde_json::to_string(&manifest).unwrap();
    let deserialized: SyncManifest = serde_json::from_str(&serialized).unwrap();
    assert!(deserialized.encrypted);
  }

  #[test]
  fn test_compute_diff_empty_local_downloads_from_remote() {
    // When local has no files but remote does, always download from remote.
    // This prevents data loss when profile data is deleted but metadata survives.
    let local = SyncManifest {
      version: 1,
      profile_id: "test".to_string(),
      generated_at: Utc::now().to_rfc3339(),
      updated_at: Utc::now().to_rfc3339(), // NOW — appears newer than remote
      exclude_globs: vec![],
      files: vec![],
      encrypted: false,
    };

    let remote = SyncManifest {
      version: 1,
      profile_id: "test".to_string(),
      generated_at: "2024-01-01T00:00:00Z".to_string(),
      updated_at: "2024-01-01T00:00:00Z".to_string(),
      exclude_globs: vec![],
      files: vec![
        ManifestFileEntry {
          path: "Cookies".to_string(),
          size: 100,
          mtime: 1000,
          hash: "abc".to_string(),
        },
        ManifestFileEntry {
          path: "Local State".to_string(),
          size: 200,
          mtime: 1000,
          hash: "def".to_string(),
        },
      ],
      encrypted: false,
    };

    let diff = compute_diff(&local, Some(&remote));

    // Must download all remote files, NOT delete them
    assert_eq!(diff.files_to_download.len(), 2);
    assert!(diff.files_to_upload.is_empty());
    assert!(diff.files_to_delete_remote.is_empty());
    assert!(diff.files_to_delete_local.is_empty());
  }

  #[test]
  fn test_generate_manifest_sanitizes_metadata() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    let profile_id = uuid::Uuid::new_v4();
    let metadata_path = profile_dir.join("metadata.json");

    let profile = BrowserProfile {
      id: profile_id,
      name: "test-profile".to_string(),
      last_sync: Some(100),
      process_id: Some(1234),
      ..Default::default()
    };

    fs::write(&metadata_path, serde_json::to_string(&profile).unwrap()).unwrap();

    let mut cache = HashCache::default();
    let manifest1 = generate_manifest(&profile_id.to_string(), &profile_dir, &mut cache).unwrap();
    let hash1 = manifest1
      .files
      .iter()
      .find(|f| f.path == "metadata.json")
      .unwrap()
      .hash
      .clone();

    // Update volatile fields
    let profile2 = BrowserProfile {
      id: profile_id,
      name: "test-profile".to_string(),
      last_sync: Some(200),
      process_id: Some(5678),
      ..Default::default()
    };

    fs::write(&metadata_path, serde_json::to_string(&profile2).unwrap()).unwrap();

    let manifest2 = generate_manifest(&profile_id.to_string(), &profile_dir, &mut cache).unwrap();
    let hash2 = manifest2
      .files
      .iter()
      .find(|f| f.path == "metadata.json")
      .unwrap()
      .hash
      .clone();

    // Hash should be identical because volatile fields are sanitized
    assert_eq!(
      hash1, hash2,
      "Metadata hash should be stable across last_sync/process_id updates"
    );

    // Change a non-volatile field
    let profile3 = BrowserProfile {
      id: profile_id,
      name: "changed-name".to_string(),
      last_sync: Some(200),
      ..Default::default()
    };

    fs::write(&metadata_path, serde_json::to_string(&profile3).unwrap()).unwrap();

    let manifest3 = generate_manifest(&profile_id.to_string(), &profile_dir, &mut cache).unwrap();
    let hash3 = manifest3
      .files
      .iter()
      .find(|f| f.path == "metadata.json")
      .unwrap()
      .hash
      .clone();

    // Hash should be different because name changed
    assert_ne!(
      hash1, hash3,
      "Metadata hash should change when non-volatile fields change"
    );
  }
}
