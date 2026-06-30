use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::browser::GithubRelease;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionComponent {
  pub major: u32,
  pub minor: u32,
  pub patch: u32,
  pub build: u32,
  pub pre_release: Option<PreRelease>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreRelease {
  pub kind: PreReleaseKind,
  pub number: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum PreReleaseKind {
  Alpha,
  Beta,
  RC,
  Dev,
  Pre,
}

impl VersionComponent {
  pub fn parse(version: &str) -> Self {
    let version = version.trim();
    // Normalize common tag prefixes like 'v1.2.3' -> '1.2.3'
    let version = if version.starts_with('v') || version.starts_with('V') {
      &version[1..]
    } else {
      version
    };

    // Handle special case for Zen Browser twilight releases
    if version.to_lowercase() == "twilight" {
      // Pure twilight release without base version
      return VersionComponent {
        major: 999, // High major version to indicate it's a rolling release
        minor: 0,
        patch: 0,
        build: 0,
        pre_release: Some(PreRelease {
          kind: PreReleaseKind::Alpha,
          number: Some(999), // High number to indicate it's a rolling release
        }),
      };
    }

    // Split version into numeric and pre-release parts
    let (numeric_part, pre_release_part) = Self::split_version(version);

    // Parse numeric parts (major.minor.patch)
    let parts: Vec<u32> = numeric_part
      .split('.')
      .filter_map(|part| part.parse().ok())
      .collect();

    let major = parts.first().copied().unwrap_or(0);
    let minor = parts.get(1).copied().unwrap_or(0);
    let patch = parts.get(2).copied().unwrap_or(0);
    let build = parts.get(3).copied().unwrap_or(0);

    // Parse pre-release part
    let pre_release = pre_release_part
      .as_deref()
      .and_then(Self::parse_pre_release);

    VersionComponent {
      major,
      minor,
      patch,
      build,
      pre_release,
    }
  }

  fn split_version(version: &str) -> (String, Option<String>) {
    let version = version.to_lowercase();

    // Look for pre-release indicators
    for (i, ch) in version.char_indices() {
      if ch.is_alphabetic() && i > 0 {
        // Check if this is a pre-release indicator
        let remaining = &version[i..];
        if remaining.starts_with('a')
          || remaining.starts_with('b')
          || remaining.starts_with("alpha")
          || remaining.starts_with("beta")
          || remaining.starts_with("rc")
          || remaining.starts_with("dev")
          || remaining.starts_with("pre")
        {
          return (version[..i].to_string(), Some(remaining.to_string()));
        }
      }
    }

    (version, None)
  }

  fn parse_pre_release(pre_release: &str) -> Option<PreRelease> {
    let pre_release = pre_release.trim().to_lowercase();

    if pre_release.is_empty() {
      return None;
    }

    // Extract kind and number
    let (kind, number) = if let Some(stripped) = pre_release.strip_prefix("alpha") {
      (PreReleaseKind::Alpha, Self::extract_number(stripped))
    } else if let Some(stripped) = pre_release.strip_prefix("beta") {
      (PreReleaseKind::Beta, Self::extract_number(stripped))
    } else if let Some(stripped) = pre_release.strip_prefix("rc") {
      (PreReleaseKind::RC, Self::extract_number(stripped))
    } else if let Some(stripped) = pre_release.strip_prefix("dev") {
      (PreReleaseKind::Dev, Self::extract_number(stripped))
    } else if let Some(stripped) = pre_release.strip_prefix("pre") {
      (PreReleaseKind::Pre, Self::extract_number(stripped))
    } else if let Some(stripped) = pre_release.strip_prefix('a') {
      (PreReleaseKind::Alpha, Self::extract_number(stripped))
    } else if let Some(stripped) = pre_release.strip_prefix('b') {
      (PreReleaseKind::Beta, Self::extract_number(stripped))
    } else {
      return None;
    };

    Some(PreRelease { kind, number })
  }

  fn extract_number(s: &str) -> Option<u32> {
    let numeric_part: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    numeric_part.parse().ok()
  }
}

impl PartialOrd for VersionComponent {
  fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
    Some(self.cmp(other))
  }
}

impl Ord for VersionComponent {
  fn cmp(&self, other: &Self) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    // Check for twilight versions
    let self_is_twilight = self
      .pre_release
      .as_ref()
      .map(|pr| pr.kind == PreReleaseKind::Alpha && pr.number == Some(999))
      .unwrap_or(false);
    let other_is_twilight = other
      .pre_release
      .as_ref()
      .map(|pr| pr.kind == PreReleaseKind::Alpha && pr.number == Some(999))
      .unwrap_or(false);

    // If one is twilight and the other isn't, twilight always has priority
    if self_is_twilight && !other_is_twilight {
      return Ordering::Greater; // twilight > non-twilight
    }
    if !self_is_twilight && other_is_twilight {
      return Ordering::Less; // non-twilight < twilight
    }

    // Both are twilight or both are not twilight - use normal comparison
    match (self_is_twilight, other_is_twilight) {
      (true, true) => {
        // Both are twilight, compare by base version
        return (self.major, self.minor, self.patch, self.build).cmp(&(
          other.major,
          other.minor,
          other.patch,
          other.build,
        ));
      }
      (false, false) => {
        // Neither is twilight, continue with normal comparison
      }
      _ => unreachable!(), // Already handled above
    }

    // Compare major.minor.patch.build first
    match (self.major, self.minor, self.patch, self.build).cmp(&(
      other.major,
      other.minor,
      other.patch,
      other.build,
    )) {
      Ordering::Equal => {
        // If numeric parts are equal, compare pre-release
        match (&self.pre_release, &other.pre_release) {
          (None, None) => Ordering::Equal,
          (None, Some(_)) => Ordering::Greater, // Stable > pre-release
          (Some(_), None) => Ordering::Less,    // Pre-release < stable
          (Some(a), Some(b)) => {
            // Compare pre-release kinds first
            match a.kind.cmp(&b.kind) {
              Ordering::Equal => {
                // Same kind, compare numbers
                match (&a.number, &b.number) {
                  (None, None) => Ordering::Equal,
                  (None, Some(_)) => Ordering::Less,
                  (Some(_), None) => Ordering::Greater,
                  (Some(a_num), Some(b_num)) => a_num.cmp(b_num),
                }
              }
              other => other,
            }
          }
        }
      }
      other => other,
    }
  }
}

// Helper function to sort versions properly
pub fn sort_versions(versions: &mut [String]) {
  versions.sort_by(|a, b| {
    let version_a = VersionComponent::parse(a);
    let version_b = VersionComponent::parse(b);
    version_b.cmp(&version_a) // Descending order (newest first)
  });
}

// Helper function to compare two versions
pub fn compare_versions(version1: &str, version2: &str) -> std::cmp::Ordering {
  let version_a = VersionComponent::parse(version1);
  let version_b = VersionComponent::parse(version2);
  version_a.cmp(&version_b)
}

pub fn is_version_newer(version1: &str, version2: &str) -> bool {
  // Use the proper VersionComponent comparison from api_client.rs
  let version_a = VersionComponent::parse(version1);
  let version_b = VersionComponent::parse(version2);
  version_a > version_b
}

// Helper function to sort GitHub releases
pub fn sort_github_releases(releases: &mut [GithubRelease]) {
  releases.sort_by(|a, b| {
    // Normalize tags like "v1.81.9" -> "1.81.9" for correct ordering
    let tag_a = a.tag_name.trim_start_matches('v');
    let tag_b = b.tag_name.trim_start_matches('v');
    let version_a = VersionComponent::parse(tag_a);
    let version_b = VersionComponent::parse(tag_b);
    version_b.cmp(&version_a) // Descending order (newest first)
  });
}

pub fn is_nightly_version(version: &str) -> bool {
  let version_comp = VersionComponent::parse(version);
  version_comp.pre_release.is_some()
}

/// Centralized function to determine if a browser version/release is nightly/prerelease
/// This is the single source of truth for nightly detection across the entire codebase
pub fn is_browser_version_nightly(
  browser: &str,
  version: &str,
  release_name: Option<&str>,
) -> bool {
  match browser {
    "zen" => {
      // For Zen Browser, only "twilight" is considered nightly
      version.to_lowercase() == "twilight"
    }
    "brave" => {
      // For Brave Browser, only releases whose name starts with "Release" (case-insensitive) are stable.
      if let Some(name) = release_name {
        let normalized = name.trim_start().to_ascii_lowercase();
        return !normalized.starts_with("release");
      }

      // Fallback: try cached GitHub releases
      if let Some(releases) = ApiClient::instance().get_cached_github_releases("brave") {
        if let Some(found) = releases.iter().find(|r| r.tag_name == version) {
          let normalized = found.name.trim_start().to_ascii_lowercase();
          return !normalized.starts_with("release");
        }
      }

      // Last resort: when no name available, treat as nightly (non-Release)
      true
    }
    "firefox-developer" => {
      // For Firefox Developer Edition, always treat as nightly/prerelease
      // This ensures consistent behavior regardless of cache state or API response parsing
      true
    }
    "firefox" => {
      // For Firefox, use the category from the API response to determine stability
      // This will be handled in the API parsing, so this fallback is for cached versions
      is_nightly_version(version)
    }
    "chromium" => {
      // Chromium builds are generally stable snapshots
      false
    }
    "camoufox" => {
      // For Camoufox, beta versions are actually the stable releases
      false
    }
    "wayfern" => {
      // For Wayfern, all releases from version.json are stable
      false
    }
    _ => {
      // Default fallback
      is_nightly_version(version)
    }
  }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FirefoxRelease {
  pub build_number: u32,
  pub category: String,
  pub date: String,
  pub description: Option<String>,
  pub is_security_driven: bool,
  pub product: String,
  pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FirefoxApiResponse {
  pub releases: HashMap<String, FirefoxRelease>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserRelease {
  pub version: String,
  pub date: String,
  pub is_prerelease: bool,
}

/// Wayfern version info from https://donutbrowser.com/wayfern.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WayfernVersionInfo {
  pub version: String,
  pub downloads: HashMap<String, Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CachedVersionData {
  releases: Vec<BrowserRelease>,
  timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CachedGithubData {
  releases: Vec<GithubRelease>,
  timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CachedWayfernData {
  version_info: WayfernVersionInfo,
  timestamp: u64,
}

pub struct ApiClient {
  client: Client,
  firefox_api_base: String,
  firefox_dev_api_base: String,
  github_api_base: String,
  chromium_api_base: String,
}

impl ApiClient {
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    let client = Client::builder()
      .timeout(std::time::Duration::from_secs(30))
      .build()
      .unwrap_or_else(|_| Client::new());

    Self {
      client,
      firefox_api_base: "https://product-details.mozilla.org/1.0".to_string(),
      firefox_dev_api_base: "https://product-details.mozilla.org/1.0".to_string(),
      github_api_base: "https://api.github.com".to_string(),
      chromium_api_base: "https://commondatastorage.googleapis.com/chromium-browser-snapshots"
        .to_string(),
    }
  }

  async fn fetch_github_releases_multiple_pages(
    &self,
    base_releases_url: &str,
  ) -> Result<Vec<GithubRelease>, Box<dyn std::error::Error + Send + Sync>> {
    let mut all_releases: Vec<GithubRelease> = Vec::new();

    // For now, only fetch 1 page
    for page in 1..=1 {
      let url = format!("{base_releases_url}?per_page=100&page={page}");
      let response = self
        .client
        .get(&url)
        .header(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        )
        .send()
        .await?;

      if !response.status().is_success() {
        // If the first page fails, propagate error; otherwise stop pagination
        if page == 1 {
          return Err(
            format!(
              "GitHub API returned status for page {}: {}",
              page,
              response.status()
            )
            .into(),
          );
        } else {
          break;
        }
      }

      let text = response.text().await?;
      let mut page_releases: Vec<GithubRelease> = serde_json::from_str(&text).map_err(|e| {
        log::error!("Failed to parse GitHub API response (page {page}): {e}");
        log::error!(
          "Response text (first 500 chars): {}",
          if text.len() > 500 {
            &text[..500]
          } else {
            &text
          }
        );
        format!("Failed to parse GitHub API response: {e}")
      })?;

      if page_releases.is_empty() {
        break;
      }

      all_releases.append(&mut page_releases);
    }

    Ok(all_releases)
  }

  pub fn instance() -> &'static ApiClient {
    &API_CLIENT
  }

  #[cfg(test)]
  pub fn new_with_base_urls(
    firefox_api_base: String,
    firefox_dev_api_base: String,
    github_api_base: String,
    chromium_api_base: String,
  ) -> Self {
    Self {
      client: Client::new(),
      firefox_api_base,
      firefox_dev_api_base,
      github_api_base,
      chromium_api_base,
    }
  }

  fn get_cache_dir() -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let cache_dir = crate::settings::app_dirs::cache_dir().join("version_cache");
    fs::create_dir_all(&cache_dir)?;
    Ok(cache_dir)
  }

  fn get_current_timestamp() -> u64 {
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_secs()
  }

  fn is_cache_valid(timestamp: u64) -> bool {
    let current_time = Self::get_current_timestamp();
    let cache_duration = 10 * 60; // 10 minutes in seconds
    current_time - timestamp < cache_duration
  }

  pub fn load_cached_versions(&self, browser: &str) -> Option<Vec<BrowserRelease>> {
    let cache_dir = Self::get_cache_dir().ok()?;
    let cache_file = cache_dir.join(format!("{browser}_versions.json"));

    if !cache_file.exists() {
      return None;
    }

    let content = fs::read_to_string(&cache_file).ok()?;
    if let Ok(cached) = serde_json::from_str::<CachedVersionData>(&content) {
      // Always return cached releases regardless of age - they're always valid
      log::info!("Using cached versions for {browser}");
      return Some(cached.releases);
    }

    // Backward compatibility: legacy caches stored just an array of version strings
    if let Ok(legacy_versions) = serde_json::from_str::<Vec<String>>(&content) {
      log::info!("Using legacy cached versions for {browser}; upgrading in-memory");
      let releases: Vec<BrowserRelease> = legacy_versions
        .into_iter()
        .map(|version| BrowserRelease {
          is_prerelease: is_browser_version_nightly(browser, &version, None),
          version,
          date: "".to_string(),
        })
        .collect();
      return Some(releases);
    }

    None
  }

  pub fn is_cache_expired(&self, browser: &str) -> bool {
    let cache_dir = match Self::get_cache_dir() {
      Ok(dir) => dir,
      Err(_) => return true, // If we can't get cache dir, consider expired
    };
    let cache_file = cache_dir.join(format!("{browser}_versions.json"));

    if !cache_file.exists() {
      return true; // No cache file means expired
    }

    let content = match fs::read_to_string(&cache_file) {
      Ok(content) => content,
      Err(_) => return true, // Can't read cache, consider expired
    };

    let cached_data: CachedVersionData = match serde_json::from_str(&content) {
      Ok(data) => data,
      Err(_) => return true, // Can't parse cache, consider expired
    };

    // Check if cache is older than 10 minutes
    !Self::is_cache_valid(cached_data.timestamp)
  }

  pub fn save_cached_versions(
    &self,
    browser: &str,
    releases: &[BrowserRelease],
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cache_dir = Self::get_cache_dir()?;
    let cache_file = cache_dir.join(format!("{browser}_versions.json"));

    let cached_data = CachedVersionData {
      releases: releases.to_vec(),
      timestamp: Self::get_current_timestamp(),
    };

    let content = serde_json::to_string_pretty(&cached_data)?;
    fs::write(&cache_file, content)?;
    log::info!("Cached {} versions for {}", releases.len(), browser);
    Ok(())
  }

  fn load_cached_github_releases(&self, browser: &str) -> Option<Vec<GithubRelease>> {
    let cache_dir = Self::get_cache_dir().ok()?;
    let cache_file = cache_dir.join(format!("{browser}_github.json"));

    if !cache_file.exists() {
      return None;
    }

    let content = fs::read_to_string(&cache_file).ok()?;
    let cached_data: CachedGithubData = serde_json::from_str(&content).ok()?;

    // Always use cached GitHub releases - cache never expires, only gets updated with new versions
    Some(cached_data.releases)
  }

  /// Public accessor for cached GitHub releases (used by other modules for classification)
  pub fn get_cached_github_releases(&self, browser: &str) -> Option<Vec<GithubRelease>> {
    self.load_cached_github_releases(browser)
  }

  fn save_cached_github_releases(
    &self,
    browser: &str,
    releases: &[GithubRelease],
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cache_dir = Self::get_cache_dir()?;
    let cache_file = cache_dir.join(format!("{browser}_github.json"));

    let cached_data = CachedGithubData {
      releases: releases.to_vec(),
      timestamp: Self::get_current_timestamp(),
    };

    let content = serde_json::to_string_pretty(&cached_data)?;
    fs::write(&cache_file, content)?;
    log::info!("Cached {} GitHub releases for {}", releases.len(), browser);
    Ok(())
  }
}

include!("api_client_fetch.rs");
include!("api_client_tests.rs");
