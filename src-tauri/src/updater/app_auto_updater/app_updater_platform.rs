#[cfg(target_os = "linux")]
use super::app_updater_types::LinuxInstallationMethod;
use super::app_updater_types::{AppAutoUpdater, AppReleaseAsset};

impl AppAutoUpdater {
  pub(crate) fn get_download_url_for_platform(&self, assets: &[AppReleaseAsset]) -> Option<String> {
    let arch = if cfg!(target_arch = "aarch64") {
      "aarch64"
    } else if cfg!(target_arch = "x86_64") {
      "x64"
    } else {
      "unknown"
    };

    log::info!("Looking for platform-specific asset for arch: {arch}");

    #[cfg(target_os = "linux")]
    {
      // If we're running from an AppImage, disable auto-updates for safety
      if self.is_running_from_appimage() {
        log::info!("Running from AppImage - auto-updates disabled for safety");
        return None;
      }
    }

    #[cfg(target_os = "macos")]
    {
      self.get_macos_download_url(assets, arch)
    }

    #[cfg(target_os = "windows")]
    {
      self.get_windows_download_url(assets, arch)
    }

    #[cfg(target_os = "linux")]
    {
      self.get_linux_download_url(assets, arch)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
      log::info!("Unsupported platform for auto-update");
      None
    }
  }

  #[cfg(target_os = "macos")]
  pub(crate) fn get_macos_download_url(
    &self,
    assets: &[AppReleaseAsset],
    arch: &str,
  ) -> Option<String> {
    // Look for exact architecture match in DMG
    for asset in assets {
      if asset.name.contains(".dmg")
        && (asset.name.contains(&format!("_{arch}.dmg"))
          || asset.name.contains(&format!("-{arch}.dmg"))
          || asset.name.contains(&format!("_{arch}_"))
          || asset.name.contains(&format!("-{arch}-"))
          || asset.name.contains(&format!("_{arch}-")))
      {
        log::info!("Found exact architecture match: {}", asset.name);
        return Some(asset.browser_download_url.clone());
      }
    }

    // Look for x86_64 variations if we're looking for x64
    if arch == "x64" {
      for asset in assets {
        if asset.name.contains(".dmg")
          && (asset.name.contains("x86_64") || asset.name.contains("x86-64"))
        {
          log::info!("Found x86_64 variant: {}", asset.name);
          return Some(asset.browser_download_url.clone());
        }
      }
    }

    // Look for arm64 variations if we're looking for aarch64
    if arch == "aarch64" {
      for asset in assets {
        if asset.name.contains(".dmg")
          && (asset.name.contains("arm64") || asset.name.contains("aarch64"))
        {
          log::info!("Found arm64 variant: {}", asset.name);
          return Some(asset.browser_download_url.clone());
        }
      }
    }

    // Fallback to any macOS DMG
    for asset in assets {
      if asset.name.contains(".dmg")
        && (asset.name.to_lowercase().contains("macos")
          || asset.name.to_lowercase().contains("darwin")
          || !asset.name.contains(".app.tar.gz"))
      {
        log::info!("Found fallback DMG: {}", asset.name);
        return Some(asset.browser_download_url.clone());
      }
    }

    None
  }

  #[cfg(target_os = "windows")]
  pub(crate) fn get_windows_download_url(
    &self,
    assets: &[AppReleaseAsset],
    arch: &str,
  ) -> Option<String> {
    // Priority order: MSI > EXE > ZIP
    let extensions = ["msi", "exe", "zip"];

    for ext in &extensions {
      // Look for exact architecture match
      for asset in assets {
        if asset.name.to_lowercase().ends_with(&format!(".{ext}"))
          && (asset.name.contains(&format!("_{arch}.{ext}"))
            || asset.name.contains(&format!("-{arch}.{ext}"))
            || asset.name.contains(&format!("_{arch}_"))
            || asset.name.contains(&format!("-{arch}-"))
            || asset.name.contains(&format!("_{arch}-")))
        {
          log::info!("Found Windows {ext} with exact arch match: {}", asset.name);
          return Some(asset.browser_download_url.clone());
        }
      }

      // Look for x86_64 variations if we're looking for x64
      if arch == "x64" {
        for asset in assets {
          if asset.name.to_lowercase().ends_with(&format!(".{ext}"))
            && (asset.name.contains("x86_64") || asset.name.contains("x86-64"))
          {
            log::info!("Found Windows {ext} with x86_64 variant: {}", asset.name);
            return Some(asset.browser_download_url.clone());
          }
        }
      }

      // Fallback to any Windows file of this type
      for asset in assets {
        if asset.name.to_lowercase().ends_with(&format!(".{ext}"))
          && (asset.name.to_lowercase().contains("windows")
            || asset.name.to_lowercase().contains("win32")
            || asset.name.to_lowercase().contains("win64"))
        {
          log::info!("Found Windows {ext} fallback: {}", asset.name);
          return Some(asset.browser_download_url.clone());
        }
      }
    }

    None
  }

  #[cfg(target_os = "linux")]
  pub(crate) fn get_linux_download_url(
    &self,
    assets: &[AppReleaseAsset],
    arch: &str,
  ) -> Option<String> {
    // Detect installation method to prioritize appropriate formats
    let installation_method = self.detect_linux_installation_method();
    log::info!("Detected Linux installation method: {installation_method:?}");

    // Priority order based on installation method
    let extensions = match installation_method {
      LinuxInstallationMethod::Deb => vec!["deb", "tar.gz"],
      LinuxInstallationMethod::Rpm => vec!["rpm", "tar.gz"],
      LinuxInstallationMethod::AppImage => {
        // AppImages should not auto-update for safety
        log::info!("AppImage installation detected - auto-updates disabled");
        return None;
      }
      LinuxInstallationMethod::Manual | LinuxInstallationMethod::Unknown => {
        vec!["deb", "rpm", "tar.gz"]
      }
    };

    for ext in &extensions {
      // Look for exact architecture match
      for asset in assets {
        let asset_name_lower = asset.name.to_lowercase();
        if asset_name_lower.ends_with(&format!(".{ext}"))
          && (asset.name.contains(&format!("_{arch}.{ext}"))
            || asset.name.contains(&format!("-{arch}.{ext}"))
            || asset.name.contains(&format!("_{arch}_"))
            || asset.name.contains(&format!("-{arch}-"))
            || asset.name.contains(&format!("_{arch}-")))
        {
          log::info!("Found Linux {ext} with exact arch match: {}", asset.name);
          return Some(asset.browser_download_url.clone());
        }
      }

      // Look for x86_64 variations if we're looking for x64
      if arch == "x64" {
        for asset in assets {
          let asset_name_lower = asset.name.to_lowercase();
          if asset_name_lower.ends_with(&format!(".{ext}"))
            && (asset.name.contains("x86_64")
              || asset.name.contains("x86-64")
              || asset.name.contains("amd64"))
          {
            log::info!("Found Linux {ext} with x86_64 variant: {}", asset.name);
            return Some(asset.browser_download_url.clone());
          }
        }
      }

      // Look for arm64 variations if we're looking for aarch64
      if arch == "aarch64" {
        for asset in assets {
          let asset_name_lower = asset.name.to_lowercase();
          if asset_name_lower.ends_with(&format!(".{ext}"))
            && (asset.name.contains("arm64") || asset.name.contains("aarch64"))
          {
            log::info!("Found Linux {ext} with arm64 variant: {}", asset.name);
            return Some(asset.browser_download_url.clone());
          }
        }
      }

      // Fallback to any Linux file of this type
      for asset in assets {
        let asset_name_lower = asset.name.to_lowercase();
        if asset_name_lower.ends_with(&format!(".{ext}"))
          && (asset_name_lower.contains("linux")
            || asset_name_lower.contains("ubuntu")
            || asset_name_lower.contains("debian"))
        {
          log::info!("Found Linux {ext} fallback: {}", asset.name);
          return Some(asset.browser_download_url.clone());
        }
      }
    }

    None
  }
}
