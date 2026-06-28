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
      log::info!("Wayfern token passed as CLI flag (length: {})", token.len());
    }

    let webrtc_mode = resolve_webrtc_mode(
      config.block_webrtc.unwrap_or(false),
      config.webrtc_mode.as_deref(),
    );

    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path,
      remote_debugging_port: Some(port),
      headless,
      fingerprint_json: config.fingerprint.as_deref(),
      ephemeral,
      extension_paths,
      wayfern_token: wayfern_token.as_deref(),
      proxy_url,
      webrtc_mode,
      block_images: config.block_images.unwrap_or(false),
      block_webgl: config.block_webgl.unwrap_or(false),
      url: None,
    });

    if !headless {
      if let Some((w, h)) = config
        .fingerprint
        .as_deref()
        .and_then(Self::window_size_from_fingerprint)
      {
        log::info!("Sizing Wayfern window to fingerprint dimensions: {w}x{h}");
      }
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

    let fingerprinted_targets = Arc::new(AsyncMutex::new(HashSet::new()));

    let (used_fingerprint, fingerprint_params_store, watcher_cancel) = if config.fingerprint.is_some() {
      let fingerprint_json = config.fingerprint.as_deref().unwrap_or("");
      log::info!(
        "Applying fingerprint to Wayfern browser, fingerprint length: {} chars",
        fingerprint_json.len()
      );

      let fingerprint_params = self
        .prepare_fingerprint_cdp_params(config, profile, proxy_url, webrtc_mode)
        .await?;

      if let Some(obj) = fingerprint_params.as_object() {
        log::info!(
          "Fingerprint prepared for CDP — timezone: {:?}, language: {:?}, fields: {:?}",
          obj.get("timezone"),
          obj.get("language"),
          obj.keys().collect::<Vec<_>>()
        );
      }

      let fingerprint_params = Arc::new(fingerprint_params);
      let page_refs: Vec<&CdpTarget> = page_targets.to_vec();
      let used = self
        .apply_fingerprint_to_targets(&page_refs, &fingerprint_params, &fingerprinted_targets)
        .await?;

      let cancel = self.start_fingerprint_watcher(
        port,
        fingerprint_params.clone(),
        fingerprinted_targets.clone(),
      );
      (used, Some(fingerprint_params), Some(cancel))
    } else {
      return Err(serde_json::json!({ "code": "WAYFERN_FINGERPRINT_MISSING" }).to_string().into());
    };

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
      fingerprint_params: fingerprint_params_store,
      fingerprinted_targets,
      watcher_cancel,
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
      if let Some(cancel) = instance.watcher_cancel {
        // Send true to trigger changed() in watcher (false → true transition)
        let _ = cancel.send(true);
      }
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

    let (port, fingerprint_params, fingerprinted_targets) = inner
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
      .map(|i| {
        (
          i.cdp_port,
          i.fingerprint_params.clone(),
          i.fingerprinted_targets.clone(),
        )
      })
      .ok_or("Wayfern instance (with CDP port) not found for profile")?;
    let port = port.ok_or("Wayfern instance has no CDP port")?;
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

    // New tabs do not inherit Wayfern.setFingerprint automatically — re-apply
    // immediately so the tab matches the launch page (spike Gate #7).
    if let Some(params) = fingerprint_params {
      tokio::time::sleep(Duration::from_millis(300)).await;
      if let Err(e) = self
        .respoof_new_page_targets(port, &params, &fingerprinted_targets)
        .await
      {
        return Err(format!("Opened tab but fingerprint re-apply failed: {e}").into());
      }
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

    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    let mut launch_result: Option<WayfernLaunchResult> = None;
    let mut rehydrate: Option<(String, String, u16)> = None;

    {
      let mut inner = self.inner.lock().await;

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

      if let Some(id) = found_id {
        if let Some(instance) = inner.instances.get(&id) {
          if let Some(pid) = instance.process_id {
            let system = System::new_with_specifics(
              RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
            );
            let sysinfo_pid = sysinfo::Pid::from_u32(pid);

            if system.process(sysinfo_pid).is_some() {
              if instance.fingerprint_params.is_none() {
                if let (Some(data_path), Some(port)) =
                  (instance.profile_path.clone(), instance.cdp_port)
                {
                  rehydrate = Some((id.clone(), data_path, port));
                }
              }
              launch_result = Some(WayfernLaunchResult {
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
            }
          }
        }
      } else if let Some((pid, found_profile_path, cdp_port)) =
        Self::find_wayfern_process_by_profile(&target_path)
      {
        log::info!(
          "Found running Wayfern process (PID: {}) for profile path via system scan",
          pid
        );

        let instance_id = format!("recovered_{pid}");
        inner.instances.insert(
          instance_id.clone(),
          WayfernInstance {
            id: instance_id.clone(),
            process_id: Some(pid),
            profile_path: Some(found_profile_path.clone()),
            url: None,
            cdp_port,
            fingerprint_params: None,
            fingerprinted_targets: Arc::new(AsyncMutex::new(HashSet::new())),
            watcher_cancel: None,
          },
        );

        if let Some(port) = cdp_port {
          rehydrate = Some((instance_id.clone(), found_profile_path.clone(), port));
        }
        launch_result = Some(WayfernLaunchResult {
          id: instance_id,
          processId: Some(pid),
          profilePath: Some(found_profile_path),
          url: None,
          cdp_port,
          used_fingerprint: None,
        });
      }
    }

    if let Some((instance_id, data_path, port)) = rehydrate {
      if let Err(e) = self
        .rehydrate_recovered_instance(&instance_id, &data_path, port)
        .await
      {
        log::error!("Failed to re-hydrate recovered Wayfern instance {instance_id}: {e}");
      }
    }

    launch_result
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
