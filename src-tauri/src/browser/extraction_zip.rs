// Zip extraction implementation for Extractor
// Extracted from extraction_formats.rs for modularization

// Note: File, BufReader, Path, PathBuf, Extractor are in scope via `include!` into extraction.rs

impl Extractor {
  pub async fn extract_zip(
    &self,
    zip_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Extracting ZIP archive: {}", zip_path.display());
    std::fs::create_dir_all(dest_dir)?;

    let file = File::open(zip_path)
      .map_err(|e| format!("Failed to open ZIP file {}: {}", zip_path.display(), e))?;

    let mut archive = zip::ZipArchive::new(BufReader::new(file))
      .map_err(|e| format!("Failed to read ZIP archive {}: {}", zip_path.display(), e))?;

    log::info!("ZIP archive contains {} files", archive.len());

    for i in 0..archive.len() {
      let mut entry = archive
        .by_index(i)
        .map_err(|e| format!("Failed to read ZIP entry at index {i}: {e}"))?;

      // Use enclosed_name to prevent path traversal; do not modify names otherwise
      let enclosed = entry
        .enclosed_name()
        .ok_or_else(|| format!("ZIP contains an invalid entry path: {}", entry.name()))?;

      let outpath = dest_dir.join(enclosed);

      // Handle directories and files
      if entry.is_dir() {
        std::fs::create_dir_all(&outpath)
          .map_err(|e| format!("Failed to create directory {}: {}", outpath.display(), e))?;
      } else {
        if let Some(parent) = outpath.parent() {
          std::fs::create_dir_all(parent).map_err(|e| {
            format!(
              "Failed to create parent directory {}: {}",
              parent.display(),
              e
            )
          })?;
        }

        let mut outfile = File::create(&outpath)
          .map_err(|e| format!("Failed to create file {}: {}", outpath.display(), e))?;
        io::copy(&mut entry, &mut outfile)
          .map_err(|e| format!("Failed to extract file {}: {}", outpath.display(), e))?;

        // Set executable permissions on Unix-like systems based on stored mode
        #[cfg(unix)]
        {
          use std::os::unix::fs::PermissionsExt;
          if let Some(mode) = entry.unix_mode() {
            let permissions = std::fs::Permissions::from_mode(mode);
            std::fs::set_permissions(&outpath, permissions)
              .map_err(|e| format!("Failed to set permissions for {}: {}", outpath.display(), e))?;
          }
        }
      }
    }

    log::info!("ZIP extraction completed.");

    self.flatten_single_directory_archive(dest_dir)?;

    log::info!("Searching for executable...");
    self
      .find_extracted_executable(dest_dir)
      .await
      .map_err(|e| format!("Failed to find executable after ZIP extraction: {e}").into())
  }
}
