impl WayfernManager {
  #[allow(clippy::too_many_arguments)]
  pub async fn launch_wayfern(
    &self,
    _app_handle: &AppHandle,
    profile: &BrowserProfile,
    profile_path: &str,
    config: &WayfernConfig,
    url: Option<&str>,
    proxy_url: Option<&str>,
    ephemeral: bool,
    extension_paths: &[String],
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<WayfernLaunchResult, Box<dyn std::error::Error + Send + Sync>> {
    let executable_path = BrowserRunner::instance()
      .get_browser_executable_path(profile)
      .map_err(|e| format!("Failed to get Wayfern executable path: {e}"))?;

    let port = match remote_debugging_port {
      Some(p) => p,
      None => Self::find_free_port().await?,
    };
    log::info!("Launching Wayfern on CDP port {port} (detached)");

    // Diagnostic: verify critical profile files and test cookie decryption
    {
      let profile_path_buf = std::path::PathBuf::from(profile_path);
      let key_path = profile_path_buf.join("os_crypt_key");
      let cookies_path = {
        let network = profile_path_buf
          .join("Default")
          .join("Network")
          .join("Cookies");
        if network.exists() {
          network
        } else {
          profile_path_buf.join("Default").join("Cookies")
        }
      };

      if key_path.exists() {
        let key_text = std::fs::read_to_string(&key_path).unwrap_or_default();
        log::info!(
          "Pre-launch: os_crypt_key present ({} bytes, content: '{}')",
          key_text.len(),
          key_text.trim()
        );
      } else {
        log::warn!("Pre-launch: os_crypt_key NOT FOUND");
      }

      if cookies_path.exists() {
        // Try to open Cookies DB and check if encrypted cookies can be decrypted
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
          &cookies_path,
          rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
          let cookie_count: i64 = conn
            .query_row(
              "SELECT COUNT(*) FROM cookies WHERE length(encrypted_value) > 0",
              [],
              |r| r.get(0),
            )
            .unwrap_or(0);
          let total_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM cookies", [], |r| r.get(0))
            .unwrap_or(0);
          log::info!(
            "Pre-launch: Cookies DB has {} total cookies, {} encrypted",
            total_count,
            cookie_count
          );

          // Try decrypting one cookie using the cookie_manager if there are encrypted cookies
          if cookie_count > 0 {
            if let Some(encryption_key) =
              crate::profile::cookie_manager::chrome_decrypt::get_encryption_key(&profile_path_buf)
            {
              if let Ok(mut stmt) = conn.prepare(
                "SELECT name, host_key, encrypted_value FROM cookies WHERE length(encrypted_value) > 0 LIMIT 1",
              ) {
                if let Ok(mut rows) = stmt.query([]) {
                  if let Ok(Some(row)) = rows.next() {
                    let name: String = row.get(0).unwrap_or_default();
                    let host: String = row.get(1).unwrap_or_default();
                    let encrypted: Vec<u8> = row.get(2).unwrap_or_default();
                    let decrypted = crate::profile::cookie_manager::chrome_decrypt::decrypt(
                      &encrypted,
                      &host,
                      &encryption_key,
                    );
                    match decrypted {
                      Some(val) => log::info!(
                        "Pre-launch: Cookie decryption SUCCEEDED for '{}' (host: {}, decrypted {} bytes)",
                        name, host, val.len()
                      ),
                      None => log::error!(
                        "Pre-launch: Cookie decryption FAILED for '{}' (host: {}, encrypted {} bytes)",
                        name, host, encrypted.len()
                      ),
                    }
                  }
                }
              }
            } else {
              log::warn!("Pre-launch: Unable to derive encryption key from os_crypt_key; skipping decryption of {} encrypted cookies",
                cookie_count);
            }
          }
        }
      } else {
        log::warn!("Pre-launch: Cookies NOT FOUND");
      }
    }

    let mut args = vec![
      format!("--remote-debugging-port={port}"),
      "--remote-debugging-address=127.0.0.1".to_string(),
      format!("--user-data-dir={profile_path}"),
      "--no-first-run".to_string(),
      "--no-default-browser-check".to_string(),
      "--disable-background-mode".to_string(),
      "--disable-component-update".to_string(),
      "--disable-background-timer-throttling".to_string(),
      "--crash-server-url=".to_string(),
      "--disable-updater".to_string(),
      "--disable-session-crashed-bubble".to_string(),
      "--hide-crash-restore-bubble".to_string(),
      "--disable-infobars".to_string(),
      // Prefetch* / NoStatePrefetch: cross-site Speculation-Rules prefetch uses
      // an isolated NetworkContext that defaults to DIRECT egress (real host IP
      // leaks past the per-profile proxy). Disabling via a LAUNCH FLAG cannot be
      // re-enabled by an imported/synced network_prediction_options pref (which a
      // compile-time pref default could be).
      "--disable-features=DialMediaRouteProvider,DnsOverHttps,AsyncDns,Prefetch,PrefetchProxy,SpeculationRulesPrefetchFuture,NoStatePrefetch".to_string(),
      "--use-mock-keychain".to_string(),
      "--password-store=basic".to_string(),
    ];

    if headless {
      args.push("--headless=new".to_string());
    } else if let Some((w, h)) = config
      .fingerprint
      .as_deref()
      .and_then(Self::window_size_from_fingerprint)
    {
      // Size the real OS window to match the fingerprint so the visible window
      // agrees with the reported windowOuterWidth/screen dimensions. Anchor at
      // 0,0 so the window also fits within the spoofed screen origin. Skipped in
      // headless mode, where there is no on-screen window.
      log::info!("Sizing Wayfern window to fingerprint dimensions: {w}x{h}");
      args.push(format!("--window-size={w},{h}"));
      args.push("--window-position=0,0".to_string());
    }

    #[cfg(target_os = "linux")]
    {
      args.push("--no-sandbox".to_string());
      args.push("--disable-setuid-sandbox".to_string());
      args.push("--disable-dev-shm-usage".to_string());
    }

    if ephemeral {
      args.push("--disk-cache-size=1".to_string());
      args.push("--disable-breakpad".to_string());
      args.push("--disable-crash-reporter".to_string());
      args.push("--no-service-autorun".to_string());
      args.push("--disable-sync".to_string());
    }

    if !extension_paths.is_empty() {
      args.push(format!("--load-extension={}", extension_paths.join(",")));
    }

    let mut wayfern_token = crate::api::cloud_auth::CLOUD_AUTH.get_wayfern_token().await;
    if wayfern_token.is_none()
      && crate::api::cloud_auth::CLOUD_AUTH
        .has_active_paid_subscription()
        .await
    {
      // Brief wait for the background token fetch — when the API is healthy
      // the token usually lands in well under a second. If api.donutbrowser.com
      // is unreachable we don't want to gate the whole launch on it; the
      // browser still works without the token (cross-OS fingerprinting just
      // won't be enabled for this session, and the next launch will pick it
      // up once the token arrives).
      log::info!("Wayfern token not ready for paid user, waiting briefly...");
      for _ in 0..3 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        wayfern_token = crate::api::cloud_auth::CLOUD_AUTH.get_wayfern_token().await;
        if wayfern_token.is_some() {
          break;
        }
      }
      if wayfern_token.is_none() {
        log::warn!(
          "Wayfern token still unavailable after wait; launching without it (api.donutbrowser.com may be unreachable)"
        );
      }
    }
    if let Some(ref token) = wayfern_token {
      args.push(format!("--wayfern-token={token}"));
      log::info!("Wayfern token passed as CLI flag (length: {})", token.len());
    }

    if let Some(proxy) = proxy_url {
      // Map the local proxy scheme to the matching PAC directive. SOCKS5 lets
      // Chromium route UDP (QUIC/WebRTC) and resolve DNS through the proxy;
      // PROXY is HTTP CONNECT (TCP only). The host:port is the same either way.
      let (pac_directive, host_port) = if let Some(rest) = proxy.strip_prefix("socks5://") {
        ("SOCKS5", rest)
      } else {
        (
          "PROXY",
          proxy
            .trim_start_matches("http://")
            .trim_start_matches("https://"),
        )
      };
      let pac_data = format!(
        "data:application/x-ns-proxy-autoconfig,function FindProxyForURL(url,host){{return \"{pac_directive} {host_port}\";}}",
      );
      args.push(format!("--proxy-pac-url={pac_data}"));
      args.push("--dns-prefetch-disable".to_string());
    }

    let mut command = TokioCommand::new(&executable_path);
    command
      .args(&args)
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null());

    let mut child = command
      .spawn()
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        let hint = if e.raw_os_error() == Some(14001) {
          ". This usually means the Visual C++ Redistributable is not installed. \
           Download it from https://aka.ms/vs/17/release/vc_redist.x64.exe"
        } else {
          ""
        };
        format!("Failed to spawn Wayfern: {e}{hint}").into()
      })?;
    let process_id = child.id();

    let app_handle_exit = _app_handle.clone();
    let profile_id_exit = profile.id.to_string();
    let profile_name_exit = profile.name.clone();
    tokio::spawn(async move {
      let (exit_details, is_crash) = match child.wait().await {
        Ok(status) => {
          log::info!(
            "Wayfern PID {:?} for {} exited with status: {:?}",
            process_id,
            profile_name_exit,
            status
          );
          (format!("status={:?}", status), !status.success())
        }
        Err(e) => {
          log::warn!("Failed to wait for Wayfern PID {:?} exit: {}", process_id, e);
          (format!("wait_error={}", e), true)
        }
      };
      let runner = BrowserRunner::instance();
      if let Err(e) = runner.handle_profile_stopped(&app_handle_exit, &profile_id_exit, Some(&exit_details), is_crash).await {
        log::warn!("Error running handle_profile_stopped for Wayfern {}: {e}", profile_name_exit);
      }
    });

    self.wait_for_cdp_ready(port).await?;

    let targets = self.get_cdp_targets(port).await?;
    log::info!("Found {} CDP targets", targets.len());

    let page_targets: Vec<_> = targets.iter().filter(|t| t.target_type == "page").collect();
    log::info!("Found {} page targets", page_targets.len());

    // Apply fingerprint if configured
    let mut used_fingerprint: Option<String> = None;
    if let Some(fingerprint_json) = &config.fingerprint {
      log::info!(
        "Applying fingerprint to Wayfern browser, fingerprint length: {} chars",
        fingerprint_json.len()
      );

      let stored_value: serde_json::Value = serde_json::from_str(fingerprint_json)
        .map_err(|e| format!("Failed to parse stored fingerprint JSON: {e}"))?;

      // The stored fingerprint should be the fingerprint object directly (after our fix in generate_fingerprint_config)
      // But for backwards compatibility, also handle the wrapped format
      let mut fingerprint = if stored_value.get("fingerprint").is_some() {
        // Old format: {"fingerprint": {...}} - extract the inner fingerprint
        stored_value.get("fingerprint").cloned().unwrap()
      } else {
        // New format: fingerprint object directly {...}
        stored_value.clone()
      };

      // Add default timezone if not present (for profiles created before timezone was added)
      if let Some(obj) = fingerprint.as_object_mut() {
        if !obj.contains_key("timezone") {
          obj.insert("timezone".to_string(), json!("America/New_York"));
          log::info!("Added default timezone to fingerprint");
        }
        if !obj.contains_key("timezoneOffset") {
          obj.insert("timezoneOffset".to_string(), json!(300));
          log::info!("Added default timezoneOffset to fingerprint");
        }
      }

      // Denormalize fingerprint for Wayfern CDP (convert arrays/objects to JSON strings)
      let mut fingerprint_for_cdp = Self::denormalize_fingerprint(fingerprint);

      // Normalize languages: if it's a comma-separated string, convert to array
      if let Some(obj) = fingerprint_for_cdp.as_object_mut() {
        if let Some(serde_json::Value::String(s)) = obj.get("languages").cloned() {
          let arr: Vec<&str> = s.split(',').map(|l| l.trim()).collect();
          obj.insert("languages".to_string(), json!(arr));
        }
      }

      log::info!(
        "Fingerprint prepared for CDP command, fields: {:?}",
        fingerprint_for_cdp
          .as_object()
          .map(|o| o.keys().collect::<Vec<_>>())
      );

      // Log timezone and geolocation fields specifically for debugging
      if let Some(obj) = fingerprint_for_cdp.as_object() {
        log::info!(
          "Timezone/Geolocation fields - timezone: {:?}, timezoneOffset: {:?}, latitude: {:?}, longitude: {:?}, language: {:?}, languages: {:?}",
          obj.get("timezone"),
          obj.get("timezoneOffset"),
          obj.get("latitude"),
          obj.get("longitude"),
          obj.get("language"),
          obj.get("languages")
        );
      }

      // Include wayfern token if available (enables cross-OS fingerprinting for paid users)
      let wayfern_token = crate::api::cloud_auth::CLOUD_AUTH.get_wayfern_token().await;
      let mut fingerprint_params = fingerprint_for_cdp.clone();
      if let Some(ref token) = wayfern_token {
        if let Some(obj) = fingerprint_params.as_object_mut() {
          obj.insert("wayfernToken".to_string(), json!(token));
        }
      }

      for target in &page_targets {
        if let Some(ws_url) = &target.websocket_debugger_url {
          log::info!("Applying fingerprint to target via WebSocket: {}", ws_url);
          match self
            .send_cdp_command(ws_url, "Wayfern.setFingerprint", fingerprint_params.clone())
            .await
          {
            Ok(result) => {
              log::info!(
                "Successfully applied fingerprint to page target: {:?}",
                result
              );
              // Wayfern.setFingerprint echoes back the fingerprint it actually
              // used, which may be UPGRADED from what we sent (e.g. when the
              // stored fingerprint targets an older browser version). Capture
              // it once, from the first target that succeeds, so the caller can
              // persist the upgraded value to the profile.
              if used_fingerprint.is_none() {
                // getFingerprint/setFingerprint wrap the object as
                // { fingerprint: {...} }; tolerate a bare object too.
                let fp = result.get("fingerprint").cloned().unwrap_or(result);
                if fp.is_object() {
                  match serde_json::to_string(&Self::normalize_fingerprint(fp)) {
                    Ok(s) => used_fingerprint = Some(s),
                    Err(e) => {
                      log::warn!("Failed to serialize used fingerprint: {e}")
                    }
                  }
                }
              }
            }
            Err(e) => log::error!("Failed to apply fingerprint to target: {e}"),
          }
        }
      }
    } else {
      log::warn!("No fingerprint found in config, browser will use default fingerprint");
    }

    // Geolocation is handled internally by the browser binary.

    if let Some(url) = url {
      log::info!("Navigating to URL via CDP: {}", url);
      if let Some(target) = page_targets.first() {
        if let Some(ws_url) = &target.websocket_debugger_url {
          if let Err(e) = self
            .send_cdp_command(ws_url, "Page.navigate", json!({ "url": url }))
            .await
          {
            log::error!("Failed to navigate to URL: {e}");
          }
        }
      }
    }

    for target in &page_targets {
      if let Some(ws_url) = &target.websocket_debugger_url {
        let _ = self
          .send_cdp_command(ws_url, "Emulation.clearDeviceMetricsOverride", json!({}))
          .await;
        let _ = self
          .send_cdp_command(
            ws_url,
            "Emulation.setFocusEmulationEnabled",
            json!({ "enabled": false }),
          )
          .await;
        let _ = self
          .send_cdp_command(
            ws_url,
            "Emulation.setEmulatedMedia",
            json!({ "media": "", "features": [] }),
          )
          .await;
      }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let instance = WayfernInstance {
      id: id.clone(),
      process_id,
      profile_path: Some(profile_path.to_string()),
      url: url.map(|s| s.to_string()),
      cdp_port: Some(port),
    };

    let mut inner = self.inner.lock().await;
    inner.instances.insert(id.clone(), instance);

    Ok(WayfernLaunchResult {
      id,
      processId: process_id,
      profilePath: Some(profile_path.to_string()),
      url: url.map(|s| s.to_string()),
      cdp_port: Some(port),
      used_fingerprint,
    })
  }

  pub async fn stop_wayfern(
    &self,
    id: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut inner = self.inner.lock().await;

    if let Some(instance) = inner.instances.remove(id) {
      log::info!("Cleaning up Wayfern instance {}", instance.id);
      if let Some(pid) = instance.process_id {
        #[cfg(unix)]
        {
          use nix::sys::signal::{kill, Signal};
          use nix::unistd::Pid;
          let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
        }
        #[cfg(windows)]
        {
          use std::os::windows::process::CommandExt;
          const CREATE_NO_WINDOW: u32 = 0x08000000;
          let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        }
        log::info!("Stopped Wayfern instance {id} (PID: {pid})");
      }
    }

    Ok(())
  }

  /// Opens a URL in a new tab for an existing Wayfern instance.
  pub async fn open_url_in_tab(
    &self,
    profile_path: &str,
    url: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let inner = self.inner.lock().await;
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    let port = inner
      .instances
      .values()
      .find(|i| {
        i.profile_path
          .as_deref()
          .map(|p| {
            std::path::Path::new(p)
              .canonicalize()
              .unwrap_or_else(|_| std::path::Path::new(p).to_path_buf())
              == target_path
          })
          .unwrap_or(false)
      })
      .and_then(|i| i.cdp_port)
      .ok_or("Wayfern instance (with CDP port) not found for profile")?;
    drop(inner);

    // Open the URL in a new tab via the CDP HTTP convenience endpoint.
    let new_tab_url = format!(
      "http://127.0.0.1:{port}/json/new?{}",
      urlencoding::encode(url)
    );
    let resp = self
      .http_client
      .put(&new_tab_url)
      .send()
      .await
      .map_err(|e| format!("Failed to open new tab: {e}"))?;
    if !resp.status().is_success() {
      return Err(format!("CDP /json/new returned HTTP {}", resp.status()).into());
    }

    log::info!("Opened URL in new tab via CDP: {}", url);
    Ok(())
  }

  pub async fn get_cdp_port(&self, profile_path: &str) -> Option<u16> {
    let inner = self.inner.lock().await;
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    for instance in inner.instances.values() {
      if let Some(path) = &instance.profile_path {
        let instance_path = std::path::Path::new(path)
          .canonicalize()
          .unwrap_or_else(|_| std::path::Path::new(path).to_path_buf());
        if instance_path == target_path {
          return instance.cdp_port;
        }
      }
    }
    None
  }

  pub async fn find_wayfern_by_profile(&self, profile_path: &str) -> Option<WayfernLaunchResult> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let mut inner = self.inner.lock().await;

    // Canonicalize the target path for comparison
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    // Find the instance with the matching profile path
    let mut found_id: Option<String> = None;
    for (id, instance) in &inner.instances {
      if let Some(path) = &instance.profile_path {
        let instance_path = std::path::Path::new(path)
          .canonicalize()
          .unwrap_or_else(|_| std::path::Path::new(path).to_path_buf());
        if instance_path == target_path {
          found_id = Some(id.clone());
          break;
        }
      }
    }

    // If we found an instance, verify the process is still running
    if let Some(id) = found_id {
      if let Some(instance) = inner.instances.get(&id) {
        if let Some(pid) = instance.process_id {
          let system = System::new_with_specifics(
            RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
          );
          let sysinfo_pid = sysinfo::Pid::from_u32(pid);

          if system.process(sysinfo_pid).is_some() {
            return Some(WayfernLaunchResult {
              id: id.clone(),
              processId: instance.process_id,
              profilePath: instance.profile_path.clone(),
              url: instance.url.clone(),
              cdp_port: instance.cdp_port,
              used_fingerprint: None,
            });
          } else {
            log::info!(
              "Wayfern process {} for profile {} is no longer running, cleaning up",
              pid,
              profile_path
            );
            inner.instances.remove(&id);
            return None;
          }
        }
      }
    }

    // If not found in in-memory instances, scan system processes.
    // This handles the case where the GUI was restarted but Wayfern is still running.
    if let Some((pid, found_profile_path, cdp_port)) =
      Self::find_wayfern_process_by_profile(&target_path)
    {
      log::info!(
        "Found running Wayfern process (PID: {}) for profile path via system scan",
        pid
      );

      let instance_id = format!("recovered_{}", pid);
      inner.instances.insert(
        instance_id.clone(),
        WayfernInstance {
          id: instance_id.clone(),
          process_id: Some(pid),
          profile_path: Some(found_profile_path.clone()),
          url: None,
          cdp_port,
        },
      );

      return Some(WayfernLaunchResult {
        id: instance_id,
        processId: Some(pid),
        profilePath: Some(found_profile_path),
        url: None,
        cdp_port,
        used_fingerprint: None,
      });
    }

    None
  }

  /// Scan system processes to find a Wayfern/Chromium process using a specific profile path
  fn find_wayfern_process_by_profile(
    target_path: &std::path::Path,
  ) -> Option<(u32, String, Option<u16>)> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );

    let target_path_str = target_path.to_string_lossy();

    for (pid, process) in system.processes() {
      let cmd = process.cmd();
      if cmd.is_empty() {
        continue;
      }

      let exe_name = process.name().to_string_lossy().to_lowercase();
      let is_chromium_like = exe_name.contains("wayfern")
        || exe_name.contains("chromium")
        || exe_name.contains("chrome");

      if !is_chromium_like {
        continue;
      }

      // Skip child processes (renderer, GPU, utility, zygote, etc.)
      // Only the main browser process lacks a --type= argument
      let is_child = cmd
        .iter()
        .any(|a| a.to_str().is_some_and(|s| s.starts_with("--type=")));
      if is_child {
        continue;
      }

      let mut matched = false;
      let mut cdp_port: Option<u16> = None;

      for arg in cmd.iter() {
        if let Some(arg_str) = arg.to_str() {
          if let Some(dir_val) = arg_str.strip_prefix("--user-data-dir=") {
            let cmd_path = std::path::Path::new(dir_val)
              .canonicalize()
              .unwrap_or_else(|_| std::path::Path::new(dir_val).to_path_buf());
            if cmd_path == target_path {
              matched = true;
            }
          }

          if let Some(port_val) = arg_str.strip_prefix("--remote-debugging-port=") {
            cdp_port = port_val.parse().ok();
          }
        }
      }

      if matched {
        return Some((pid.as_u32(), target_path_str.to_string(), cdp_port));
      }
    }

    None
  }

  #[allow(dead_code)]
  pub async fn launch_wayfern_profile(
    &self,
    app_handle: &AppHandle,
    profile: &BrowserProfile,
    config: &WayfernConfig,
    url: Option<&str>,
    proxy_url: Option<&str>,
  ) -> Result<WayfernLaunchResult, Box<dyn std::error::Error + Send + Sync>> {
    let profiles_dir = self.get_profiles_dir();
    let profile_path = profiles_dir.join(profile.id.to_string()).join("profile");
    let profile_path_str = profile_path.to_string_lossy().to_string();

    std::fs::create_dir_all(&profile_path)?;

    if let Some(existing) = self.find_wayfern_by_profile(&profile_path_str).await {
      log::info!("Stopping existing Wayfern instance for profile");
      self.stop_wayfern(&existing.id).await?;
    }

    self
      .launch_wayfern(
        app_handle,
        profile,
        &profile_path_str,
        config,
        url,
        proxy_url,
        profile.ephemeral,
        &[],
        None,
        false,
      )
      .await
  }

  #[allow(dead_code)]
  pub async fn cleanup_dead_instances(&self) {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let mut inner = self.inner.lock().await;
    let mut dead_ids = Vec::new();

    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );

    for (id, instance) in &inner.instances {
      if let Some(pid) = instance.process_id {
        let pid = sysinfo::Pid::from_u32(pid);
        if !system.processes().contains_key(&pid) {
          dead_ids.push(id.clone());
        }
      }
    }

    for id in dead_ids {
      log::info!("Cleaning up dead Wayfern instance: {id}");
      inner.instances.remove(&id);
    }
  }
}
