use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ProxySettings {
  pub proxy_type: String, // "http", "https", "socks4", "socks5", or "ss" (Shadowsocks)
  pub host: String,
  pub port: u16,
  pub username: Option<String>,
  pub password: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub vless_uri: Option<String>,
}

impl ProxySettings {
  pub fn new(
    proxy_type: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
  ) -> Self {
    Self {
      proxy_type,
      host,
      port,
      username,
      password,
      vless_uri: None,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BrowserType {
  Camoufox,
  Wayfern,
}

impl BrowserType {
  pub fn as_str(&self) -> &'static str {
    match self {
      BrowserType::Camoufox => "camoufox",
      BrowserType::Wayfern => "wayfern",
    }
  }

  #[allow(clippy::should_implement_trait)]
  pub fn from_str(s: &str) -> Result<Self, String> {
    match s {
      "camoufox" => Ok(BrowserType::Camoufox),
      "wayfern" => Ok(BrowserType::Wayfern),
      _ => Err(format!("Unknown browser type: {s}")),
    }
  }
}

#[allow(dead_code)]
pub trait Browser: Send + Sync {
  fn get_executable_path(&self, install_dir: &Path) -> Result<PathBuf, Box<dyn std::error::Error>>;
  fn create_launch_args(
    &self,
    profile_path: &str,
    proxy_settings: Option<&ProxySettings>,
    url: Option<String>,
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<Vec<String>, Box<dyn std::error::Error>>;
  fn is_version_downloaded(&self, version: &str, binaries_dir: &Path) -> bool;
  fn prepare_executable(&self, executable_path: &Path) -> Result<(), Box<dyn std::error::Error>>;
}

// Platform-specific modules
#[cfg(target_os = "macos")]
mod macos {
  use super::*;

  pub fn get_firefox_executable_path(
    install_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // Find the .app directory
    let app_path = std::fs::read_dir(install_dir)?
      .filter_map(Result::ok)
      .find(|entry| entry.path().extension().is_some_and(|ext| ext == "app"))
      .ok_or("Browser app not found")?;

    // Construct the browser executable path
    let mut executable_dir = app_path.path();
    executable_dir.push("Contents");
    executable_dir.push("MacOS");

    // Find executables matching the browser name pattern
    let candidates: Vec<_> = std::fs::read_dir(&executable_dir)?
      .filter_map(Result::ok)
      .filter(|entry| {
        let binding = entry.file_name();
        let name = binding.to_string_lossy();
        name.starts_with("firefox") || name.starts_with("camoufox") || name.contains("Browser")
      })
      .map(|entry| entry.path())
      .collect();

    if candidates.is_empty() {
      return Err("No executable found in MacOS directory".into());
    }

    // For Camoufox, validate architecture compatibility
    let executable_path = if candidates.iter().any(|p| {
      p.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with("camoufox"))
        .unwrap_or(false)
    }) {
      // Find the executable that matches the current architecture
      let current_arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
      } else if cfg!(target_arch = "aarch64") {
        "arm64"
      } else {
        return Err("Unsupported architecture".into());
      };

      // Try to find an executable that matches the current architecture
      // Use file command to check architecture
      let mut found_executable = None;
      let mut file_command_available = true;

      for candidate in &candidates {
        match std::process::Command::new("file").arg(candidate).output() {
          Ok(output) => {
            if output.status.success() {
              if let Ok(output_str) = String::from_utf8(output.stdout) {
                let is_compatible = if current_arch == "x86_64" {
                  output_str.contains("x86_64") || output_str.contains("i386")
                } else {
                  output_str.contains("arm64") || output_str.contains("aarch64")
                };

                if is_compatible {
                  found_executable = Some(candidate.clone());
                  log::info!(
                    "Found compatible Camoufox executable for {}: {}",
                    current_arch,
                    candidate.display()
                  );
                  break;
                } else {
                  log::warn!(
                    "Skipping incompatible Camoufox executable: {} (architecture: {})",
                    candidate.display(),
                    output_str.trim()
                  );
                }
              }
            } else {
              log::warn!(
                "Failed to check architecture for {}: file command returned non-zero exit code",
                candidate.display()
              );
            }
          }
          Err(e) => {
            log::warn!(
              "Failed to check architecture for {} using file command: {}",
              candidate.display(),
              e
            );
            file_command_available = false;
            // Continue checking other candidates
          }
        }
      }

      // If no compatible executable found but we have candidates, use the first one
      // (fallback for cases where file command isn't available or failed)
      if found_executable.is_none() && !candidates.is_empty() {
        if !file_command_available {
          log::warn!(
            "file command not available, using first candidate: {}",
            candidates[0].display()
          );
        } else {
          log::warn!(
            "No compatible executable found for architecture {}, using first candidate: {}",
            current_arch,
            candidates[0].display()
          );
        }
        found_executable = Some(candidates[0].clone());
      }

      found_executable.ok_or_else(|| {
        format!(
          "No compatible Camoufox executable found for architecture {}. Available executables: {:?}",
          current_arch,
          candidates
        )
      })?
    } else {
      // For other browsers, use the first matching executable
      candidates[0].clone()
    };

    Ok(executable_path)
  }

  pub fn get_wayfern_executable_path(
    install_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // Newer builds ship as Wayfern.app; older ones as Chromium.app. Either way,
    // find the .app bundle in the version directory.
    let app_path = std::fs::read_dir(install_dir)?
      .filter_map(Result::ok)
      .find(|entry| entry.path().extension().is_some_and(|ext| ext == "app"))
      .ok_or("Wayfern app not found")?;

    // Construct the browser executable path
    let mut executable_dir = app_path.path();
    executable_dir.push("Contents");
    executable_dir.push("MacOS");

    // Find the main executable inside Contents/MacOS. The renamed builds name it
    // `Wayfern`; older Chromium-named builds name it `Chromium`. Helper binaries
    // such as `chrome_crashpad_handler` contain neither token and are skipped.
    let executable_path = std::fs::read_dir(&executable_dir)?
      .filter_map(Result::ok)
      .find(|entry| {
        let binding = entry.file_name();
        let name = binding.to_string_lossy();
        name.contains("Wayfern") || name.contains("Chromium")
      })
      .map(|entry| entry.path())
      .ok_or("No Wayfern executable found in MacOS directory")?;

    Ok(executable_path)
  }

  pub fn is_wayfern_version_downloaded(install_dir: &Path) -> bool {
    // On macOS, check for the .app bundle (Wayfern.app or legacy Chromium.app)
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        if entry.path().extension().is_some_and(|ext| ext == "app") {
          return true;
        }
      }
    }
    false
  }

  pub fn is_firefox_version_downloaded(install_dir: &Path) -> bool {
    // On macOS, check for .app files
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        if entry.path().extension().is_some_and(|ext| ext == "app") {
          return true;
        }
      }
    }
    false
  }

  #[allow(dead_code)]
  pub fn prepare_executable(_executable_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // On macOS, no special preparation needed
    Ok(())
  }
}

#[cfg(target_os = "linux")]
mod linux {
  use super::*;
  use std::os::unix::fs::PermissionsExt;

  pub fn get_firefox_executable_path(
    install_dir: &Path,
    browser_type: &BrowserType,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // Expected structure examples:
    // - Firefox/Firefox Developer on Linux often extract to: install_dir/firefox/firefox
    // - Some archives may extract directly under: install_dir/firefox or install_dir/firefox-bin
    // - For some flavors we may have: install_dir/<browser_type>/<binary>
    let _browser_subdir = install_dir.join(browser_type.as_str());

    // Try common firefox executable locations (nested and flat)
    let possible_executables = match browser_type {
      BrowserType::Camoufox => {
        vec![
          install_dir.join("camoufox-bin"),
          install_dir.join("camoufox"),
        ]
      }
      _ => vec![],
    };

    for executable_path in &possible_executables {
      if executable_path.exists() && executable_path.is_file() {
        return Ok(executable_path.clone());
      }
    }

    Err(
      format!(
        "Executable not found for {} in {}",
        browser_type.as_str(),
        install_dir.display(),
      )
      .into(),
    )
  }

  /// Candidate paths for the Wayfern executable on Linux, in priority order.
  /// Newer builds ship the binary named `wayfern`; the `chromium`/`chrome` names
  /// are retained as fallbacks so versions extracted before the rename still
  /// launch.
  fn wayfern_executable_candidates(install_dir: &Path) -> Vec<PathBuf> {
    const NAMES: [&str; 3] = ["wayfern", "chromium", "chrome"];
    let dirs = [
      install_dir.to_path_buf(),
      install_dir.join("wayfern"),
      install_dir.join("wayfern-linux"),
      install_dir.join("chrome-linux"),
    ];
    dirs
      .iter()
      .flat_map(|dir| NAMES.iter().map(move |name| dir.join(name)))
      .collect()
  }

  pub fn get_wayfern_executable_path(
    install_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    for executable_path in wayfern_executable_candidates(install_dir) {
      if executable_path.exists() && executable_path.is_file() {
        return Ok(executable_path);
      }
    }
    Err(format!("Wayfern executable not found in {}", install_dir.display()).into())
  }

  pub fn is_wayfern_version_downloaded(install_dir: &Path) -> bool {
    wayfern_executable_candidates(install_dir)
      .iter()
      .any(|exe_path| exe_path.exists() && exe_path.is_file())
  }

  /// Compat shim — callers that pass browser_type use this path.
  pub fn get_chromium_executable_path(
    install_dir: &Path,
    _browser_type: &BrowserType,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    get_wayfern_executable_path(install_dir)
  }

  pub fn is_chromium_version_downloaded(install_dir: &Path, _browser_type: &BrowserType) -> bool {
    is_wayfern_version_downloaded(install_dir)
  }

  #[allow(dead_code)]
  pub fn prepare_executable(executable_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // On Linux, ensure the executable has proper permissions
    log::info!("Setting execute permissions for: {:?}", executable_path);

    let metadata = std::fs::metadata(executable_path)?;
    let mut permissions = metadata.permissions();

    // Add execute permissions for owner, group, and others
    let mode = permissions.mode();
    permissions.set_mode(mode | 0o755);

    std::fs::set_permissions(executable_path, permissions)?;

    log::info!(
      "Execute permissions set successfully for: {:?}",
      executable_path
    );
    Ok(())
  }
}

#[cfg(target_os = "windows")]
mod windows {
  use super::*;

  pub fn get_firefox_executable_path(
    install_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // On Windows, look for firefox.exe
    let possible_paths = [
      install_dir.join("firefox.exe"),
      install_dir.join("firefox").join("firefox.exe"),
      install_dir.join("bin").join("firefox.exe"),
    ];

    for path in &possible_paths {
      if path.exists() && path.is_file() {
        return Ok(path.clone());
      }
    }

    // Look for any .exe file that might be the browser
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "exe") {
          let name = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
          if name.starts_with("firefox") || name.starts_with("camoufox") || name.contains("browser")
          {
            return Ok(path);
          }
        }
      }
    }

    Err("Firefox executable not found in Windows installation directory".into())
  }

  pub fn is_firefox_version_downloaded(install_dir: &Path) -> bool {
    // On Windows, check for .exe files
    let possible_executables = [
      install_dir.join("firefox.exe"),
      install_dir.join("firefox").join("firefox.exe"),
      install_dir.join("bin").join("firefox.exe"),
    ];

    for exe_path in &possible_executables {
      if exe_path.exists() && exe_path.is_file() {
        return true;
      }
    }

    // Check for any .exe file that looks like a browser
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "exe") {
          let name = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
          if name.starts_with("firefox") || name.starts_with("camoufox") || name.contains("browser")
          {
            return true;
          }
        }
      }
    }

    false
  }

  /// Candidate paths for the Wayfern executable on Windows, in priority order.
  /// Newer builds ship `wayfern.exe`; the `chromium.exe`/`chrome.exe` names are
  /// retained as fallbacks so versions extracted before the rename still launch.
  fn wayfern_executable_candidates(install_dir: &Path) -> Vec<PathBuf> {
    const NAMES: [&str; 3] = ["wayfern.exe", "chromium.exe", "chrome.exe"];
    let dirs = [
      install_dir.to_path_buf(),
      install_dir.join("bin"),
      install_dir.join("wayfern"),
      install_dir.join("wayfern-win"),
      install_dir.join("chrome-win"),
    ];
    dirs
      .iter()
      .flat_map(|dir| NAMES.iter().map(move |name| dir.join(name)))
      .collect()
  }

  /// Whether `path` is an .exe whose name looks like the browser (Wayfern or a
  /// legacy Chromium-named build). Guards against archives wrongly given a
  /// `*.exe` name by requiring a valid PE header.
  fn is_wayfern_exe(path: &Path) -> bool {
    if path.extension().is_none_or(|ext| ext != "exe") || !is_pe_executable(path) {
      return false;
    }
    let name = path
      .file_stem()
      .unwrap_or_default()
      .to_string_lossy()
      .to_lowercase();
    name.contains("wayfern") || name.contains("chromium") || name.contains("chrome")
  }

  pub fn get_wayfern_executable_path(
    install_dir: &Path,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    for path in wayfern_executable_candidates(install_dir) {
      if path.exists() && path.is_file() {
        return Ok(path);
      }
    }
    // Fallback: scan directory for any browser-named PE
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        let path = entry.path();
        if is_wayfern_exe(&path) {
          return Ok(path);
        }
      }
    }
    Err("Wayfern executable not found in Windows installation directory".into())
  }

  pub fn is_wayfern_version_downloaded(install_dir: &Path) -> bool {
    if wayfern_executable_candidates(install_dir)
      .iter()
      .any(|exe_path| exe_path.exists() && exe_path.is_file())
    {
      return true;
    }
    // Check for any .exe file that looks like the browser
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        if is_wayfern_exe(&entry.path()) {
          return true;
        }
      }
    }
    false
  }

  /// Compat shim for callers passing browser_type.
  pub fn get_chromium_executable_path(
    install_dir: &Path,
    _browser_type: &BrowserType,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    get_wayfern_executable_path(install_dir)
  }

  pub fn is_chromium_version_downloaded(install_dir: &Path, _browser_type: &BrowserType) -> bool {
    is_wayfern_version_downloaded(install_dir)
  }

  #[allow(dead_code)]
  pub fn prepare_executable(_executable_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // On Windows, no special preparation needed
    Ok(())
  }
}

include!("browser_impls.rs");
include!("browser_tests.rs");
