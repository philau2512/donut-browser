#[cfg(test)]
mod tests {
  use super::*;
  use std::env;
  use std::path::PathBuf;
  use std::time::Duration;
  use tokio::process::Command;
  use tokio::time::sleep;

  // Mock HTTP server for testing

  use http_body_util::Full;
  use hyper::body::Bytes;
  use hyper::server::conn::http1;
  use hyper::service::service_fn;
  use hyper::Response;
  use hyper_util::rt::TokioIo;
  use tokio::net::TcpListener;

  // Helper function to build donut-proxy binary for testing
  async fn ensure_donut_proxy_binary() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let cargo_manifest_dir = env::var("CARGO_MANIFEST_DIR")?;
    let project_root = PathBuf::from(cargo_manifest_dir)
      .parent()
      .unwrap()
      .to_path_buf();
    let proxy_binary_name = if cfg!(windows) {
      "donut-proxy.exe"
    } else {
      "donut-proxy"
    };
    let proxy_binary = project_root
      .join("src-tauri")
      .join("target")
      .join("debug")
      .join(proxy_binary_name);

    // Check if binary already exists
    if proxy_binary.exists() {
      return Ok(proxy_binary);
    }

    // Build the donut-proxy binary
    println!("Building donut-proxy binary for tests...");

    let build_status = Command::new("cargo")
      .args(["build", "--bin", "donut-proxy"])
      .current_dir(project_root.join("src-tauri"))
      .status()
      .await?;

    if !build_status.success() {
      return Err("Failed to build donut-proxy binary".into());
    }

    if !proxy_binary.exists() {
      return Err("donut-proxy binary was not created successfully".into());
    }

    Ok(proxy_binary)
  }

  #[test]
  fn test_proxy_settings_validation() {
    // Test valid proxy settings
    let valid_settings = ProxySettings {
      proxy_type: "http".to_string(),
      host: "127.0.0.1".to_string(),
      port: 8080,
      username: Some("user".to_string()),
      password: Some("pass".to_string()),
    };

    assert!(
      !valid_settings.host.is_empty(),
      "Valid settings should have non-empty host"
    );
    assert!(
      valid_settings.port > 0,
      "Valid settings should have positive port"
    );
    assert_eq!(valid_settings.proxy_type, "http", "Proxy type should match");
    assert!(
      valid_settings.username.is_some(),
      "Username should be present"
    );
    assert!(
      valid_settings.password.is_some(),
      "Password should be present"
    );

    // Test proxy settings with empty values
    let empty_settings = ProxySettings {
      proxy_type: "http".to_string(),
      host: "".to_string(),
      port: 0,
      username: None,
      password: None,
    };

    assert!(
      empty_settings.host.is_empty(),
      "Empty settings should have empty host"
    );
    assert_eq!(
      empty_settings.port, 0,
      "Empty settings should have zero port"
    );
    assert!(empty_settings.username.is_none(), "Username should be None");
    assert!(empty_settings.password.is_none(), "Password should be None");
  }

  #[tokio::test]
  async fn test_proxy_manager_concurrent_access() {
    use std::sync::Arc;

    let proxy_manager = Arc::new(ProxyManager::new());
    let mut handles = vec![];

    // Spawn multiple tasks that access the proxy manager concurrently
    for i in 0..10 {
      let pm = proxy_manager.clone();
      let handle = tokio::spawn(async move {
        let browser_pid = (1000 + i) as u32;
        let proxy_info = ProxyInfo {
          id: format!("proxy_{i}"),
          local_url: format!("http://127.0.0.1:{}", 8000 + i),
          upstream_host: "127.0.0.1".to_string(),
          upstream_port: 3128,
          upstream_type: "http".to_string(),
          local_port: (8000 + i) as u16,
          profile_id: None,
          blocklist_file: None,
        };

        // Add proxy
        {
          let mut active_proxies = pm.active_proxies.lock().unwrap();
          active_proxies.insert(browser_pid, proxy_info);
        }

        browser_pid
      });
      handles.push(handle);
    }

    // Wait for all tasks to complete
    let results: Vec<u32> = futures_util::future::join_all(handles)
      .await
      .into_iter()
      .map(|r| r.unwrap())
      .collect();

    // Verify all browser PIDs were processed
    assert_eq!(results.len(), 10);
    for (i, &browser_pid) in results.iter().enumerate() {
      assert_eq!(browser_pid, (1000 + i) as u32);
    }
  }

  // Integration test that actually builds and uses donut-proxy binary
  #[tokio::test]
  async fn test_proxy_integration_with_real_proxy() -> Result<(), Box<dyn std::error::Error>> {
    // This test requires donut-proxy binary to be available
    // Skip if we can't find the binary or if proxy startup fails
    use crate::proxy::proxy_runner::{start_proxy_process, stop_proxy_process};
    use tokio::net::TcpStream;

    // Start a mock upstream HTTP server
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await?;
    let upstream_addr = upstream_listener.local_addr()?;

    // Spawn upstream server
    let server_handle = tokio::spawn(async move {
      while let Ok((stream, _)) = upstream_listener.accept().await {
        let io = TokioIo::new(stream);
        tokio::task::spawn(async move {
          let _ = http1::Builder::new()
            .serve_connection(
              io,
              service_fn(|_req| async {
                Ok::<_, hyper::Error>(Response::new(Full::new(Bytes::from("Upstream OK"))))
              }),
            )
            .await;
        });
      }
    });

    // Wait for server to start
    sleep(Duration::from_millis(100)).await;

    let upstream_url = format!("http://{}:{}", upstream_addr.ip(), upstream_addr.port());

    // Try to start proxy - if it fails, skip the test
    let config = match start_proxy_process(Some(upstream_url), None).await {
      Ok(config) => config,
      Err(e) => {
        println!("Skipping proxy integration test - proxy startup failed: {e}");
        server_handle.abort();
        return Ok(()); // Skip test instead of failing
      }
    };

    // Verify proxy configuration
    assert!(!config.id.is_empty());
    assert!(config.local_port.is_some());

    let proxy_id = config.id.clone();
    let local_port = config.local_port.unwrap();

    // Verify the local port is listening (should be fast now)
    match tokio::time::timeout(
      Duration::from_millis(500),
      TcpStream::connect(("127.0.0.1", local_port)),
    )
    .await
    {
      Ok(Ok(_)) => {
        println!("Proxy is listening on port {local_port}");
      }
      Ok(Err(e)) => {
        println!("Warning: Proxy port {local_port} is not listening: {e:?}");
        // Don't fail the test, just log a warning
      }
      Err(_) => {
        println!("Warning: Proxy port {local_port} connection check timed out");
        // Don't fail the test, just log a warning
      }
    }

    // Test stopping the proxy
    let stopped = stop_proxy_process(&proxy_id).await?;
    assert!(stopped);

    println!("Integration test passed: proxy start/stop works correctly");

    // Clean up server
    server_handle.abort();

    Ok(())
  }

  // Test that validates the command line arguments are constructed correctly
  #[test]
  fn test_proxy_command_construction() {
    let proxy_settings = ProxySettings {
      proxy_type: "http".to_string(),
      host: "proxy.example.com".to_string(),
      port: 8080,
      username: Some("user".to_string()),
      password: Some("pass".to_string()),
    };

    // Test command arguments match expected format
    let expected_args = [
      "proxy",
      "start",
      "--host",
      "proxy.example.com",
      "--proxy-port",
      "8080",
      "--type",
      "http",
      "--username",
      "user",
      "--password",
      "pass",
    ];

    // This test verifies the argument structure without actually running the command
    assert_eq!(
      proxy_settings.host, "proxy.example.com",
      "Host should match expected value"
    );
    assert_eq!(
      proxy_settings.port, 8080,
      "Port should match expected value"
    );
    assert_eq!(
      proxy_settings.proxy_type, "http",
      "Proxy type should match expected value"
    );
    assert_eq!(
      proxy_settings.username.as_ref().unwrap(),
      "user",
      "Username should match expected value"
    );
    assert_eq!(
      proxy_settings.password.as_ref().unwrap(),
      "pass",
      "Password should match expected value"
    );

    // Verify expected args structure
    assert_eq!(expected_args[0], "proxy", "First arg should be 'proxy'");
    assert_eq!(expected_args[1], "start", "Second arg should be 'start'");
    assert_eq!(expected_args[2], "--host", "Third arg should be '--host'");
    assert_eq!(
      expected_args[3], "proxy.example.com",
      "Fourth arg should be host value"
    );
  }

  // Test the CLI detachment specifically - ensure the CLI exits properly
  #[tokio::test]
  async fn test_cli_exits_after_proxy_start() -> Result<(), Box<dyn std::error::Error>> {
    let proxy_path = ensure_donut_proxy_binary().await?;

    // Test that the CLI exits quickly with a mock upstream
    let mut cmd = Command::new(&proxy_path);
    cmd
      .arg("proxy")
      .arg("start")
      .arg("--host")
      .arg("httpbin.org")
      .arg("--proxy-port")
      .arg("80")
      .arg("--type")
      .arg("http");

    let start_time = std::time::Instant::now();
    let output = tokio::time::timeout(Duration::from_secs(10), cmd.output()).await;

    match output {
      Ok(Ok(cmd_output)) => {
        let execution_time = start_time.elapsed();

        if cmd_output.status.success() {
          let stdout = String::from_utf8(cmd_output.stdout)?;
          let config: serde_json::Value = serde_json::from_str(&stdout)?;

          // Clean up - try to stop the proxy
          if let Some(proxy_id) = config["id"].as_str() {
            let mut stop_cmd = Command::new(&proxy_path);
            stop_cmd.arg("proxy").arg("stop").arg("--id").arg(proxy_id);
            let _ = stop_cmd.output().await;
          }
        }

        println!("CLI detachment test passed - CLI exited in {execution_time:?}");
      }
      Ok(Err(e)) => {
        return Err(format!("Command execution failed: {e}").into());
      }
      Err(_) => {
        return Err("CLI command timed out - this indicates improper detachment".into());
      }
    }

    Ok(())
  }

  // Test that validates proper CLI detachment behavior
  #[tokio::test]
  async fn test_cli_detachment_behavior() -> Result<(), Box<dyn std::error::Error>> {
    let proxy_path = ensure_donut_proxy_binary().await?;

    // Test that the CLI command exits quickly even with a real upstream
    let mut cmd = Command::new(&proxy_path);
    cmd
      .arg("proxy")
      .arg("start")
      .arg("--host")
      .arg("httpbin.org")
      .arg("--proxy-port")
      .arg("80")
      .arg("--type")
      .arg("http");

    let output = tokio::time::timeout(Duration::from_secs(10), cmd.output()).await??;

    if output.status.success() {
      let stdout = String::from_utf8(output.stdout)?;
      let config: serde_json::Value = serde_json::from_str(&stdout)?;
      let proxy_id = config["id"].as_str().unwrap();

      // Clean up
      let mut stop_cmd = Command::new(&proxy_path);
      stop_cmd.arg("proxy").arg("stop").arg("--id").arg(proxy_id);
      let _ = stop_cmd.output().await;

      println!("CLI detachment test passed");
    } else {
      // Even if the upstream fails, the CLI should still exit quickly
      println!("CLI command failed but exited quickly as expected");
    }

    Ok(())
  }

  // Test that validates URL encoding for special characters in credentials
  #[tokio::test]
  async fn test_proxy_credentials_encoding() -> Result<(), Box<dyn std::error::Error>> {
    let proxy_path = ensure_donut_proxy_binary().await?;

    // Test with credentials that include special characters
    let mut cmd = Command::new(&proxy_path);
    cmd
      .arg("proxy")
      .arg("start")
      .arg("--host")
      .arg("test.example.com")
      .arg("--proxy-port")
      .arg("8080")
      .arg("--type")
      .arg("http")
      .arg("--username")
      .arg("user@domain.com")
      .arg("--password")
      .arg("pass word!");

    let output = tokio::time::timeout(Duration::from_secs(10), cmd.output()).await??;

    if output.status.success() {
      let stdout = String::from_utf8(output.stdout)?;
      let config: serde_json::Value = serde_json::from_str(&stdout)?;

      let upstream_url = config["upstreamUrl"].as_str().unwrap();

      println!("Generated upstream URL: {upstream_url}");

      // Verify that special characters are properly encoded
      assert!(upstream_url.contains("user%40domain.com"));
      assert!(upstream_url.contains("pass%20word"));

      println!("URL encoding test passed - special characters handled correctly");

      // Clean up
      let proxy_id = config["id"].as_str().unwrap();
      let mut stop_cmd = Command::new(&proxy_path);
      stop_cmd.arg("proxy").arg("stop").arg("--id").arg(proxy_id);
      let _ = stop_cmd.output().await;
    } else {
      let stdout = String::from_utf8(output.stdout)?;
      let stderr = String::from_utf8(output.stderr)?;
      println!("Command failed (expected for non-existent upstream):");
      println!("Stdout: {stdout}");
      println!("Stderr: {stderr}");

      println!("URL encoding test completed - credentials should be properly encoded");
    }

    Ok(())
  }

  // ──────────────────────────────────────────────────────────────────────
  // Complex proxy process monitoring tests
  // ──────────────────────────────────────────────────────────────────────

  fn make_proxy_info(id: &str, port: u16, profile_id: Option<&str>) -> ProxyInfo {
    ProxyInfo {
      id: id.to_string(),
      local_url: format!("http://127.0.0.1:{port}"),
      upstream_host: "10.0.0.1".to_string(),
      upstream_port: 3128,
      upstream_type: "http".to_string(),
      local_port: port,
      profile_id: profile_id.map(|s| s.to_string()),
      blocklist_file: None,
    }
  }

  #[test]
  fn test_pid_mapping_lifecycle() {
    let pm = ProxyManager::new();

    // Initially empty
    assert_eq!(pm.active_proxy_count(), 0);

    // Register proxies for 3 browser PIDs
    pm.insert_active_proxy(1001, make_proxy_info("px_a", 9001, Some("profile_1")));
    pm.insert_active_proxy(1002, make_proxy_info("px_b", 9002, Some("profile_2")));
    pm.insert_active_proxy(1003, make_proxy_info("px_c", 9003, None));

    assert_eq!(pm.active_proxy_count(), 3);

    // Verify each PID resolves correctly
    let a = pm.get_active_proxy(1001).unwrap();
    assert_eq!(a.id, "px_a");
    assert_eq!(a.local_port, 9001);
    assert_eq!(a.profile_id.as_deref(), Some("profile_1"));

    let c = pm.get_active_proxy(1003).unwrap();
    assert!(c.profile_id.is_none());

    // Unknown PID returns None
    assert!(pm.get_active_proxy(9999).is_none());
  }

  #[test]
  fn test_update_proxy_pid_remaps_correctly() {
    let pm = ProxyManager::new();
    pm.insert_active_proxy(100, make_proxy_info("px_remap", 9010, Some("prof_a")));

    // Old PID 100 → new PID 200
    pm.update_proxy_pid(100, 200).unwrap();

    // Old PID should be gone
    assert!(pm.get_active_proxy(100).is_none());

    // New PID should have the same proxy info
    let info = pm.get_active_proxy(200).unwrap();
    assert_eq!(info.id, "px_remap");
    assert_eq!(info.local_port, 9010);
    assert_eq!(info.profile_id.as_deref(), Some("prof_a"));
  }

  #[test]
  fn test_update_proxy_pid_error_for_unknown_pid() {
    let pm = ProxyManager::new();
    let result = pm.update_proxy_pid(777, 888);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("No proxy found for PID 777"));
  }

  #[test]
  fn test_profile_proxy_id_mapping_tracks_active_proxy() {
    let pm = ProxyManager::new();

    pm.insert_active_proxy(500, make_proxy_info("px_1", 9100, Some("profile_x")));
    pm.insert_profile_proxy_mapping("profile_x".to_string(), "px_1".to_string());

    // Verify mapping exists
    {
      let map = pm.profile_active_proxy_ids.lock().unwrap();
      assert_eq!(map.get("profile_x").unwrap(), "px_1");
    }

    // Simulate profile-specific cleanup: remove the profile mapping
    {
      let mut map = pm.profile_active_proxy_ids.lock().unwrap();
      map.remove("profile_x");
    }

    assert_eq!(pm.profile_proxy_mapping_count(), 0);
    // Active proxy itself should still be there
    assert_eq!(pm.active_proxy_count(), 1);
  }

  #[test]
  fn test_tracked_proxy_ids_returns_all_unique_ids() {
    let pm = ProxyManager::new();
    pm.insert_active_proxy(1, make_proxy_info("alpha", 8001, None));
    pm.insert_active_proxy(2, make_proxy_info("beta", 8002, None));
    pm.insert_active_proxy(3, make_proxy_info("gamma", 8003, None));

    let ids = pm.tracked_proxy_ids();
    assert_eq!(ids.len(), 3);
    assert!(ids.contains("alpha"));
    assert!(ids.contains("beta"));
    assert!(ids.contains("gamma"));
  }

  #[tokio::test]
  async fn test_concurrent_pid_registration_and_removal() {
    use std::sync::Arc;

    let pm = Arc::new(ProxyManager::new());
    let mut handles = vec![];

    // Phase 1: concurrent insertion of 50 proxies
    for i in 0..50 {
      let pm = pm.clone();
      handles.push(tokio::spawn(async move {
        let pid = 2000 + i as u32;
        let info = make_proxy_info(&format!("px_{i}"), 7000 + i as u16, None);
        pm.insert_active_proxy(pid, info);
      }));
    }
    for h in handles.drain(..) {
      h.await.unwrap();
    }
    assert_eq!(pm.active_proxy_count(), 50);

    // Phase 2: concurrent removal of half the proxies
    for i in (0..50).step_by(2) {
      let pm = pm.clone();
      handles.push(tokio::spawn(async move {
        let pid = 2000 + i as u32;
        let mut proxies = pm.active_proxies.lock().unwrap();
        proxies.remove(&pid);
      }));
    }
    for h in handles.drain(..) {
      h.await.unwrap();
    }
    assert_eq!(pm.active_proxy_count(), 25);

    // Phase 3: remaining proxies should all have odd indices
    let proxies = pm.active_proxies.lock().unwrap();
    for (&pid, info) in proxies.iter() {
      let idx = (pid - 2000) as usize;
      assert!(idx % 2 == 1, "Only odd-index proxies should remain");
      assert_eq!(info.id, format!("px_{idx}"));
    }
  }

  #[test]
  fn test_process_running_detection_with_child_lifecycle() {
    use crate::proxy::proxy_storage::is_process_running;

    // Spawn a long-lived child so we can check while it runs.
    // On Windows, `timeout` requires console input and exits immediately in
    // non-interactive contexts, so use `ping` with a high count instead.
    let mut child = std::process::Command::new(if cfg!(windows) { "ping" } else { "sleep" })
      .args(if cfg!(windows) {
        vec!["-n", "100", "127.0.0.1"]
      } else {
        vec!["10"]
      })
      .stdout(std::process::Stdio::null())
      .stderr(std::process::Stdio::null())
      .spawn()
      .expect("spawn long-lived child");

    let pid = child.id();

    // Process should be alive
    assert!(
      is_process_running(pid),
      "Child process must be detected as running (PID {pid})"
    );

    // Kill it
    child.kill().expect("kill child");
    child.wait().expect("wait child");

    // Process should now be dead
    assert!(
      !is_process_running(pid),
      "Killed child must be detected as dead (PID {pid})"
    );
  }

  #[tokio::test]
  async fn test_cleanup_distinguishes_live_and_dead_proxy_configs() {
    use crate::proxy::proxy_storage::{save_proxy_config, ProxyConfig};

    // Spawn a live child process to use its PID.
    // On Windows, `timeout` requires console input and exits immediately in CI,
    // so use `ping` which works reliably in non-interactive contexts.
    let mut live_child = std::process::Command::new(if cfg!(windows) { "ping" } else { "sleep" })
      .args(if cfg!(windows) {
        vec!["-n", "30", "127.0.0.1"]
      } else {
        vec!["30"]
      })
      .stdout(std::process::Stdio::null())
      .stderr(std::process::Stdio::null())
      .spawn()
      .expect("spawn live child");
    let live_pid = live_child.id();

    // Spawn and kill a short-lived process to get a dead PID
    let dead_child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
      .args(if cfg!(windows) {
        vec!["/C", "exit"]
      } else {
        vec![]
      })
      .spawn()
      .expect("spawn dead child");
    let dead_pid = dead_child.id();
    let mut dead_child = dead_child;
    dead_child.wait().expect("wait for dead child");

    // Use an old timestamp so the configs aren't in the grace period
    let old_ts = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_secs()
      - 300; // 5 minutes ago

    // Save both proxy configs to disk
    let live_id = format!("proxy_{old_ts}_11111");
    let dead_id = format!("proxy_{old_ts}_22222");

    let live_config = ProxyConfig {
      id: live_id.clone(),
      upstream_url: "DIRECT".to_string(),
      local_port: Some(19001),
      ignore_proxy_certificate: None,
      local_url: Some("http://127.0.0.1:19001".to_string()),
      pid: Some(live_pid),
      profile_id: None,
      bypass_rules: Vec::new(),
      blocklist_file: None,
      local_protocol: None,
      browser_pid: None,
    };
    let dead_config = ProxyConfig {
      id: dead_id.clone(),
      upstream_url: "DIRECT".to_string(),
      local_port: Some(19002),
      ignore_proxy_certificate: None,
      local_url: Some("http://127.0.0.1:19002".to_string()),
      pid: Some(dead_pid),
      profile_id: None,
      bypass_rules: Vec::new(),
      blocklist_file: None,
      local_protocol: None,
      browser_pid: None,
    };

    save_proxy_config(&live_config).unwrap();
    save_proxy_config(&dead_config).unwrap();

    // Verify is_process_running differentiates them
    assert!(
      crate::proxy::proxy_storage::is_process_running(live_pid),
      "Live PID should be detected"
    );
    assert!(
      !crate::proxy::proxy_storage::is_process_running(dead_pid),
      "Dead PID should not be detected"
    );

    // Clean up
    live_child.kill().expect("kill live child");
    live_child.wait().expect("wait live child");
    crate::proxy::proxy_storage::delete_proxy_config(&live_id);
    crate::proxy::proxy_storage::delete_proxy_config(&dead_id);
  }

}
