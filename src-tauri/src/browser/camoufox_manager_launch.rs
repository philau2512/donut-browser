
impl CamoufoxManager {
  #[allow(clippy::too_many_arguments)]
  pub async fn launch_camoufox_profile(
    &self,
    app_handle: AppHandle,
    profile: BrowserProfile,
    config: CamoufoxConfig,
    url: Option<String>,
    override_profile_path: Option<std::path::PathBuf>,
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<CamoufoxLaunchResult, String> {
    // Get profile path
    let profile_path = if let Some(ref override_path) = override_profile_path {
      override_path.clone()
    } else {
      let profiles_dir = self.get_profiles_dir();
      profile.get_profile_data_path(&profiles_dir)
    };
    let profile_path_str = profile_path.to_string_lossy();

    // Check if there's already a running instance for this profile
    if let Ok(Some(existing)) = self.find_camoufox_by_profile(&profile_path_str).await {
      // If there's an existing instance, stop it first to avoid conflicts
      let _ = self.stop_camoufox(&app_handle, &existing.id).await;
    }

    // Clean up any dead instances before launching
    let _ = self.cleanup_dead_instances().await;

    // For ephemeral profiles, write Firefox prefs to minimize disk writes
    if override_profile_path.is_some() {
      let user_js_path = profile_path.join("user.js");
      let prefs = concat!(
        "user_pref(\"browser.cache.disk.enable\", false);\n",
        "user_pref(\"browser.cache.memory.enable\", true);\n",
        "user_pref(\"browser.sessionstore.resume_from_crash\", false);\n",
        "user_pref(\"browser.sessionstore.max_tabs_undo\", 0);\n",
        "user_pref(\"browser.sessionstore.max_windows_undo\", 0);\n",
        "user_pref(\"places.history.enabled\", false);\n",
        "user_pref(\"browser.formfill.enable\", false);\n",
        "user_pref(\"signon.rememberSignons\", false);\n",
        "user_pref(\"browser.bookmarks.max_backups\", 0);\n",
        "user_pref(\"browser.shell.checkDefaultBrowser\", false);\n",
        "user_pref(\"toolkit.crashreporter.enabled\", false);\n",
        "user_pref(\"browser.pagethumbnails.capturing_disabled\", true);\n",
        "user_pref(\"browser.download.manager.addToRecentDocs\", false);\n",
      );
      if let Err(e) = std::fs::write(&user_js_path, prefs) {
        log::warn!("Failed to write ephemeral user.js: {e}");
      }
    }

    // Patch user.js with Camoufox-specific overrides on every launch. This
    // always runs (not gated on the proxy being set) because Camoufox's
    // bundled camoufox.cfg ships defaults that break basic browser features
    // and we need to override them per-profile.
    {
      let user_js_path = profile_path.join("user.js");
      let mut prefs = String::new();

      // Preserve existing user.js lines, but strip any keys we're about to
      // re-emit so they never duplicate.
      let managed_keys = [
        "network.proxy.",
        "network.http.http3.enable",
        "network.http.http3.enabled",
        "xpinstall.signatures.required",
        "extensions.startupScanScopes",
        "browser.sessionhistory.max_entries",
        "browser.sessionhistory.max_total_viewers",
      ];
      if let Ok(existing) = std::fs::read_to_string(&user_js_path) {
        for line in existing.lines() {
          if !managed_keys.iter().any(|k| line.contains(k)) {
            prefs.push_str(line);
            prefs.push('\n');
          }
        }
      }

      // Camoufox's bundled camoufox.cfg sets these to 0, which makes
      // docShell remember zero prior pages and leaves the toolbar
      // back/forward buttons permanently disabled no matter how much
      // the user navigates. Restore Firefox defaults.
      prefs.push_str(
        "user_pref(\"browser.sessionhistory.max_entries\", 50);\n\
         user_pref(\"browser.sessionhistory.max_total_viewers\", -1);\n",
      );

      // Required for sideloaded extensions:
      // - signatures.required=false accepts unsigned .xpi (Camoufox is built
      //   without MOZ_REQUIRE_SIGNING so this is honored).
      // - startupScanScopes=1 rescans SCOPE_PROFILE on each launch so newly
      //   dropped .xpi files in <profile>/extensions/ get registered.
      prefs.push_str(
        "user_pref(\"xpinstall.signatures.required\", false);\n\
         user_pref(\"extensions.startupScanScopes\", 1);\n",
      );

      // Disable HTTP/3 / QUIC. Camoufox always sits behind the local
      // donut-proxy, and Firefox-150's QUIC stack bypasses configured HTTP
      // proxies and goes direct UDP to the remote host. With an upstream
      // proxy that's the only allowed egress, that traffic silently fails
      // and pages won't load. (Chromium suppresses QUIC under a proxy on
      // its own, so Wayfern doesn't need the equivalent toggle.) Both
      // pref names are emitted because they've been renamed across FF
      // versions and either could be the active one at runtime.
      prefs.push_str(
        "user_pref(\"network.http.http3.enable\", false);\n\
         user_pref(\"network.http.http3.enabled\", false);\n",
      );

      // WebRTC Configuration
      let webrtc_mode = config.webrtc_mode.as_deref().unwrap_or(
        if config.block_webrtc.unwrap_or(false) { "disable" } else { "forward" }
      );
      match webrtc_mode {
        "disable" => {
          prefs.push_str("user_pref(\"media.peerconnection.enabled\", false);\n");
        }
        "forward" => {
          prefs.push_str(
            "user_pref(\"media.peerconnection.enabled\", true);\n\
             user_pref(\"media.peerconnection.ice.proxy_only_if_bypass\", true);\n\
             user_pref(\"media.peerconnection.ice.default_address_only\", true);\n"
          );
        }
        "forward_google" => {
          prefs.push_str(
            "user_pref(\"media.peerconnection.enabled\", true);\n\
             user_pref(\"media.peerconnection.ice.proxy_only_if_bypass\", false);\n\
             user_pref(\"media.peerconnection.ice.default_address_only\", true);\n"
          );
        }
        "real" => {
          prefs.push_str(
            "user_pref(\"media.peerconnection.enabled\", true);\n\
             user_pref(\"media.peerconnection.ice.proxy_only_if_bypass\", false);\n\
             user_pref(\"media.peerconnection.ice.default_address_only\", false);\n"
          );
        }
        "alter" => {
          prefs.push_str(
            "user_pref(\"media.peerconnection.enabled\", true);\n\
             user_pref(\"media.peerconnection.ice.proxy_only_if_bypass\", false);\n\
             user_pref(\"media.peerconnection.ice.default_address_only\", false);\n"
          );
        }
        _ => {}
      }

      // NOTE: Proxy configuration is handled by the external donut-proxy layer
      // (Rust sidecar), NOT via Firefox prefs. Setting network.proxy.* in user.js
      // creates a detectable fingerprint (pixelscan.net, browserleaks.com).
      // Camoufox launches behind local proxy (127.0.0.1) without exposing prefs.
      // If config.proxy is set, it's used by donut-proxy for upstream routing.
      if let Some(_proxy_str) = &config.proxy {
        // Proxy routing is managed externally — do not emit network.proxy prefs.
        // This avoids "Proxy detected" on fingerprint scanners.
        log::debug!("Proxy configured via external layer, skipping user.js prefs");
      }

      if let Err(e) = std::fs::write(&user_js_path, prefs) {
        log::warn!("Failed to write user.js: {e}");
      }
    }

    self
      .launch_camoufox(
        &app_handle,
        &profile,
        &profile_path_str,
        &config,
        url.as_deref(),
        remote_debugging_port,
        headless,
      )
      .await
      .map_err(|e| format!("Failed to launch Camoufox: {e}"))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_default_config() {
    let default_config = CamoufoxConfig::default();

    // Verify defaults
    assert_eq!(default_config.geoip, Some(serde_json::Value::Bool(true)));
    assert_eq!(default_config.proxy, None);
    assert_eq!(default_config.fingerprint, None);
    assert_eq!(default_config.randomize_fingerprint_on_launch, None);
    assert_eq!(default_config.os, None);
    assert_eq!(default_config.webrtc_mode, None);
  }

  #[test]
  fn test_camoufox_config_webrtc_serialization() {
    // If webrtc_mode is provided
    let json_str = r#"{"webrtc_mode": "forward_google"}"#;
    let config: CamoufoxConfig = serde_json::from_str(json_str).unwrap();
    assert_eq!(config.webrtc_mode.as_deref(), Some("forward_google"));

    // If nothing is provided, it should be None
    let json_empty = r#"{}"#;
    let config_empty: CamoufoxConfig = serde_json::from_str(json_empty).unwrap();
    assert_eq!(config_empty.webrtc_mode, None);
    assert_eq!(config_empty.block_webrtc, None);
  }
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref CAMOUFOX_LAUNCHER: CamoufoxManager = CamoufoxManager::new();
}
