
lazy_static::lazy_static! {
  static ref WAYFERN_MANAGER: WayfernManager = WayfernManager::new();
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn window_size_prefers_outer_window_dimensions() {
    // Field names + values mirror a real Wayfern fingerprint (camelCase).
    let fp = r#"{"windowOuterWidth": 1268, "windowOuterHeight": 764,
                 "windowInnerWidth": 1253, "windowInnerHeight": 630,
                 "screenAvailWidth": 1280, "screenAvailHeight": 775,
                 "screenWidth": 1280, "screenHeight": 800}"#;
    assert_eq!(
      WayfernManager::window_size_from_fingerprint(fp),
      Some((1268, 764))
    );
  }

  #[test]
  fn window_size_falls_back_to_avail_then_full_screen() {
    let avail = r#"{"screenAvailWidth": 1280, "screenAvailHeight": 775,
                    "screenWidth": 1280, "screenHeight": 800}"#;
    assert_eq!(
      WayfernManager::window_size_from_fingerprint(avail),
      Some((1280, 775))
    );

    let full = r#"{"screenWidth": 2560, "screenHeight": 1440}"#;
    assert_eq!(
      WayfernManager::window_size_from_fingerprint(full),
      Some((2560, 1440))
    );
  }

  #[test]
  fn window_size_handles_wrapper_and_stringified_numbers() {
    let wrapped = r#"{"fingerprint": {"windowOuterWidth": "1366", "windowOuterHeight": "768"}}"#;
    assert_eq!(
      WayfernManager::window_size_from_fingerprint(wrapped),
      Some((1366, 768))
    );
  }

  #[test]
  fn window_size_none_when_missing_or_invalid() {
    // No dimensions at all.
    assert_eq!(
      WayfernManager::window_size_from_fingerprint(r#"{"userAgent": "x"}"#),
      None
    );
    // A width with no matching height is not a usable pair.
    assert_eq!(
      WayfernManager::window_size_from_fingerprint(r#"{"windowOuterWidth": 1268}"#),
      None
    );
    // Zero is rejected as a degenerate size.
    assert_eq!(
      WayfernManager::window_size_from_fingerprint(
        r#"{"windowOuterWidth": 0, "windowOuterHeight": 0}"#
      ),
      None
    );
    // Not valid JSON.
    assert_eq!(
      WayfernManager::window_size_from_fingerprint("not json"),
      None
    );
  }

  #[test]
  fn test_wayfern_config_webrtc_serialization() {
    // If webrtc_mode is provided
    let json_str = r#"{"webrtc_mode": "alter"}"#;
    let config: WayfernConfig = serde_json::from_str(json_str).unwrap();
    assert_eq!(config.webrtc_mode.as_deref(), Some("alter"));

    // If nothing is provided, it should be None
    let json_empty = r#"{}"#;
    let config_empty: WayfernConfig = serde_json::from_str(json_empty).unwrap();
    assert_eq!(config_empty.webrtc_mode, None);
    assert_eq!(config_empty.block_webrtc, None);
  }

  #[test]
  fn clamp_screen_resolution_removes_fractional_pixels() {
    let mut fp: serde_json::Value = serde_json::json!({
      "screenWidth": 2560.5,
      "screenHeight": 1600.5,
      "windowOuterWidth": 2560,
      "windowOuterHeight": 1600
    });
    WayfernManager::clamp_screen_resolution(&mut fp, "windows").unwrap();
    assert_eq!(fp["screenWidth"], 2561); // rounded
    assert_eq!(fp["screenHeight"], 1601);
  }

  #[test]
  fn clamp_screen_resolution_replaces_mac_retina_on_windows() {
    let mut fp: serde_json::Value = serde_json::json!({
      "screenWidth": 2560,
      "screenHeight": 1600,
      "windowOuterWidth": 2560,
      "windowOuterHeight": 1600
    });
    WayfernManager::clamp_screen_resolution(&mut fp, "windows").unwrap();
    // Mac Retina 2560x1600 replaced with common Windows resolution
    assert_eq!(fp["screenWidth"], 1920);
    assert_eq!(fp["screenHeight"], 1080);
  }

  #[test]
  fn clamp_screen_resolution_preserves_macos_fractional() {
    let mut fp: serde_json::Value = serde_json::json!({
      "screenWidth": 2560.5,
      "screenHeight": 1600.5
    });
    WayfernManager::clamp_screen_resolution(&mut fp, "macos").unwrap();
    // macOS allows fractional pixels (Retina)
    assert_eq!(fp["screenWidth"], 2560.5);
    assert_eq!(fp["screenHeight"], 1600.5);
  }

  #[test]
  fn validate_fingerprint_consistency_rejects_fractional_on_windows() {
    let fp: serde_json::Value = serde_json::json!({
      "screenWidth": 2560.5,
      "screenHeight": 1600.5
    });
    let result = WayfernManager::validate_fingerprint_consistency(&fp, "windows");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("fractional pixels"));
  }

  #[test]
  fn validate_fingerprint_consistency_accepts_integers_on_windows() {
    let fp: serde_json::Value = serde_json::json!({
      "screenWidth": 1920,
      "screenHeight": 1080,
      "windowOuterWidth": 1820,
      "screenAvailWidth": 1920
    });
    let result = WayfernManager::validate_fingerprint_consistency(&fp, "windows");
    assert!(result.is_ok());
  }

  #[test]
  fn validate_fingerprint_consistency_rejects_mac_retina_on_windows() {
    let fp: serde_json::Value = serde_json::json!({
      "screenWidth": 2560,
      "screenHeight": 1600
    });
    let result = WayfernManager::validate_fingerprint_consistency(&fp, "windows");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Mac Retina"));
  }

  #[test]
  fn validate_fingerprint_consistency_accepts_mac_retina_on_macos() {
    let fp: serde_json::Value = serde_json::json!({
      "screenWidth": 2560.5,
      "screenHeight": 1600.5
    });
    let result = WayfernManager::validate_fingerprint_consistency(&fp, "macos");
    assert!(result.is_ok());
  }
}
