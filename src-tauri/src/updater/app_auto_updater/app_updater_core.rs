use super::app_updater_types::{AppAutoUpdater, AppRelease, AppUpdateInfo};

impl AppAutoUpdater {
  pub(super) fn new() -> Self {
    Self {
      client: reqwest::Client::new(),
      extractor: crate::browser::extraction::Extractor::instance(),
    }
  }

  pub fn instance() -> &'static AppAutoUpdater {
    &super::app_updater_types::APP_AUTO_UPDATER
  }

  pub fn is_nightly_build() -> bool {
    // If STABLE_RELEASE env var is set at compile time, it's a stable build
    if option_env!("STABLE_RELEASE").is_some() {
      return false;
    }

    // Also check if the current version starts with "nightly-"
    let current_version = Self::get_current_version();
    if current_version.starts_with("nightly-") {
      return true;
    }

    // If STABLE_RELEASE is not set and version doesn't start with "nightly-",
    // it's still considered a nightly build (dev builds, main branch builds, etc.)
    true
  }

  /// Get current app version from build-time injection
  pub fn get_current_version() -> String {
    // Use build-time injected version instead of CARGO_PKG_VERSION
    env!("BUILD_VERSION").to_string()
  }

  /// Check for app updates
  pub async fn check_for_updates(
    &self,
  ) -> Result<Option<AppUpdateInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let current_version = Self::get_current_version();
    let is_nightly = Self::is_nightly_build();

    log::info!("=== App Update Check ===");
    log::info!("Current version: {current_version}");
    log::info!("Is nightly build: {is_nightly}");
    log::info!("STABLE_RELEASE env: {:?}", option_env!("STABLE_RELEASE"));

    let releases = self.fetch_app_releases().await?;
    log::info!("Fetched {} releases from GitHub", releases.len());

    // Filter releases based on build type
    let filtered_releases: Vec<&AppRelease> = if is_nightly {
      // For nightly builds, look for nightly releases
      let nightly_releases: Vec<&AppRelease> = releases
        .iter()
        .filter(|release| release.tag_name.starts_with("nightly-"))
        .collect();
      log::info!("Found {} nightly releases", nightly_releases.len());
      nightly_releases
    } else {
      // For stable builds, look for stable releases (semver format)
      let stable_releases: Vec<&AppRelease> = releases
        .iter()
        .filter(|release| release.tag_name.starts_with('v'))
        .collect();
      log::info!("Found {} stable releases", stable_releases.len());
      stable_releases
    };

    if filtered_releases.is_empty() {
      log::info!("No releases found for build type (nightly: {is_nightly})");
      return Ok(None);
    }

    // Get the latest release
    let latest_release = filtered_releases[0];
    log::info!(
      "Latest release: {} ({})",
      latest_release.tag_name,
      latest_release.name
    );

    // Check if we need to update
    if self.should_update(&current_version, &latest_release.tag_name, is_nightly) {
      log::info!("Update available!");

      // Build the release page URL
      let release_page_url = format!(
        "https://github.com/zhom/donutbrowser/releases/tag/{}",
        latest_release.tag_name
      );

      // Find the appropriate asset for current platform
      let download_url = self.get_download_url_for_platform(&latest_release.assets);

      // On Linux, when a package repo is configured, notify users to update via
      // their package manager instead of auto-downloading from GitHub.
      #[cfg(target_os = "linux")]
      {
        let repo_update = self.is_repo_configured();
        let manual_update_required = download_url.is_none() || repo_update;
        let update_info = AppUpdateInfo {
          current_version,
          new_version: latest_release.tag_name.clone(),
          release_notes: latest_release.body.clone(),
          download_url: download_url.unwrap_or_else(|| release_page_url.clone()),
          is_nightly,
          published_at: latest_release.published_at.clone(),
          manual_update_required,
          release_page_url: Some(release_page_url),
          repo_update,
        };

        log::info!(
          "Update info prepared: {} -> {} (manual_update_required: {}, repo_update: {})",
          update_info.current_version,
          update_info.new_version,
          update_info.manual_update_required,
          update_info.repo_update
        );
        return Ok(Some(update_info));
      }

      #[cfg(not(target_os = "linux"))]
      {
        if let Some(url) = download_url {
          let update_info = AppUpdateInfo {
            current_version,
            new_version: latest_release.tag_name.clone(),
            release_notes: latest_release.body.clone(),
            download_url: url,
            is_nightly,
            published_at: latest_release.published_at.clone(),
            manual_update_required: false,
            release_page_url: Some(release_page_url),
            repo_update: false,
          };

          log::info!(
            "Update info prepared: {} -> {}",
            update_info.current_version,
            update_info.new_version
          );
          return Ok(Some(update_info));
        } else {
          log::info!("No suitable download asset found for current platform");
        }
      }
    } else {
      log::info!("No update needed");
    }

    Ok(None)
  }

  /// Fetch app releases from GitHub
  pub(crate) async fn fetch_app_releases(
    &self,
  ) -> Result<Vec<AppRelease>, Box<dyn std::error::Error + Send + Sync>> {
    let url = "https://api.github.com/repos/zhom/donutbrowser/releases?per_page=100";
    let response = self
      .client
      .get(url)
      .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
      .send()
      .await?;

    if !response.status().is_success() {
      return Err(format!("GitHub API request failed: {}", response.status()).into());
    }

    let releases: Vec<AppRelease> = response.json().await?;
    Ok(releases)
  }

  /// Determine if an update should be performed
  pub(crate) fn should_update(
    &self,
    current_version: &str,
    new_version: &str,
    is_nightly: bool,
  ) -> bool {
    if current_version.starts_with("dev-") {
      return false;
    }

    log::info!(
      "Comparing versions: current={current_version}, new={new_version}, is_nightly={is_nightly}"
    );

    if is_nightly {
      // For nightly builds, always update if there's a newer nightly
      if let (Some(current_hash), Some(new_hash)) = (
        current_version.strip_prefix("nightly-"),
        new_version.strip_prefix("nightly-"),
      ) {
        // Different commit hashes mean we should update
        let should_update = new_hash != current_hash;
        log::info!("Nightly comparison: current_hash={current_hash}, new_hash={new_hash}, should_update={should_update}");
        return should_update;
      }

      // If current version doesn't have nightly prefix but we're in nightly mode,
      // this could be a dev build or stable build upgrading to nightly
      if !current_version.starts_with("nightly-") {
        log::info!("Upgrading from non-nightly to nightly: {new_version}");
        return true;
      }
    } else {
      // For stable builds, use semantic versioning comparison
      let should_update = self.is_version_newer(new_version, current_version);
      log::info!("Stable comparison: {new_version} > {current_version} = {should_update}");
      return should_update;
    }

    false
  }

  /// Compare semantic versions (returns true if version1 > version2)
  pub(crate) fn is_version_newer(&self, version1: &str, version2: &str) -> bool {
    let v1 = self.parse_semver(version1);
    let v2 = self.parse_semver(version2);
    v1 > v2
  }

  /// Parse semantic version string into comparable tuple
  pub(crate) fn parse_semver(&self, version: &str) -> (u32, u32, u32) {
    let clean_version = version.trim_start_matches('v');
    let parts: Vec<&str> = clean_version.split('.').collect();

    let major = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);

    (major, minor, patch)
  }

  /// Detect if we're running from an AppImage
  #[cfg(target_os = "linux")]
  fn is_running_from_appimage(&self) -> bool {
    // Check APPIMAGE environment variable first
    if std::env::var("APPIMAGE").is_ok() {
      return true;
    }

    // Check if current executable path looks like an AppImage
    if let Ok(exe_path) = std::env::current_exe() {
      if let Some(file_name) = exe_path.file_name().and_then(|n| n.to_str()) {
        if file_name.to_lowercase().contains("appimage") {
          return true;
        }
      }

      // Check if the executable is in a temporary mount point (typical for AppImages)
      if let Some(path_str) = exe_path.to_str() {
        if path_str.contains("/tmp/.mount_") || path_str.contains("/tmp/appimage") {
          return true;
        }
      }
    }

    false
  }

  /// Detect how the application was installed on Linux
  #[cfg(target_os = "linux")]
  fn detect_linux_installation_method(&self) -> LinuxInstallationMethod {
    // First check if we're running from an AppImage
    if self.is_running_from_appimage() {
      return LinuxInstallationMethod::AppImage;
    }

    // Get current executable path
    let exe_path = match std::env::current_exe() {
      Ok(path) => path,
      Err(_) => return LinuxInstallationMethod::Unknown,
    };

    let exe_path_str = exe_path.to_string_lossy();
    log::info!("Detecting installation method for: {exe_path_str}");

    // Check if installed via package manager by querying package databases
    if let Some(exe_name) = exe_path.file_name().and_then(|n| n.to_str()) {
      // Try to find the package that owns this file

      // Check DEB systems (dpkg)
      if let Ok(output) = Command::new("dpkg").args(["-S", &exe_path_str]).output() {
        if output.status.success() {
          let stdout = String::from_utf8_lossy(&output.stdout);
          if !stdout.trim().is_empty() && !stdout.contains("no path found") {
            log::info!("Found DEB package owning the executable");
            return LinuxInstallationMethod::Deb;
          }
        }
      }

      // Check RPM systems (rpm)
      if let Ok(output) = Command::new("rpm").args(["-qf", &exe_path_str]).output() {
        if output.status.success() {
          let stdout = String::from_utf8_lossy(&output.stdout);
          if !stdout.trim().is_empty() && !stdout.contains("not owned") {
            log::info!("Found RPM package owning the executable");
            return LinuxInstallationMethod::Rpm;
          }
        }
      }

      // Alternative RPM check with different systems
      for rpm_cmd in &["dnf", "yum", "zypper"] {
        if let Ok(output) = Command::new(rpm_cmd)
          .args(["provides", &exe_path_str])
          .output()
        {
          if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if !stdout.trim().is_empty() && stdout.contains(exe_name) {
              log::info!("Found RPM package via {rpm_cmd}");
              return LinuxInstallationMethod::Rpm;
            }
          }
        }
      }
    }

    // Check installation location to infer method
    if exe_path_str.starts_with("/usr/bin/") || exe_path_str.starts_with("/usr/local/bin/") {
      // Likely installed via package manager or system-wide installation
      log::info!("Executable in system directory, assuming package installation");

      // Try to determine which package system is available
      if Command::new("dpkg").arg("--version").output().is_ok() {
        return LinuxInstallationMethod::Deb;
      } else if Command::new("rpm").arg("--version").output().is_ok() {
        return LinuxInstallationMethod::Rpm;
      }

      return LinuxInstallationMethod::Manual;
    } else if exe_path_str.contains("/.local/") || exe_path_str.starts_with("/home/") {
      // User-local installation
      log::info!("Executable in user directory, assuming manual installation");
      return LinuxInstallationMethod::Manual;
    }

    log::info!("Could not determine installation method");
    LinuxInstallationMethod::Unknown
  }

  /// Check if the APT repository is configured
  #[cfg(target_os = "linux")]
  fn is_deb_repo_configured() -> bool {
    Path::new("/etc/apt/sources.list.d/donutbrowser.list").exists()
  }

  /// Check if an RPM repository is configured (yum/dnf or zypper)
  #[cfg(target_os = "linux")]
  fn is_rpm_repo_configured() -> bool {
    Path::new("/etc/yum.repos.d/donutbrowser.repo").exists()
      || Path::new("/etc/zypp/repos.d/donutbrowser.repo").exists()
  }

  /// Check if a system package manager repo is configured for this installation.
  #[cfg(target_os = "linux")]
  fn is_repo_configured(&self) -> bool {
    let installation_method = self.detect_linux_installation_method();
    match installation_method {
      LinuxInstallationMethod::Deb => Self::is_deb_repo_configured(),
      LinuxInstallationMethod::Rpm => Self::is_rpm_repo_configured(),
      _ => false,
    }
  }
}
