use crate::api::api_client::{sort_versions, ApiClient, BrowserRelease};
use crate::browser::GithubRelease;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserVersionInfo {
  pub version: String,
  pub is_prerelease: bool,
  pub date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserVersionsResult {
  pub versions: Vec<String>,
  pub new_versions_count: Option<usize>,
  pub total_versions_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserReleaseTypes {
  pub stable: Option<String>,
  pub nightly: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadInfo {
  pub url: String,
  pub filename: String,
  pub is_archive: bool, // true for .dmg, .zip, etc.
}

pub struct BrowserVersionManager {
  api_client: &'static ApiClient,
}

impl BrowserVersionManager {
  fn new() -> Self {
    Self {
      api_client: ApiClient::instance(),
    }
  }

  pub fn instance() -> &'static BrowserVersionManager {
    &BROWSER_VERSION_SERVICE
  }

  /// Check if a browser is supported on the current platform and architecture
  pub fn is_browser_supported(
    &self,
    browser: &str,
  ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let (os, arch) = Self::get_platform_info();

    match browser {
      "firefox" | "firefox-developer" => Ok(true),
      "zen" => {
        // Zen supports all platforms and architectures
        Ok(true)
      }
      "brave" => {
        // Brave supports all platforms and architectures
        Ok(true)
      }
      "chromium" => {
        // Chromium doesn't support ARM64 on Linux
        if arch == "arm64" && os == "linux" {
          Ok(false)
        } else {
          Ok(true)
        }
      }
      "camoufox" => {
        // Camoufox supports all platforms and architectures according to the JS code
        Ok(true)
      }
      "wayfern" => {
        // Wayfern support depends on version.json downloads availability
        // Currently supports macos-arm64 and linux-x64
        let platform_key = format!("{os}-{arch}");
        // Check dynamically, but allow the browser to appear even if platform not available yet
        // The actual download will fail gracefully if not supported
        Ok(matches!(
          platform_key.as_str(),
          "macos-arm64"
            | "linux-x64"
            | "macos-x64"
            | "linux-arm64"
            | "windows-x64"
            | "windows-arm64"
        ))
      }
      _ => Err(format!("Unknown browser: {browser}").into()),
    }
  }

  /// Get list of browsers supported on the current platform
  pub fn get_supported_browsers(&self) -> Vec<String> {
    let all_browsers = vec![
      "firefox",
      "firefox-developer",
      "zen",
      "brave",
      "chromium",
      "camoufox",
      "wayfern",
    ];

    all_browsers
      .into_iter()
      .filter(|browser| self.is_browser_supported(browser).unwrap_or(false))
      .map(|s| s.to_string())
      .collect()
  }

  /// Get cached browser versions immediately (returns None if no cache exists)
  pub fn get_cached_browser_versions(&self, browser: &str) -> Option<Vec<String>> {
    if browser == "brave" {
      return self
        .api_client
        .get_cached_github_releases("brave")
        .map(|releases| releases.into_iter().map(|r| r.tag_name).collect());
    }

    self
      .api_client
      .load_cached_versions(browser)
      .map(|releases| releases.into_iter().map(|r| r.version).collect())
  }

  /// Get cached detailed browser version information immediately
  pub fn get_cached_browser_versions_detailed(
    &self,
    browser: &str,
  ) -> Option<Vec<BrowserVersionInfo>> {
    if browser == "brave" {
      if let Some(releases) = self.api_client.get_cached_github_releases("brave") {
        let detailed_info: Vec<BrowserVersionInfo> = releases
          .into_iter()
          .map(|r| BrowserVersionInfo {
            version: r.tag_name,
            is_prerelease: r.is_nightly,
            date: r.published_at,
          })
          .collect();
        return Some(detailed_info);
      }
    }

    let cached_releases = self.api_client.load_cached_versions(browser)?;

    // Convert cached versions to detailed info (without dates since cache doesn't store them)
    let detailed_info: Vec<BrowserVersionInfo> = cached_releases
      .into_iter()
      .map(|r| BrowserVersionInfo {
        version: r.version,
        is_prerelease: r.is_prerelease,
        date: r.date,
      })
      .collect();

    Some(detailed_info)
  }

  /// Check if cache should be updated (expired or doesn't exist)
  pub fn should_update_cache(&self, browser: &str) -> bool {
    self.api_client.is_cache_expired(browser)
  }

  /// Get latest stable and nightly versions for a browser (cached first)
  pub async fn get_browser_release_types(
    &self,
    browser: &str,
  ) -> Result<BrowserReleaseTypes, Box<dyn std::error::Error + Send + Sync>> {
    // Try to get from cache first
    if let Some(cached_versions) = self.get_cached_browser_versions_detailed(browser) {
      let latest_stable = cached_versions
        .iter()
        .find(|v| !v.is_prerelease)
        .map(|v| v.version.clone());

      let latest_nightly = cached_versions
        .iter()
        .find(|v| v.is_prerelease)
        .map(|v| v.version.clone());

      return Ok(BrowserReleaseTypes {
        stable: latest_stable,
        nightly: latest_nightly,
      });
    }

    let detailed_versions = self.fetch_browser_versions_detailed(browser, false).await?;

    let latest_stable = detailed_versions
      .iter()
      .find(|v| !v.is_prerelease)
      .map(|v| v.version.clone());

    let latest_nightly = detailed_versions
      .iter()
      .find(|v| v.is_prerelease)
      .map(|v| v.version.clone());

    Ok(BrowserReleaseTypes {
      stable: latest_stable,
      nightly: latest_nightly,
    })
  }

  /// Fetch browser versions with optional caching
  pub async fn fetch_browser_versions(
    &self,
    browser: &str,
    no_caching: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let result = self
      .fetch_browser_versions_with_count(browser, no_caching)
      .await?;
    Ok(result.versions)
  }

  /// Fetch browser versions with new count information and optional caching
  pub async fn fetch_browser_versions_with_count(
    &self,
    browser: &str,
    no_caching: bool,
  ) -> Result<BrowserVersionsResult, Box<dyn std::error::Error + Send + Sync>> {
    // Get existing cached versions to compare and merge
    let existing_versions = self
      .api_client
      .load_cached_versions(browser)
      .unwrap_or_default();
    let existing_set: HashSet<String> = existing_versions.into_iter().map(|r| r.version).collect();

    // Fetch fresh versions from API
    let fresh_versions = match browser {
      "firefox" => self.fetch_firefox_versions(true).await?, // Always fetch fresh for merging
      "firefox-developer" => self.fetch_firefox_developer_versions(true).await?,
      "zen" => self.fetch_zen_versions(true).await?,
      "brave" => self.fetch_brave_versions(true).await?,
      "chromium" => self.fetch_chromium_versions(true).await?,
      "camoufox" => self.fetch_camoufox_versions(true).await?,
      "wayfern" => self.fetch_wayfern_versions(true).await?,
      _ => return Err(format!("Unsupported browser: {browser}").into()),
    };

    let fresh_set: HashSet<String> = fresh_versions.into_iter().collect();

    // Find new versions (in fresh but not in existing cache)
    let new_versions: Vec<String> = fresh_set.difference(&existing_set).cloned().collect();
    let new_versions_count = if existing_set.is_empty() {
      None
    } else {
      Some(new_versions.len())
    };

    // Merge existing and fresh versions
    let mut merged_versions: Vec<String> = existing_set.union(&fresh_set).cloned().collect();

    // Sort versions using the existing sorting logic
    crate::api::api_client::sort_versions(&mut merged_versions);

    // Save the merged cache (unless explicitly bypassing cache)
    if !no_caching && browser != "brave" {
      let merged_releases: Vec<BrowserRelease> = merged_versions
        .iter()
        .map(|v| BrowserRelease {
          version: v.clone(),
          date: "".to_string(),
          is_prerelease: crate::api::api_client::is_browser_version_nightly(browser, v, None),
        })
        .collect();
      if let Err(e) = self
        .api_client
        .save_cached_versions(browser, &merged_releases)
      {
        log::error!("Failed to save merged cache for {browser}: {e}");
      }
    }

    let total_versions_count = merged_versions.len();

    Ok(BrowserVersionsResult {
      versions: merged_versions,
      new_versions_count,
      total_versions_count,
    })
  }

  /// Fetch detailed browser version information with optional caching
  pub async fn fetch_browser_versions_detailed(
    &self,
    browser: &str,
    no_caching: bool,
  ) -> Result<Vec<BrowserVersionInfo>, Box<dyn std::error::Error + Send + Sync>> {
    // For detailed versions, we'll use the merged versions from fetch_browser_versions_with_count
    // to ensure consistency with the version list
    let versions_result = self
      .fetch_browser_versions_with_count(browser, no_caching)
      .await?;
    let merged_versions = versions_result.versions;

    // Convert the version strings to BrowserVersionInfo
    // Since we don't have detailed date/prerelease info for cached versions,
    // we'll fetch fresh detailed info and map it to our merged versions
    let detailed_info: Vec<BrowserVersionInfo> = match browser {
      "firefox" => {
        let releases = self.fetch_firefox_releases_detailed(true).await?;
        merged_versions
          .into_iter()
          .map(|version| {
            // Try to find matching release info, otherwise create basic info
            if let Some(release) = releases.iter().find(|r| r.version == version) {
              BrowserVersionInfo {
                version: release.version.clone(),
                is_prerelease: release.is_prerelease,
                date: release.date.clone(),
              }
            } else {
              BrowserVersionInfo {
                version: version.clone(),
                is_prerelease: crate::api::api_client::is_browser_version_nightly(
                  "firefox", &version, None,
                ),
                date: "".to_string(),
              }
            }
          })
          .collect()
      }
      "firefox-developer" => {
        let releases = self.fetch_firefox_developer_releases_detailed(true).await?;
        merged_versions
          .into_iter()
          .map(|version| {
            if let Some(release) = releases.iter().find(|r| r.version == version) {
              BrowserVersionInfo {
                version: release.version.clone(),
                is_prerelease: release.is_prerelease,
                date: release.date.clone(),
              }
            } else {
              BrowserVersionInfo {
                version: version.clone(),
                is_prerelease: crate::api::api_client::is_browser_version_nightly(
                  "firefox-developer",
                  &version,
                  None,
                ),
                date: "".to_string(),
              }
            }
          })
          .collect()
      }
      "zen" => {
        let releases = self.fetch_zen_releases_detailed(true).await?;
        merged_versions
          .into_iter()
          // Filter out twilight releases at the detailed level too
          .filter(|version| version.to_lowercase() != "twilight")
          .map(|version| {
            if let Some(release) = releases.iter().find(|r| r.tag_name == version) {
              BrowserVersionInfo {
                version: release.tag_name.clone(),
                is_prerelease: release.is_nightly,
                date: release.published_at.clone(),
              }
            } else {
              BrowserVersionInfo {
                version: version.clone(),
                is_prerelease: crate::api::api_client::is_browser_version_nightly(
                  "zen", &version, None,
                ),
                date: "".to_string(),
              }
            }
          })
          .collect()
      }
      "brave" => {
        let releases = self.fetch_brave_releases_detailed(true).await?;
        merged_versions
          .into_iter()
          .map(|version| {
            if let Some(release) = releases.iter().find(|r| r.tag_name == version) {
              BrowserVersionInfo {
                version: release.tag_name.clone(),
                is_prerelease: release.is_nightly,
                date: release.published_at.clone(),
              }
            } else {
              BrowserVersionInfo {
                version: version.clone(),
                is_prerelease: crate::api::api_client::is_browser_version_nightly(
                  "brave", &version, None,
                ),
                date: "".to_string(),
              }
            }
          })
          .collect()
      }
      "chromium" => {
        let releases = self.fetch_chromium_releases_detailed(true).await?;
        merged_versions
          .into_iter()
          .map(|version| {
            if let Some(release) = releases.iter().find(|r| r.version == version) {
              BrowserVersionInfo {
                version: release.version.clone(),
                is_prerelease: release.is_prerelease,
                date: release.date.clone(),
              }
            } else {
              BrowserVersionInfo {
                version: version.clone(),
                is_prerelease: false, // Chromium usually stable releases
                date: "".to_string(),
              }
            }
          })
          .collect()
      }
      "camoufox" => {
        let releases = self.fetch_camoufox_releases_detailed(true).await?;
        merged_versions
          .into_iter()
          .map(|version| {
            if let Some(release) = releases.iter().find(|r| r.tag_name == version) {
              BrowserVersionInfo {
                version: release.tag_name.clone(),
                is_prerelease: release.is_nightly,
                date: release.published_at.clone(),
              }
            } else {
              BrowserVersionInfo {
                version: version.clone(),
                is_prerelease: false, // Camoufox usually stable releases
                date: "".to_string(),
              }
            }
          })
          .collect()
      }
      "wayfern" => {
        // Wayfern only has one version from version.json
        merged_versions
          .into_iter()
          .map(|version| BrowserVersionInfo {
            version: version.clone(),
            is_prerelease: false, // Wayfern releases are always stable
            date: "".to_string(),
          })
          .collect()
      }
      _ => {
        return Err(format!("Unsupported browser: {browser}").into());
      }
    };

    Ok(detailed_info)
  }

  /// Update browser versions incrementally (for background updates)
  pub async fn update_browser_versions_incrementally(
    &self,
    browser: &str,
  ) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    // Get existing cached versions
    let existing_versions = self
      .api_client
      .load_cached_versions(browser)
      .unwrap_or_default();
    let existing_set: HashSet<String> = existing_versions.into_iter().map(|r| r.version).collect();

    // Fetch new versions (always bypass cache for background updates)
    let new_versions = self.fetch_browser_versions(browser, true).await?;
    let new_set: HashSet<String> = new_versions.into_iter().collect();

    // Find truly new versions (not in existing cache)
    let really_new_versions: Vec<String> = new_set.difference(&existing_set).cloned().collect();
    let new_versions_count = really_new_versions.len();

    // Merge existing and new versions
    let mut all_versions: Vec<String> = existing_set.union(&new_set).cloned().collect();

    // Sort versions using the existing sorting logic
    sort_versions(&mut all_versions);

    // Save the updated cache
    let releases: Vec<BrowserRelease> = all_versions
      .iter()
      .map(|v| BrowserRelease {
        version: v.clone(),
        date: "".to_string(),
        is_prerelease: crate::api::api_client::is_browser_version_nightly(browser, v, None),
      })
      .collect();
    if let Err(e) = self.api_client.save_cached_versions(browser, &releases) {
      log::error!("Failed to save updated cache for {browser}: {e}");
    }

    Ok(new_versions_count)
  }
}

include!("browser_version_manager_download.rs");
include!("browser_version_manager_tests.rs");
