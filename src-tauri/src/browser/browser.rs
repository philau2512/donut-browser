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
    // Wayfern is Chromium-based, look for Chromium.app
    // Find the .app directory
    let app_path = std::fs::read_dir(install_dir)?
      .filter_map(Result::ok)
      .find(|entry| entry.path().extension().is_some_and(|ext| ext == "app"))
      .ok_or("Wayfern app not found")?;

    // Construct the browser executable path
    let mut executable_dir = app_path.path();
    executable_dir.push("Contents");
    executable_dir.push("MacOS");

    // Find the Chromium executable
    let executable_path = std::fs::read_dir(&executable_dir)?
      .filter_map(Result::ok)
      .find(|entry| {
        let binding = entry.file_name();
        let name = binding.to_string_lossy();
        name.contains("Chromium") || name == "Wayfern"
      })
      .map(|entry| entry.path())
      .ok_or("No Wayfern executable found in MacOS directory")?;

    Ok(executable_path)
  }

  pub fn is_wayfern_version_downloaded(install_dir: &Path) -> bool {
    // On macOS, check for .app files (Chromium.app)
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

  pub fn get_chromium_executable_path(
    install_dir: &Path,
    browser_type: &BrowserType,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let possible_executables = match browser_type {
      BrowserType::Wayfern => vec![
        install_dir.join("chromium"),
        install_dir.join("chrome"),
        install_dir.join("wayfern"),
        install_dir.join("wayfern").join("chromium"),
        install_dir.join("wayfern").join("chrome"),
        install_dir.join("chrome-linux").join("chrome"),
      ],
      _ => vec![],
    };

    for executable_path in &possible_executables {
      if executable_path.exists() && executable_path.is_file() {
        return Ok(executable_path.clone());
      }
    }

    Err(
      format!(
        "Chromium executable not found in {}/{}",
        install_dir.display(),
        browser_type.as_str()
      )
      .into(),
    )
  }

  pub fn is_firefox_version_downloaded(install_dir: &Path, browser_type: &BrowserType) -> bool {
    // Expected structure (most common):
    //   install_dir/<browser>/<binary>
    // However, Firefox Developer tarballs often extract to a "firefox" subfolder
    // rather than "firefox-developer". Support both layouts.
    let _browser_subdir = install_dir.join(browser_type.as_str());

    let possible_executables = match browser_type {
      BrowserType::Camoufox => {
        vec![
          install_dir.join("camoufox-bin"),
          install_dir.join("camoufox"),
        ]
      }
      _ => vec![],
    };

    for exe_path in &possible_executables {
      if exe_path.exists() && exe_path.is_file() {
        return true;
      }
    }

    false
  }

  pub fn is_chromium_version_downloaded(install_dir: &Path, browser_type: &BrowserType) -> bool {
    let possible_executables = match browser_type {
      BrowserType::Wayfern => vec![
        install_dir.join("chromium"),
        install_dir.join("chrome"),
        install_dir.join("wayfern"),
        install_dir.join("wayfern").join("chromium"),
        install_dir.join("wayfern").join("chrome"),
        install_dir.join("chrome-linux").join("chrome"),
      ],
      _ => vec![],
    };

    for exe_path in &possible_executables {
      if exe_path.exists() && exe_path.is_file() {
        return true;
      }
    }

    false
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

  pub fn get_chromium_executable_path(
    install_dir: &Path,
    browser_type: &BrowserType,
  ) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // On Windows, look for .exe files
    let possible_paths = match browser_type {
      BrowserType::Wayfern => vec![
        install_dir.join("chromium.exe"),
        install_dir.join("chrome.exe"),
        install_dir.join("wayfern.exe"),
        install_dir.join("bin").join("chromium.exe"),
        install_dir.join("wayfern").join("chromium.exe"),
        install_dir.join("wayfern").join("chrome.exe"),
        install_dir.join("chrome-win").join("chrome.exe"),
      ],
      _ => vec![],
    };

    for path in &possible_paths {
      if path.exists() && path.is_file() {
        return Ok(path.clone());
      }
    }

    // Look for any .exe file that might be the browser
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "exe") && is_pe_executable(&path) {
          let name = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
          if name.contains("chromium") || name.contains("chrome") || name.contains("wayfern") {
            return Ok(path);
          }
        }
      }
    }

    Err("Chromium/Wayfern executable not found in Windows installation directory".into())
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

  pub fn is_chromium_version_downloaded(install_dir: &Path, browser_type: &BrowserType) -> bool {
    // On Windows, check for .exe files
    let possible_executables = match browser_type {
      BrowserType::Wayfern => vec![
        install_dir.join("chromium.exe"),
        install_dir.join("chrome.exe"),
        install_dir.join("wayfern.exe"),
        install_dir.join("bin").join("chromium.exe"),
        install_dir.join("wayfern").join("chromium.exe"),
        install_dir.join("wayfern").join("chrome.exe"),
        install_dir.join("chrome-win").join("chrome.exe"),
      ],
      _ => vec![],
    };

    for exe_path in &possible_executables {
      if exe_path.exists() && exe_path.is_file() {
        return true;
      }
    }

    // Check for any .exe file that looks like the browser
    if let Ok(entries) = std::fs::read_dir(install_dir) {
      for entry in entries.flatten() {
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "exe") && is_pe_executable(&path) {
          let name = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
          if name.contains("chromium") || name.contains("chrome") || name.contains("wayfern") {
            return true;
          }
        }
      }
    }

    false
  }

  #[allow(dead_code)]
  pub fn prepare_executable(_executable_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // On Windows, no special preparation needed
    Ok(())
  }
}

include!("browser_impls.rs");
include!("browser_tests.rs");
