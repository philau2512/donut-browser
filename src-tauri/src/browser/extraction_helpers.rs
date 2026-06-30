// Archive flattening and permission helpers for Extractor
// Extracted from extraction_formats.rs for modularization

// Note: fs, Path are imported in extraction.rs parent module
// via `include!`, so we don't re-import them here to avoid duplicate definition errors.

impl Extractor {
  fn flatten_single_directory_archive(
    &self,
    dest_dir: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let entries: Vec<_> = fs::read_dir(dest_dir)?.filter_map(|e| e.ok()).collect();

    let archive_extensions = ["zip", "tar", "xz", "gz", "bz2", "dmg", "msi", "exe"];

    let mut dirs = Vec::new();
    let mut has_non_archive_files = false;

    for entry in &entries {
      let path = entry.path();
      if path.is_dir() {
        dirs.push(path);
      } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if !archive_extensions.contains(&ext.to_lowercase().as_str()) {
          has_non_archive_files = true;
        }
      } else {
        has_non_archive_files = true;
      }
    }

    if dirs.len() == 1 && !has_non_archive_files {
      let single_dir = &dirs[0];

      if single_dir.extension().is_some_and(|ext| ext == "app") {
        log::info!(
          "Skipping flatten: {} is a macOS app bundle",
          single_dir.display()
        );
        return Ok(());
      }

      log::info!(
        "Flattening single-directory archive: moving contents of {} to {}",
        single_dir.display(),
        dest_dir.display()
      );

      let inner_entries: Vec<_> = fs::read_dir(single_dir)?.filter_map(|e| e.ok()).collect();

      for entry in inner_entries {
        let source = entry.path();
        let file_name = match source.file_name() {
          Some(name) => name.to_owned(),
          None => continue,
        };
        let target = dest_dir.join(&file_name);
        fs::rename(&source, &target).map_err(|e| {
          format!(
            "Failed to move {} to {}: {}",
            source.display(),
            target.display(),
            e
          )
        })?;
      }

      fs::remove_dir(single_dir).map_err(|e| {
        format!(
          "Failed to remove empty directory {}: {}",
          single_dir.display(),
          e
        )
      })?;

      log::info!("Successfully flattened archive directory structure");
    }

    Ok(())
  }

  /// Set executable permissions recursively for all files in a directory
  #[cfg(unix)]
  pub async fn set_executable_permissions_recursive(
    &self,
    dir: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(entries) = fs::read_dir(dir) {
      for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
          // Check if file looks like it should be executable
          if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            let name_lower = file_name.to_lowercase();
            if name_lower.contains("firefox")
              || name_lower.contains("chrome")
              || name_lower.contains("brave")
              || name_lower.contains("zen")
              || name_lower.contains("camoufox")
              || name_lower.contains("wayfern")
              || name_lower.ends_with(".appimage")
              || !name_lower.contains('.')
            {
              // Likely an executable, set permissions
              let mut permissions = path.metadata()?.permissions();
              let current_mode = permissions.mode();
              let new_mode = current_mode | 0o755; // rwxr-xr-x
              permissions.set_mode(new_mode);
              std::fs::set_permissions(&path, permissions)?;
            }
          }
        } else if path.is_dir() {
          // Recursively process subdirectories
          Box::pin(self.set_executable_permissions_recursive(&path)).await?;
        }
      }
    }
    Ok(())
  }

  #[cfg(not(unix))]
  pub async fn set_executable_permissions_recursive(
    &self,
    _dir: &Path,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    Ok(())
  }
}
