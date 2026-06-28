
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
}
