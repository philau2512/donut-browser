#[cfg(test)]
mod tests {
  use super::*;

  // Removing `browser` from UpdateProfileRequest, and rejecting invalid
  // `browser` values on create, must NOT make the API reject requests that
  // carry extra/unknown fields — old clients still send them. serde ignores
  // unknown fields by default; these tests lock that in so a future
  // `#[serde(deny_unknown_fields)]` can't silently break compatibility.
  #[test]
  fn update_profile_request_ignores_unknown_fields() {
    // `browser` is no longer a field, plus a wholly unknown field. Both must
    // be accepted and ignored, not rejected.
    let json = r#"{"name": "p", "browser": "wayfern", "totally_unknown": 123}"#;
    let parsed: UpdateProfileRequest =
      serde_json::from_str(json).expect("unknown fields must be ignored, not rejected");
    assert_eq!(parsed.name.as_deref(), Some("p"));
  }

  #[test]
  fn create_profile_request_ignores_unknown_fields() {
    let json = r#"{"name": "p", "browser": "wayfern", "version": "latest", "future_field": true}"#;
    let parsed: CreateProfileRequest =
      serde_json::from_str(json).expect("unknown fields must be ignored, not rejected");
    assert_eq!(parsed.browser, "wayfern");
  }

  #[test]
  fn create_profile_request_allows_omitting_version_and_configs() {
    // Minimal body: no version, no wayfern_config/camoufox_config. Must
    // deserialize (version resolves to latest-downloaded at the handler; an
    // absent config triggers fresh-fingerprint generation).
    let json = r#"{"name": "p", "browser": "wayfern"}"#;
    let parsed: CreateProfileRequest =
      serde_json::from_str(json).expect("version and configs are optional");
    assert_eq!(parsed.browser, "wayfern");
    assert!(parsed.version.is_none());
    assert!(parsed.wayfern_config.is_none());
    assert!(parsed.camoufox_config.is_none());
  }

  #[test]
  fn update_profile_request_accepts_clear_on_close() {
    let json = r#"{"name": "p", "clear_on_close": true}"#;
    let parsed: UpdateProfileRequest =
      serde_json::from_str(json).expect("clear_on_close must deserialize");
    assert_eq!(parsed.clear_on_close, Some(true));
  }

  #[test]
  fn import_profiles_request_deserializes_batch_items() {
    let json = r#"{
      "items": [{"source_path": "C:/profiles/Default", "new_profile_name": "Imported"}],
      "duplicate_strategy": "rename"
    }"#;
    let parsed: ImportProfilesRequest =
      serde_json::from_str(json).expect("import batch body must deserialize");
    assert_eq!(parsed.items.len(), 1);
    assert_eq!(parsed.items[0].new_profile_name, "Imported");
    assert_eq!(
      parsed.duplicate_strategy,
      Some(crate::profile::profile_importer::DuplicateStrategy::Rename)
    );
  }
}
