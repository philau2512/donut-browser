
use crate::browser::wayfern_launch_args::{
  build_wayfern_launch_args, resolve_webrtc_mode, WayfernLaunchArgsOptions,
};

pub struct CamoufoxBrowser;

impl CamoufoxBrowser {
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    Self
  }
}

impl Browser for CamoufoxBrowser {
  fn get_executable_path(&self, install_dir: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    return macos::get_firefox_executable_path(install_dir);

    #[cfg(target_os = "linux")]
    return linux::get_firefox_executable_path(install_dir, &BrowserType::Camoufox);

    #[cfg(target_os = "windows")]
    return windows::get_firefox_executable_path(install_dir);

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("Unsupported platform".into())
  }

  fn create_launch_args(
    &self,
    profile_path: &str,
    _proxy_settings: Option<&ProxySettings>,
    url: Option<String>,
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    // For Camoufox, we handle launching through the camoufox launcher
    // This method won't be used directly, but we provide basic Firefox args as fallback
    let mut args = vec![
      "-profile".to_string(),
      profile_path.to_string(),
      "-no-remote".to_string(),
    ];

    // Add remote debugging if requested
    if let Some(port) = remote_debugging_port {
      args.push("--start-debugger-server".to_string());
      args.push(port.to_string());
    }

    // Add headless mode if requested
    if headless {
      args.push("--headless".to_string());
    }

    if let Some(url) = url {
      args.push(url);
    }

    Ok(args)
  }

  fn is_version_downloaded(&self, version: &str, binaries_dir: &Path) -> bool {
    let install_dir = binaries_dir.join("camoufox").join(version);

    #[cfg(target_os = "macos")]
    return macos::is_firefox_version_downloaded(&install_dir);

    #[cfg(target_os = "linux")]
    return linux::is_firefox_version_downloaded(&install_dir, &BrowserType::Camoufox);

    #[cfg(target_os = "windows")]
    return windows::is_firefox_version_downloaded(&install_dir);

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    false
  }

  fn prepare_executable(&self, executable_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    return macos::prepare_executable(executable_path);

    #[cfg(target_os = "linux")]
    return linux::prepare_executable(executable_path);

    #[cfg(target_os = "windows")]
    return windows::prepare_executable(executable_path);

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("Unsupported platform".into())
  }
}

/// Wayfern is a Chromium-based anti-detect browser with CDP-based fingerprint injection
pub struct WayfernBrowser;

impl WayfernBrowser {
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    Self
  }
}

impl Browser for WayfernBrowser {
  fn get_executable_path(&self, install_dir: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    return macos::get_wayfern_executable_path(install_dir);

    #[cfg(target_os = "linux")]
    return linux::get_chromium_executable_path(install_dir, &BrowserType::Wayfern);

    #[cfg(target_os = "windows")]
    return windows::get_chromium_executable_path(install_dir, &BrowserType::Wayfern);

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("Unsupported platform".into())
  }

  fn create_launch_args(
    &self,
    profile_path: &str,
    proxy_settings: Option<&ProxySettings>,
    url: Option<String>,
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let proxy_url = proxy_settings.map(|proxy| {
      let scheme = match proxy.proxy_type.to_lowercase().as_str() {
        "socks5" | "socks4" => "socks5",
        _ => "http",
      };
      format!("{scheme}://{}:{}", proxy.host, proxy.port)
    });

    Ok(build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path,
      remote_debugging_port,
      headless,
      fingerprint_json: None,
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: proxy_url.as_deref(),
      webrtc_mode: resolve_webrtc_mode(false, None),
      block_images: false,
      block_webgl: false,
      url: url.as_deref(),
    }))
  }

  fn is_version_downloaded(&self, version: &str, binaries_dir: &Path) -> bool {
    let install_dir = binaries_dir.join("wayfern").join(version);

    #[cfg(target_os = "macos")]
    return macos::is_wayfern_version_downloaded(&install_dir);

    #[cfg(target_os = "linux")]
    return linux::is_chromium_version_downloaded(&install_dir, &BrowserType::Wayfern);

    #[cfg(target_os = "windows")]
    return windows::is_chromium_version_downloaded(&install_dir, &BrowserType::Wayfern);

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    false
  }

  fn prepare_executable(&self, executable_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    return macos::prepare_executable(executable_path);

    #[cfg(target_os = "linux")]
    return linux::prepare_executable(executable_path);

    #[cfg(target_os = "windows")]
    return windows::prepare_executable(executable_path);

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err("Unsupported platform".into())
  }
}

pub struct BrowserFactory;

impl BrowserFactory {
  fn new() -> Self {
    Self
  }

  pub fn instance() -> &'static BrowserFactory {
    &BROWSER_FACTORY
  }

  pub fn create_browser(&self, browser_type: BrowserType) -> Box<dyn Browser> {
    match browser_type {
      BrowserType::Camoufox => Box::new(CamoufoxBrowser::new()),
      BrowserType::Wayfern => Box::new(WayfernBrowser::new()),
    }
  }
}

/// Check if a file is a valid PE executable by reading its magic bytes (MZ).
/// Returns false for archive files (.zip starts with PK, etc.) that were
/// incorrectly named with a .exe extension.
#[cfg(target_os = "windows")]
fn is_pe_executable(path: &Path) -> bool {
  use std::io::Read;
  let Ok(mut file) = std::fs::File::open(path) else {
    return false;
  };
  let mut magic = [0u8; 2];
  if file.read_exact(&mut magic).is_err() {
    return false;
  }
  magic == [0x4D, 0x5A] // MZ
}

// Factory function to create browser instances (kept for backward compatibility)
pub fn create_browser(browser_type: BrowserType) -> Box<dyn Browser> {
  BrowserFactory::instance().create_browser(browser_type)
}

// Add GithubRelease and GithubAsset structs to browser.rs if they don't already exist
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GithubRelease {
  pub tag_name: String,
  #[serde(default)]
  pub name: String,
  pub assets: Vec<GithubAsset>,
  #[serde(default)]
  pub published_at: String,
  #[serde(default)]
  pub is_nightly: bool,
  #[serde(default)]
  pub prerelease: bool,
  #[serde(default)]
  pub draft: bool,
  #[serde(default)]
  pub body: Option<String>,
  #[serde(default)]
  pub html_url: Option<String>,
  #[serde(default)]
  pub id: Option<u64>,
  #[serde(default)]
  pub node_id: Option<String>,
  #[serde(default)]
  pub target_commitish: Option<String>,
  #[serde(default)]
  pub created_at: Option<String>,
  #[serde(default)]
  pub tarball_url: Option<String>,
  #[serde(default)]
  pub zipball_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GithubAsset {
  pub name: String,
  pub browser_download_url: String,
  #[serde(default)]
  pub size: u64,
  #[serde(default)]
  pub download_count: Option<u64>,
  #[serde(default)]
  pub id: Option<u64>,
  #[serde(default)]
  pub node_id: Option<String>,
  #[serde(default)]
  pub label: Option<String>,
  #[serde(default)]
  pub content_type: Option<String>,
  #[serde(default)]
  pub state: Option<String>,
  #[serde(default)]
  pub created_at: Option<String>,
  #[serde(default)]
  pub updated_at: Option<String>,
}

