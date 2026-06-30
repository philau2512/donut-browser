impl ProxyManager {
  // Start a proxy for given proxy settings and associate it with a browser process ID
  // If proxy_settings is None, starts a direct proxy for traffic monitoring
  #[allow(clippy::too_many_arguments)]
  pub async fn start_proxy(
    &self,
    app_handle: tauri::AppHandle,
    proxy_settings: Option<&ProxySettings>,
    browser_pid: u32,
    profile_id: Option<&str>,
    bypass_rules: Vec<String>,
    blocklist_file: Option<String>,
    // Protocol the local worker serves the browser: "http" (Camoufox) or
    // "socks5" (Wayfern). Reflected in the returned ProxySettings.proxy_type
    // so the caller formats the right local proxy URL scheme.
    local_protocol: &str,
  ) -> Result<ProxySettings, String> {
    if let Some(name) = profile_id {
      // Check if we have an active proxy recorded for this profile
      let maybe_existing_id = {
        let map = self.profile_active_proxy_ids.lock().unwrap();
        map.get(name).cloned()
      };

      if let Some(existing_id) = maybe_existing_id {
        // Find the existing proxy info
        let existing_info = {
          let proxies = self.active_proxies.lock().unwrap();
          proxies.values().find(|p| p.id == existing_id).cloned()
        };

        if let Some(existing) = existing_info {
          let desired_type = proxy_settings
            .map(|p| p.proxy_type.as_str())
            .unwrap_or("DIRECT");
          let desired_host = proxy_settings.map(|p| p.host.as_str()).unwrap_or("DIRECT");
          let desired_port = proxy_settings.map(|p| p.port).unwrap_or(0);

          let is_same_upstream = existing.upstream_type == desired_type
            && existing.upstream_host == desired_host
            && existing.upstream_port == desired_port;

          if is_same_upstream {
            // Settings match - can reuse existing proxy
            // Just update the PID mapping if needed
            let proxies = self.active_proxies.lock().unwrap();
            if proxies.contains_key(&browser_pid) {
              // Already mapped, reuse it
              return Ok(ProxySettings {
                proxy_type: local_protocol.to_string(),
                host: "127.0.0.1".to_string(),
                port: existing.local_port,
                username: None,
                password: None,
              });
            }
            // Need to add this PID to the mapping - we'll do that after starting
          }
          // Settings differ - we'll create a new proxy, but don't stop the old one
          // It will be cleaned up by periodic cleanup if it becomes dead
        }
      }
    }
    // Check if we already have a proxy for this browser PID
    // If settings match, reuse it; otherwise create a new one (don't stop the old one)
    {
      let proxies = self.active_proxies.lock().unwrap();
      if let Some(existing) = proxies.get(&browser_pid) {
        let desired_type = proxy_settings
          .map(|p| p.proxy_type.as_str())
          .unwrap_or("DIRECT");
        let desired_host = proxy_settings.map(|p| p.host.as_str()).unwrap_or("DIRECT");
        let desired_port = proxy_settings.map(|p| p.port).unwrap_or(0);

        let is_same_upstream = existing.upstream_type == desired_type
          && existing.upstream_host == desired_host
          && existing.upstream_port == desired_port;

        if is_same_upstream {
          // Check if profile_id matches
          let profile_id_matches = match (profile_id, &existing.profile_id) {
            (Some(ref new_id), Some(ref old_id)) => new_id == old_id,
            (None, None) => true,
            _ => false,
          };

          if profile_id_matches {
            // Reuse existing local proxy (settings and profile_id match)
            return Ok(ProxySettings {
              proxy_type: local_protocol.to_string(),
              host: "127.0.0.1".to_string(),
              port: existing.local_port,
              username: None,
              password: None,
            });
          }
          // Profile ID changed - we'll create a new proxy but don't stop the old one
          // It will be cleaned up by periodic cleanup if it becomes dead
        }
        // Upstream changed - we'll create a new proxy but don't stop the old one
        // It will be cleaned up by periodic cleanup if it becomes dead
      }
    }

    // Start a new proxy using the donut-proxy binary with the correct CLI interface
    let mut proxy_cmd = app_handle
      .shell()
      .sidecar("donut-proxy")
      .map_err(|e| format!("Failed to create sidecar: {e}"))?
      .arg("proxy")
      .arg("start");

    // Add upstream proxy settings if provided, otherwise create direct proxy
    if let Some(proxy_settings) = proxy_settings {
      proxy_cmd = proxy_cmd
        .arg("--host")
        .arg(&proxy_settings.host)
        .arg("--proxy-port")
        .arg(proxy_settings.port.to_string())
        .arg("--type")
        .arg(&proxy_settings.proxy_type);

      // Add credentials if provided
      if let Some(username) = &proxy_settings.username {
        proxy_cmd = proxy_cmd.arg("--username").arg(username);
      }
      if let Some(password) = &proxy_settings.password {
        proxy_cmd = proxy_cmd.arg("--password").arg(password);
      }
    }

    // Add profile ID if provided for traffic tracking
    if let Some(id) = profile_id {
      proxy_cmd = proxy_cmd.arg("--profile-id").arg(id);
    }

    // Add bypass rules if any
    if !bypass_rules.is_empty() {
      let rules_json = serde_json::to_string(&bypass_rules)
        .map_err(|e| format!("Failed to serialize bypass rules: {e}"))?;
      proxy_cmd = proxy_cmd.arg("--bypass-rules").arg(rules_json);
    }

    // Add blocklist file path if provided
    if let Some(ref path) = blocklist_file {
      proxy_cmd = proxy_cmd.arg("--blocklist-file").arg(path);
    }

    // Tell the worker which protocol to serve the browser (http or socks5)
    proxy_cmd = proxy_cmd.arg("--local-protocol").arg(local_protocol);

    // Execute the command and wait for it to complete
    // The donut-proxy binary should start the worker and then exit
    let output = proxy_cmd
      .output()
      .await
      .map_err(|e| format!("Failed to execute donut-proxy: {e}"))?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      let stdout = String::from_utf8_lossy(&output.stdout);
      return Err(format!(
        "Proxy start failed - stdout: {stdout}, stderr: {stderr}"
      ));
    }

    let json_string =
      String::from_utf8(output.stdout).map_err(|e| format!("Failed to parse proxy output: {e}"))?;

    // Parse the JSON output
    let json: Value = serde_json::from_str(json_string.trim())
      .map_err(|e| format!("Failed to parse JSON: {e}. Output was: {}", json_string))?;

    // Extract proxy information
    let id = json["id"].as_str().ok_or("Missing proxy ID")?;
    let local_port = json["localPort"]
      .as_u64()
      .ok_or_else(|| format!("Missing local port in JSON: {}", json_string))?
      as u16;
    let local_url = json["localUrl"]
      .as_str()
      .ok_or_else(|| format!("Missing local URL in JSON: {}", json_string))?
      .to_string();

    let proxy_info = ProxyInfo {
      id: id.to_string(),
      local_url,
      upstream_host: proxy_settings
        .map(|p| p.host.clone())
        .unwrap_or_else(|| "DIRECT".to_string()),
      upstream_port: proxy_settings.map(|p| p.port).unwrap_or(0),
      upstream_type: proxy_settings
        .map(|p| p.proxy_type.clone())
        .unwrap_or_else(|| "DIRECT".to_string()),
      local_port,
      profile_id: profile_id.map(|s| s.to_string()),
      blocklist_file: blocklist_file.clone(),
    };

    // Wait for the local proxy port to be ready to accept connections
    {
      use tokio::net::TcpStream;
      use tokio::time::{sleep, Duration};
      let mut ready = false;
      for _ in 0..50 {
        match TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, proxy_info.local_port)).await {
          Ok(_stream) => {
            ready = true;
            break;
          }
          Err(_) => {
            sleep(Duration::from_millis(100)).await;
          }
        }
      }
      if !ready {
        return Err(format!(
          "Local proxy on 127.0.0.1:{} did not become ready in time",
          proxy_info.local_port
        ));
      }
    }

    // Store the proxy info
    {
      let mut proxies = self.active_proxies.lock().unwrap();
      proxies.insert(browser_pid, proxy_info.clone());
    }

    // Store the profile proxy info for persistence
    if let Some(id) = profile_id {
      if let Some(proxy_settings) = proxy_settings {
        let mut profile_proxies = self.profile_proxies.lock().unwrap();
        profile_proxies.insert(id.to_string(), proxy_settings.clone());
      }
      // Also record the active proxy id for this profile for quick cleanup on changes
      let mut map = self.profile_active_proxy_ids.lock().unwrap();
      map.insert(id.to_string(), proxy_info.id.clone());
    }

    // Return proxy settings for the browser
    Ok(ProxySettings {
      proxy_type: local_protocol.to_string(),
      host: "127.0.0.1".to_string(), // Use 127.0.0.1 instead of localhost for better compatibility
      port: proxy_info.local_port,
      username: None,
      password: None,
    })
  }

  // Stop the proxy associated with a browser process ID
  pub async fn stop_proxy(
    &self,
    app_handle: tauri::AppHandle,
    browser_pid: u32,
  ) -> Result<(), String> {
    let (proxy_id, profile_id): (String, Option<String>) = {
      let mut proxies = self.active_proxies.lock().unwrap();
      match proxies.remove(&browser_pid) {
        Some(proxy) => (proxy.id, proxy.profile_id.clone()),
        None => return Ok(()), // No proxy to stop
      }
    };

    // Stop the proxy using the donut-proxy binary
    let proxy_cmd = app_handle
      .shell()
      .sidecar("donut-proxy")
      .map_err(|e| format!("Failed to create sidecar: {e}"))?
      .arg("proxy")
      .arg("stop")
      .arg("--id")
      .arg(&proxy_id);

    // A failed spawn (sidecar missing, permission denied, fd exhaustion) must
    // not panic the cleanup task — the proxy is already removed from tracking,
    // so degrade gracefully like the non-success branch below.
    match proxy_cmd.output().await {
      Ok(output) if !output.status.success() => {
        log::warn!(
          "Proxy stop error: {}",
          String::from_utf8_lossy(&output.stderr)
        );
      }
      Ok(_) => {}
      Err(e) => log::warn!("Failed to run donut-proxy stop: {e}"),
    }

    // Clear profile-to-proxy mapping if it references this proxy
    if let Some(id) = profile_id {
      let mut map = self.profile_active_proxy_ids.lock().unwrap();
      if let Some(current_id) = map.get(&id) {
        if current_id == &proxy_id {
          map.remove(&id);
        }
      }
    }

    // Emit event for reactive UI updates
    if let Err(e) = events::emit_empty("proxies-changed") {
      log::error!("Failed to emit proxies-changed event: {e}");
    }

    Ok(())
  }

  // Stop the proxy associated with a profile ID
  pub async fn stop_proxy_by_profile_id(
    &self,
    app_handle: tauri::AppHandle,
    profile_id: &str,
  ) -> Result<(), String> {
    // Find the proxy ID for this profile
    let proxy_id = {
      let map = self.profile_active_proxy_ids.lock().unwrap();
      map.get(profile_id).cloned()
    };

    if let Some(proxy_id) = proxy_id {
      // Find the PID for this proxy
      let pid = {
        let proxies = self.active_proxies.lock().unwrap();
        proxies.iter().find_map(|(pid, proxy)| {
          if proxy.id == proxy_id {
            Some(*pid)
          } else {
            None
          }
        })
      };

      if let Some(pid) = pid {
        // Use the existing stop_proxy method
        self.stop_proxy(app_handle, pid).await
      } else {
        // Proxy not found in active_proxies, try to stop it directly by ID
        let proxy_cmd = app_handle
          .shell()
          .sidecar("donut-proxy")
          .map_err(|e| format!("Failed to create sidecar: {e}"))?
          .arg("proxy")
          .arg("stop")
          .arg("--id")
          .arg(&proxy_id);

        // Don't panic if the sidecar can't be spawned — still clear the mapping.
        match proxy_cmd.output().await {
          Ok(output) if !output.status.success() => {
            log::warn!(
              "Proxy stop error: {}",
              String::from_utf8_lossy(&output.stderr)
            );
          }
          Ok(_) => {}
          Err(e) => log::warn!("Failed to run donut-proxy stop: {e}"),
        }

        // Clear profile-to-proxy mapping
        let mut map = self.profile_active_proxy_ids.lock().unwrap();
        map.remove(profile_id);

        // Emit event for reactive UI updates
        if let Err(e) = events::emit_empty("proxies-changed") {
          log::error!("Failed to emit proxies-changed event: {e}");
        }

        Ok(())
      }
    } else {
      // No proxy found for this profile
      Ok(())
    }
  }

  // Update the PID mapping for an existing proxy
  pub fn update_proxy_pid(&self, old_pid: u32, new_pid: u32) -> Result<(), String> {
    let mut proxies = self.active_proxies.lock().unwrap();
    if let Some(proxy_info) = proxies.remove(&old_pid) {
      proxies.insert(new_pid, proxy_info);
      Ok(())
    } else {
      Err(format!("No proxy found for PID {old_pid}"))
    }
  }

  /// Persist the real browser PID onto the worker's on-disk config so the
  /// detached worker can self-terminate when that browser dies, independent of
  /// the GUI being alive. Resolved via the profile→proxy_id map rather than the
  /// PID-keyed `active_proxies` map: the latter uses a placeholder key 0 during
  /// launch that collides across concurrent launches, which could tag a live
  /// worker with the wrong (dead) PID and make it self-exit. Safe on the reuse
  /// path — it simply rewrites `browser_pid` to the new live PID. A `browser_pid`
  /// of 0 (launch failed to report a PID) is ignored so the worker never
  /// self-exits against a bogus PID.
  pub fn set_browser_pid_for_profile(&self, profile_id: &str, browser_pid: u32) {
    if browser_pid == 0 {
      return;
    }
    let proxy_id = {
      let map = self.profile_active_proxy_ids.lock().unwrap();
      match map.get(profile_id) {
        Some(id) => id.clone(),
        None => return, // No local worker for this profile — nothing to tag.
      }
    };
    if let Some(mut cfg) = crate::proxy::proxy_storage::get_proxy_config(&proxy_id) {
      cfg.browser_pid = Some(browser_pid);
      if crate::proxy::proxy_storage::update_proxy_config(&cfg) {
        log::info!(
          "Recorded browser PID {browser_pid} on proxy config {proxy_id} for self-reaping"
        );
      } else {
        log::warn!("Failed to persist browser_pid {browser_pid} to proxy config {proxy_id}");
      }
    }
  }

  // Clean up proxies for dead browser processes
  // Only clean up orphaned config files where the proxy process itself is dead
  pub async fn cleanup_dead_proxies(
    &self,
    _app_handle: tauri::AppHandle,
  ) -> Result<Vec<u32>, String> {
    // Don't stop proxies for dead browser processes - let them run indefinitely
    // The proxy processes are idle and don't consume CPU when not in use
    // Only clean up config files where the proxy process itself is dead (see below)
    let dead_pids: Vec<u32> = Vec::new();

    // Clean up orphaned proxy configs (only where proxy process is definitely dead)
    // IMPORTANT: Only clean up configs where the proxy process itself is dead
    // If the proxy process is running (even if idle), leave it alone
    // The user doesn't care if proxy processes run indefinitely as long as they're not consuming CPU
    let orphaned_configs = {
      use crate::proxy::proxy_storage::{is_process_running, list_proxy_configs};
      use std::time::{SystemTime, UNIX_EPOCH};

      let all_configs = list_proxy_configs();
      let tracked_proxy_ids: std::collections::HashSet<String> = {
        let proxies = self.active_proxies.lock().unwrap();
        proxies.values().map(|p| p.id.clone()).collect()
      };

      // Get current time for grace period check
      let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

      all_configs
        .into_iter()
        .filter(|config| {
          // If proxy is tracked in active_proxies, it's definitely not orphaned
          if tracked_proxy_ids.contains(&config.id) {
            return false;
          }

          // Extract creation time from proxy ID (format: proxy_{timestamp}_{random})
          // This gives us a grace period for newly created proxies
          let proxy_age = config
            .id
            .strip_prefix("proxy_")
            .and_then(|s| s.split('_').next())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|created_at| now.saturating_sub(created_at))
            .unwrap_or(0);

          // Grace period: don't clean up proxies created in the last 120 seconds
          // This prevents race conditions during startup (increased from 60 to 120 for safety)
          if proxy_age < 120 {
            log::debug!(
              "Skipping cleanup of proxy {} - too new (age: {}s)",
              config.id,
              proxy_age
            );
            return false;
          }

          // ONLY clean up if we can verify the proxy process is dead
          // If proxy process is running, leave it alone (even if idle)
          if let Some(proxy_pid) = config.pid {
            // Check if proxy process is actually dead
            if !is_process_running(proxy_pid) {
              // Proxy process is dead, clean up the config file
              log::info!(
                "Proxy {} process (PID {}) is dead, will clean up config",
                config.id,
                proxy_pid
              );
              return true;
            }
            // Proxy process is running - leave it alone
            log::debug!(
              "Skipping cleanup of proxy {} - process (PID {}) is still running",
              config.id,
              proxy_pid
            );
            return false;
          }

          // No PID in config - can't verify if process is dead
          // Be conservative: don't clean up (might be starting up or PID not set yet)
          log::debug!(
            "Skipping cleanup of proxy {} - no PID in config (might be starting up)",
            config.id
          );
          false
        })
        .collect::<Vec<_>>()
    };

    // Clean up orphaned config files (proxy process is dead)
    for config in orphaned_configs {
      log::info!(
        "Cleaning up orphaned proxy config: {} (proxy process is dead)",
        config.id
      );
      use crate::proxy::proxy_storage::delete_proxy_config;
      delete_proxy_config(&config.id);
    }

    // Kill stale profileless proxy workers — these are check workers
    // (from check_proxy_validity or similar) that were never cleaned up.
    // Profile-associated proxies are left alone to avoid the regression
    // where killing proxies for "dead" browsers on Linux also killed
    // proxies for running browsers (due to launcher-vs-browser PID mismatch).
    {
      use crate::proxy::proxy_storage::{is_process_running, list_proxy_configs};
      use std::time::{SystemTime, UNIX_EPOCH};

      let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

      let all_configs = list_proxy_configs();
      for config in all_configs {
        // Only target proxies WITHOUT a profile_id (check workers)
        if config.profile_id.is_some() {
          continue;
        }

        // Must have a running process to kill
        let Some(pid) = config.pid else { continue };
        if !is_process_running(pid) {
          continue;
        }

        // Check age: only kill if older than 5 minutes
        let proxy_age = config
          .id
          .strip_prefix("proxy_")
          .and_then(|s| s.split('_').next())
          .and_then(|s| s.parse::<u64>().ok())
          .map(|created_at| now.saturating_sub(created_at))
          .unwrap_or(0);

        if proxy_age > 300 {
          log::info!(
            "Killing stale profileless proxy {} (PID {}, age {}s)",
            config.id,
            pid,
            proxy_age
          );
          let _ = crate::proxy::proxy_runner::stop_proxy_process(&config.id).await;
        }
      }
    }

    // Kill proxy workers whose browser process has died.
    //
    // active_proxies is keyed by the EXACT browser PID that was recorded in
    // update_proxy_pid(). Checking that PID against a single process-table
    // snapshot is deterministic: either the PID refers to a live process or
    // it doesn't. This avoids the fuzzy launcher-vs-browser detection used
    // by check_browser_status (which historically had false negatives on
    // Linux and was the reason profile-associated workers were left alone
    // in the other cleanup branches).
    //
    // Without this, every time a user closes their browser via the window's
    // X button (bypassing Donut's stop flow) or the browser crashes, the
    // worker keeps running forever. On Windows users reported dozens of
    // donut-proxy processes accumulating this way.
    {
      // Snapshot current active entries first so we don't hold the mutex
      // while running the (expensive on Windows) sysinfo scan.
      let snapshot: Vec<(u32, String, Option<String>)> = {
        let proxies = self.active_proxies.lock().unwrap();
        proxies
          .iter()
          .map(|(&browser_pid, info)| (browser_pid, info.id.clone(), info.profile_id.clone()))
          .collect()
      };

      if !snapshot.is_empty() {
        // One process-table scan for all candidates
        let system = sysinfo::System::new_with_specifics(
          sysinfo::RefreshKind::nothing().with_processes(sysinfo::ProcessRefreshKind::everything()),
        );

        // Two-state classification: alive PIDs reset their miss counter,
        // dead PIDs increment it. A worker is only reaped after MISS_THRESHOLD
        // consecutive misses (~60s by default given the 30s cleanup cadence),
        // so a single sysinfo blip under heavy load doesn't kill a healthy worker.
        const MISS_THRESHOLD: u8 = 2;

        let mut alive_pids: Vec<u32> = Vec::new();
        let mut dead_candidates: Vec<(u32, String, Option<String>)> = Vec::new();
        let mut snapshot_pids: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for (browser_pid, proxy_id, profile_id) in snapshot {
          snapshot_pids.insert(browser_pid);
          // The sentinel PID=0 is used as a placeholder during launch,
          // before update_proxy_pid has recorded the real browser PID.
          if browser_pid == 0 {
            continue;
          }
          if system
            .process(sysinfo::Pid::from_u32(browser_pid))
            .is_some()
          {
            alive_pids.push(browser_pid);
          } else {
            dead_candidates.push((browser_pid, proxy_id, profile_id));
          }
        }

        let dead_browser_entries: Vec<(u32, String, Option<String>)> = {
          let mut misses = self.dead_browser_misses.lock().unwrap();
          // Forget PIDs no longer tracked at all (worker already torn down elsewhere).
          misses.retain(|pid, _| snapshot_pids.contains(pid));
          // Reset miss count for any PID that's currently alive.
          for pid in &alive_pids {
            misses.remove(pid);
          }
          // Increment dead candidates and select those past threshold.
          let mut to_reap = Vec::new();
          for (browser_pid, proxy_id, profile_id) in dead_candidates {
            let count = misses.entry(browser_pid).or_insert(0);
            *count = count.saturating_add(1);
            if *count >= MISS_THRESHOLD {
              misses.remove(&browser_pid);
              to_reap.push((browser_pid, proxy_id, profile_id));
            }
          }
          to_reap
        };

        for (browser_pid, proxy_id, profile_id) in dead_browser_entries {
          log::info!(
            "Cleanup: browser PID {} is dead, stopping proxy worker {} (profile={:?})",
            browser_pid,
            proxy_id,
            profile_id
          );
          {
            let mut proxies = self.active_proxies.lock().unwrap();
            // Re-check the entry still maps to the same proxy_id — another
            // thread may have replaced it with a new proxy since we snapshotted.
            if let Some(current) = proxies.get(&browser_pid) {
              if current.id != proxy_id {
                continue;
              }
            } else {
              continue;
            }
            proxies.remove(&browser_pid);
          }
          if let Some(ref pid) = profile_id {
            let mut map = self.profile_active_proxy_ids.lock().unwrap();
            if map.get(pid) == Some(&proxy_id) {
              map.remove(pid);
            }
          }
          let _ = crate::proxy::proxy_runner::stop_proxy_process(&proxy_id).await;
        }
      }
    }

    // Clean up orphaned VPN worker configs where the worker process is dead
    {
      use crate::proxy::proxy_storage::is_process_running;
      use crate::vpn::vpn_worker_storage::{delete_vpn_worker_config, list_vpn_worker_configs};

      let vpn_workers = list_vpn_worker_configs();
      for worker in vpn_workers {
        if let Some(pid) = worker.pid {
          if !is_process_running(pid) {
            log::info!(
              "Cleaning up orphaned VPN worker config: {} (process PID {} is dead)",
              worker.id,
              pid
            );
            let _ = std::fs::remove_file(&worker.config_file_path);
            delete_vpn_worker_config(&worker.id);
          }
        }
      }
    }

    // Emit event for reactive UI updates
    if let Err(e) = events::emit_empty("proxies-changed") {
      log::error!("Failed to emit proxies-changed event: {e}");
    }

    Ok(dead_pids)
  }

  /// Snapshot the set of tracked proxy IDs (for asserting in tests).
  #[cfg(test)]
  fn tracked_proxy_ids(&self) -> std::collections::HashSet<String> {
    let proxies = self.active_proxies.lock().unwrap();
    proxies.values().map(|p| p.id.clone()).collect()
  }

  /// Snapshot active proxy count.
  #[cfg(test)]
  fn active_proxy_count(&self) -> usize {
    self.active_proxies.lock().unwrap().len()
  }

  /// Snapshot profile-to-proxy-id mapping count.
  #[cfg(test)]
  fn profile_proxy_mapping_count(&self) -> usize {
    self.profile_active_proxy_ids.lock().unwrap().len()
  }

  /// Insert a proxy info entry directly (for testing).
  #[cfg(test)]
  fn insert_active_proxy(&self, browser_pid: u32, info: ProxyInfo) {
    self
      .active_proxies
      .lock()
      .unwrap()
      .insert(browser_pid, info);
  }

  /// Insert a profile-to-proxy mapping directly (for testing).
  #[cfg(test)]
  fn insert_profile_proxy_mapping(&self, profile_id: String, proxy_id: String) {
    self
      .profile_active_proxy_ids
      .lock()
      .unwrap()
      .insert(profile_id, proxy_id);
  }

  /// Get active proxy info by browser PID (for testing).
  #[cfg(test)]
  fn get_active_proxy(&self, browser_pid: u32) -> Option<ProxyInfo> {
    self
      .active_proxies
      .lock()
      .unwrap()
      .get(&browser_pid)
      .cloned()
  }
}


// Create a singleton instance of the proxy manager
lazy_static::lazy_static! {
    pub static ref PROXY_MANAGER: ProxyManager = ProxyManager::new();
}

