// EXE and AppImage handling for Extractor
// Extracted from extraction_formats.rs for modularization

// Note: fs, Path, PathBuf, Extractor are in scope via `include!` into extraction.rs

// BrowserType is already in scope via include! from extraction.rs

impl Extractor {
  #[cfg(target_os = "linux")]
  pub async fn handle_appimage(
    &self,
    appimage_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    std::fs::create_dir_all(dest_dir)?;

    // For AppImages, we typically just copy them and make sure they're executable
    let dest_file = dest_dir.join(
      appimage_path
        .file_name()
        .unwrap_or_else(|| std::ffi::OsStr::new("app.AppImage")),
    );

    // Copy the AppImage to destination
    fs::copy(appimage_path, &dest_file)?;

    // Set executable permissions
    self
      .set_executable_permissions_recursive(&dest_file)
      .await?;

    Ok(dest_file)
  }

  pub async fn handle_exe_file(
    &self,
    exe_path: &Path,
    dest_dir: &Path,
    browser_type: BrowserType,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    {
      let _ = browser_type;
      let exe_name = exe_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("browser.exe");

      let dest_path = dest_dir.join(exe_name);
      fs::copy(exe_path, &dest_path)?;
      Ok(dest_path)
    }
  }
}
