impl ApiClient {
  pub async fn fetch_firefox_releases_with_caching(
    &self,
    no_caching: bool,
  ) -> Result<Vec<BrowserRelease>, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first (unless bypassing)
    if !no_caching {
      if let Some(cached_releases) = self.load_cached_versions("firefox") {
        return Ok(cached_releases);
      }
    }

    log::info!("Fetching Firefox releases from Mozilla API...");
    let url = format!("{}/firefox.json", self.firefox_api_base);

    let response = self
      .client
      .get(url)
      .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
      .send()
      .await?;

    if !response.status().is_success() {
      return Err(format!("Failed to fetch Firefox versions: {}", response.status()).into());
    }

    let firefox_response: FirefoxApiResponse = response.json().await?;

    // Extract releases and filter for stable versions
    let mut releases: Vec<BrowserRelease> = firefox_response
      .releases
      .into_iter()
      .filter_map(|(key, release)| {
        // Only include releases that start with "firefox-" and have proper version format
        if key.starts_with("firefox-") && !release.version.is_empty() {
          let is_stable = matches!(release.category.as_str(), "major" | "stability");
          Some(BrowserRelease {
            version: release.version.clone(),
            date: release.date,
            is_prerelease: !is_stable,
          })
        } else {
          None
        }
      })
      .collect();

    // Sort by version number in descending order (newest first)
    releases.sort_by(|a, b| {
      let version_a = VersionComponent::parse(&a.version);
      let version_b = VersionComponent::parse(&b.version);
      version_b.cmp(&version_a)
    });

    // Cache the results (unless bypassing cache)
    if !no_caching {
      if let Err(e) = self.save_cached_versions("firefox", &releases) {
        log::error!("Failed to cache Firefox versions: {e}");
      }
    }

    Ok(releases)
  }

  pub async fn fetch_firefox_developer_releases_with_caching(
    &self,
    no_caching: bool,
  ) -> Result<Vec<BrowserRelease>, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first (unless bypassing)
    if !no_caching {
      if let Some(cached_releases) = self.load_cached_versions("firefox-developer") {
        return Ok(cached_releases);
      }
    }

    log::info!("Fetching Firefox Developer Edition releases from Mozilla API...");
    let url = format!("{}/devedition.json", self.firefox_dev_api_base);

    let response = self
      .client
      .get(&url)
      .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
      .send()
      .await?;

    if !response.status().is_success() {
      let error_msg = format!(
        "Failed to fetch Firefox Developer Edition versions: {} - URL: {}",
        response.status(),
        url
      );
      log::error!("{error_msg}");
      return Err(error_msg.into());
    }

    let firefox_response: FirefoxApiResponse = response.json().await?;

    // Extract releases and filter for developer edition versions
    let mut releases: Vec<BrowserRelease> = firefox_response
      .releases
      .into_iter()
      .filter_map(|(key, release)| {
        // Only include releases that start with "devedition-" and have proper version format
        if key.starts_with("devedition-") && !release.version.is_empty() {
          let is_stable = matches!(release.category.as_str(), "major" | "stability");
          Some(BrowserRelease {
            version: release.version.clone(),
            date: release.date,
            is_prerelease: !is_stable,
          })
        } else {
          None
        }
      })
      .collect();

    // Sort by version number in descending order (newest first)
    releases.sort_by(|a, b| {
      let version_a = VersionComponent::parse(&a.version);
      let version_b = VersionComponent::parse(&b.version);
      version_b.cmp(&version_a)
    });

    // Cache the results (unless bypassing cache)
    if !no_caching {
      if let Err(e) = self.save_cached_versions("firefox-developer", &releases) {
        log::error!("Failed to cache Firefox Developer versions: {e}");
      }
    }

    Ok(releases)
  }

  pub async fn fetch_zen_releases_with_caching(
    &self,
    no_caching: bool,
  ) -> Result<Vec<GithubRelease>, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first (unless bypassing)
    if !no_caching {
      if let Some(cached_releases) = self.load_cached_github_releases("zen") {
        return Ok(cached_releases);
      }
    }

    log::info!("Fetching Zen releases from GitHub API");
    let base_url = format!(
      "{}/repos/zen-browser/desktop/releases",
      self.github_api_base
    );
    let mut releases: Vec<GithubRelease> =
      self.fetch_github_releases_multiple_pages(&base_url).await?;

    // Check for twilight updates and mark alpha releases
    for release in &mut releases {
      // Use browser-specific alpha detection for Zen Browser - only "twilight" is nightly
      release.is_nightly =
        is_browser_version_nightly("zen", &release.tag_name, Some(&release.name));

      // Check for twilight update if this is a twilight release
      if release.tag_name.to_lowercase() == "twilight" {
        if let Ok(has_update) = self.check_twilight_update(release).await {
          if has_update {
            log::info!(
              "Detected update for Zen twilight release: {}",
              release.tag_name
            );
          }
        }
      }
    }

    // Sort releases using the new version sorting system
    sort_github_releases(&mut releases);

    // Cache the results (unless bypassing cache)
    if !no_caching {
      if let Err(e) = self.save_cached_github_releases("zen", &releases) {
        log::error!("Failed to cache Zen releases: {e}");
      }
    }

    Ok(releases)
  }

  pub async fn fetch_brave_releases_with_caching(
    &self,
    no_caching: bool,
  ) -> Result<Vec<GithubRelease>, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first (unless bypassing)
    if !no_caching {
      if let Some(cached_releases) = self.load_cached_github_releases("brave") {
        return Ok(cached_releases);
      }
    }

    log::info!("Fetching Brave releases from GitHub API");
    let base_url = format!(
      "{}/repos/brave/brave-browser/releases",
      self.github_api_base
    );
    let releases: Vec<GithubRelease> = self.fetch_github_releases_multiple_pages(&base_url).await?;

    // Get platform info to filter appropriate releases
    let (os, _) = Self::get_platform_info();

    // Filter releases that have assets compatible with the current platform
    let mut filtered_releases: Vec<GithubRelease> = releases
      .into_iter()
      .filter_map(|mut release| {
        // Check if this release has compatible assets for the current platform
        let has_compatible_asset = Self::has_compatible_brave_asset(&release.assets, &os);

        if has_compatible_asset {
          // Use the centralized nightly detection function
          release.is_nightly =
            is_browser_version_nightly("brave", &release.tag_name, Some(&release.name));
          Some(release)
        } else {
          None
        }
      })
      .collect();

    // Sort releases using the new version sorting system
    sort_github_releases(&mut filtered_releases);

    if let Err(e) = self.save_cached_github_releases("brave", &filtered_releases) {
      log::error!("Failed to cache Brave releases: {e}");
    }

    Ok(filtered_releases)
  }

  /// Check if a Camoufox release has compatible assets for the given platform and architecture
  fn has_compatible_camoufox_asset(
    &self,
    assets: &[crate::browser::GithubAsset],
    os: &str,
    arch: &str,
  ) -> bool {
    let (os_name, arch_name) = match (os, arch) {
      ("windows", "x64") => ("win", "x86_64"),
      ("windows", "arm64") => ("win", "arm64"),
      ("linux", "x64") => ("lin", "x86_64"),
      ("linux", "arm64") => ("lin", "arm64"),
      ("macos", "x64") => ("mac", "x86_64"),
      ("macos", "arm64") => ("mac", "arm64"),
      _ => return false,
    };

    // Look for assets matching the pattern: camoufox-{version}-beta.{number}-{os}.{arch}.zip
    // The separator before OS is a dash, e.g., camoufox-135.0.1-beta.24-lin.x86_64.zip
    let pattern = format!("-{os_name}.{arch_name}.zip");
    assets.iter().any(|asset| {
      let name = asset.name.to_lowercase();
      name.starts_with("camoufox-") && name.ends_with(&pattern)
    })
  }

  fn has_compatible_brave_asset(assets: &[crate::browser::GithubAsset], os: &str) -> bool {
    match os {
      "windows" => {
        // For Windows, look for standalone setup EXE (not the auto-updater one)
        assets.iter().any(|asset| {
          let name = asset.name.to_lowercase();
          name.contains("standalone") && name.ends_with(".exe") && !name.contains("silent")
        }) || assets.iter().any(|asset| asset.name.ends_with(".exe"))
      }
      "macos" => {
        // For macOS, prefer universal DMG
        assets.iter().any(|asset| {
          let name = asset.name.to_lowercase();
          name.contains("universal") && name.ends_with(".dmg")
        }) || assets.iter().any(|asset| asset.name.ends_with(".dmg"))
      }
      "linux" => {
        if assets.iter().any(|asset| {
          let name = asset.name.to_lowercase();
          name.contains("lin")
        }) {
          return true;
        }

        false
      }
      _ => false,
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

  pub async fn fetch_chromium_latest_version(
    &self,
  ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Use platform-aware URL for Chromium to match download URL generation
    let (os, arch) = Self::get_platform_info();
    let platform_str = match (&os[..], &arch[..]) {
      ("windows", "x64") => "Win_x64",
      ("windows", "arm64") => "Win_Arm64",
      ("linux", "x64") => "Linux_x64",
      ("linux", "arm64") => return Err("Chromium doesn't support ARM64 on Linux".into()),
      ("macos", "x64") => "Mac",
      ("macos", "arm64") => "Mac_Arm",
      _ => {
        return Err(format!("Unsupported platform/architecture for Chromium: {os}/{arch}").into())
      }
    };
    let url = format!("{}/{platform_str}/LAST_CHANGE", self.chromium_api_base);
    let version = self
      .client
      .get(&url)
      .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
      .send()
      .await?
      .text()
      .await?
      .trim()
      .to_string();

    Ok(version)
  }

  pub async fn fetch_chromium_releases_with_caching(
    &self,
    no_caching: bool,
  ) -> Result<Vec<BrowserRelease>, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first (unless bypassing)
    if !no_caching {
      if let Some(cached_releases) = self.load_cached_versions("chromium") {
        return Ok(cached_releases);
      }
    }

    log::info!("Fetching Chromium releases...");

    // Get the latest version first
    let latest_version = self.fetch_chromium_latest_version().await?;
    let latest_num: u32 = latest_version.parse().unwrap_or(0);

    // Generate a list of recent versions (last 20 builds, going back by 1000 each time)
    let mut versions = Vec::new();
    for i in 0..20 {
      let version_num = latest_num.saturating_sub(i * 1000);
      if version_num > 0 {
        versions.push(version_num.to_string());
      }
    }

    // Convert to BrowserRelease objects
    let releases: Vec<BrowserRelease> = versions
      .into_iter()
      .map(|version| BrowserRelease {
        version: version.clone(),
        date: "".to_string(),
        is_prerelease: false,
      })
      .collect();

    // Cache the results (unless bypassing cache)
    if !no_caching {
      if let Err(e) = self.save_cached_versions("chromium", &releases) {
        log::error!("Failed to cache Chromium versions: {e}");
      }
    }

    Ok(releases)
  }

  pub async fn fetch_camoufox_releases_with_caching(
    &self,
    no_caching: bool,
  ) -> Result<Vec<GithubRelease>, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first (unless bypassing)
    if !no_caching {
      if let Some(cached_releases) = self.load_cached_github_releases("camoufox") {
        log::info!(
          "Using cached Camoufox releases, count: {}",
          cached_releases.len()
        );
        return Ok(cached_releases);
      }
    }

    log::info!("Fetching Camoufox releases from GitHub API");
    let base_url = format!("{}/repos/daijro/camoufox/releases", self.github_api_base);
    let releases: Vec<GithubRelease> = self.fetch_github_releases_multiple_pages(&base_url).await?;

    log::info!(
      "Fetched {} total Camoufox releases from GitHub",
      releases.len()
    );

    // Get platform info to filter appropriate releases
    let (os, arch) = Self::get_platform_info();
    log::info!("Filtering for platform: {os}/{arch}");

    // Filter releases that have assets compatible with the current platform
    let mut compatible_releases: Vec<GithubRelease> = releases
      .into_iter()
      .enumerate()
      .filter_map(|(i, release)| {
        let has_compatible = self.has_compatible_camoufox_asset(&release.assets, &os, &arch);
        if !has_compatible {
          log::info!(
            "Release {} ({}) has no compatible assets for {}/{}",
            i,
            release.tag_name,
            os,
            arch
          );
          log::info!(
            "  Available assets: {:?}",
            release.assets.iter().map(|a| &a.name).collect::<Vec<_>>()
          );
        }
        if has_compatible {
          Some(release)
        } else {
          None
        }
      })
      .collect();

    log::info!(
      "After platform filtering: {} compatible releases",
      compatible_releases.len()
    );

    // Sort by version (latest first) with debugging
    log::info!(
      "Before sorting: {:?}",
      compatible_releases
        .iter()
        .map(|r| &r.tag_name)
        .take(10)
        .collect::<Vec<_>>()
    );
    sort_github_releases(&mut compatible_releases);
    log::info!(
      "After sorting: {:?}",
      compatible_releases
        .iter()
        .map(|r| &r.tag_name)
        .take(10)
        .collect::<Vec<_>>()
    );

    // Cache the results (unless bypassing cache)
    if !no_caching {
      if let Err(e) = self.save_cached_github_releases("camoufox", &compatible_releases) {
        log::error!("Failed to cache Camoufox releases: {e}");
      } else {
        log::info!("Cached {} Camoufox releases", compatible_releases.len());
      }
    }

    Ok(compatible_releases)
  }

  fn load_cached_wayfern_version(&self) -> Option<WayfernVersionInfo> {
    let cache_dir = Self::get_cache_dir().ok()?;
    let cache_file = cache_dir.join("wayfern_version.json");

    if !cache_file.exists() {
      return None;
    }

    let content = fs::read_to_string(&cache_file).ok()?;
    let cached_data: CachedWayfernData = serde_json::from_str(&content).ok()?;

    // Always use cached Wayfern version - cache never expires, only gets updated
    Some(cached_data.version_info)
  }

  fn save_cached_wayfern_version(
    &self,
    version_info: &WayfernVersionInfo,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cache_dir = Self::get_cache_dir()?;
    let cache_file = cache_dir.join("wayfern_version.json");

    let cached_data = CachedWayfernData {
      version_info: version_info.clone(),
      timestamp: Self::get_current_timestamp(),
    };

    let content = serde_json::to_string_pretty(&cached_data)?;
    fs::write(&cache_file, content)?;
    log::info!("Cached Wayfern version: {}", version_info.version);
    Ok(())
  }

  /// Fetch Wayfern version info from https://donutbrowser.com/wayfern.json
  pub async fn fetch_wayfern_version_with_caching(
    &self,
    no_caching: bool,
  ) -> Result<WayfernVersionInfo, Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first (unless bypassing)
    if !no_caching {
      if let Some(cached_version) = self.load_cached_wayfern_version() {
        log::info!("Using cached Wayfern version: {}", cached_version.version);
        return Ok(cached_version);
      }
    }

    log::info!("Fetching Wayfern version from https://donutbrowser.com/wayfern.json");
    let url = "https://donutbrowser.com/wayfern.json";

    let mut last_err = None;
    let mut version_info: Option<WayfernVersionInfo> = None;

    for attempt in 1..=3 {
      match self
        .client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
        .send()
        .await
      {
        Ok(response) => {
          if !response.status().is_success() {
            last_err = Some(format!("HTTP {}", response.status()));
          } else {
            match response.json::<WayfernVersionInfo>().await {
              Ok(info) => {
                version_info = Some(info);
                break;
              }
              Err(e) => last_err = Some(format!("Failed to parse response: {e}")),
            }
          }
        }
        Err(e) => {
          log::warn!("Wayfern fetch attempt {attempt}/3 failed: {e}");
          last_err = Some(e.to_string());
        }
      }

      if attempt < 3 {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
      }
    }

    let version_info = version_info.ok_or_else(|| {
      format!(
        "Failed to fetch Wayfern version after 3 attempts: {}",
        last_err.unwrap_or_default()
      )
    })?;
    log::info!("Fetched Wayfern version: {}", version_info.version);

    // Cache the results (unless bypassing cache)
    if !no_caching {
      if let Err(e) = self.save_cached_wayfern_version(&version_info) {
        log::error!("Failed to cache Wayfern version: {e}");
      }
    }

    Ok(version_info)
  }

  /// Get the download URL for Wayfern based on current platform
  pub fn get_wayfern_download_url(&self, version_info: &WayfernVersionInfo) -> Option<String> {
    let (os, arch) = Self::get_platform_info();
    let platform_key = format!("{os}-{arch}");

    version_info
      .downloads
      .get(&platform_key)
      .and_then(|url| url.clone())
  }

  /// Check if Wayfern has a compatible download for current platform
  pub fn has_wayfern_compatible_download(&self, version_info: &WayfernVersionInfo) -> bool {
    self.get_wayfern_download_url(version_info).is_some()
  }

  /// Check if a Zen twilight release has been updated by comparing file size
  pub async fn check_twilight_update(
    &self,
    release: &GithubRelease,
  ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    if release.tag_name.to_lowercase() != "twilight" {
      return Ok(false); // Not a twilight release
    }

    // Find the macOS universal DMG asset
    let asset = release
      .assets
      .iter()
      .find(|asset| asset.name == "zen.macos-universal.dmg")
      .ok_or("No macOS universal asset found for twilight release")?;

    // Check if we have cached file size information
    let cache_dir = Self::get_cache_dir()?;
    let twilight_cache_file = cache_dir.join("zen_twilight_info.json");

    #[derive(serde::Serialize, serde::Deserialize)]
    struct TwilightInfo {
      file_size: u64,
      last_updated: u64,
    }

    let current_info = TwilightInfo {
      file_size: asset.size,
      last_updated: Self::get_current_timestamp(),
    };

    if !twilight_cache_file.exists() {
      // No cache exists, save current info and return true (new)
      let content = serde_json::to_string_pretty(&current_info)?;
      fs::write(&twilight_cache_file, content)?;
      return Ok(true);
    }

    let cached_content = fs::read_to_string(&twilight_cache_file)?;
    let cached_info: TwilightInfo = serde_json::from_str(&cached_content)?;

    // Check if file size has changed
    if cached_info.file_size != current_info.file_size {
      // File size changed, update cache and return true
      let content = serde_json::to_string_pretty(&current_info)?;
      fs::write(&twilight_cache_file, content)?;
      log::info!(
        "Zen twilight release updated: file size changed from {} to {}",
        cached_info.file_size,
        current_info.file_size
      );
      return Ok(true);
    }

    Ok(false) // No update detected
  }

  pub fn clear_all_cache(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cache_dir = Self::get_cache_dir()?;

    if cache_dir.exists() {
      // Remove all cache files
      for entry in fs::read_dir(&cache_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
          fs::remove_file(&path)?;
          log::info!("Removed cache file: {path:?}");
        }
      }
      log::info!("All version cache cleared successfully");
    }

    Ok(())
  }
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref API_CLIENT: ApiClient = ApiClient::new();
}
