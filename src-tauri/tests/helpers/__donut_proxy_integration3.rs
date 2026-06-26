/// Test that an empty bypass rules list means everything goes through upstream.
#[tokio::test]
#[serial]
async fn test_no_bypass_rules_all_through_upstream(
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
  let binary_path = setup_test().await?;
  let mut tracker = ProxyTestTracker::new(binary_path.clone());

  let (upstream_port, upstream_handle) = start_mock_http_server("ALL-UPSTREAM-RESPONSE").await;

  // Start proxy with empty bypass rules
  let bypass_rules = serde_json::json!([]).to_string();
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
    upstream_handle.abort();
    return Err(format!("Proxy start failed - stdout: {stdout}, stderr: {stderr}").into());
  }

  let config: Value = serde_json::from_str(&String::from_utf8(output.stdout)?)?;
  let proxy_id = config["id"].as_str().unwrap().to_string();
  let local_port = config["localPort"].as_u64().unwrap() as u16;
  tracker.track_proxy(proxy_id.clone());

  sleep(Duration::from_millis(500)).await;

  // All requests should go through upstream when bypass rules are empty
  let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
  let request =
    b"GET http://any-host.test/ HTTP/1.1\r\nHost: any-host.test\r\nConnection: close\r\n\r\n";
  stream.write_all(request).await?;

  let mut response = Vec::new();
  stream.read_to_end(&mut response).await?;
  let response_str = String::from_utf8_lossy(&response);

  assert!(
    response_str.contains("ALL-UPSTREAM-RESPONSE"),
    "With no bypass rules, all requests should go through upstream, got: {}",
    &response_str[..response_str.len().min(300)]
  );
  println!("Empty bypass rules test passed: all traffic goes through upstream");

  tracker.cleanup_all().await;
  upstream_handle.abort();

  Ok(())
}

/// Start a minimal SOCKS5 proxy that tunnels connections to the real destination.
/// Returns (port, JoinHandle).
async fn start_mock_socks5_server() -> (u16, tokio::task::JoinHandle<()>) {
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
  let port = listener.local_addr().unwrap().port();

  let handle = tokio::spawn(async move {
    while let Ok((mut client, _)) = listener.accept().await {
      tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        // SOCKS5 handshake: client sends version + methods
        let mut buf = [0u8; 256];
        let n = client.read(&mut buf).await.unwrap_or(0);
        if n < 2 || buf[0] != 0x05 {
          return;
        }

        // Reply: version 5, no auth required
        client.write_all(&[0x05, 0x00]).await.ok();

        // Read connect request: VER CMD RSV ATYP DST.ADDR DST.PORT
        let n = client.read(&mut buf).await.unwrap_or(0);
        if n < 7 || buf[1] != 0x01 {
          client
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await
            .ok();
          return;
        }

        let (target_host, target_port) = match buf[3] {
          0x01 => {
            // IPv4
            if n < 10 {
              return;
            }
            let ip = format!("{}.{}.{}.{}", buf[4], buf[5], buf[6], buf[7]);
            let port = u16::from_be_bytes([buf[8], buf[9]]);
            (ip, port)
          }
          0x03 => {
            // Domain
            let domain_len = buf[4] as usize;
            if n < 5 + domain_len + 2 {
              return;
            }
            let domain = String::from_utf8_lossy(&buf[5..5 + domain_len]).to_string();
            let port = u16::from_be_bytes([buf[5 + domain_len], buf[6 + domain_len]]);
            (domain, port)
          }
          _ => return,
        };

        // Connect to target
        let target =
          match tokio::net::TcpStream::connect(format!("{}:{}", target_host, target_port)).await {
            Ok(t) => t,
            Err(_) => {
              client
                .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .ok();
              return;
            }
          };

        // Success reply
        client
          .write_all(&[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0])
          .await
          .ok();

        // Bidirectional relay
        let (mut cr, mut cw) = tokio::io::split(client);
        let (mut tr, mut tw) = tokio::io::split(target);
        tokio::select! {
          _ = tokio::io::copy(&mut cr, &mut tw) => {}
          _ = tokio::io::copy(&mut tr, &mut cw) => {}
        }
      });
    }
  });

  sleep(Duration::from_millis(100)).await;
  (port, handle)
}

/// Test that a SOCKS5 upstream proxy works end-to-end through donut-proxy.
/// Starts a mock SOCKS5 server, a mock HTTP target server,
/// then routes requests through donut-proxy -> SOCKS5 -> target.
#[tokio::test]
#[serial]
async fn test_local_proxy_with_socks5_upstream(
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
  let binary_path = setup_test().await?;
  let mut tracker = ProxyTestTracker::new(binary_path.clone());

  // Start a mock HTTP server as the final destination
  let (target_port, target_handle) = start_mock_http_server("SOCKS5-TARGET-RESPONSE").await;
  println!("Mock target HTTP server on port {target_port}");

  // Start a mock SOCKS5 proxy
  let (socks_port, socks_handle) = start_mock_socks5_server().await;
  println!("Mock SOCKS5 server on port {socks_port}");

  // Helper to start a socks5 proxy
  async fn start_socks5_proxy(
    binary_path: &std::path::PathBuf,
    socks_port: u16,
  ) -> Result<(String, u16), Box<dyn std::error::Error + Send + Sync>> {
    let output = TestUtils::execute_command(
      binary_path,
      &[
        "proxy",
        "start",
        "--host",
        "127.0.0.1",
        "--proxy-port",
        &socks_port.to_string(),
        "--type",
        "socks5",
      ],
    )
    .await?;
    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Proxy start failed: {stderr}").into());
    }
    let config: Value = serde_json::from_str(&String::from_utf8(output.stdout)?)?;
    let id = config["id"].as_str().unwrap().to_string();
    let port = config["localPort"].as_u64().unwrap() as u16;

    // Wait for proxy to be fully ready by verifying it accepts and responds
    for _ in 0..20 {
      sleep(Duration::from_millis(100)).await;
      if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
        break;
      }
    }
    // Extra settle time for the accept loop to be fully initialized
    sleep(Duration::from_millis(200)).await;

    Ok((id, port))
  }

  // Test 1: HTTP request through donut-proxy -> SOCKS5 -> target
  let (proxy_id, local_port) = start_socks5_proxy(&binary_path, socks_port).await?;
  tracker.track_proxy(proxy_id);

  let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
  let request = format!(
    "GET http://127.0.0.1:{target_port}/ HTTP/1.1\r\nHost: 127.0.0.1:{target_port}\r\nConnection: close\r\n\r\n"
  );
  stream.write_all(request.as_bytes()).await?;

  let mut response = vec![0u8; 8192];
  let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut response))
    .await
    .map_err(|_| "HTTP request through SOCKS5 timed out")?
    .map_err(|e| format!("Read error: {e}"))?;
  let response_str = String::from_utf8_lossy(&response[..n]);

  assert!(
    response_str.contains("SOCKS5-TARGET-RESPONSE"),
    "HTTP request should be tunneled through SOCKS5 to target, got: {}",
    &response_str[..response_str.len().min(500)]
  );
  println!("SOCKS5 upstream proxy test passed");

  tracker.cleanup_all().await;
  target_handle.abort();
  socks_handle.abort();

  Ok(())
}

/// Test proxying traffic through a real Shadowsocks server running in Docker.
/// Verifies the full chain: client → donut-proxy → Shadowsocks → internet.
#[tokio::test]
#[serial]
async fn test_local_proxy_with_shadowsocks_upstream(
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
  let binary_path = setup_test().await?;
  let mut tracker = ProxyTestTracker::new(binary_path.clone());

  // Check Docker availability
  let docker_check = std::process::Command::new("docker").arg("version").output();
  if docker_check.map(|o| !o.status.success()).unwrap_or(true) {
    eprintln!("skipping Shadowsocks e2e test because Docker is unavailable");
    return Ok(());
  }

  // Start a Shadowsocks server container
  let ss_container = "donut-ss-test";
  let ss_port = 18388u16;
  let ss_password = "donut-test-password";
  let ss_method = "aes-256-gcm";

  // Clean up any previous container
  let _ = std::process::Command::new("docker")
    .args(["rm", "-f", ss_container])
    .output();

  let docker_start = std::process::Command::new("docker")
    .args([
      "run",
      "-d",
      "--name",
      ss_container,
      "-p",
      &format!("{ss_port}:8388"),
      "ghcr.io/shadowsocks/ssserver-rust:latest",
      "ssserver",
      "-s",
      "[::]:8388",
      "-k",
      ss_password,
      "-m",
      ss_method,
    ])
    .output()?;

  if !docker_start.status.success() {
    let stderr = String::from_utf8_lossy(&docker_start.stderr);
    eprintln!("skipping Shadowsocks e2e test: Docker run failed: {stderr}");
    return Ok(());
  }

  // Wait for the SS server to be ready
  for _ in 0..15 {
    sleep(Duration::from_secs(1)).await;
    if TcpStream::connect(("127.0.0.1", ss_port)).await.is_ok() {
      break;
    }
  }

  // Start donut-proxy with Shadowsocks upstream
  let output = TestUtils::execute_command(
    &binary_path,
    &[
      "proxy",
      "start",
      "--host",
      "127.0.0.1",
      "--proxy-port",
      &ss_port.to_string(),
      "--type",
      "ss",
      "--username",
      ss_method,
      "--password",
      ss_password,
    ],
  )
  .await?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let _ = std::process::Command::new("docker")
      .args(["rm", "-f", ss_container])
      .output();
    return Err(format!("Proxy start failed: {stderr}").into());
  }

  let config: Value = serde_json::from_str(&String::from_utf8(output.stdout)?)?;
  let proxy_id = config["id"].as_str().unwrap().to_string();
  let local_port = config["localPort"].as_u64().unwrap() as u16;
  tracker.track_proxy(proxy_id);

  // Wait for proxy to be fully ready
  for _ in 0..20 {
    sleep(Duration::from_millis(100)).await;
    if TcpStream::connect(("127.0.0.1", local_port)).await.is_ok() {
      break;
    }
  }
  sleep(Duration::from_millis(500)).await;

  // Test: HTTP request through donut-proxy → Shadowsocks → example.com
  let mut stream = TcpStream::connect(("127.0.0.1", local_port)).await?;
  let request =
    "GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n";
  stream.write_all(request.as_bytes()).await?;

  let mut response = vec![0u8; 16384];
  let n = tokio::time::timeout(Duration::from_secs(15), stream.read(&mut response))
    .await
    .map_err(|_| "HTTP request through Shadowsocks timed out")?
    .map_err(|e| format!("Read error: {e}"))?;
  let response_str = String::from_utf8_lossy(&response[..n]);

  assert!(
    response_str.contains("Example Domain"),
    "HTTP traffic through Shadowsocks should reach example.com, got: {}",
    &response_str[..response_str.len().min(500)]
  );
  println!("Shadowsocks upstream proxy test passed");

  // Cleanup
  tracker.cleanup_all().await;
  let _ = std::process::Command::new("docker")
    .args(["rm", "-f", ss_container])
    .output();

  Ok(())
}
