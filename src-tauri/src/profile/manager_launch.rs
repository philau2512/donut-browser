impl ProfileManager {
  fn get_common_firefox_preferences(&self) -> Vec<String> {
    vec![
      // Disable default browser check
      "user_pref(\"browser.shell.checkDefaultBrowser\", false);".to_string(),
      "user_pref(\"browser.shell.skipDefaultBrowserCheckOnFirstRun\", true);".to_string(),
      "user_pref(\"browser.preferences.moreFromMozilla\", false);".to_string(),
      "user_pref(\"services.sync.prefs.sync.browser.startup.upgradeDialog.enabled\", false);"
        .to_string(),
      // Disable welcome / first-run screens
      "user_pref(\"browser.aboutwelcome.enabled\", false);".to_string(),
      "user_pref(\"browser.startup.homepage_override.mstone\", \"ignore\");".to_string(),
      "user_pref(\"startup.homepage_welcome_url\", \"\");".to_string(),
      "user_pref(\"startup.homepage_welcome_url.additional\", \"\");".to_string(),
      "user_pref(\"startup.homepage_override_url\", \"\");".to_string(),
      // Keep extension updates enabled and allow sideloaded extensions.
      // - autoDisableScopes=0: profile-installed extensions are enabled by default.
      // - startupScanScopes=1: rescan SCOPE_PROFILE on each launch so freshly
      //   dropped .xpi files in <profile>/extensions/ get registered.
      // - signatures.required=false: accept unsigned/dev .xpi files. Camoufox
      //   is built without MOZ_REQUIRE_SIGNING so this is honored.
      "user_pref(\"extensions.update.enabled\", true);".to_string(),
      "user_pref(\"extensions.update.autoUpdateDefault\", true);".to_string(),
      "user_pref(\"extensions.autoDisableScopes\", 0);".to_string(),
      "user_pref(\"extensions.startupScanScopes\", 1);".to_string(),
      "user_pref(\"xpinstall.signatures.required\", false);".to_string(),
      // Completely disable browser update checking
      "user_pref(\"app.update.enabled\", false);".to_string(),
      "user_pref(\"app.update.auto\", false);".to_string(),
      "user_pref(\"app.update.mode\", 0);".to_string(),
      "user_pref(\"app.update.service.enabled\", false);".to_string(),
      "user_pref(\"app.update.staging.enabled\", false);".to_string(),
      "user_pref(\"app.update.silent\", true);".to_string(),
      "user_pref(\"app.update.disabledForTesting\", true);".to_string(),
      // Prevent update URL access entirely
      "user_pref(\"app.update.url\", \"\");".to_string(),
      "user_pref(\"app.update.url.manual\", \"\");".to_string(),
      "user_pref(\"app.update.url.details\", \"\");".to_string(),
      // Disable update timing/scheduling
      "user_pref(\"app.update.timerFirstInterval\", 999999999);".to_string(),
      "user_pref(\"app.update.interval\", 999999999);".to_string(),
      "user_pref(\"app.update.background.interval\", 999999999);".to_string(),
      "user_pref(\"app.update.idletime\", 999999999);".to_string(),
      "user_pref(\"app.update.promptWaitTime\", 999999999);".to_string(),
      // Disable update attempts
      "user_pref(\"app.update.download.maxAttempts\", 0);".to_string(),
      "user_pref(\"app.update.elevate.maxAttempts\", 0);".to_string(),
      "user_pref(\"app.update.checkInstallTime\", false);".to_string(),
      // Suppress update UI/prompts/notifications
      "user_pref(\"app.update.doorhanger\", false);".to_string(),
      "user_pref(\"app.update.badge\", false);".to_string(),
      "user_pref(\"app.update.notifyDuringDownload\", false);".to_string(),
      "user_pref(\"app.update.background.scheduling.enabled\", false);".to_string(),
      "user_pref(\"app.update.background.enabled\", false);".to_string(),
      // Disable BITS (Windows Background Intelligent Transfer Service) updates
      "user_pref(\"app.update.BITS.enabled\", false);".to_string(),
      // Disable language pack updates
      "user_pref(\"app.update.langpack.enabled\", false);".to_string(),
      // Suppress upgrade dialogs on startup
      "user_pref(\"browser.startup.upgradeDialog.enabled\", false);".to_string(),
      // Disable update ping telemetry
      "user_pref(\"toolkit.telemetry.updatePing.enabled\", false);".to_string(),
      // Zen browser specific - disable welcome screen and updates
      "user_pref(\"zen.welcome-screen.seen\", true);".to_string(),
      "user_pref(\"zen.updates.enabled\", false);".to_string(),
      "user_pref(\"zen.updates.check-for-updates\", false);".to_string(),
      // Additional first-run suppressions
      "user_pref(\"app.normandy.first_run\", false);".to_string(),
      "user_pref(\"trailhead.firstrun.didSeeAboutWelcome\", true);".to_string(),
      "user_pref(\"datareporting.policy.dataSubmissionPolicyBypassNotification\", true);"
        .to_string(),
      "user_pref(\"toolkit.telemetry.reportingpolicy.firstRun\", false);".to_string(),
      // Disable quit confirmation dialogs
      "user_pref(\"browser.warnOnQuit\", false);".to_string(),
      "user_pref(\"browser.showQuitWarning\", false);".to_string(),
      "user_pref(\"browser.tabs.warnOnClose\", false);".to_string(),
      "user_pref(\"browser.tabs.warnOnCloseOtherTabs\", false);".to_string(),
      "user_pref(\"browser.sessionstore.warnOnQuit\", false);".to_string(),
    ]
  }

  pub fn apply_proxy_settings_to_profile(
    &self,
    profile_data_path: &Path,
    proxy: &ProxySettings,
    internal_proxy: Option<&ProxySettings>,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let user_js_path = profile_data_path.join("user.js");
    let prefs_js_path = profile_data_path.join("prefs.js");

    // Remove prefs.js if it exists to ensure Firefox reads user.js instead
    // Firefox may cache proxy settings in prefs.js, so we need to clear it
    if prefs_js_path.exists() {
      log::info!("Removing prefs.js to ensure Firefox reads updated user.js settings");
      let _ = fs::remove_file(&prefs_js_path);
    }

    let mut preferences = Vec::new();

    // Add common Firefox preferences (like disabling default browser check)
    preferences.extend(self.get_common_firefox_preferences());

    // Determine which proxy settings to use
    let effective_proxy = internal_proxy.unwrap_or(proxy);
    let proxy_host = &effective_proxy.host;
    let proxy_port = effective_proxy.port;

    // Check if this is a SOCKS proxy (only possible when using upstream directly)
    let is_socks =
      internal_proxy.is_none() && (proxy.proxy_type == "socks4" || proxy.proxy_type == "socks5");

    log::info!(
      "Applying manual proxy settings to Firefox profile: {}:{} (is_internal: {}, is_socks: {})",
      proxy_host,
      proxy_port,
      internal_proxy.is_some(),
      is_socks
    );

    // Use MANUAL proxy configuration (type 1) instead of PAC file (type 2)
    // PAC files with file:// URLs are blocked by privacy-focused browsers like Zen
    // Manual proxy configuration works reliably across all Firefox variants
    preferences.push("user_pref(\"network.proxy.type\", 1);".to_string());

    if is_socks {
      // SOCKS proxy configuration
      preferences.extend([
        format!("user_pref(\"network.proxy.socks\", \"{}\");", proxy_host),
        format!("user_pref(\"network.proxy.socks_port\", {});", proxy_port),
        format!(
          "user_pref(\"network.proxy.socks_version\", {});",
          if proxy.proxy_type == "socks5" { 5 } else { 4 }
        ),
        "user_pref(\"network.proxy.http\", \"\");".to_string(),
        "user_pref(\"network.proxy.http_port\", 0);".to_string(),
        "user_pref(\"network.proxy.ssl\", \"\");".to_string(),
        "user_pref(\"network.proxy.ssl_port\", 0);".to_string(),
      ]);
    } else {
      // HTTP/HTTPS proxy configuration (including our internal local proxy)
      preferences.extend([
        format!("user_pref(\"network.proxy.http\", \"{}\");", proxy_host),
        format!("user_pref(\"network.proxy.http_port\", {});", proxy_port),
        format!("user_pref(\"network.proxy.ssl\", \"{}\");", proxy_host),
        format!("user_pref(\"network.proxy.ssl_port\", {});", proxy_port),
        format!("user_pref(\"network.proxy.ftp\", \"{}\");", proxy_host),
        format!("user_pref(\"network.proxy.ftp_port\", {});", proxy_port),
        "user_pref(\"network.proxy.socks\", \"\");".to_string(),
        "user_pref(\"network.proxy.socks_port\", 0);".to_string(),
      ]);
    }

    // Common proxy settings - keep it simple like proxy-chain expected
    preferences.extend([
      "user_pref(\"network.proxy.no_proxies_on\", \"\");".to_string(),
      "user_pref(\"network.proxy.autoconfig_url\", \"\");".to_string(),
      // Disable QUIC/HTTP3 - it bypasses HTTP proxy
      "user_pref(\"network.http.http3.enable\", false);".to_string(),
      "user_pref(\"network.http.http3.enabled\", false);".to_string(),
    ]);

    // Write settings to user.js file
    let user_js_content = preferences.join("\n");
    fs::write(user_js_path, &user_js_content)?;
    log::info!(
      "Updated user.js with manual proxy settings: {}:{}",
      proxy_host,
      proxy_port
    );

    Ok(())
  }

  pub fn disable_proxy_settings_in_profile(
    &self,
    profile_data_path: &Path,
  ) -> Result<(), Box<dyn std::error::Error>> {
    let user_js_path = profile_data_path.join("user.js");
    let mut preferences = Vec::new();

    // Get the UUID directory (parent of profile data directory)
    let uuid_dir = profile_data_path
      .parent()
      .ok_or("Invalid profile path - cannot find UUID directory")?;

    // Add common Firefox preferences (like disabling default browser check)
    preferences.extend(self.get_common_firefox_preferences());

    preferences.push("user_pref(\"network.proxy.type\", 0);".to_string());
    preferences.push("user_pref(\"network.proxy.failover_direct\", true);".to_string());

    // Create a direct proxy PAC file in UUID directory
    let pac_content = "function FindProxyForURL(url, host) { return 'DIRECT'; }";
    let pac_path = uuid_dir.join("proxy.pac");
    fs::write(&pac_path, pac_content)?;
    let pac_url =
      url::Url::from_file_path(&pac_path).map_err(|_| "Failed to convert PAC path to file URL")?;
    preferences.push(format!(
      "user_pref(\"network.proxy.autoconfig_url\", \"{}\");",
      pac_url.as_str()
    ));

    fs::write(user_js_path, preferences.join("\n"))?;

    Ok(())
  }
}
