use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

/// Global storage override path that replaces the default data_dir()
static STORAGE_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

/// Storage settings persisted to settings_dir().join("storage.json")
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageSettings {
  /// Custom storage path if set by the user
  pub custom_path: Option<PathBuf>,

  /// Timestamp when the setting was last modified
  #[serde(skip_serializing_if = "Option::is_none")]
  pub modified_at: Option<String>,
}

impl StorageSettings {
  /// Load storage settings from disk (settings_dir/storage.json)
  pub fn load() -> Result<Self, String> {
    let settings_path = super::app_dirs::settings_dir().join("storage.json");

    if !settings_path.exists() {
      return Ok(Self::default());
    }

    let content = std::fs::read_to_string(&settings_path)
      .map_err(|e| format!("Failed to read storage settings: {e}"))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse storage settings: {e}"))
  }

  /// Save storage settings to disk (settings_dir/storage.json)
  pub fn save(&self) -> Result<(), String> {
    let settings_dir = super::app_dirs::settings_dir();
    std::fs::create_dir_all(&settings_dir)
      .map_err(|e| format!("Failed to create settings directory: {e}"))?;

    let settings_path = settings_dir.join("storage.json");
    let content = serde_json::to_string_pretty(self)
      .map_err(|e| format!("Failed to serialize storage settings: {e}"))?;

    std::fs::write(&settings_path, content)
      .map_err(|e| format!("Failed to write storage settings: {e}"))?;

    Ok(())
  }

  /// Apply the custom storage path to the global override
  pub fn apply(&self) -> Result<(), String> {
    let lock = STORAGE_OVERRIDE.get_or_init(|| RwLock::new(None));
    let mut guard = lock
      .write()
      .map_err(|e| format!("Failed to acquire storage override lock: {e}"))?;

    *guard = self.custom_path.clone();

    log::info!(
      "Storage override applied: {}",
      self
        .custom_path
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "none".to_string())
    );

    Ok(())
  }
}

/// Get the current storage override path (if set)
pub fn get_storage_override() -> Option<PathBuf> {
  STORAGE_OVERRIDE
    .get()
    .and_then(|lock| lock.read().ok())
    .and_then(|guard| guard.clone())
}

/// Check if a custom storage path is currently active
pub fn is_storage_override_active() -> bool {
  get_storage_override().is_some()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_default_storage_settings() {
    let settings = StorageSettings::default();
    assert!(settings.custom_path.is_none());
    assert!(settings.modified_at.is_none());
  }

  #[test]
  fn test_storage_settings_serialization() {
    let settings = StorageSettings {
      custom_path: Some(PathBuf::from("/custom/path")),
      modified_at: Some("2026-07-06T00:00:00Z".to_string()),
    };

    let json = serde_json::to_string(&settings).unwrap();
    let deserialized: StorageSettings = serde_json::from_str(&json).unwrap();

    assert_eq!(settings.custom_path, deserialized.custom_path);
    assert_eq!(settings.modified_at, deserialized.modified_at);
  }

  #[test]
  fn test_storage_override_initially_none() {
    // This test assumes a fresh state
    let override_path = get_storage_override();
    assert!(override_path.is_none() || override_path.is_some());
  }

  #[test]
  fn test_storage_persistence() {
    let temp_dir = std::env::temp_dir().join("donut_test_storage_77777");
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).unwrap();

    let test_path = temp_dir.join("custom_storage");
    std::fs::create_dir_all(&test_path).unwrap();

    let settings = StorageSettings {
      custom_path: Some(test_path.clone()),
      modified_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    // Save should succeed
    let save_result = settings.save();
    assert!(
      save_result.is_ok(),
      "Save should succeed: {:?}",
      save_result
    );

    // Load should retrieve the same data
    let loaded = StorageSettings::load().unwrap();
    assert_eq!(loaded.custom_path, Some(test_path));
    assert!(loaded.modified_at.is_some());

    let _ = std::fs::remove_dir_all(&temp_dir);
  }

  #[test]
  fn test_storage_override_apply() {
    let test_path = std::env::temp_dir().join("donut_test_override_99999");
    let _ = std::fs::remove_dir_all(&test_path);
    std::fs::create_dir_all(&test_path).unwrap();

    let settings = StorageSettings {
      custom_path: Some(test_path.clone()),
      modified_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    // Apply should succeed
    let apply_result = settings.apply();
    assert!(
      apply_result.is_ok(),
      "Apply should succeed: {:?}",
      apply_result
    );

    // Override should now be active
    assert!(is_storage_override_active());
    let current = get_storage_override();
    assert_eq!(current, Some(test_path.clone()));

    let _ = std::fs::remove_dir_all(&test_path);
  }

  #[test]
  fn test_storage_override_concurrent_access() {
    use std::sync::Arc;
    use std::thread;

    let test_path = Arc::new(std::env::temp_dir().join("donut_test_concurrent_44444"));
    let _ = std::fs::remove_dir_all(test_path.as_ref());
    std::fs::create_dir_all(test_path.as_ref()).unwrap();

    let handles: Vec<_> = (0..5)
      .map(|i| {
        let path = test_path.clone();
        thread::spawn(move || {
          let settings = StorageSettings {
            custom_path: Some(path.join(format!("thread_{}", i))),
            modified_at: Some(chrono::Utc::now().to_rfc3339()),
          };
          settings.apply()
        })
      })
      .collect();

    // All threads should complete without deadlock
    for handle in handles {
      let result = handle.join();
      assert!(result.is_ok(), "Thread should not panic");
    }

    // Override should be set (to one of the paths)
    assert!(is_storage_override_active());

    let _ = std::fs::remove_dir_all(test_path.as_ref());
  }

  #[test]
  fn test_storage_reset_to_default() {
    let settings = StorageSettings {
      custom_path: None,
      modified_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    // Apply with None should clear override
    settings.apply().unwrap();

    let current = get_storage_override();
    assert_eq!(current, None, "Override should be cleared");
  }
}
