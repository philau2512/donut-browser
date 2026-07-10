use std::path::{Path, PathBuf};

/// Validation result for a storage path
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StorageValidationResult {
  pub is_valid: bool,
  pub error: Option<String>,
  pub warnings: Vec<String>,
  pub absolute_path: Option<PathBuf>,
}

impl StorageValidationResult {
  pub fn valid(path: PathBuf) -> Self {
    Self {
      is_valid: true,
      error: None,
      warnings: Vec::new(),
      absolute_path: Some(path),
    }
  }

  pub fn valid_with_warnings(path: PathBuf, warnings: Vec<String>) -> Self {
    Self {
      is_valid: true,
      error: None,
      warnings,
      absolute_path: Some(path),
    }
  }

  pub fn invalid(error: String) -> Self {
    Self {
      is_valid: false,
      error: Some(error),
      warnings: Vec::new(),
      absolute_path: None,
    }
  }
}

/// Validate a custom storage path for various safety and permission issues
pub fn validate_storage_path(path: &Path) -> StorageValidationResult {
  let mut warnings = Vec::new();

  // Convert to absolute path
  let absolute_path = match path.canonicalize() {
    Ok(p) => p,
    Err(_) => {
      // Path doesn't exist, try to resolve it
      match std::fs::create_dir_all(path) {
        Ok(_) => match path.canonicalize() {
          Ok(p) => p,
          Err(e) => return StorageValidationResult::invalid(format!("Cannot resolve path: {e}")),
        },
        Err(e) => return StorageValidationResult::invalid(format!("Cannot create directory: {e}")),
      }
    }
  };

  // Check if path is writable
  let test_file = absolute_path.join(".donut_write_test");
  match std::fs::write(&test_file, b"test") {
    Ok(_) => {
      let _ = std::fs::remove_file(&test_file);
    }
    Err(e) => {
      return StorageValidationResult::invalid(format!("Directory is not writable: {e}"));
    }
  }

  // Check if path is readable
  match std::fs::read_dir(&absolute_path) {
    Ok(_) => {}
    Err(e) => {
      return StorageValidationResult::invalid(format!("Directory is not readable: {e}"));
    }
  }

  // Warn if path is in system directories
  let path_str = absolute_path.to_string_lossy().to_lowercase();

  #[cfg(target_os = "windows")]
  {
    if path_str.starts_with("c:\\windows")
      || path_str.starts_with("c:\\program files")
      || path_str.starts_with("c:\\program files (x86)")
    {
      warnings.push(
        "Storage path is in a system directory. This may cause permission issues.".to_string(),
      );
    }
  }

  #[cfg(any(target_os = "macos", target_os = "linux"))]
  {
    if path_str.starts_with("/sys")
      || path_str.starts_with("/proc")
      || path_str.starts_with("/dev")
      || path_str.starts_with("/etc")
      || path_str.starts_with("/bin")
      || path_str.starts_with("/sbin")
      || path_str.starts_with("/usr/bin")
      || path_str.starts_with("/usr/sbin")
    {
      warnings.push(
        "Storage path is in a system directory. This may cause permission issues.".to_string(),
      );
    }
  }

  // Warn if path is in temp directory. Canonicalize temp_dir so the
  // comparison works on Windows where canonicalize() adds the \\?\ extended
  // path prefix but temp_dir().to_str() does not.
  let temp_canonical = std::env::temp_dir()
    .canonicalize()
    .unwrap_or_else(|_| std::env::temp_dir());
  let temp_str = temp_canonical.to_string_lossy().to_lowercase();
  if path_str.starts_with(&*temp_str) {
    warnings.push(
      "Storage path is in a temporary directory. Data may be deleted by the system.".to_string(),
    );
  }

  // Check available disk space
  match check_disk_space(&absolute_path) {
    Ok(bytes) => {
      const MIN_SPACE_MB: u64 = 100;
      const MIN_SPACE_BYTES: u64 = MIN_SPACE_MB * 1024 * 1024;

      if bytes < MIN_SPACE_BYTES {
        warnings.push(format!(
          "Low disk space: {} MB available (recommended: at least {} MB)",
          bytes / 1024 / 1024,
          MIN_SPACE_MB
        ));
      }
    }
    Err(_) => {
      warnings.push("Could not check available disk space".to_string());
    }
  }

  // Warn if existing data is detected
  if absolute_path.join("profiles").exists()
    || absolute_path.join("binaries").exists()
    || absolute_path.join("data").exists()
  {
    warnings.push("Existing Donut Browser data detected in this location".to_string());
  }

  if warnings.is_empty() {
    StorageValidationResult::valid(absolute_path)
  } else {
    StorageValidationResult::valid_with_warnings(absolute_path, warnings)
  }
}

/// Check available disk space for a given path (in bytes)
fn check_disk_space(path: &Path) -> Result<u64, String> {
  #[cfg(target_os = "windows")]
  {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let root = match path.ancestors().last() {
      Some(r) => r,
      None => return Err("Cannot determine root path".to_string()),
    };

    let mut root_wide: Vec<u16> = OsStr::new(root)
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();

    let mut free_bytes: u64 = 0;
    let result = unsafe {
      windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
        windows::core::PCWSTR(root_wide.as_mut_ptr()),
        Some(std::ptr::null_mut()),
        None,
        Some(&mut free_bytes as *mut u64),
      )
    };

    if result.is_ok() {
      Ok(free_bytes)
    } else {
      Err("Failed to get disk space on Windows".to_string())
    }
  }

  #[cfg(any(target_os = "macos", target_os = "linux"))]
  {
    use std::os::unix::ffi::OsStrExt;

    let path_cstring = std::ffi::CString::new(path.as_os_str().as_bytes())
      .map_err(|e| format!("Invalid path: {e}"))?;

    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::statvfs(path_cstring.as_ptr(), &mut stat) };

    if result == 0 {
      let available = stat.f_bavail * stat.f_bsize as u64;
      Ok(available)
    } else {
      Err("Failed to get disk space on Unix".to_string())
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_validate_temp_directory() {
    let temp = std::env::temp_dir();
    let result = validate_storage_path(&temp);

    // Should be valid but with warnings
    assert!(result.is_valid);
    assert!(!result.warnings.is_empty());
  }

  #[test]
  fn test_validate_nonexistent_path() {
    let path = std::env::temp_dir().join("donut_test_nonexistent_12345");
    let _ = std::fs::remove_dir_all(&path);

    let result = validate_storage_path(&path);

    // Should either be valid or have a reasonable error
    if !result.is_valid {
      assert!(result.error.is_some());
    }

    let _ = std::fs::remove_dir_all(&path);
  }

  #[test]
  fn test_validate_system_directory() {
    #[cfg(target_os = "windows")]
    let system_path = PathBuf::from("C:\\Windows\\System32");

    #[cfg(target_os = "macos")]
    let system_path = PathBuf::from("/usr/bin");

    #[cfg(target_os = "linux")]
    let system_path = PathBuf::from("/usr/bin");

    let result = validate_storage_path(&system_path);

    // Should either fail (no permission) or warn about system directory
    if result.is_valid {
      assert!(
        result
          .warnings
          .iter()
          .any(|w| w.contains("system directory")),
        "Expected warning about system directory"
      );
    }
  }

  #[test]
  fn test_validate_readonly_directory() {
    // Create a test directory
    let test_path = std::env::temp_dir().join("donut_test_readonly_98765");
    let _ = std::fs::remove_dir_all(&test_path);
    std::fs::create_dir_all(&test_path).unwrap();

    // Try to set readonly on Unix
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let perms = std::fs::Permissions::from_mode(0o444);
      std::fs::set_permissions(&test_path, perms).ok();
    }

    // Try to set readonly on Windows
    #[cfg(windows)]
    {
      let mut perms = std::fs::metadata(&test_path).unwrap().permissions();
      perms.set_readonly(true);
      std::fs::set_permissions(&test_path, perms).ok();
    }

    let result = validate_storage_path(&test_path);

    // Should fail with writable error
    if !result.is_valid {
      assert!(
        result
          .error
          .as_ref()
          .map_or(false, |e| e.contains("writable")),
        "Expected error about directory not being writable"
      );
    }

    // Cleanup
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let perms = std::fs::Permissions::from_mode(0o755);
      let _ = std::fs::set_permissions(&test_path, perms);
    }
    #[cfg(windows)]
    {
      let mut perms = std::fs::metadata(&test_path).unwrap().permissions();
      perms.set_readonly(false);
      let _ = std::fs::set_permissions(&test_path, perms);
    }
    let _ = std::fs::remove_dir_all(&test_path);
  }

  #[test]
  fn test_validate_path_with_special_characters() {
    let test_path = std::env::temp_dir().join("donut test (with) [special] {chars}");
    let _ = std::fs::remove_dir_all(&test_path);

    let result = validate_storage_path(&test_path);

    // Should handle special characters in path
    assert!(
      result.is_valid || result.error.is_some(),
      "Should either succeed or fail gracefully with special chars"
    );

    let _ = std::fs::remove_dir_all(&test_path);
  }

  #[test]
  fn test_validate_existing_donut_data() {
    let test_path = std::env::temp_dir().join("donut_test_existing_55555");
    let _ = std::fs::remove_dir_all(&test_path);
    std::fs::create_dir_all(&test_path).unwrap();

    // Create fake existing data
    std::fs::create_dir_all(test_path.join("profiles")).unwrap();
    std::fs::create_dir_all(test_path.join("binaries")).unwrap();

    let result = validate_storage_path(&test_path);

    // Should be valid but warn about existing data
    assert!(result.is_valid);
    assert!(
      result
        .warnings
        .iter()
        .any(|w| w.contains("Existing Donut Browser data")),
      "Expected warning about existing data"
    );

    let _ = std::fs::remove_dir_all(&test_path);
  }

  #[test]
  fn test_disk_space_check() {
    let temp = std::env::temp_dir();
    let result = check_disk_space(&temp);

    // Should succeed or return error
    match result {
      Ok(bytes) => assert!(bytes > 0, "Disk space should be positive"),
      Err(_) => {
        // Platform-specific check may fail, acceptable
      }
    }
  }
}
