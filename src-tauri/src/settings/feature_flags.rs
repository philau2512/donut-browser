use serde::{Deserialize, Serialize};

/// Runtime feature flags for upstream sync features.
/// Persisted in app_settings.json under "feature_flags".
/// Toggle features without recompile — edit settings.json directly or use
/// the `set_feature_flag` Tauri command (MCP/API only, no frontend UI yet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlags {
  /// IPv6 support for WireGuard VPN (upstream 23dab4c).
  /// Default false until dual-stack testing is complete.
  #[serde(default)]
  pub ipv6_vpn: bool,

  /// Per-profile window color passed as `--window-color` to Wayfern (upstream 63a1f4c).
  /// Default FALSE — injecting this flag into all existing profiles will break
  /// launch on any pinned Wayfern version that does not support it.
  /// Enable only after verifying Wayfern `--window-color` flag support.
  #[serde(default)]
  pub window_colors: bool,

  /// Emit extension sync-status events to frontend (upstream 8628317).
  /// Default true — pure addition with no risk to existing behavior.
  #[serde(default = "default_true")]
  pub sync_events: bool,
}

fn default_true() -> bool {
  true
}

impl Default for FeatureFlags {
  fn default() -> Self {
    Self {
      ipv6_vpn: false,
      window_colors: false, // SAFE DEFAULT: verify Wayfern compat before enabling
      sync_events: true,
    }
  }
}
