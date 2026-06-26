/// Test that bypass rules cause requests to bypass the upstream proxy.
/// Requests to bypassed hosts go directly to the target, while
/// requests to non-bypassed hosts are routed through the upstream.
#[tokio::test]
#[serial]
async fn test_bypass_rules_http_direct() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
  let binary_path = setup_test().await?;
  let mut tracker = ProxyTestTracker::new(binary_path.clone());

  // Start a target HTTP server (this is where bypassed requests should arrive)
  let (target_port, target_handle) = start_mock_http_server("DIRECT-TARGET-RESPONSE").await;
  println!("Target server listening on port {target_port}");

  // Start a mock upstream proxy (non-bypassed requests go here)
  let (upstream_port, upstream_handle) = start_mock_http_server("UPSTREAM-PROXY-RESPONSE").await;
  println!("Mock upstream proxy listening on port {upstream_port}");

  // Start donut-proxy with upstream + bypass rules for "127.0.0.1"
  let bypass_rules = serde_json::json!(["127.0.0.1"]).to_string();
  let output = TestUtils::execute_command(
    &binary_path,
    &[
      "proxy",
      "start",
      "--host",
      "127.0.0.1",
      "--proxy-port",
      &upstream_port.to_string(),
      "--type",
      "http",
      "--bypass-rules",
      &bypass_rules,
    ],
  )
  .await?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    target_handle.abort();
    upstream_handle.abort();
    return Err(format!("Proxy start failed - stdout: {stdout}, stderr: {stderr}").into());
  }

  let config: Value = serde_json::from_str(&String::from_utf8(output.stdout)?)?;
  let proxy_id = config["id"].as_str().unwrap().to_string();
  let local_port = config["localPort"].as_u64().unwrap() as u16;
  tracker.track_proxy(proxy_id.clone());

  println!("Donut-proxy started on port {local_port} with bypass rules for 127.0.0.1");

  sleep(Duration::from_millis(500)).await;

  // Test 1: Request to 127.0.0.1 should be BYPASSED (direct connection to target)
  {
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
    let request = format!(
      "GET http://127.0.0.1:{target_port}/ HTTP/1.1\r\nHost: 127.0.0.1:{target_port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response_str = String::from_utf8_lossy(&response);

    println!(
      "Bypass response: {}",
      &response_str[..response_str.len().min(300)]
    );

    assert!(
      response_str.contains("DIRECT-TARGET-RESPONSE"),
      "Bypassed request should reach target directly, got: {}",
      &response_str[..response_str.len().min(300)]
    );
    assert!(
      !response_str.contains("UPSTREAM-PROXY-RESPONSE"),
      "Bypassed request should NOT go through upstream"
    );
    println!("Bypass test passed: request to 127.0.0.1 went directly to target");
  }

  // Test 2: Request to non-bypassed host should go through upstream
  {
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
    let request =
      b"GET http://non-bypass-host.test/ HTTP/1.1\r\nHost: non-bypass-host.test\r\nConnection: close\r\n\r\n";
    stream.write_all(request).await?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response_str = String::from_utf8_lossy(&response);

    println!(
      "Non-bypass response: {}",
      &response_str[..response_str.len().min(300)]
    );

    assert!(
      response_str.contains("UPSTREAM-PROXY-RESPONSE"),
      "Non-bypassed request should go through upstream, got: {}",
      &response_str[..response_str.len().min(300)]
    );
    assert!(
      !response_str.contains("DIRECT-TARGET-RESPONSE"),
      "Non-bypassed request should NOT reach target directly"
    );
    println!("Non-bypass test passed: request to non-bypass-host.test went through upstream");
  }

  // Cleanup
  tracker.cleanup_all().await;
  target_handle.abort();
  upstream_handle.abort();

  Ok(())
}

/// Test bypass rules with regex patterns.
/// Verifies that regex-based rules match hosts correctly.
#[tokio::test]
#[serial]
async fn test_bypass_rules_regex_pattern() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
  let binary_path = setup_test().await?;
  let mut tracker = ProxyTestTracker::new(binary_path.clone());

  let (target_port, target_handle) = start_mock_http_server("REGEX-DIRECT-RESPONSE").await;
  let (upstream_port, upstream_handle) = start_mock_http_server("REGEX-UPSTREAM-RESPONSE").await;

  // Use regex bypass rule: ^127\.0\.0\.\d+ (matches any 127.0.0.x address)
  let bypass_rules = serde_json::json!([r"^127\.0\.0\.\d+"]).to_string();
  let output = TestUtils::execute_command(
    &binary_path,
    &[
      "proxy",
      "start",
      "--host",
      "127.0.0.1",
      "--proxy-port",
      &upstream_port.to_string(),
      "--type",
      "http",
      "--bypass-rules",
      &bypass_rules,
    ],
  )
  .await?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    target_handle.abort();
    upstream_handle.abort();
    return Err(format!("Proxy start failed - stdout: {stdout}, stderr: {stderr}").into());
  }

  let config: Value = serde_json::from_str(&String::from_utf8(output.stdout)?)?;
  let proxy_id = config["id"].as_str().unwrap().to_string();
  let local_port = config["localPort"].as_u64().unwrap() as u16;
  tracker.track_proxy(proxy_id.clone());

  sleep(Duration::from_millis(500)).await;

  // Request to 127.0.0.1 should match regex and be bypassed
  {
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
    let request = format!(
      "GET http://127.0.0.1:{target_port}/ HTTP/1.1\r\nHost: 127.0.0.1:{target_port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response_str = String::from_utf8_lossy(&response);

    assert!(
      response_str.contains("REGEX-DIRECT-RESPONSE"),
      "Regex-bypassed request should reach target directly, got: {}",
      &response_str[..response_str.len().min(300)]
    );
    println!("Regex bypass test passed: 127.0.0.1 matched regex rule");
  }

  // Request to non-matching host should go through upstream
  {
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
    let request =
      b"GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n";
    stream.write_all(request).await?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response_str = String::from_utf8_lossy(&response);

    assert!(
      response_str.contains("REGEX-UPSTREAM-RESPONSE"),
      "Non-matching request should go through upstream, got: {}",
      &response_str[..response_str.len().min(300)]
    );
    println!("Regex non-bypass test passed: example.com did not match regex rule");
  }

  tracker.cleanup_all().await;
  target_handle.abort();
  upstream_handle.abort();

  Ok(())
}

/// Test that bypass rules are persisted in the proxy config on disk.
#[tokio::test]
#[serial]
async fn test_bypass_rules_in_config() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
  let binary_path = setup_test().await?;
  let mut tracker = ProxyTestTracker::new(binary_path.clone());

  let bypass_rules =
    serde_json::json!(["example.com", "192.168.0.0/16", r".*\.internal\.net"]).to_string();
  let output = TestUtils::execute_command(
    &binary_path,
    &["proxy", "start", "--bypass-rules", &bypass_rules],
  )
  .await?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    return Err(format!("Proxy start failed - stdout: {stdout}, stderr: {stderr}").into());
  }

  let config: Value = serde_json::from_str(&String::from_utf8(output.stdout)?)?;
  let proxy_id = config["id"].as_str().unwrap().to_string();
  tracker.track_proxy(proxy_id.clone());

  sleep(Duration::from_millis(500)).await;

  // Read the proxy config file from disk to verify bypass rules are persisted
  let proxies_dir = donutbrowser_lib::app_dirs::proxy_workers_dir();
  let config_file = proxies_dir.join(format!("{proxy_id}.json"));

  assert!(
    config_file.exists(),
    "Proxy config file should exist at {:?}",
    config_file
  );

  let config_content = std::fs::read_to_string(&config_file)?;
  let disk_config: Value = serde_json::from_str(&config_content)?;

  let rules = disk_config["bypass_rules"]
    .as_array()
    .expect("bypass_rules should be an array in the config");

  assert_eq!(rules.len(), 3, "Should have 3 bypass rules");
  assert_eq!(rules[0], "example.com");
  assert_eq!(rules[1], "192.168.0.0/16");
  assert_eq!(rules[2], r".*\.internal\.net");

  println!(
    "Config persistence test passed: {} bypass rules found in config",
    rules.len()
  );

  tracker.cleanup_all().await;

  Ok(())
}

/// Test bypass rules with multiple rule types combined (exact + regex).
#[tokio::test]
#[serial]
async fn test_bypass_rules_multiple_rules() -> Result<(), Box<dyn std::error::Error + Send + Sync>>
{
  let binary_path = setup_test().await?;
  let mut tracker = ProxyTestTracker::new(binary_path.clone());

  let (target_port, target_handle) = start_mock_http_server("MULTI-DIRECT-RESPONSE").await;
  let (upstream_port, upstream_handle) = start_mock_http_server("MULTI-UPSTREAM-RESPONSE").await;

  // Multiple bypass rules: exact match + regex
  let bypass_rules = serde_json::json!(["127.0.0.1", r"^localhost$"]).to_string();
  let output = TestUtils::execute_command(
    &binary_path,
    &[
      "proxy",
      "start",
      "--host",
      "127.0.0.1",
      "--proxy-port",
      &upstream_port.to_string(),
      "--type",
      "http",
      "--bypass-rules",
      &bypass_rules,
    ],
  )
  .await?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    target_handle.abort();
    upstream_handle.abort();
    return Err(format!("Proxy start failed - stdout: {stdout}, stderr: {stderr}").into());
  }

  let config: Value = serde_json::from_str(&String::from_utf8(output.stdout)?)?;
  let proxy_id = config["id"].as_str().unwrap().to_string();
  let local_port = config["localPort"].as_u64().unwrap() as u16;
  tracker.track_proxy(proxy_id.clone());

  sleep(Duration::from_millis(500)).await;

  // Request via 127.0.0.1 (exact match rule) → bypass
  {
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
    let request = format!(
      "GET http://127.0.0.1:{target_port}/ HTTP/1.1\r\nHost: 127.0.0.1:{target_port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response_str = String::from_utf8_lossy(&response);

    assert!(
      response_str.contains("MULTI-DIRECT-RESPONSE"),
      "Exact-match bypassed request should reach target, got: {}",
      &response_str[..response_str.len().min(300)]
    );
    println!("Multi-rule test: exact match bypass works");
  }

  // Request via localhost (regex match rule) → bypass
  {
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
    let request = format!(
      "GET http://localhost:{target_port}/ HTTP/1.1\r\nHost: localhost:{target_port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response_str = String::from_utf8_lossy(&response);

    assert!(
      response_str.contains("MULTI-DIRECT-RESPONSE"),
      "Regex-match bypassed request should reach target, got: {}",
      &response_str[..response_str.len().min(300)]
    );
    println!("Multi-rule test: regex match bypass works");
  }

  // Request to non-matching host → upstream
  {
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
    let request =
      b"GET http://other-host.test/ HTTP/1.1\r\nHost: other-host.test\r\nConnection: close\r\n\r\n";
    stream.write_all(request).await?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response_str = String::from_utf8_lossy(&response);

    assert!(
      response_str.contains("MULTI-UPSTREAM-RESPONSE"),
      "Non-matching request should go through upstream, got: {}",
      &response_str[..response_str.len().min(300)]
    );
    println!("Multi-rule test: non-matching host goes through upstream");
  }

  tracker.cleanup_all().await;
  target_handle.abort();
  upstream_handle.abort();

  Ok(())
}

