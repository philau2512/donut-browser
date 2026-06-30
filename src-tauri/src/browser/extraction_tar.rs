// Tar/Tar.gz/Tar.bz2/Tar.xz extraction implementations for Extractor
// Extracted from extraction_formats.rs for modularization

// Note: File, BufReader, Path, PathBuf, Extractor are in scope via `include!` into extraction.rs

impl Extractor {
  pub async fn extract_tar_gz(
    &self,
    tar_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Extracting tar.gz archive: {}", tar_path.display());
    std::fs::create_dir_all(dest_dir)?;

    let file = File::open(tar_path)?;
    let gz_decoder = flate2::read::GzDecoder::new(BufReader::new(file));
    let mut archive = tar::Archive::new(gz_decoder);

    archive.unpack(dest_dir)?;

    // Set executable permissions for extracted files
    self.set_executable_permissions_recursive(dest_dir).await?;

    log::info!("tar.gz extraction completed.");
    self.flatten_single_directory_archive(dest_dir)?;
    log::info!("Searching for executable...");
    self.find_extracted_executable(dest_dir).await
  }

  pub async fn extract_tar_bz2(
    &self,
    tar_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Extracting tar.bz2 archive: {}", tar_path.display());
    std::fs::create_dir_all(dest_dir)?;

    let file = File::open(tar_path)?;
    let bz2_decoder = bzip2::read::BzDecoder::new(BufReader::new(file));
    let mut archive = tar::Archive::new(bz2_decoder);

    archive.unpack(dest_dir)?;

    // Set executable permissions for extracted files
    self.set_executable_permissions_recursive(dest_dir).await?;

    log::info!("tar.bz2 extraction completed.");
    self.flatten_single_directory_archive(dest_dir)?;
    log::info!("Searching for executable...");
    self.find_extracted_executable(dest_dir).await
  }

  pub async fn extract_tar_xz(
    &self,
    tar_path: &Path,
    dest_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Extracting tar.xz archive: {}", tar_path.display());
    std::fs::create_dir_all(dest_dir)?;

    let file = File::open(tar_path)?;
    let mut buf_reader = BufReader::new(file);

    // Read the entire file into memory for lzma-rs
    let mut compressed_data = Vec::new();
    buf_reader.read_to_end(&mut compressed_data)?;

    // Decompress using lzma-rs
    let mut decompressed_data = Vec::new();
    lzma_rs::xz_decompress(
      &mut std::io::Cursor::new(compressed_data),
      &mut decompressed_data,
    )?;

    // Create tar archive from decompressed data
    let cursor = std::io::Cursor::new(decompressed_data);
    let mut archive = tar::Archive::new(cursor);

    archive.unpack(dest_dir)?;

    // Set executable permissions for extracted files
    self.set_executable_permissions_recursive(dest_dir).await?;

    log::info!("tar.xz extraction completed.");
    self.flatten_single_directory_archive(dest_dir)?;
    log::info!("Searching for executable...");
    self.find_extracted_executable(dest_dir).await
  }
}
