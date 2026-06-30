// MSI extraction implementation for Extractor
// Extracted from extraction_formats.rs for modularization

// Note: Path, PathBuf, Extractor are in scope via `include!` into extraction.rs

impl Extractor {
  pub async fn extract_msi(
    &self,
    msi_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Extracting MSI archive: {}", msi_path.display());
    std::fs::create_dir_all(dest_dir)?;

    // Extract MSI in a separate scope to avoid Send issues
    {
      let mut extractor = msi_extract::MsiExtractor::from_path(msi_path)?;
      extractor.to(dest_dir);
    }

    log::info!("MSI extraction completed.");
    self.flatten_single_directory_archive(dest_dir)?;
    log::info!("Searching for executable...");
    self.find_extracted_executable(dest_dir).await
  }
}
