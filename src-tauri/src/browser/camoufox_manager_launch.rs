
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

      if let Some(proxy_str) = &config.proxy {
        if let Ok(parsed) = url::Url::parse(proxy_str) {
          let host = parsed.host_str().unwrap_or("127.0.0.1");
          let port = parsed.port().unwrap_or(8080);
          let scheme = parsed.scheme();

          if scheme == "socks5" || scheme == "socks4" {
            prefs.push_str(&format!(
              "user_pref(\"network.proxy.type\", 1);\n\
               user_pref(\"network.proxy.socks\", \"{host}\");\n\
               user_pref(\"network.proxy.socks_port\", {port});\n\
               user_pref(\"network.proxy.socks_version\", {});\n\
               user_pref(\"network.proxy.socks_remote_dns\", true);\n",
              if scheme == "socks5" { 5 } else { 4 }
            ));
          } else {
            // HTTP/HTTPS proxy
            prefs.push_str(&format!(
              "user_pref(\"network.proxy.type\", 1);\n\
               user_pref(\"network.proxy.http\", \"{host}\");\n\
               user_pref(\"network.proxy.http_port\", {port});\n\
               user_pref(\"network.proxy.ssl\", \"{host}\");\n\
               user_pref(\"network.proxy.ssl_port\", {port});\n\
               user_pref(\"network.proxy.no_proxies_on\", \"\");\n"
            ));
          }
        }
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
  }
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref CAMOUFOX_LAUNCHER: CamoufoxManager = CamoufoxManager::new();
}
