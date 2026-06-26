use super::app_updater_types::{AppAutoUpdater, AppUpdateInfo, PENDING_INSTALLER_PATH};
use crate::events;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

impl AppAutoUpdater {
  async fn download_update_silent(
    &self,
    download_url: &str,
    dest_dir: &Path,
    filename: &str,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let file_path = dest_dir.join(filename);

    let response = self
      .client
      .get(download_url)
      .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
      .send()
      .await?;

    if !response.status().is_success() {
      return Err(format!("Download failed with status: {}", response.status()).into());
    }

    let total_size = response.content_length().unwrap_or(0);
    log::info!("Silent download size: {} bytes", total_size);
    let raw_file = fs::File::create(&file_path)?;
    let mut file = std::io::BufWriter::with_capacity(8 * 1024 * 1024, raw_file);
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
      let chunk = chunk?;
      file.write_all(&chunk)?;
    }
    std::io::Write::flush(&mut file)?;

    log::info!("Silent download completed: {}", file_path.display());
    Ok(file_path)
  }

  /// Download and prepare app update (silent download + install + notify)
  pub async fn download_and_prepare_update(
    &self,
    _app_handle: &tauri::AppHandle,
    update_info: &AppUpdateInfo,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Starting background update download and install");

    let temp_dir = std::env::temp_dir().join("donut_app_update");
    fs::create_dir_all(&temp_dir)?;

    let filename = update_info
      .download_url
      .split('/')
      .next_back()
      .unwrap_or("update.dmg")
      .to_string();

    log::info!("Downloading update from: {}", update_info.download_url);

    let download_path = self
      .download_update_silent(&update_info.download_url, &temp_dir, &filename)
      .await?;

    log::info!("Extracting update...");
    let extracted_app_path = self.extract_update(&download_path, &temp_dir).await?;

    // On Windows, MSI/EXE installers close the running app, so running them now
    // would kill the process before the "Update ready" toast can appear. Instead,
    // defer execution to restart_application() when the user clicks "Restart Now".
    #[cfg(target_os = "windows")]
    {
      let ext = extracted_app_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
      if ext == "msi" || ext == "exe" {
        log::info!("Deferring Windows installer execution until user-initiated restart");
        *PENDING_INSTALLER_PATH.lock().unwrap() = Some(extracted_app_path);
      } else {
        log::info!("Installing update (overwriting binary)...");
        self.install_update(&extracted_app_path).await?;
        log::info!("Cleaning up temporary files...");
        let _ = fs::remove_dir_all(&temp_dir);
      }
    }

    #[cfg(not(target_os = "windows"))]
    {
      log::info!("Installing update (overwriting binary)...");
      self.install_update(&extracted_app_path).await?;
      log::info!("Cleaning up temporary files...");
      let _ = fs::remove_dir_all(&temp_dir);
    }

    log::info!("Update ready, emitting app-update-ready event");

    let _ = events::emit("app-update-ready", update_info.new_version.clone());

    Ok(())
  }

  /// Extract the update using the extraction module
  pub(crate) async fn extract_update(
    &self,
    archive_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let file_name = archive_path
      .file_name()
      .and_then(|name| name.to_str())
      .unwrap_or("");

    // Handle compound extensions like .tar.gz
    if file_name.ends_with(".tar.gz") {
      return self.extractor.extract_tar_gz(archive_path, dest_dir).await;
    }

    let extension = archive_path
      .extension()
      .and_then(|ext| ext.to_str())
      .unwrap_or("");

    match extension {
      "dmg" => {
        #[cfg(target_os = "macos")]
        {
          self.extractor.extract_dmg(archive_path, dest_dir).await
        }
        #[cfg(not(target_os = "macos"))]
        {
          Err("DMG extraction is only supported on macOS".into())
        }
      }
      "msi" => {
        #[cfg(target_os = "windows")]
        {
          // For MSI files on Windows, we need to run the installer
          // MSI files can't be extracted like archives, they need to be executed
          // Return the path to the MSI file itself for installation
          Ok(archive_path.to_path_buf())
        }
        #[cfg(not(target_os = "windows"))]
        {
          Err("MSI installation is only supported on Windows".into())
        }
      }
      "exe" => {
        #[cfg(target_os = "windows")]
        {
          // For exe installers on Windows, return the path for execution
          Ok(archive_path.to_path_buf())
        }
        #[cfg(not(target_os = "windows"))]
        {
          Err("EXE installation is only supported on Windows".into())
        }
      }
      "deb" => {
        #[cfg(target_os = "linux")]
        {
          // For DEB files on Linux, return the path for installation
          Ok(archive_path.to_path_buf())
        }
        #[cfg(not(target_os = "linux"))]
        {
          Err("DEB installation is only supported on Linux".into())
        }
      }
      "rpm" => {
        #[cfg(target_os = "linux")]
        {
          // For RPM files on Linux, return the path for installation
          Ok(archive_path.to_path_buf())
        }
        #[cfg(not(target_os = "linux"))]
        {
          Err("RPM installation is only supported on Linux".into())
        }
      }
      "appimage" => {
        #[cfg(target_os = "linux")]
        {
          // For AppImage files, return the path for installation
          Ok(archive_path.to_path_buf())
        }
        #[cfg(not(target_os = "linux"))]
        {
          Err("AppImage installation is only supported on Linux".into())
        }
      }
      "zip" => self.extractor.extract_zip(archive_path, dest_dir).await,
      _ => Err(format!("Unsupported archive format: {extension}").into()),
    }
  }

  /// Install the update by replacing the current app
  async fn install_update(
    &self,
    #[allow(unused_variables)] installer_path: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(target_os = "macos")]
    {
      // Get the current application bundle path
      let current_app_path = self.get_current_app_path()?;

      // Create a backup of the current app
      let backup_path = current_app_path.with_extension("app.backup");
      if backup_path.exists() {
        fs::remove_dir_all(&backup_path)?;
      }

      // Move current app to backup
      fs::rename(&current_app_path, &backup_path)?;

      // Move new app to current location
      fs::rename(installer_path, &current_app_path)?;

      // Remove the macOS quarantine attribute from the freshly-installed app
      // so Gatekeeper doesn't block its first launch — but only if it's
      // actually present. macOS Sequoia's App Management TCC fires on the
      // modify-class syscall regardless of whether anything is actually
      // modified, so we gate the call behind a read-only `getxattr` check.
      let needs_quarantine_removal = {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let path_c = CString::new(current_app_path.as_os_str().as_bytes()).ok();
        let attr_c = CString::new("com.apple.quarantine").ok();
        match (path_c, attr_c) {
          (Some(p), Some(a)) => {
            // SAFETY: getxattr with a null buffer is a read-only size query.
            let result =
              unsafe { libc::getxattr(p.as_ptr(), a.as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
            result >= 0
          }
          _ => false,
        }
      };
      if needs_quarantine_removal {
        let _ = Command::new("xattr")
          .args([
            "-dr",
            "com.apple.quarantine",
            current_app_path.to_str().unwrap(),
          ])
          .output();
      }

      // Clean up backup after successful installation
      let _ = fs::remove_dir_all(&backup_path);

      // Clean up old "Donut Browser.app" if it exists (from before the project rename)
      if let Some(parent_dir) = current_app_path.parent() {
        let old_app_path = parent_dir.join("Donut Browser.app");
        if old_app_path.exists() && old_app_path != current_app_path {
          log::info!(
            "Removing old 'Donut Browser.app' from: {}",
            old_app_path.display()
          );
          if let Err(e) = fs::remove_dir_all(&old_app_path) {
            log::warn!("Warning: Failed to remove old 'Donut Browser.app': {e}");
          } else {
            log::info!("Successfully removed old 'Donut Browser.app'");
          }
        }
      }

      Ok(())
    }

    #[cfg(target_os = "windows")]
    {
      let extension = installer_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");

      log::info!("Installing Windows update with extension: {extension}");

      match extension {
        "msi" => {
          // Install MSI silently with enhanced error handling
          log::info!("Running MSI installer: {}", installer_path.display());

          let mut cmd = Command::new("msiexec");
          cmd.args([
            "/i",
            installer_path.to_str().unwrap(),
            "/quiet",
            "/norestart",
            "REBOOT=ReallySuppress",
            "/l*v", // Enable verbose logging
            &format!("{}.log", installer_path.to_str().unwrap()),
          ]);

          use std::os::windows::process::CommandExt;
          const CREATE_NO_WINDOW: u32 = 0x08000000;
          cmd.creation_flags(CREATE_NO_WINDOW);

          let output = cmd.output()?;

          if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            let exit_code = output.status.code().unwrap_or(-1);

            // Try to read the log file for more details
            let log_path = format!("{}.log", installer_path.to_str().unwrap());
            let log_content = fs::read_to_string(&log_path).unwrap_or_default();

            log::info!("MSI installation failed with exit code: {exit_code}");
            log::info!("Error output: {error_msg}");
            if !log_content.is_empty() {
              log::info!(
                "Log file content (last 500 chars): {}",
                &log_content
                  .chars()
                  .rev()
                  .take(500)
                  .collect::<String>()
                  .chars()
                  .rev()
                  .collect::<String>()
              );
            }

            return Err(
              format!("MSI installation failed (exit code {exit_code}): {error_msg}").into(),
            );
          }

          log::info!("MSI installation completed successfully");
        }
        "exe" => {
          // Run exe installer silently with multiple fallback options
          log::info!("Running EXE installer: {}", installer_path.display());

          // Try NSIS silent flag first (most common for Tauri)
          let mut success = false;
          let mut last_error = String::new();

          // NSIS installer flags (used by Tauri)
          let nsis_args = vec![
            vec!["/S"],                                             // Standard NSIS silent flag
            vec!["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], // Inno Setup flags
            vec!["/quiet"],                                         // Generic quiet flag
            vec!["/silent"],                                        // Alternative silent flag
          ];

          for args in nsis_args {
            log::info!("Trying installer with args: {:?}", args);
            let output = Command::new(installer_path).args(&args).output();

            match output {
              Ok(output) if output.status.success() => {
                log::info!(
                  "EXE installation completed successfully with args: {:?}",
                  args
                );
                success = true;
                break;
              }
              Ok(output) => {
                let error_msg = String::from_utf8_lossy(&output.stderr);
                last_error = format!(
                  "Exit code {}: {}",
                  output.status.code().unwrap_or(-1),
                  error_msg
                );
                log::info!("Installer failed with args {:?}: {}", args, last_error);
              }
              Err(e) => {
                last_error = format!("Failed to execute installer: {e}");
                log::info!(
                  "Failed to execute installer with args {:?}: {}",
                  args,
                  last_error
                );
              }
            }
          }

          if !success {
            return Err(
              format!(
                "EXE installation failed after trying multiple methods. Last error: {last_error}"
              )
              .into(),
            );
          }
        }
        "zip" => {
          // Handle ZIP files by extracting and replacing the current executable
          log::info!("Handling ZIP update: {}", installer_path.display());

          let temp_extract_dir = installer_path.parent().unwrap().join("extracted");
          fs::create_dir_all(&temp_extract_dir)?;

          // Extract ZIP file
          let extracted_path = self
            .extractor
            .extract_zip(installer_path, &temp_extract_dir)
            .await?;

          // Find the executable in the extracted files
          let current_exe = self.get_current_app_path()?;
          let current_exe_name = current_exe.file_name().unwrap();

          // Look for the new executable
          let new_exe_path =
            if extracted_path.is_file() && extracted_path.file_name() == Some(current_exe_name) {
              extracted_path
            } else {
              // Search in extracted directory
              let mut found_exe = None;
              if let Ok(entries) = fs::read_dir(&extracted_path) {
                for entry in entries.flatten() {
                  let path = entry.path();
                  if path.file_name() == Some(current_exe_name) {
                    found_exe = Some(path);
                    break;
                  }
                }
              }
              found_exe.ok_or("Could not find executable in ZIP file")?
            };

          // Create backup of current executable
          let backup_path = current_exe.with_extension("exe.backup");
          if backup_path.exists() {
            fs::remove_file(&backup_path)?;
          }
          fs::copy(&current_exe, &backup_path)?;

          // Replace current executable
          fs::copy(&new_exe_path, &current_exe)?;

          // Clean up
          let _ = fs::remove_dir_all(&temp_extract_dir);

          log::info!("ZIP update completed successfully");
        }
        _ => {
          return Err(format!("Unsupported installer format: {extension}").into());
        }
      }

      Ok(())
    }

    #[cfg(target_os = "linux")]
    {
      let file_name = installer_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");

      log::info!("Installing Linux update: {}", installer_path.display());

      // Handle compound extensions like .tar.gz
      if file_name.ends_with(".tar.gz") {
        return self.install_linux_tarball(installer_path).await;
      }

      let extension = installer_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");

      match extension {
        "deb" => self.install_linux_deb(installer_path).await,
        "rpm" => self.install_linux_rpm(installer_path).await,
        "appimage" => self.install_linux_appimage(installer_path).await,
        _ => Err(format!("Unsupported Linux installer format: {extension}").into()),
      }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
      Err("Auto-update installation not supported on this platform".into())
    }
  }

  /// Install Linux DEB package
  #[cfg(target_os = "linux")]
  async fn install_linux_deb(
    &self,
    deb_path: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Installing DEB package: {}", deb_path.display());
    Self::install_linux_package_with_privileges(deb_path, "dpkg", "-i")
  }

  /// Install Linux RPM package
  #[cfg(target_os = "linux")]
  async fn install_linux_rpm(
    &self,
    rpm_path: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Installing RPM package: {}", rpm_path.display());
    Self::install_linux_package_with_privileges(rpm_path, "rpm", "-Uvh")
  }

  /// Install a Linux package with privilege escalation, using a fallback chain:
  /// 1. pkexec (graphical PolicyKit prompt — most common on desktop Linux)
  /// 2. zenity/kdialog password dialog → sudo -S (graphical sudo experience)
  /// 3. sudo (terminal fallback — works in TTY sessions)
  #[cfg(target_os = "linux")]
  fn install_linux_package_with_privileges(
    pkg_path: &Path,
    install_cmd: &str,
    install_arg: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let pkg = pkg_path.to_str().unwrap_or_default();

    // 1. Try pkexec (graphical PolicyKit prompt)
    if let Ok(status) = Command::new("pkexec")
      .args([install_cmd, install_arg, pkg])
      .status()
    {
      if status.success() {
        log::info!("Installed {pkg} with pkexec");
        return Ok(());
      }
    }

    // 2. Try graphical password dialog → sudo -S
    if let Some(password) = Self::get_password_graphically() {
      if Self::install_with_sudo_stdin(pkg_path, &password, install_cmd, install_arg) {
        log::info!("Installed {pkg} with graphical sudo");
        return Ok(());
      }
    }

    // 3. Terminal sudo fallback
    if let Ok(status) = Command::new("sudo")
      .args([install_cmd, install_arg, pkg])
      .status()
    {
      if status.success() {
        log::info!("Installed {pkg} with sudo");
        return Ok(());
      }
    }

    Err(format!("Failed to install {pkg} — all privilege escalation methods failed").into())
  }

  /// Try zenity then kdialog to get a password graphically.
  #[cfg(target_os = "linux")]
  fn get_password_graphically() -> Option<String> {
    // Try zenity
    if let Ok(output) = Command::new("zenity")
      .args([
        "--password",
        "--title=Authentication Required",
        "--text=Enter your password to install the update:",
      ])
      .output()
    {
      if output.status.success() {
        let pw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !pw.is_empty() {
          return Some(pw);
        }
      }
    }

    // Fall back to kdialog
    if let Ok(output) = Command::new("kdialog")
      .args(["--password", "Enter your password to install the update:"])
      .output()
    {
      if output.status.success() {
        let pw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !pw.is_empty() {
          return Some(pw);
        }
      }
    }

    None
  }

  /// Pipe a password to `sudo -S <install_cmd> <install_arg> <pkg>`.
  #[cfg(target_os = "linux")]
  fn install_with_sudo_stdin(
    pkg_path: &Path,
    password: &str,
    install_cmd: &str,
    install_arg: &str,
  ) -> bool {
    use std::io::Write;

    let child = Command::new("sudo")
      .args([
        "-S",
        install_cmd,
        install_arg,
        pkg_path.to_str().unwrap_or_default(),
      ])
      .stdin(std::process::Stdio::piped())
      .stdout(std::process::Stdio::piped())
      .stderr(std::process::Stdio::piped())
      .spawn();

    match child {
      Ok(mut child) => {
        if let Some(mut stdin) = child.stdin.take() {
          let _ = writeln!(stdin, "{password}");
        }
        child.wait().map(|s| s.success()).unwrap_or(false)
      }
      Err(_) => false,
    }
  }

  /// Install Linux AppImage
  #[cfg(target_os = "linux")]
  async fn install_linux_appimage(
    &self,
    appimage_path: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Installing AppImage: {}", appimage_path.display());

    // This function should not be called for AppImages since we disable auto-updates for them
    // But if it somehow gets called, we'll handle it safely

    if !self.is_running_from_appimage() {
      return Err("AppImage installation attempted but not running from AppImage".into());
    }

    let current_exe = self.get_current_app_path()?;

    // Detect if we're running from an AppImage using multiple methods
    let current_appimage = if let Ok(appimage_env) = std::env::var("APPIMAGE") {
      PathBuf::from(appimage_env)
    } else {
      // Fallback: use current executable path
      current_exe.clone()
    };

    // Create backup
    let backup_path = current_appimage.with_extension("appimage.backup");
    if backup_path.exists() {
      fs::remove_file(&backup_path)?;
    }
    fs::copy(&current_appimage, &backup_path)?;

    // Make new AppImage executable
    let _ = Command::new("chmod")
      .args(["+x", appimage_path.to_str().unwrap()])
      .output();

    // Replace the AppImage
    fs::copy(appimage_path, &current_appimage)?;

    log::info!("AppImage replacement completed successfully");
    Ok(())
  }

  /// Install Linux tarball
  #[cfg(target_os = "linux")]
  async fn install_linux_tarball(
    &self,
    tarball_path: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Installing tarball: {}", tarball_path.display());

    let current_exe = self.get_current_app_path()?;
    let temp_extract_dir = tarball_path.parent().unwrap().join("extracted");
    fs::create_dir_all(&temp_extract_dir)?;

    // Extract tarball
    let extracted_path = self
      .extractor
      .extract_tar_gz(tarball_path, &temp_extract_dir)
      .await?;

    // Find the executable in the extracted files
    let current_exe_name = current_exe.file_name().unwrap();
    let new_exe_path =
      if extracted_path.is_file() && extracted_path.file_name() == Some(current_exe_name) {
        extracted_path
      } else {
        // Search in extracted directory
        let mut found_exe = None;
        if let Ok(entries) = fs::read_dir(&extracted_path) {
          for entry in entries.flatten() {
            let path = entry.path();
            if path.file_name() == Some(current_exe_name) {
              found_exe = Some(path);
              break;
            }
            // Also check subdirectories
            if path.is_dir() {
              if let Ok(sub_entries) = fs::read_dir(&path) {
                for sub_entry in sub_entries.flatten() {
                  let sub_path = sub_entry.path();
                  if sub_path.file_name() == Some(current_exe_name) {
                    found_exe = Some(sub_path);
                    break;
                  }
                }
              }
            }
          }
        }
        found_exe.ok_or("Could not find executable in tarball")?
      };

    // Create backup of current executable
    let backup_path = current_exe.with_extension("backup");
    if backup_path.exists() {
      fs::remove_file(&backup_path)?;
    }
    fs::copy(&current_exe, &backup_path)?;

    // Replace current executable
    fs::copy(&new_exe_path, &current_exe)?;

    // Make sure it's executable
    let _ = Command::new("chmod")
      .args(["+x", current_exe.to_str().unwrap()])
      .output();

    // Clean up
    let _ = fs::remove_dir_all(&temp_extract_dir);

    log::info!("Tarball installation completed successfully");
    Ok(())
  }

  /// Get the current application bundle path
  pub(crate) fn get_current_app_path(
    &self,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(target_os = "macos")]
    {
      // Get the current executable path
      let exe_path = std::env::current_exe()?;

      // Navigate up to find the .app bundle
      let mut current = exe_path.as_path();
      while let Some(parent) = current.parent() {
        if parent.extension().is_some_and(|ext| ext == "app") {
          return Ok(parent.to_path_buf());
        }
        current = parent;
      }

      Err("Could not find application bundle".into())
    }

    #[cfg(target_os = "windows")]
    {
      // On Windows, just return the current executable path
      std::env::current_exe().map_err(|e| e.into())
    }

    #[cfg(target_os = "linux")]
    {
      // On Linux, return the current executable path
      std::env::current_exe().map_err(|e| e.into())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
      Err("Platform not supported".into())
    }
  }
}
