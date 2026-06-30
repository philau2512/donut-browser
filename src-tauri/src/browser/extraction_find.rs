// Executable finding logic for Extractor (platform-specific)
// Extracted from extraction_formats.rs for modularization

// Note: Path, PathBuf are imported in extraction.rs parent module
// via `include!`, so we don't re-import them here to avoid duplicate definition errors.


impl Extractor {
  async fn find_extracted_executable(
    &self,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    // Platform-specific executable finding logic
    #[cfg(target_os = "macos")]
    {
      self.find_macos_app(dest_dir).await
    }

    #[cfg(target_os = "windows")]
    {
      self.find_windows_executable(dest_dir).await
    }

    #[cfg(target_os = "linux")]
    {
      let result = self.find_linux_executable(dest_dir).await;

      // If we found an executable, ensure it's in the correct directory structure
      // that the verification expects
      if let Ok(exe_path) = &result {
        self
          .ensure_correct_directory_structure(dest_dir, exe_path)
          .await?;
      }

      result
    }
  }

  #[cfg(target_os = "macos")]
  async fn find_macos_app(
    &self,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Searching for .app bundle in: {}", dest_dir.display());

    // Use the enhanced recursive search
    match self.find_app_in_directory(dest_dir).await {
      Ok(app_path) => {
        // Check if the app is in a subdirectory and move it to the root if needed
        let app_parent = app_path.parent().unwrap();
        if app_parent != dest_dir {
          log::info!(
            "Found .app in subdirectory, moving to root: {} -> {}",
            app_path.display(),
            dest_dir.display()
          );
          let target_path = dest_dir.join(app_path.file_name().unwrap());

          // Move the app to the root destination directory
          fs::rename(&app_path, &target_path)?;

          // Try to clean up the now-empty subdirectory (ignore errors)
          if let Some(parent_dir) = app_path.parent() {
            if parent_dir != dest_dir {
              let _ = fs::remove_dir_all(parent_dir);
            }
          }

          log::info!("Successfully moved .app to: {}", target_path.display());
          Ok(target_path)
        } else {
          log::info!("Found .app at root level: {}", app_path.display());
          Ok(app_path)
        }
      }
      Err(e) => {
        log::info!("Failed to find .app bundle: {e}");
        Err("No .app found after extraction".into())
      }
    }
  }

  #[cfg(target_os = "windows")]
  async fn find_windows_executable(
    &self,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!(
      "Searching for Windows executable in: {}",
      dest_dir.display()
    );

    // Look for .exe files, preferring main browser executables
    let priority_exe_names = [
      "firefox.exe",
      "chrome.exe",
      "chromium.exe",
      "camoufox.exe",
      "wayfern.exe",
    ];

    // First try priority executable names
    for exe_name in &priority_exe_names {
      let exe_path = dest_dir.join(exe_name);
      if exe_path.exists() {
        log::info!("Found priority executable: {}", exe_path.display());
        return Ok(exe_path);
      }
    }

    // Recursively search for executables with depth limit
    match self.find_windows_executable_recursive(dest_dir, 0, 3).await {
      Ok(exe_path) => {
        log::info!(
          "Found executable via recursive search: {}",
          exe_path.display()
        );
        Ok(exe_path)
      }
      Err(_) => Err("No executable found after extraction".into()),
    }
  }

  #[cfg(target_os = "windows")]
  #[allow(clippy::type_complexity)]
  fn find_windows_executable_recursive<'a>(
    &'a self,
    dir: &'a Path,
    depth: usize,
    max_depth: usize,
  ) -> std::pin::Pin<
    Box<
      dyn std::future::Future<Output = Result<PathBuf, Box<dyn std::error::Error + Send + Sync>>>
        + Send
        + 'a,
    >,
  > {
    Box::pin(async move {
      if depth > max_depth {
        return Err("Maximum search depth reached".into());
      }

      if let Ok(entries) = fs::read_dir(dir) {
        let mut dirs_to_search = Vec::new();

        // First pass: look for .exe files in current directory
        for entry in entries.flatten() {
          let path = entry.path();

          if path.is_file()
            && path
              .extension()
              .is_some_and(|ext| ext.to_string_lossy().to_lowercase() == "exe")
          {
            let file_name = path
              .file_name()
              .and_then(|n| n.to_str())
              .unwrap_or("")
              .to_lowercase();

            // Check if it's a browser executable
            if file_name.contains("firefox")
              || file_name.contains("chrome")
              || file_name.contains("chromium")
              || file_name.contains("browser")
              || file_name.contains("camoufox")
              || file_name.contains("wayfern")
            {
              return Ok(path);
            }
          } else if path.is_dir() {
            // Collect directories for later search
            dirs_to_search.push(path);
          }
        }

        // Second pass: search subdirectories
        for subdir in dirs_to_search {
          if let Ok(result) = self
            .find_windows_executable_recursive(&subdir, depth + 1, max_depth)
            .await
          {
            return Ok(result);
          }
        }

        // Third pass: if no browser-specific executable found, return any .exe
        if let Ok(entries) = fs::read_dir(dir) {
          for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
              && path
                .extension()
                .is_some_and(|ext| ext.to_string_lossy().to_lowercase() == "exe")
            {
              return Ok(path);
            }
          }
        }
      }

      Err("No executable found".into())
    })
  }

  #[cfg(target_os = "linux")]
  async fn find_linux_executable(
    &self,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Searching for Linux executable in: {}", dest_dir.display());

    // Enhanced list of common browser executable names
    let exe_names = [
      // Firefox variants (used by Camoufox)
      "firefox",
      "firefox-bin",
      // Chrome/Chromium variants (used by Wayfern)
      "chrome",
      "chromium",
      "chromium-browser",
      "chromium-bin",
      // Camoufox variants
      "camoufox",
      "camoufox-bin",
      "camoufox-browser",
      // Wayfern variants
      "wayfern",
      "wayfern-bin",
      "wayfern-browser",
    ];

    // First, try direct lookup in the main directory
    for exe_name in &exe_names {
      let exe_path = dest_dir.join(exe_name);
      if exe_path.exists() && self.is_executable(&exe_path) {
        log::info!("Found executable at root level: {}", exe_path.display());
        return Ok(exe_path);
      }
    }

    // Enhanced list of common Linux subdirectories to search
    let subdirs = [
      "bin",
      "usr/bin",
      "usr/local/bin",
      "opt",
      "sbin",
      "usr/sbin",
      "firefox",
      "chrome",
      "chromium",
      "camoufox",
      "wayfern",
      ".",
      "./",
      "Browser",
      "browser",
      "opt/camoufox",
      "usr/lib/firefox",
      "usr/lib/chromium",
      "usr/lib/camoufox",
      "usr/share/applications",
      "usr/bin",
      "AppRun",
    ];

    // Search in subdirectories
    for subdir in &subdirs {
      let subdir_path = dest_dir.join(subdir);
      if subdir_path.exists() && subdir_path.is_dir() {
        for exe_name in &exe_names {
          let exe_path = subdir_path.join(exe_name);
          if exe_path.exists() && self.is_executable(&exe_path) {
            log::info!("Found executable in subdirectory: {}", exe_path.display());
            return Ok(exe_path);
          }
        }
      }
    }

    // Look for AppImage files
    if let Ok(entries) = fs::read_dir(dest_dir) {
      for entry in entries.flatten() {
        let path = entry.path();
        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
          if file_name.ends_with(".AppImage") && self.is_executable(&path) {
            log::info!("Found AppImage: {}", path.display());
            return Ok(path);
          }
        }
      }
    }

    // Last resort: recursive search for any executable file
    log::info!("Performing recursive search for executables...");
    match self.find_any_executable_recursive(dest_dir, 0).await {
      Ok(path) => {
        log::info!("Found executable via recursive search: {}", path.display());
        Ok(path)
      }
      Err(e) => {
        // List all files in the directory for debugging
        log::info!("Failed to find executable. Directory contents:");
        if let Ok(entries) = fs::read_dir(dest_dir) {
          for entry in entries.flatten() {
            let path = entry.path();
            let is_exec = if path.is_file() {
              self.is_executable(&path)
            } else {
              false
            };
            log::info!("  {} (executable: {})", path.display(), is_exec);
          }
        }
        Err(
          format!(
            "No executable found in {} after extraction. Original error: {}",
            dest_dir.display(),
            e
          )
          .into(),
        )
      }
    }
  }

  #[cfg(target_os = "linux")]
  fn is_executable(&self, path: &Path) -> bool {
    if let Ok(metadata) = path.metadata() {
      use std::os::unix::fs::PermissionsExt;
      return metadata.permissions().mode() & 0o111 != 0;
    }
    false
  }

  #[cfg(target_os = "linux")]
  async fn find_any_executable_recursive(
    &self,
    dir: &Path,
    depth: usize,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    // Limit recursion depth to avoid infinite loops
    if depth > 5 {
      return Err("Maximum search depth reached".into());
    }

    if let Ok(entries) = fs::read_dir(dir) {
      let mut directories = Vec::new();
      let mut potential_executables = Vec::new();

      // First pass: look for executable files
      for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && self.is_executable(&path) {
          // Prefer files with browser-like names
          if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            let name_lower = file_name.to_lowercase();
            if name_lower.contains("firefox")
              || name_lower.contains("chrome")
              || name_lower.contains("brave")
              || name_lower.contains("zen")
              || name_lower.contains("camoufox")
              || name_lower.contains("wayfern")
              || file_name.ends_with(".AppImage")
            {
              log::info!(
                "Found priority executable at depth {}: {}",
                depth,
                path.display()
              );
              return Ok(path);
            }
            // Collect other executables as potential candidates
            potential_executables.push(path);
          }
        } else if path.is_dir() {
          directories.push(path);
        }
      }

      // Second pass: recursively search directories
      for dir_path in directories {
        if let Ok(result) = Box::pin(self.find_any_executable_recursive(&dir_path, depth + 1)).await
        {
          return Ok(result);
        }
      }

      // Third pass: if no browser-specific executable found, try any executable
      if !potential_executables.is_empty() {
        // Sort by filename to prefer more likely candidates
        potential_executables.sort_by(|a, b| {
          let a_name = a
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
          let b_name = b
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

          // Prefer shorter names (likely main executables)
          a_name.len().cmp(&b_name.len())
        });

        log::info!(
          "Found potential executable at depth {}: {}",
          depth,
          potential_executables[0].display()
        );
        return Ok(potential_executables[0].clone());
      }
    }

    Err(format!("No executable found in directory: {}", dir.display()).into())
  }
}
