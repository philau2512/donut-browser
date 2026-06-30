impl BrowserVersionManager {
  /// Get download information for a specific browser and version
  pub fn get_download_info(
    &self,
    browser: &str,
    version: &str,
  ) -> Result<DownloadInfo, Box<dyn std::error::Error + Send + Sync>> {
    let (os, arch) = Self::get_platform_info();

    match browser {
      "firefox" => {
        let (platform_path, filename, is_archive) = match (&os[..], &arch[..]) {
          ("windows", "x64") => ("win64", format!("Firefox Setup {version}.exe"), false),
          ("windows", "arm64") => (
            "win64-aarch64",
            format!("Firefox Setup {version}.exe"),
            false,
          ),
          ("linux", "x64") => ("linux-x86_64", format!("firefox-{version}.tar.xz"), true),
          ("linux", "arm64") => ("linux-aarch64", format!("firefox-{version}.tar.xz"), true),
          ("macos", _) => ("mac", format!("Firefox {version}.dmg"), true),
          _ => {
            return Err(
              format!("Unsupported platform/architecture for Firefox: {os}/{arch}").into(),
            )
          }
        };

        Ok(DownloadInfo {
          url: format!(
            "https://download-installer.cdn.mozilla.net/pub/firefox/releases/{version}/{platform_path}/en-US/{filename}"
          ),
          filename,
          is_archive,
        })
      }
      "firefox-developer" => {
        let (platform_path, filename, is_archive) = match (&os[..], &arch[..]) {
          ("windows", "x64") => ("win64", format!("Firefox Setup {version}.exe"), false),
          ("windows", "arm64") => (
            "win64-aarch64",
            format!("Firefox Setup {version}.exe"),
            false,
          ),
          ("linux", "x64") => ("linux-x86_64", format!("firefox-{version}.tar.xz"), true),
          ("linux", "arm64") => ("linux-aarch64", format!("firefox-{version}.tar.xz"), true),
          ("macos", _) => ("mac", format!("Firefox {version}.dmg"), true),
          _ => {
            return Err(
              format!("Unsupported platform/architecture for Firefox Developer: {os}/{arch}")
                .into(),
            )
          }
        };

        Ok(DownloadInfo {
          url: format!(
            "https://download-installer.cdn.mozilla.net/pub/devedition/releases/{version}/{platform_path}/en-US/{filename}"
          ),
          filename,
          is_archive,
        })
      }
      "zen" => {
        let (asset_name, filename, is_archive) = match (&os[..], &arch[..]) {
          ("windows", "x64") => ("zen.installer.exe", format!("zen-{version}.exe"), false),
          ("windows", "arm64") => (
            "zen.installer-arm64.exe",
            format!("zen-{version}-arm64.exe"),
            false,
          ),
          ("linux", "x64") => (
            "zen.linux-x86_64.tar.xz",
            format!("zen-{version}-x86_64.tar.xz"),
            true,
          ),
          ("linux", "arm64") => (
            "zen.linux-aarch64.tar.xz",
            format!("zen-{version}-aarch64.tar.xz"),
            true,
          ),
          ("macos", _) => (
            "zen.macos-universal.dmg",
            format!("zen-{version}.dmg"),
            true,
          ),
          _ => {
            return Err(format!("Unsupported platform/architecture for Zen: {os}/{arch}").into())
          }
        };

        Ok(DownloadInfo {
          url: format!(
            "https://github.com/zen-browser/desktop/releases/download/{version}/{asset_name}"
          ),
          filename,
          is_archive,
        })
      }
      "brave" => {
        let (filename, is_archive) = match (&os[..], &arch[..]) {
          ("windows", _) => (format!("brave-{version}.exe"), false),
          ("linux", "x64") => (format!("brave-browser-{version}-linux-amd64.zip"), true),
          ("linux", "arm64") => (format!("brave-browser-{version}-linux-arm64.zip"), true),
          ("macos", _) => ("Brave-Browser-universal.dmg".to_string(), true),
          _ => {
            return Err(format!("Unsupported platform/architecture for Brave: {os}/{arch}").into())
          }
        };

        Ok(DownloadInfo {
          url: format!(
            "https://github.com/brave/brave-browser/releases/download/{version}/{filename}"
          ),
          filename,
          is_archive,
        })
      }
      "chromium" => {
        let platform_str = match (&os[..], &arch[..]) {
          ("windows", "x64") => "Win_x64",
          ("windows", "arm64") => "Win_Arm64",
          ("linux", "x64") => "Linux_x64",
          ("linux", "arm64") => return Err("Chromium doesn't support ARM64 on Linux".into()),
          ("macos", "x64") => "Mac",
          ("macos", "arm64") => "Mac_Arm",
          _ => {
            return Err(
              format!("Unsupported platform/architecture for Chromium: {os}/{arch}").into(),
            )
          }
        };

        let (archive_name, filename) = match os.as_str() {
          "windows" => ("chrome-win.zip", format!("chromium-{version}-win.zip")),
          "linux" => ("chrome-linux.zip", format!("chromium-{version}-linux.zip")),
          "macos" => ("chrome-mac.zip", format!("chromium-{version}-mac.zip")),
          _ => return Err(format!("Unsupported platform for Chromium: {os}").into()),
        };

        Ok(DownloadInfo {
          url: format!(
            "https://commondatastorage.googleapis.com/chromium-browser-snapshots/{platform_str}/{version}/{archive_name}"
          ),
          filename,
          is_archive: true,
        })
      }
      "camoufox" => {
        // Camoufox downloads from GitHub releases with pattern: camoufox-{version}-{release}-{os}.{arch}.zip
        let (os_name, arch_name) = match (&os[..], &arch[..]) {
          ("windows", "x64") => ("win", "x86_64"),
          ("windows", "arm64") => ("win", "arm64"),
          ("linux", "x64") => ("lin", "x86_64"),
          ("linux", "arm64") => ("lin", "arm64"),
          ("macos", "x64") => ("mac", "x86_64"),
          ("macos", "arm64") => ("mac", "arm64"),
          _ => {
            return Err(
              format!("Unsupported platform/architecture for Camoufox: {os}/{arch}").into(),
            )
          }
        };

        // Note: We provide a placeholder URL here since Camoufox requires dynamic resolution
        // The actual URL will be resolved in download.rs resolve_download_url
        Ok(DownloadInfo {
          url: format!(
            "https://github.com/daijro/camoufox/releases/download/{version}/camoufox-{{version}}-{{release}}-{os_name}.{arch_name}.zip"
          ),
          filename: format!("camoufox-{version}-{os_name}.{arch_name}.zip"),
          is_archive: true,
        })
      }
      "wayfern" => {
        // Wayfern downloads from https://download.wayfern.com/
        // File naming: wayfern-{chromium_version}-{platform}-{arch}.{ext}
        // Platform/arch format: linux-x64, macos-arm64, etc.
        let platform_key = format!("{os}-{arch}");
        let (filename, is_archive) = match platform_key.as_str() {
          "macos-arm64" | "macos-x64" => (format!("wayfern-{version}-{platform_key}.dmg"), true),
          "linux-x64" | "linux-arm64" => (format!("wayfern-{version}-{platform_key}.tar.xz"), true),
          "windows-x64" | "windows-arm64" => {
            (format!("wayfern-{version}-{platform_key}.zip"), true)
          }
          _ => {
            return Err(
              format!("Unsupported platform/architecture for Wayfern: {os}/{arch}").into(),
            )
          }
        };

        // Note: The actual URL will be resolved dynamically from version.json in downloader.rs
        Ok(DownloadInfo {
          url: format!("https://download.wayfern.com/{filename}"),
          filename,
          is_archive,
        })
      }
      _ => Err(format!("Unsupported browser: {browser}").into()),
    }
  }

  /// Get platform and architecture information
  fn get_platform_info() -> (String, String) {
    let os = if cfg!(target_os = "windows") {
      "windows"
    } else if cfg!(target_os = "linux") {
      "linux"
    } else if cfg!(target_os = "macos") {
      "macos"
    } else {
      "unknown"
    };

    let arch = if cfg!(target_arch = "x86_64") {
      "x64"
    } else if cfg!(target_arch = "aarch64") {
      "arm64"
    } else {
      "unknown"
    };

    (os.to_string(), arch.to_string())
  }

  // Private helper methods for each browser type

  async fn fetch_firefox_versions(
    &self,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let releases = self.fetch_firefox_releases_detailed(no_caching).await?;
    Ok(releases.into_iter().map(|r| r.version).collect())
  }

  async fn fetch_firefox_releases_detailed(
    &self,
    no_caching: bool,
  ) -> Result<Vec<BrowserRelease>, Box<dyn std::error::Error + Send + Sync>> {
    self
      .api_client
      .fetch_firefox_releases_with_caching(no_caching)
      .await
  }

  async fn fetch_firefox_developer_versions(
    &self,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let releases = self
      .fetch_firefox_developer_releases_detailed(no_caching)
      .await?;
    Ok(releases.into_iter().map(|r| r.version).collect())
  }

  async fn fetch_firefox_developer_releases_detailed(
    &self,
    no_caching: bool,
  ) -> Result<Vec<BrowserRelease>, Box<dyn std::error::Error + Send + Sync>> {
    self
      .api_client
      .fetch_firefox_developer_releases_with_caching(no_caching)
      .await
  }

  async fn fetch_zen_versions(
    &self,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let releases = self.fetch_zen_releases_detailed(no_caching).await?;
    Ok(
      releases
        .into_iter()
        .filter(|r| r.tag_name.to_lowercase() != "twilight")
        .map(|r| r.tag_name)
        .collect(),
    )
  }

  async fn fetch_zen_releases_detailed(
    &self,
    no_caching: bool,
  ) -> Result<Vec<GithubRelease>, Box<dyn std::error::Error + Send + Sync>> {
    self
      .api_client
      .fetch_zen_releases_with_caching(no_caching)
      .await
  }

  async fn fetch_brave_versions(
    &self,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let releases = self.fetch_brave_releases_detailed(no_caching).await?;
    // Persist a lightweight versions cache with accurate prerelease info for Brave
    let converted: Vec<BrowserRelease> = releases
      .iter()
      .map(|r| BrowserRelease {
        version: r.tag_name.clone(),
        date: r.published_at.clone(),
        is_prerelease: r.is_nightly,
      })
      .collect();
    // Always save so that other callers without release_name can classify correctly
    if let Err(e) = self.api_client.save_cached_versions("brave", &converted) {
      log::error!("Failed to persist Brave versions cache: {e}");
    }

    Ok(releases.into_iter().map(|r| r.tag_name).collect())
  }

  async fn fetch_brave_releases_detailed(
    &self,
    no_caching: bool,
  ) -> Result<Vec<GithubRelease>, Box<dyn std::error::Error + Send + Sync>> {
    let releases = self
      .api_client
      .fetch_brave_releases_with_caching(no_caching)
      .await?;

    // Save a parallel versions cache for Brave with accurate prerelease flags
    let converted: Vec<BrowserRelease> = releases
      .iter()
      .map(|r| BrowserRelease {
        version: r.tag_name.clone(),
        date: r.published_at.clone(),
        is_prerelease: r.is_nightly,
      })
      .collect();
    if let Err(e) = self.api_client.save_cached_versions("brave", &converted) {
      log::error!("Failed to persist Brave versions cache: {e}");
    }

    Ok(releases)
  }

  async fn fetch_chromium_versions(
    &self,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let releases = self.fetch_chromium_releases_detailed(no_caching).await?;
    Ok(releases.into_iter().map(|r| r.version).collect())
  }

  async fn fetch_chromium_releases_detailed(
    &self,
    no_caching: bool,
  ) -> Result<Vec<BrowserRelease>, Box<dyn std::error::Error + Send + Sync>> {
    self
      .api_client
      .fetch_chromium_releases_with_caching(no_caching)
      .await
  }

  async fn fetch_camoufox_versions(
    &self,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let releases = self.fetch_camoufox_releases_detailed(no_caching).await?;
    Ok(releases.into_iter().map(|r| r.tag_name).collect())
  }

  async fn fetch_camoufox_releases_detailed(
    &self,
    no_caching: bool,
  ) -> Result<Vec<GithubRelease>, Box<dyn std::error::Error + Send + Sync>> {
    self
      .api_client
      .fetch_camoufox_releases_with_caching(no_caching)
      .await
  }

  async fn fetch_wayfern_versions(
    &self,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let version_info = self
      .api_client
      .fetch_wayfern_version_with_caching(no_caching)
      .await?;

    // Check if current platform has a download available
    if self
      .api_client
      .has_wayfern_compatible_download(&version_info)
    {
      Ok(vec![version_info.version])
    } else {
      // No compatible download for current platform
      Ok(vec![])
    }
  }
}
