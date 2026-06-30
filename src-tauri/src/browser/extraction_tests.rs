
#[cfg(test)]
mod tests {
  use super::*;
  use std::fs::File;
  use std::io::Write;
  use tempfile::TempDir;

  #[cfg(target_os = "macos")]
  use std::fs::create_dir_all;

  #[test]
  fn test_format_detection_zip() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let zip_path = temp_dir.path().join("test.zip");

    // Create a file with ZIP magic number
    let mut file = File::create(&zip_path).unwrap();
    file.write_all(&[0x50, 0x4B, 0x03, 0x04]).unwrap(); // ZIP magic
    file.write_all(&[0; 8]).unwrap(); // padding

    let result = extractor.detect_file_format(&zip_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "zip");
  }

  #[test]
  fn test_format_detection_dmg_by_extension() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let dmg_path = temp_dir.path().join("test.dmg");

    // Create a file (magic number won't match, but extension will)
    let mut file = File::create(&dmg_path).unwrap();
    file.write_all(b"fake dmg content").unwrap();

    let result = extractor.detect_file_format(&dmg_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "dmg");
  }

  #[test]
  fn test_format_detection_exe() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let exe_path = temp_dir.path().join("test.exe");

    // Create a file with PE header
    let mut file = File::create(&exe_path).unwrap();
    file.write_all(&[0x4D, 0x5A]).unwrap(); // PE magic
    file.write_all(&[0; 10]).unwrap(); // padding

    let result = extractor.detect_file_format(&exe_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "exe");
  }

  #[test]
  fn test_format_detection_tar_gz() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let tar_gz_path = temp_dir.path().join("test.tar.gz");

    // Create a file with gzip magic
    let mut file = File::create(&tar_gz_path).unwrap();
    file.write_all(&[0x1F, 0x8B, 0x08]).unwrap(); // gzip magic
    file.write_all(&[0; 9]).unwrap(); // padding

    let result = extractor.detect_file_format(&tar_gz_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "tar.gz");
  }

  #[test]
  fn test_format_detection_tar_bz2() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let tar_bz2_path = temp_dir.path().join("test.tar.bz2");

    // Create a file with bzip2 magic
    let mut file = File::create(&tar_bz2_path).unwrap();
    file.write_all(&[0x42, 0x5A, 0x68]).unwrap(); // bzip2 magic
    file.write_all(&[0; 9]).unwrap(); // padding

    let result = extractor.detect_file_format(&tar_bz2_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "tar.bz2");
  }

  #[test]
  fn test_format_detection_tar_xz() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let tar_xz_path = temp_dir.path().join("test.tar.xz");

    // Create a file with xz magic
    let mut file = File::create(&tar_xz_path).unwrap();
    file
      .write_all(&[0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])
      .unwrap(); // xz magic
    file.write_all(&[0; 6]).unwrap(); // padding

    let result = extractor.detect_file_format(&tar_xz_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "tar.xz");
  }

  #[test]
  fn test_format_detection_msi() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let msi_path = temp_dir.path().join("test.msi");

    // Create a file with MSI magic
    let mut file = File::create(&msi_path).unwrap();
    file
      .write_all(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
      .unwrap(); // MSI magic
    file.write_all(&[0; 4]).unwrap(); // padding

    let result = extractor.detect_file_format(&msi_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "msi");
  }

  #[test]
  fn test_format_detection_msi_by_extension() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let msi_path = temp_dir.path().join("test.msi");

    // Create a file (magic number won't match, but extension will)
    let mut file = File::create(&msi_path).unwrap();
    file.write_all(b"fake msi content").unwrap();

    let result = extractor.detect_file_format(&msi_path);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "msi");
  }

  #[tokio::test]
  async fn test_extract_zip_with_test_archive() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let dest_dir = temp_dir.path().join("extracted");

    // Create a test ZIP archive in memory
    let zip_path = temp_dir.path().join("test.zip");
    {
      let file = std::fs::File::create(&zip_path).expect("Failed to create test zip file");
      let mut zip = zip::ZipWriter::new(file);

      let options =
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Stored);

      zip
        .start_file("test.txt", options)
        .expect("Failed to start zip file");
      zip
        .write_all(b"Hello, World!")
        .expect("Failed to write to zip");
      zip.finish().expect("Failed to finish zip");
    }

    let result = extractor.extract_zip(&zip_path, &dest_dir).await;

    // The result might fail because we're looking for executables, but the extraction should work
    // Let's check if the file was extracted regardless of the result
    let extracted_file = dest_dir.join("test.txt");
    assert!(extracted_file.exists(), "Extracted file should exist");

    let content = std::fs::read_to_string(&extracted_file).expect("Failed to read extracted file");
    assert_eq!(
      content.trim(),
      "Hello, World!",
      "Extracted content should match"
    );

    // If the result is an error, it should be because no executable was found, not extraction failure
    if let Err(e) = result {
      let error_msg = e.to_string();
      assert!(
        error_msg.contains("No executable found") || error_msg.contains("executable"),
        "Error should be about missing executable, not extraction failure: {error_msg}"
      );
    }
  }

  #[tokio::test]
  async fn test_extract_tar_gz_with_test_archive() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let dest_dir = temp_dir.path().join("extracted");

    // Create a test tar.gz archive in memory
    let tar_gz_path = temp_dir.path().join("test.tar.gz");
    {
      let tar_gz_file =
        std::fs::File::create(&tar_gz_path).expect("Failed to create test tar.gz file");
      let enc = flate2::write::GzEncoder::new(tar_gz_file, flate2::Compression::default());
      let mut tar = tar::Builder::new(enc);

      let mut header = tar::Header::new_gnu();
      header.set_path("test.txt").expect("Failed to set tar path");
      header.set_size(13); // "Hello, World!" length
      header.set_cksum();

      tar
        .append(&header, "Hello, World!".as_bytes())
        .expect("Failed to append to tar");
      tar.finish().expect("Failed to finish tar");
    }

    let result = extractor.extract_tar_gz(&tar_gz_path, &dest_dir).await;

    // Check if the file was extracted
    let extracted_file = dest_dir.join("test.txt");
    assert!(extracted_file.exists(), "Extracted file should exist");

    let content = std::fs::read_to_string(&extracted_file).expect("Failed to read extracted file");
    assert_eq!(
      content.trim(),
      "Hello, World!",
      "Extracted content should match"
    );

    // If the result is an error, it should be because no executable was found, not extraction failure
    if let Err(e) = result {
      let error_msg = e.to_string();
      assert!(
        error_msg.contains("No executable found")
          || error_msg.contains("executable")
          || error_msg.contains("No .app found")
          || error_msg.contains("app not found"),
        "Error should be about missing executable/app, not extraction failure: {error_msg}"
      );
    }
  }

  #[tokio::test]
  async fn test_extract_tar_bz2_with_test_archive() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let dest_dir = temp_dir.path().join("extracted");

    // Create a test tar.bz2 archive in memory
    let tar_bz2_path = temp_dir.path().join("test.tar.bz2");
    {
      let tar_bz2_file =
        std::fs::File::create(&tar_bz2_path).expect("Failed to create test tar.bz2 file");
      let enc = bzip2::write::BzEncoder::new(tar_bz2_file, bzip2::Compression::default());
      let mut tar = tar::Builder::new(enc);

      let mut header = tar::Header::new_gnu();
      header.set_path("test.txt").expect("Failed to set tar path");
      header.set_size(13); // "Hello, World!" length
      header.set_cksum();

      tar
        .append(&header, "Hello, World!".as_bytes())
        .expect("Failed to append to tar");
      tar.finish().expect("Failed to finish tar");
    }

    let result = extractor.extract_tar_bz2(&tar_bz2_path, &dest_dir).await;

    // Check if the file was extracted
    let extracted_file = dest_dir.join("test.txt");
    assert!(extracted_file.exists(), "Extracted file should exist");

    let content = std::fs::read_to_string(&extracted_file).expect("Failed to read extracted file");
    assert_eq!(
      content.trim(),
      "Hello, World!",
      "Extracted content should match"
    );

    // If the result is an error, it should be because no executable was found, not extraction failure
    if let Err(e) = result {
      let error_msg = e.to_string();
      assert!(
        error_msg.contains("No executable found")
          || error_msg.contains("executable")
          || error_msg.contains("No .app found")
          || error_msg.contains("app not found"),
        "Error should be about missing executable/app, not extraction failure: {error_msg}"
      );
    }
  }

  #[tokio::test]
  async fn test_extract_tar_xz_with_test_archive() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().expect("Failed to create temp directory");
    let dest_dir = temp_dir.path().join("extracted");

    // Create a test tar.xz archive in memory
    let tar_xz_path = temp_dir.path().join("test.tar.xz");
    {
      // First create a tar archive in memory
      let mut tar_data = Vec::new();
      {
        let mut tar = tar::Builder::new(&mut tar_data);

        let mut header = tar::Header::new_gnu();
        header.set_path("test.txt").expect("Failed to set tar path");
        header.set_size(13); // "Hello, World!" length
        header.set_cksum();

        tar
          .append(&header, "Hello, World!".as_bytes())
          .expect("Failed to append to tar");
        tar.finish().expect("Failed to finish tar");
      }

      // Then compress with xz
      let tar_xz_file =
        std::fs::File::create(&tar_xz_path).expect("Failed to create test tar.xz file");
      let mut compressed_data = Vec::new();
      lzma_rs::xz_compress(&mut std::io::Cursor::new(tar_data), &mut compressed_data)
        .expect("Failed to compress with xz");
      std::io::Write::write_all(&mut std::io::BufWriter::new(tar_xz_file), &compressed_data)
        .expect("Failed to write compressed data");
    }

    let result = extractor.extract_tar_xz(&tar_xz_path, &dest_dir).await;

    // Check if the file was extracted
    let extracted_file = dest_dir.join("test.txt");
    assert!(extracted_file.exists(), "Extracted file should exist");

    let content = std::fs::read_to_string(&extracted_file).expect("Failed to read extracted file");
    assert_eq!(
      content.trim(),
      "Hello, World!",
      "Extracted content should match"
    );

    // If the result is an error, it should be because no executable was found, not extraction failure
    if let Err(e) = result {
      let error_msg = e.to_string();
      assert!(
        error_msg.contains("No executable found")
          || error_msg.contains("executable")
          || error_msg.contains("No .app found")
          || error_msg.contains("app not found"),
        "Error should be about missing executable/app, not extraction failure: {error_msg}"
      );
    }
  }

  #[test]
  fn test_unsupported_archive_format() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();
    let fake_archive = temp_dir.path().join("test.rar");

    // Create a file with invalid header
    let mut file = File::create(&fake_archive).unwrap();
    file.write_all(b"invalid content").unwrap();

    // Test format detection
    let result = extractor.detect_file_format(&fake_archive);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "unknown");
  }

  #[cfg(target_os = "macos")]
  #[tokio::test]
  async fn test_find_app_at_root_level() {
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().unwrap();

    // Create a Firefox.app directory
    let firefox_app = temp_dir.path().join("Firefox.app");
    create_dir_all(&firefox_app).unwrap();

    // Create the standard macOS app structure
    let contents_dir = firefox_app.join("Contents");
    let macos_dir = contents_dir.join("MacOS");
    create_dir_all(&macos_dir).unwrap();

    // Create the executable
    let executable = macos_dir.join("firefox");
    File::create(&executable).unwrap();

    // Test finding the app
    let result = extractor.find_app_in_directory(temp_dir.path()).await;
    assert!(result.is_ok());

    let found_app = result.unwrap();
    assert_eq!(found_app.file_name().unwrap(), "Firefox.app");
    assert!(found_app.exists());
  }

  #[test]
  fn test_is_executable() {
    #[allow(unused_variables)]
    let extractor = Extractor::instance();
    let temp_dir = TempDir::new().expect("Failed to create temp directory");

    // Create a regular file
    let regular_file = temp_dir.path().join("regular.txt");
    File::create(&regular_file).expect("Failed to create test file");

    #[cfg(target_os = "linux")]
    {
      // Should not be executable initially
      assert!(
        !extractor.is_executable(&regular_file),
        "File should not be executable initially"
      );

      // Make it executable
      use std::os::unix::fs::PermissionsExt;
      let mut permissions = regular_file
        .metadata()
        .expect("Failed to get file metadata")
        .permissions();
      permissions.set_mode(0o755);
      std::fs::set_permissions(&regular_file, permissions).expect("Failed to set permissions");

      // Should now be executable
      assert!(
        extractor.is_executable(&regular_file),
        "File should be executable after setting permissions"
      );
    }

    #[cfg(not(target_os = "linux"))]
    {
      // On non-Linux systems, the is_executable method is not available
      // We'll just verify the file exists since executable permissions work differently on Windows/macOS
      assert!(regular_file.exists(), "Test file should exist");

      // On Unix systems (but not Linux), we can still test basic permission setting
      #[cfg(unix)]
      {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = regular_file
          .metadata()
          .expect("Failed to get file metadata")
          .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&regular_file, permissions).expect("Failed to set permissions");

        // Verify the permissions were set
        let new_permissions = regular_file
          .metadata()
          .expect("Failed to get updated metadata")
          .permissions();
        assert_eq!(
          new_permissions.mode() & 0o777,
          0o755,
          "Permissions should be set to 755"
        );
      }
    }
  }
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref EXTRACTOR: Extractor = Extractor::new();
}
