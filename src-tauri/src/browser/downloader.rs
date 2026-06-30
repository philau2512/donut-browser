use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::api::api_client::ApiClient;
use crate::browser::browser_version_manager::DownloadInfo;
use crate::browser::{create_browser, BrowserType};
use crate::events;

// Maximum time to wait for the next chunk of a streaming download before treating
// the connection as stalled. Converts an indefinite hang into a terminal error so
// the UI can surface it and the caller can move on / retry.
const STREAM_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

// Global state to track currently downloading browser-version pairs
lazy_static::lazy_static! {
  static ref DOWNLOADING_BROWSERS: std::sync::Arc<Mutex<std::collections::HashSet<String>>> =
    std::sync::Arc::new(Mutex::new(std::collections::HashSet::new()));
  static ref DOWNLOAD_CANCELLATION_TOKENS: std::sync::Arc<Mutex<std::collections::HashMap<String, CancellationToken>>> =
    std::sync::Arc::new(Mutex::new(std::collections::HashMap::new()));
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
  pub browser: String,
  pub version: String,
  pub downloaded_bytes: u64,
  pub total_bytes: Option<u64>,
  pub percentage: f64,
  pub speed_bytes_per_sec: f64,
  pub eta_seconds: Option<f64>,
  pub stage: String, // "downloading", "extracting", "verifying"
}

pub struct Downloader {
  client: Client,
  api_client: &'static ApiClient,
  registry: &'static crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry,
  version_service: &'static crate::browser::browser_version_manager::BrowserVersionManager,
  extractor: &'static crate::browser::extraction::Extractor,
  geoip_downloader: &'static crate::updater::geoip_downloader::GeoIPDownloader,
}

impl Downloader {
  fn new() -> Self {
    Self {
      client: Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        // Per-read idle timeout: if the connection stalls mid-stream with no bytes
        // for this long, the read fails instead of hanging forever. This is the
        // transport-level guard; the streaming loop also wraps each read in an
        // explicit tokio timeout as defense-in-depth.
        .read_timeout(STREAM_IDLE_TIMEOUT)
        .build()
        .unwrap_or_else(|_| Client::new()),
      api_client: ApiClient::instance(),
      registry: crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance(
      ),
      version_service: crate::browser::browser_version_manager::BrowserVersionManager::instance(),
      extractor: crate::browser::extraction::Extractor::instance(),
      geoip_downloader: crate::updater::geoip_downloader::GeoIPDownloader::instance(),
    }
  }

  pub fn instance() -> &'static Downloader {
    &DOWNLOADER
  }

  #[cfg(test)]
  pub fn new_for_test() -> Self {
    Self {
      client: Client::new(),
      api_client: ApiClient::instance(),
      registry: crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance(
      ),
      version_service: crate::browser::browser_version_manager::BrowserVersionManager::instance(),
      extractor: crate::browser::extraction::Extractor::instance(),
      geoip_downloader: crate::updater::geoip_downloader::GeoIPDownloader::instance(),
    }
  }

  #[cfg(test)]
  pub async fn download_file(
    &self,
    download_url: &str,
    dest_path: &Path,
    filename: &str,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let file_path = dest_path.join(filename);

    let response = self
      .client
      .get(download_url)
      .header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      )
      .send()
      .await?;

    if !response.status().is_success() {
      return Err(format!("Download failed with status: {}", response.status()).into());
    }

    let mut file = std::fs::OpenOptions::new()
      .create(true)
      .truncate(true)
      .write(true)
      .open(&file_path)?;

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
      let chunk = chunk?;
      io::copy(&mut chunk.as_ref(), &mut file)?;
    }

    Ok(file_path)
  }

  /// Resolve the actual download URL for browsers that need dynamic asset resolution
  pub async fn resolve_download_url(
    &self,
    browser_type: BrowserType,
    version: &str,
    _download_info: &DownloadInfo,
  ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    match browser_type {
      BrowserType::Camoufox => {
        // For Camoufox, verify the asset exists and find the correct download URL
        let releases = self
          .api_client
          .fetch_camoufox_releases_with_caching(true)
          .await?;

        let release = releases
          .iter()
          .find(|r| r.tag_name == version)
          .or_else(|| {
            log::info!("Camoufox: requested version {version} not found, using latest available");
            releases.first()
          })
          .ok_or("No Camoufox releases found".to_string())?;

        // Get platform and architecture info
        let (os, arch) = Self::get_platform_info();

        // Find the appropriate asset
        let asset_url = self
          .find_camoufox_asset(&release.assets, &os, &arch)
          .ok_or(format!(
            "No compatible asset found for Camoufox version {version} on {os}/{arch}"
          ))?;

        Ok(asset_url)
      }
      BrowserType::Wayfern => {
        // For Wayfern, get the download URL from version.json
        let version_info = self
          .api_client
          .fetch_wayfern_version_with_caching(true)
          .await?;

        if version_info.version != version {
          log::info!(
            "Wayfern: requested version {version}, using available version {}",
            version_info.version
          );
        }

        // Get the download URL for current platform
        let download_url = self
          .api_client
          .get_wayfern_download_url(&version_info)
          .ok_or_else(|| {
            let (os, arch) = Self::get_platform_info();
            format!(
              "No compatible download found for Wayfern on {os}/{arch}. Available platforms: {}",
              version_info
                .downloads
                .iter()
                .filter_map(|(k, v)| if v.is_some() { Some(k.as_str()) } else { None })
                .collect::<Vec<_>>()
                .join(", ")
            )
          })?;

        Ok(download_url)
      }
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

  /// Find the appropriate Camoufox asset for the current platform and architecture
  fn find_camoufox_asset(
    &self,
    assets: &[crate::browser::GithubAsset],
    os: &str,
    arch: &str,
  ) -> Option<String> {
    // Camoufox asset naming pattern: camoufox-{version}-beta.{number}-{os}.{arch}.zip
    // Example: camoufox-135.0.1-beta.24-lin.x86_64.zip
    let (os_name, arch_name) = match (os, arch) {
      ("windows", "x64") => ("win", "x86_64"),
      ("windows", "arm64") => ("win", "arm64"),
      ("linux", "x64") => ("lin", "x86_64"),
      ("linux", "arm64") => ("lin", "arm64"),
      ("macos", "x64") => ("mac", "x86_64"),
      ("macos", "arm64") => ("mac", "arm64"),
      _ => return None,
    };

    // Use ends_with for precise matching to avoid false positives
    // The separator before OS is a dash: -lin.x86_64.zip, -mac.arm64.zip, etc.
    let pattern = format!("-{os_name}.{arch_name}.zip");
    let asset = assets.iter().find(|asset| {
      let name = asset.name.to_lowercase();
      name.starts_with("camoufox-") && name.ends_with(&pattern)
    });

    if let Some(asset) = asset {
      log::info!(
        "Selected Camoufox asset for {}/{}: {}",
        os,
        arch,
        asset.name
      );
      Some(asset.browser_download_url.clone())
    } else {
      log::warn!(
        "No matching Camoufox asset found for {}/{} with pattern '{}'. Available assets: {:?}",
        os,
        arch,
        pattern,
        assets.iter().map(|a| &a.name).collect::<Vec<_>>()
      );
      None
    }
  }

  /// Ensure version.json exists in the Camoufox installation directory.
  /// Creates the file if it doesn't exist, using the version from the tag name.
  async fn ensure_camoufox_version_json(
    &self,
    browser_dir: &Path,
    version: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // The browser_dir is typically: binaries/camoufox/<version>/
    // Find the executable directory within it
    let version_json_locations = vec![
      browser_dir.join("version.json"),
      browser_dir.join("camoufox").join("version.json"),
    ];

    // Check if version.json already exists in any expected location
    for location in &version_json_locations {
      if location.exists() {
        log::info!("version.json already exists at: {}", location.display());
        return Ok(());
      }
    }

    // Parse the Firefox version from the Camoufox version tag
    // Format: "135.0.1-beta.24" -> Firefox version is "135.0.1" (or just "135.0")
    let firefox_version = version.split('-').next().unwrap_or(version);

    // Create version.json in the browser directory
    let version_json_path = browser_dir.join("version.json");
    let version_data = serde_json::json!({
      "version": firefox_version
    });

    let version_json_str = serde_json::to_string_pretty(&version_data)?;
    tokio::fs::write(&version_json_path, version_json_str).await?;

    log::info!(
      "Created version.json at {} with Firefox version: {}",
      version_json_path.display(),
      firefox_version
    );

    Ok(())
  }

  pub async fn download_browser<R: tauri::Runtime>(
    &self,
    _app_handle: &tauri::AppHandle<R>,
    browser_type: BrowserType,
    version: &str,
    download_info: &DownloadInfo,
    dest_path: &Path,
    cancel_token: Option<&CancellationToken>,
  ) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let file_path = dest_path.join(&download_info.filename);

    // Resolve the actual download URL
    log::info!(
      "Resolving download URL for {} {}",
      browser_type.as_str(),
      version
    );
    let download_url = self
      .resolve_download_url(browser_type.clone(), version, download_info)
      .await?;
    log::info!("Download URL resolved: {}", download_url);

    // Determine if we have a partial file to resume
    let mut existing_size: u64 = 0;
    if let Ok(meta) = std::fs::metadata(&file_path) {
      existing_size = meta.len();
    }

    // Build request with retry logic for transient network errors.
    let max_retries = 3u32;
    let mut response: Option<reqwest::Response> = None;
    for attempt in 0..=max_retries {
      let mut request = self
        .client
        .get(&download_url)
        .header(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        );

      if existing_size > 0 {
        request = request.header("Range", format!("bytes={existing_size}-"));
      }

      log::info!("Sending download request (attempt {})...", attempt + 1);
      match request.send().await {
        Ok(resp) => {
          log::info!(
            "Download response received: status={}, content-length={:?}",
            resp.status(),
            resp.content_length()
          );
          if resp.status().as_u16() == 416 && existing_size > 0 {
            let _ = std::fs::remove_file(&file_path);
            existing_size = 0;
            log::warn!("Download returned 416, retrying without Range header");
            continue;
          }
          response = Some(resp);
          break;
        }
        Err(e) => {
          let is_retryable = e.is_connect() || e.is_timeout() || e.is_request();
          if is_retryable && attempt < max_retries {
            let delay = 2u64.pow(attempt);
            log::warn!(
              "Download attempt {} failed ({}), retrying in {}s...",
              attempt + 1,
              e,
              delay
            );
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
          } else {
            return Err(format!("Download failed after {} attempts: {}", attempt + 1, e).into());
          }
        }
      }
    }
    let response = response.ok_or_else(|| -> Box<dyn std::error::Error + Send + Sync> {
      "Download failed: no response received".into()
    })?;

    // Check if the response is successful (200 OK or 206 Partial Content)
    if !(response.status().is_success() || response.status().as_u16() == 206) {
      return Err(format!("Download failed with status: {}", response.status()).into());
    }

    // Determine total size
    let mut total_size = response.content_length();

    // If resuming (206) and Content-Range is present, parse total
    if response.status().as_u16() == 206 {
      if let Some(content_range) = response.headers().get(reqwest::header::CONTENT_RANGE) {
        if let Ok(cr) = content_range.to_str() {
          // Format: bytes start-end/total
          if let Some((_, total_str)) = cr.split('/').collect::<Vec<_>>().split_first() {
            if let Some(total_str) = total_str.first() {
              if let Ok(total) = total_str.parse::<u64>() {
                total_size = Some(total);
              }
            }
          }
        }
      } else if let Some(len) = response.headers().get(reqwest::header::CONTENT_LENGTH) {
        // Fallback: total = existing + incoming length
        if let Ok(len_str) = len.to_str() {
          if let Ok(incoming) = len_str.parse::<u64>() {
            total_size = Some(existing_size + incoming);
          }
        }
      }
    } else if existing_size > 0 && response.status().is_success() {
      // Server ignored range or we asked from 0; if 200 and existing file has content, start fresh
      // Truncate existing file so we don't append duplicate bytes
      let _ = std::fs::remove_file(&file_path);
      existing_size = 0;
    }

    // If the existing file already matches the total size, skip the download
    if existing_size > 0 {
      if let Some(total) = total_size {
        if existing_size >= total {
          log::info!(
            "Archive {} already complete ({} bytes), skipping download",
            file_path.display(),
            existing_size
          );
          return Ok(file_path);
        }
      }
    }

    let mut downloaded = existing_size;
    let start_time = std::time::Instant::now();
    let mut last_update = start_time;

    // Emit initial progress AFTER we've established total size and resume state
    let initial_percentage = if let Some(total) = total_size {
      if total > 0 {
        (existing_size as f64 / total as f64) * 100.0
      } else {
        0.0
      }
    } else {
      0.0
    };

    let initial_stage = "downloading".to_string();

    let progress = DownloadProgress {
      browser: browser_type.as_str().to_string(),
      version: version.to_string(),
      downloaded_bytes: existing_size,
      total_bytes: total_size,
      percentage: initial_percentage,
      speed_bytes_per_sec: 0.0,
      eta_seconds: None,
      stage: initial_stage,
    };

    let _ = events::emit("download-progress", &progress);

    // Open file in append mode (resuming) or create new.
    // Wrap in BufWriter with a large buffer to reduce the number of disk writes,
    // which dramatically improves download speed on Windows (NTFS + Defender overhead).
    use std::fs::OpenOptions;
    use std::io::Write;
    let raw_file = OpenOptions::new()
      .create(true)
      .append(true)
      .open(&file_path)?;
    let mut file = io::BufWriter::with_capacity(8 * 1024 * 1024, raw_file);
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    loop {
      // Wrap each read in an idle timeout so a stalled connection (no bytes flowing)
      // surfaces as a terminal error instead of awaiting forever.
      let next = match tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()).await {
        Ok(item) => item,
        Err(_) => {
          drop(file);
          // Keep any partial bytes on disk so a later attempt can resume via Range.
          return Err(
            format!(
              "Download stalled: no data received for {}s",
              STREAM_IDLE_TIMEOUT.as_secs()
            )
            .into(),
          );
        }
      };
      let Some(chunk) = next else {
        break;
      };
      if let Some(token) = cancel_token {
        if token.is_cancelled() {
          drop(file);
          let _ = std::fs::remove_file(&file_path);
          return Err("Download cancelled".into());
        }
      }
      let chunk = chunk?;
      file.write_all(&chunk)?;
      downloaded += chunk.len() as u64;

      let now = std::time::Instant::now();
      // Update progress every 100ms to avoid too many events
      if now.duration_since(last_update).as_millis() >= 100 {
        let elapsed = start_time.elapsed().as_secs_f64();
        // Compute speed based only on bytes downloaded in this session to avoid inflated values when resuming
        let downloaded_since_start = downloaded.saturating_sub(existing_size);
        let speed = if elapsed > 0.0 {
          downloaded_since_start as f64 / elapsed
        } else {
          0.0
        };
        let percentage = if let Some(total) = total_size {
          if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
          } else {
            0.0
          }
        } else {
          0.0
        };
        let eta = if speed > 0.0 {
          total_size.map(|total| (total - downloaded) as f64 / speed)
        } else {
          None
        };

        let stage_description = "downloading".to_string();

        let progress = DownloadProgress {
          browser: browser_type.as_str().to_string(),
          version: version.to_string(),
          downloaded_bytes: downloaded,
          total_bytes: total_size,
          percentage,
          speed_bytes_per_sec: speed,
          eta_seconds: eta,
          stage: stage_description,
        };

        let _ = events::emit("download-progress", &progress);
        last_update = now;
      }
    }

    // Flush remaining buffered data to disk
    file.flush()?;

    Ok(file_path)
  }
}

include!("downloader_full.rs");
include!("downloader_tests.rs");
