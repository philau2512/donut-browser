//! Camoufox browser launcher.
//!
//! NOTE: The playwright-rust integration has been removed; Camoufox is launched
//! via the native process-based path (see camoufox_manager.rs).  These types
//! are kept for backward-compat with code that imports from this module.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::browser::camoufox::config::{CamoufoxConfigBuilder, CamoufoxLaunchConfig, ProxyConfig};
use crate::browser::camoufox::fingerprint::types::{Fingerprint, ScreenConstraints};

/// Error type for launcher operations.
#[derive(Debug, thiserror::Error)]
pub enum LauncherError {
  #[error("Configuration error: {0}")]
  Config(#[from] crate::browser::camoufox::config::ConfigError),

  #[error("IO error: {0}")]
  Io(#[from] std::io::Error),

  #[error("Camoufox executable not found at: {0}")]
  ExecutableNotFound(PathBuf),

  #[error("Failed to generate environment variables: {0}")]
  EnvVars(#[from] serde_json::Error),

  #[error("Unsupported launch method: {0}")]
  Unsupported(String),
}

/// Options for launching Camoufox.
#[derive(Debug, Clone, Default)]
pub struct LaunchOptions {
  /// Operating system to spoof: "windows", "macos", "linux"
  pub os: Option<String>,
  /// Block all images
  pub block_images: bool,
  /// Block WebRTC entirely
  pub block_webrtc: bool,
  /// Block WebGL (not recommended unless necessary)
  pub block_webgl: bool,
  /// Screen dimension constraints
  pub screen: Option<ScreenConstraints>,
  /// Fixed window size [width, height]
  pub window: Option<(u32, u32)>,
  /// Custom fingerprint (if not provided, one will be generated)
  pub fingerprint: Option<Fingerprint>,
  /// Run in headless mode
  pub headless: bool,
  /// Custom fonts to load
  pub fonts: Option<Vec<String>>,
  /// Only use custom fonts (disable OS fonts)
  pub custom_fonts_only: bool,
  /// Firefox user preferences
  pub firefox_user_prefs: Option<HashMap<String, serde_json::Value>>,
  /// Proxy configuration
  pub proxy: Option<ProxyConfig>,
  /// Additional browser arguments
  pub args: Option<Vec<String>>,
  /// Additional environment variables
  pub env: Option<HashMap<String, String>>,
  /// Profile/user data directory
  pub user_data_dir: Option<PathBuf>,
  /// Enable debug output
  pub debug: bool,
}

/// Camoufox launcher stub (playwright-based launching removed).
pub struct CamoufoxLauncher {
  executable_path: PathBuf,
}

impl CamoufoxLauncher {
  /// Create a new Camoufox launcher.
  pub async fn new(executable_path: impl AsRef<Path>) -> Result<Self, LauncherError> {
    let executable_path = executable_path.as_ref().to_path_buf();
    if !executable_path.exists() {
      return Err(LauncherError::ExecutableNotFound(executable_path));
    }
    Ok(Self { executable_path })
  }

  fn build_config(&self, options: &LaunchOptions) -> Result<CamoufoxLaunchConfig, LauncherError> {
    let mut builder = CamoufoxConfigBuilder::new();
    if let Some(ref os) = options.os {
      builder = builder.operating_system(os);
    }
    if options.block_images {
      builder = builder.block_images(true);
    }
    if options.block_webrtc {
      builder = builder.block_webrtc(true);
    }
    if let Some(ref fp) = options.fingerprint {
      builder = builder.fingerprint(fp.clone());
    }
    if let Some(ref proxy) = options.proxy {
      builder = builder.proxy(proxy.clone());
    }
    Ok(builder.build()?)
  }
}

/// Launch a Camoufox browser instance (stub — use camoufox_manager for real launches).
pub async fn launch_camoufox(
  _executable_path: impl AsRef<Path>,
  _options: LaunchOptions,
) -> Result<(), LauncherError> {
  Err(LauncherError::Unsupported(
    "Use camoufox_manager for process-based launching".to_string(),
  ))
}

/// Launch a persistent Camoufox browser context (stub).
pub async fn launch_persistent_camoufox(
  _executable_path: impl AsRef<Path>,
  _user_data_dir: impl AsRef<Path>,
  _options: LaunchOptions,
) -> Result<(), LauncherError> {
  Err(LauncherError::Unsupported(
    "Use camoufox_manager for process-based launching".to_string(),
  ))
}
