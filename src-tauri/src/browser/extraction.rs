use std::fs::{self, File};
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};

use crate::browser::downloader::DownloadProgress;
use crate::browser::BrowserType;
use crate::events;

#[cfg(target_os = "macos")]
use tokio::process::Command;

#[cfg(target_os = "macos")]
use std::fs::create_dir_all;

/// Returns true if `path` carries a `com.apple.quarantine` extended attribute.
///
/// Uses `getxattr` with a null buffer to query the attribute size only —
/// this is a read-only syscall and does NOT trigger macOS Sequoia's App
/// Management TCC prompt. We use it to gate the `xattr -d` removal: macOS
/// fires the prompt on the modify-class syscall (`removexattr`) even when
/// the operation is a no-op, so skipping the call entirely when the
/// attribute is absent is the only way to stay quiet.
#[cfg(target_os = "macos")]
fn has_quarantine_attr(path: &Path) -> bool {
  use std::ffi::CString;
  use std::os::unix::ffi::OsStrExt;
  let Ok(path_c) = CString::new(path.as_os_str().as_bytes()) else {
    return false;
  };
  let Ok(attr_c) = CString::new("com.apple.quarantine") else {
    return false;
  };
  // SAFETY: getxattr is a stable libc API. Passing a null buffer with size 0
  // makes it a pure read-only size query.
  let result = unsafe {
    libc::getxattr(
      path_c.as_ptr(),
      attr_c.as_ptr(),
      std::ptr::null_mut(),
      0,
      0,
      0,
    )
  };
  result >= 0
}

pub struct Extractor;

impl Extractor {
  fn new() -> Self {
    Self
  }

  pub fn instance() -> &'static Extractor {
    &EXTRACTOR
  }

  // NOTE: We intentionally do not rename or sanitize ZIP entry paths.
  // We only ensure paths are enclosed within the destination using zip's enclosed_name.

  /// Ensure the extracted files are in the correct directory structure expected by verification
  #[cfg(target_os = "linux")]
  async fn ensure_correct_directory_structure(
    &self,
    dest_dir: &Path,
    exe_path: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Determine browser type from the destination directory path
    let browser_type = if dest_dir.to_string_lossy().contains("camoufox") {
      "camoufox"
    } else if dest_dir.to_string_lossy().contains("wayfern") {
      "wayfern"
    } else {
      return Ok(());
    };

    // For Camoufox and Wayfern on Linux, we expect the executable directly under version directory
    // e.g., binaries/camoufox/<version>/camoufox, without an extra subdirectory
    if browser_type == "camoufox" || browser_type == "wayfern" {
      return Ok(());
    }

    let expected_subdir = dest_dir.join(browser_type);

    // If the executable is not in the expected subdirectory, create the structure
    if !exe_path.starts_with(&expected_subdir) {
      log::info!("Reorganizing directory structure for {}", browser_type);

      // Create the expected subdirectory
      std::fs::create_dir_all(&expected_subdir)?;

      // Move all files from the root to the subdirectory
      if let Ok(entries) = std::fs::read_dir(dest_dir) {
        for entry in entries.flatten() {
          let path = entry.path();
          let file_name = match path.file_name() {
            Some(name) => name,
            None => continue,
          };

          // Skip the subdirectory we just created
          if path == expected_subdir {
            continue;
          }

          let target_path = expected_subdir.join(file_name);

          // Move the file/directory
          if let Err(e) = std::fs::rename(&path, &target_path) {
            log::info!(
              "Warning: Failed to move {} to {}: {}",
              path.display(),
              target_path.display(),
              e
            );
          } else {
            log::info!("Moved {} to {}", path.display(), target_path.display());
          }
        }
      }

      log::info!("Directory structure reorganized for {}", browser_type);
    }

    Ok(())
  }

  pub async fn extract_browser(
    &self,
    _app_handle: &tauri::AppHandle,
    browser_type: BrowserType,
    version: &str,
    archive_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    // Emit extraction start progress
    let progress = DownloadProgress {
      browser: browser_type.as_str().to_string(),
      version: version.to_string(),
      downloaded_bytes: 0,
      total_bytes: None,
      percentage: 0.0,
      speed_bytes_per_sec: 0.0,
      eta_seconds: None,
      stage: "extracting".to_string(),
    };
    let _ = events::emit("download-progress", &progress);

    log::info!(
      "Starting extraction of {} for browser {} version {}",
      archive_path.display(),
      browser_type.as_str(),
      version
    );

    // Detect the actual file type by reading the file header
    let actual_format = self.detect_file_format(archive_path).map_err(|e| {
      format!(
        "Failed to detect file format for {}: {}",
        archive_path.display(),
        e
      )
    })?;
    log::info!("Detected format: {actual_format}");

    let extraction_result = match actual_format.as_str() {
      "dmg" => {
        #[cfg(target_os = "macos")]
        {
          self.extract_dmg(archive_path, dest_dir).await.map_err(|e| {
            format!("DMG extraction failed for {} {}: {}", browser_type.as_str(), version, e).into()
          })
        }

        #[cfg(not(target_os = "macos"))]
        {
          Err(format!("DMG extraction is only supported on macOS, but {} {} requires DMG extraction", browser_type.as_str(), version).into())
        }
      }
      "zip" => {
        self.extract_zip(archive_path, dest_dir).await.map_err(|e| {
          format!("ZIP extraction failed for {} {}: {}", browser_type.as_str(), version, e).into()
        })
      }
      "tar.xz" => {
        self.extract_tar_xz(archive_path, dest_dir).await.map_err(|e| {
          format!("TAR.XZ extraction failed for {} {}: {}", browser_type.as_str(), version, e).into()
        })
      }
      "tar.bz2" => {
        self.extract_tar_bz2(archive_path, dest_dir).await.map_err(|e| {
          format!("TAR.BZ2 extraction failed for {} {}: {}", browser_type.as_str(), version, e).into()
        })
      }
      "tar.gz" => {
        self.extract_tar_gz(archive_path, dest_dir).await.map_err(|e| {
          format!("TAR.GZ extraction failed for {} {}: {}", browser_type.as_str(), version, e).into()
        })
      }
      "msi" => {
        self.extract_msi(archive_path, dest_dir).await.map_err(|e| {
          format!("MSI extraction failed for {} {}: {}", browser_type.as_str(), version, e).into()
        })
      }
      "exe" => {
        // For Windows EXE files, some may be self-extracting archives, others are installers
        // For browsers like Firefox, TOR, they're typically installers that don't need extraction
        self
          .handle_exe_file(archive_path, dest_dir, browser_type.clone())
          .await
          .map_err(|e| {
            format!("EXE handling failed for {} {}: {}", browser_type.as_str(), version, e).into()
          })
      }
      "appimage" => {
        #[cfg(target_os = "linux")]
        {
          self.handle_appimage(archive_path, dest_dir).await.map_err(|e| {
            format!("AppImage handling failed for {} {}: {}", browser_type.as_str(), version, e).into()
          })
        }

        #[cfg(not(target_os = "linux"))]
        {
          Err(format!("AppImage is only supported on Linux, but {} {} requires AppImage handling", browser_type.as_str(), version).into())
        }
      }
      _ => {
        Err(format!(
          "Unsupported archive format for {} {}: {} (detected: {}). The downloaded file might be corrupted or in an unexpected format. File: {}",
          browser_type.as_str(),
          version,
          archive_path.extension().and_then(|ext| ext.to_str()).unwrap_or("unknown"),
          actual_format,
          archive_path.display()
        ).into())
      }
    };

    match extraction_result {
      Ok(path) => {
        // Remove quarantine attributes on macOS to prevent Gatekeeper prompts —
        // but only if there's actually something to remove. Calling the
        // modify-class `removexattr` syscall on a file without quarantine still
        // fires macOS Sequoia's App Management TCC notification, so we skip
        // the call entirely when the attribute is absent.
        #[cfg(target_os = "macos")]
        {
          if has_quarantine_attr(dest_dir) {
            let _ = tokio::process::Command::new("xattr")
              .args([
                "-dr",
                "com.apple.quarantine",
                dest_dir.to_str().unwrap_or("."),
              ])
              .output()
              .await;
          }
        }

        log::info!(
          "Successfully extracted {} {} to: {}",
          browser_type.as_str(),
          version,
          path.display()
        );
        Ok(path)
      }
      Err(e) => {
        log::error!(
          "Extraction failed for {} {}: {}",
          browser_type.as_str(),
          version,
          e
        );
        Err(e)
      }
    }
  }

  /// Detect the actual file format by reading file headers
  fn detect_file_format(
    &self,
    file_path: &Path,
  ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Check file extension first for container formats (DMG, MSI) whose internal
    // compression makes magic bytes unreliable
    if let Some(ext) = file_path.extension().and_then(|ext| ext.to_str()) {
      match ext.to_lowercase().as_str() {
        "dmg" => return Ok("dmg".to_string()),
        "msi" => return Ok("msi".to_string()),
        _ => {}
      }
    }

    let mut file = File::open(file_path)?;
    let mut buffer = [0u8; 12];
    file.read_exact(&mut buffer)?;

    // Check magic numbers for other file types
    match &buffer[0..4] {
      [0x50, 0x4B, 0x03, 0x04] | [0x50, 0x4B, 0x05, 0x06] | [0x50, 0x4B, 0x07, 0x08] => {
        return Ok("zip".to_string())
      }
      [0x7F, 0x45, 0x4C, 0x46] => return Ok("appimage".to_string()), // ELF header (AppImage)
      [0x4D, 0x5A, _, _] => return Ok("exe".to_string()),            // PE header (Windows EXE)
      _ => {}
    }

    // Check for MSI files (Microsoft Installer)
    if buffer[0..8] == [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] {
      return Ok("msi".to_string());
    }

    // Check for XZ compressed files
    if buffer[0..6] == [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00] {
      return Ok("tar.xz".to_string());
    }

    // Check for Bzip2 compressed files
    if buffer[0..3] == [0x42, 0x5A, 0x68] {
      return Ok("tar.bz2".to_string());
    }

    // Check for Gzip compressed files
    if buffer[0..3] == [0x1F, 0x8B, 0x08] {
      return Ok("tar.gz".to_string());
    }

    // Fallback to file extension
    if let Some(ext) = file_path.extension().and_then(|ext| ext.to_str()) {
      match ext.to_lowercase().as_str() {
        "dmg" => Ok("dmg".to_string()),
        "zip" => Ok("zip".to_string()),
        "msi" => Ok("msi".to_string()),
        "xz" => {
          if file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .ends_with(".tar.xz")
          {
            Ok("tar.xz".to_string())
          } else {
            Ok("xz".to_string())
          }
        }
        "bz2" => {
          if file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .ends_with(".tar.bz2")
          {
            Ok("tar.bz2".to_string())
          } else {
            Ok("bz2".to_string())
          }
        }
        "gz" => {
          if file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .ends_with(".tar.gz")
          {
            Ok("tar.gz".to_string())
          } else {
            Ok("gz".to_string())
          }
        }
        "exe" => Ok("exe".to_string()),
        "appimage" => Ok("appimage".to_string()),
        _ => Ok("unknown".to_string()),
      }
    } else {
      Ok("unknown".to_string())
    }
  }

  #[cfg(target_os = "macos")]
  pub async fn extract_dmg(
    &self,
    dmg_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!(
      "Extracting DMG: {} to {}",
      dmg_path.display(),
      dest_dir.display()
    );

    // Create a temporary mount point
    let mount_point = std::env::temp_dir().join(format!(
      "donut_mount_{}",
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
    ));
    create_dir_all(&mount_point)?;

    log::info!("Created mount point: {}", mount_point.display());

    // Mount the DMG
    let output = Command::new("hdiutil")
      .args([
        "attach",
        "-nobrowse",
        "-noverify",
        "-noautoopen",
        "-mountpoint",
        mount_point.to_str().unwrap(),
        dmg_path.to_str().unwrap(),
      ])
      .stdin(std::process::Stdio::null())
      .output()
      .await?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      let stdout = String::from_utf8_lossy(&output.stdout);
      log::error!("Failed to mount DMG. stdout: {stdout}, stderr: {stderr}");

      // Clean up mount point before returning error
      let _ = fs::remove_dir_all(&mount_point);

      return Err(format!("Failed to mount DMG: {stderr}").into());
    }

    log::info!("Successfully mounted DMG");

    // Find the .app directory in the mount point
    let app_result = self.find_app_in_directory(&mount_point).await;

    let app_entry = match app_result {
      Ok(app_path) => app_path,
      Err(e) => {
        log::error!("Failed to find .app in mount point: {e}");

        // Try to unmount before returning error
        let _ = Command::new("hdiutil")
          .args(["detach", "-force", mount_point.to_str().unwrap()])
          .output()
          .await;
        let _ = fs::remove_dir_all(&mount_point);

        return Err("No .app found after extraction".into());
      }
    };

    log::info!("Found .app bundle: {}", app_entry.display());

    // Copy the .app to the destination
    let app_path = dest_dir.join(app_entry.file_name().unwrap());

    log::info!("Copying .app to: {}", app_path.display());

    // `-X` strips extended attributes (notably com.apple.quarantine) during
    // the copy itself. Without it, `cp -R` preserves quarantine from the
    // mounted DMG, which then has to be removed with `xattr -dr` — and that
    // removexattr syscall on a signed .app bundle trips macOS Sequoia's App
    // Management TCC notification ("Donut.app was prevented from modifying
    // apps on your Mac"). Stripping at copy time is silent.
    let output = Command::new("cp")
      .args([
        "-RX",
        app_entry.to_str().unwrap(),
        app_path.to_str().unwrap(),
      ])
      .output()
      .await?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      log::error!("Failed to copy app: {stderr}");

      // Unmount before returning error
      let _ = Command::new("hdiutil")
        .args(["detach", "-force", mount_point.to_str().unwrap()])
        .output()
        .await;
      let _ = fs::remove_dir_all(&mount_point);

      return Err(format!("Failed to copy app: {stderr}").into());
    }

    log::info!("Successfully copied .app bundle");

    // Remove the macOS quarantine attribute so Gatekeeper doesn't block launch
    // — but only if it's actually present. A no-op `removexattr` syscall on a
    // signed .app bundle still trips macOS Sequoia's App Management privacy
    // prompt ("Donut.app was prevented from modifying apps on your Mac"),
    // even when no modification actually happens, so we gate the call behind
    // a read-only `getxattr` check.
    if has_quarantine_attr(&app_path) {
      let _ = Command::new("xattr")
        .args(["-dr", "com.apple.quarantine", app_path.to_str().unwrap()])
        .output()
        .await;
      log::info!("Removed quarantine attributes");
    } else {
      log::info!("No quarantine attribute on .app, skipping xattr removal");
    }

    // Unmount the DMG
    let output = Command::new("hdiutil")
      .args(["detach", mount_point.to_str().unwrap()])
      .output()
      .await?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      log::warn!("Warning: Failed to unmount DMG: {stderr}");
      // Don't fail if unmount fails - the extraction was successful
    } else {
      log::info!("Successfully unmounted DMG");
    }

    // Clean up mount point directory
    let _ = fs::remove_dir_all(&mount_point);

    Ok(app_path)
  }

  #[cfg(target_os = "macos")]
  async fn find_app_in_directory(
    &self,
    dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    self.find_app_recursive(dir, 0).await
  }

  #[cfg(target_os = "macos")]
  async fn find_app_recursive(
    &self,
    dir: &Path,
    depth: usize,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    // Limit search depth to avoid infinite loops
    if depth > 4 {
      return Err("Maximum search depth reached".into());
    }

    if let Ok(entries) = fs::read_dir(dir) {
      let mut subdirs = Vec::new();
      let mut hidden_subdirs = Vec::new();

      // First pass: look for .app bundles directly
      for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
          if let Some(extension) = path.extension() {
            if extension == "app" {
              log::info!("Found .app bundle at depth {}: {}", depth, path.display());
              return Ok(path);
            }
          }

          // Collect subdirectories for second pass
          let filename = path.file_name().unwrap_or_default().to_string_lossy();
          if filename.starts_with('.') {
            // Hidden directories - search these with lower priority
            hidden_subdirs.push(path);
          } else {
            // Regular directories - search these first
            subdirs.push(path);
          }
        }
      }

      // Second pass: search regular subdirectories first
      for subdir in subdirs {
        // Skip common directories that are unlikely to contain .app files
        let dirname = subdir.file_name().unwrap_or_default().to_string_lossy();
        if matches!(
          dirname.as_ref(),
          "Documents" | "Downloads" | "Desktop" | "Library" | "System" | "tmp" | "var"
        ) {
          continue;
        }

        if let Ok(result) = Box::pin(self.find_app_recursive(&subdir, depth + 1)).await {
          return Ok(result);
        }
      }

      // Third pass: search hidden directories if nothing found in regular ones
      for hidden_dir in hidden_subdirs {
        if let Ok(result) = Box::pin(self.find_app_recursive(&hidden_dir, depth + 1)).await {
          return Ok(result);
        }
      }
    }

    Err(format!("No .app found in directory: {}", dir.display()).into())
  }
}

include!("extraction_formats.rs");
include!("extraction_tests.rs");
