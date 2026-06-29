use crate::automation::pipeline::context::ExecutionContext;
use crate::automation::pipeline::types::{AutomationErrorCode, CleanupNodeConfig};
use crate::automation::pipeline::{AutomationNode, NodeResult};
use async_trait::async_trait;
use std::path::{Path, PathBuf};

pub struct CleanupNode {
  config: CleanupNodeConfig,
}

impl CleanupNode {
  pub fn new(config: CleanupNodeConfig) -> Self {
    Self { config }
  }

  /// Get profile directory path
  fn get_profile_dir(&self, profile_id: &str) -> Result<PathBuf, (AutomationErrorCode, String)> {
    let profiles_dir = crate::settings::app_dirs::profiles_dir();
    let profile_dir = profiles_dir.join(profile_id).join("profile");

    if !profile_dir.exists() {
      return Err((
        AutomationErrorCode::CleanupPathNotFound,
        format!("Profile directory not found: {:?}", profile_dir),
      ));
    }

    Ok(profile_dir)
  }

  /// Delete cookies and cache (Mode A)
  async fn cleanup_cookies_and_cache(
    &self,
    profile_dir: &Path,
  ) -> Result<(), (AutomationErrorCode, String)> {
    log::info!(
      "[AUTOMATION] [CLEANUP] Cleaning cookies and cache in {:?}",
      profile_dir
    );

    let mut deleted_count = 0;

    // Chromium/Wayfern files
    let chromium_files = vec![
      "Cookies",
      "Cookies-journal",
      "Cache",
      "Code Cache",
      "GPUCache",
      "Service Worker",
      "Session Storage",
    ];

    for file_name in chromium_files {
      let path = profile_dir.join(file_name);
      if path.exists() {
        if path.is_dir() {
          std::fs::remove_dir_all(&path).map_err(|e| {
            (
              AutomationErrorCode::CleanupDeleteFailed,
              format!("Failed to delete directory {:?}: {}", path, e),
            )
          })?;
        } else {
          std::fs::remove_file(&path).map_err(|e| {
            (
              AutomationErrorCode::CleanupDeleteFailed,
              format!("Failed to delete file {:?}: {}", path, e),
            )
          })?;
        }
        deleted_count += 1;
      }
    }

    // Firefox files
    let firefox_files = vec!["cookies.sqlite", "cookies.sqlite-wal", "cache2"];

    for file_name in firefox_files {
      let path = profile_dir.join(file_name);
      if path.exists() {
        if path.is_dir() {
          std::fs::remove_dir_all(&path).map_err(|e| {
            (
              AutomationErrorCode::CleanupDeleteFailed,
              format!("Failed to delete directory {:?}: {}", path, e),
            )
          })?;
        } else {
          std::fs::remove_file(&path).map_err(|e| {
            (
              AutomationErrorCode::CleanupDeleteFailed,
              format!("Failed to delete file {:?}: {}", path, e),
            )
          })?;
        }
        deleted_count += 1;
      }
    }

    log::info!(
      "[AUTOMATION] [CLEANUP] Deleted {} items from profile directory",
      deleted_count
    );

    Ok(())
  }

  /// Delete entire profile directory (Mode B)
  async fn cleanup_full(&self, profile_dir: &Path) -> Result<(), (AutomationErrorCode, String)> {
    log::info!(
      "[AUTOMATION] [CLEANUP] Deleting entire profile directory: {:?}",
      profile_dir
    );

    std::fs::remove_dir_all(profile_dir).map_err(|e| {
      if e.kind() == std::io::ErrorKind::PermissionDenied {
        (
          AutomationErrorCode::CleanupPermissionDenied,
          format!("Permission denied deleting {:?}: {}", profile_dir, e),
        )
      } else {
        (
          AutomationErrorCode::CleanupDeleteFailed,
          format!(
            "Failed to delete profile directory {:?}: {}",
            profile_dir, e
          ),
        )
      }
    })?;

    log::info!("[AUTOMATION] [CLEANUP] Profile directory deleted successfully");

    Ok(())
  }
}

#[async_trait]
impl AutomationNode for CleanupNode {
  async fn execute(&self, context: &mut ExecutionContext) -> NodeResult {
    log::info!("[AUTOMATION] [CLEANUP] Executing: {}", self.config.label);

    // Get profile directory
    let profile_dir = self.get_profile_dir(&context.profile_id)?;

    // Execute cleanup based on mode
    match self.config.mode.as_str() {
      "cookies_and_cache" => {
        self.cleanup_cookies_and_cache(&profile_dir).await?;
      }
      "full" => {
        self.cleanup_full(&profile_dir).await?;
      }
      _ => {
        return Err((
          AutomationErrorCode::NodeConfigInvalid,
          format!("Invalid cleanup mode: {}", self.config.mode),
        ));
      }
    }

    Ok(())
  }

  fn label(&self) -> &str {
    &self.config.label
  }

  fn node_type(&self) -> &str {
    "CLEANUP"
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_node_creation() {
    let config = CleanupNodeConfig {
      label: "Test Cleanup".to_string(),
      mode: "cookies_and_cache".to_string(),
      exclude_domains: vec![],
    };

    let node = CleanupNode::new(config);
    assert_eq!(node.label(), "Test Cleanup");
    assert_eq!(node.node_type(), "CLEANUP");
  }

  #[test]
  fn test_mode_validation() {
    let config_a = CleanupNodeConfig {
      label: "Test A".to_string(),
      mode: "cookies_and_cache".to_string(),
      exclude_domains: vec![],
    };
    assert_eq!(config_a.mode, "cookies_and_cache");

    let config_b = CleanupNodeConfig {
      label: "Test B".to_string(),
      mode: "full".to_string(),
      exclude_domains: vec![],
    };
    assert_eq!(config_b.mode, "full");
  }
}
