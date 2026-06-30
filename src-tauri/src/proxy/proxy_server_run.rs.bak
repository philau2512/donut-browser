pub async fn run_proxy_server(config: ProxyConfig) -> Result<(), Box<dyn std::error::Error>> {
  log::info!(
    "Proxy worker starting, looking for config id: {}",
    config.id
  );

  // Load the config from disk to get the latest state
  let config = match crate::proxy::proxy_storage::get_proxy_config(&config.id) {
    Some(c) => c,
    None => {
      log::error!("Config not found for id: {}", config.id);
      return Err("Config not found".into());
    }
  };

  log::info!(
    "Found config: id={}, port={:?}, upstream={}, profile_id={:?}",
    config.id,
    config.local_port,
    config.upstream_url,
    config.profile_id
  );

  // Initialize traffic tracker with profile ID if available.
  // This can be called multiple times to update the tracker.
  init_traffic_tracker(config.id.clone(), config.profile_id.clone());

  // Determine the bind address
  let bind_addr = SocketAddr::from(([127, 0, 0, 1], config.local_port.unwrap_or(0)));

  log::info!("Attempting to bind proxy server to {}", bind_addr);

  // Bind to the port. Use SO_REUSEADDR so that a freshly-restarted worker
  // can bind a port that the previous worker left in TIME_WAIT, and retry
  // briefly to absorb transient races with the OS releasing the socket.
  let listener = {
    let mut attempts: u32 = 0;
    loop {
      let socket = tokio::net::TcpSocket::new_v4()?;
      let _ = socket.set_reuseaddr(true);
      match socket.bind(bind_addr) {
        Ok(()) => match socket.listen(1024) {
          Ok(l) => break l,
          Err(e) if attempts < 5 => {
            attempts += 1;
            let delay = std::time::Duration::from_millis(200 * u64::from(attempts));
            log::warn!(
              "listen() on {} failed (attempt {}/5): {}, retrying in {}ms",
              bind_addr,
              attempts,
              e,
              delay.as_millis()
            );
            tokio::time::sleep(delay).await;
          }
          Err(e) => {
            return Err(format!("Failed to listen on {bind_addr} after 5 attempts: {e}").into())
          }
        },
        Err(e) if attempts < 5 => {
          attempts += 1;
          let delay = std::time::Duration::from_millis(200 * u64::from(attempts));
          log::warn!(
            "bind() on {} failed (attempt {}/5): {}, retrying in {}ms",
            bind_addr,
            attempts,
            e,
            delay.as_millis()
          );
          tokio::time::sleep(delay).await;
        }
        Err(e) => return Err(format!("Failed to bind {bind_addr} after 5 attempts: {e}").into()),
      }
    }
  };
  let actual_port = listener.local_addr()?.port();

  log::info!("Successfully bound to port {}", actual_port);

  // Protocol served to the browser: "socks5" (Wayfern) or "http" (default).
  let local_protocol = config.local_protocol_or_default();
  let serve_socks5 = local_protocol == "socks5";

  // Update config with actual port and local_url (scheme matches the protocol
  // we serve, so the parent's readiness check and any consumer see the truth)
  let mut updated_config = config.clone();
  updated_config.local_port = Some(actual_port);
  updated_config.local_url = Some(format!(
    "{}://127.0.0.1:{}",
    if serve_socks5 { "socks5" } else { "http" },
    actual_port
  ));

  if !crate::proxy::proxy_storage::update_proxy_config(&updated_config) {
    log::error!("Failed to update proxy config");
    return Err("Failed to update proxy config".into());
  }

  let upstream_url = if updated_config.upstream_url == "DIRECT" {
    None
  } else {
    Some(updated_config.upstream_url.clone())
  };

  log::info!(
    "Proxy server listening on 127.0.0.1:{} (ready to accept connections)",
    actual_port
  );
  log::info!("Proxy server entering accept loop - process should stay alive");

  // Start a background task to write lightweight session snapshots for real-time updates
  // These are much smaller than full stats and can be written frequently (~100 bytes every 2 seconds)
  if let Some(tracker) = get_traffic_tracker() {
    let tracker_clone = tracker.clone();
    tokio::spawn(async move {
      let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
      interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

      loop {
        interval.tick().await;
        // Write lightweight session snapshot (only current counters, ~100 bytes)
        if let Err(e) = tracker_clone.write_session_snapshot() {
          log::debug!("Failed to write session snapshot: {}", e);
        }
      }
    });
  }

  // Start a background task to periodically flush traffic stats to disk
  // Use adaptive flush frequency: every 5 seconds when active, every 30 seconds when idle
  tokio::spawn(async move {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_activity_time = std::time::Instant::now();
    let mut last_flush_time = std::time::Instant::now();
    let mut current_interval_secs = 5u64;

    loop {
      interval.tick().await;
      // Catch panics so a poisoned lock or unexpected error inside
      // flush_to_disk doesn't abort the flush task and leave stats
      // unwritten for the lifetime of the worker. The captured state
      // is all Copy or atomic-assignment, so AssertUnwindSafe is sound.
      let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if let Some(tracker) = get_traffic_tracker() {
          let (sent, recv, requests) = tracker.get_snapshot();
          let current_bytes = sent + recv;
          let time_since_activity = last_activity_time.elapsed();
          let time_since_flush = last_flush_time.elapsed();
          let has_traffic = current_bytes > 0 || requests > 0;

          let desired_interval_secs =
            if has_traffic || time_since_activity < std::time::Duration::from_secs(30) {
              5u64
            } else {
              30u64
            };

          if desired_interval_secs != current_interval_secs {
            current_interval_secs = desired_interval_secs;
            interval =
              tokio::time::interval(tokio::time::Duration::from_secs(desired_interval_secs));
          }

          let flush_interval = std::time::Duration::from_secs(desired_interval_secs);
          let should_flush = time_since_flush >= flush_interval;

          if should_flush {
            match tracker.flush_to_disk() {
              Ok(Some((sent, recv))) => {
                last_flush_time = std::time::Instant::now();
                if sent > 0 || recv > 0 {
                  last_activity_time = std::time::Instant::now();
                }
              }
              Ok(None) => {
                last_flush_time = std::time::Instant::now();
              }
              Err(e) => {
                log::error!("Failed to flush traffic stats: {}", e);
              }
            }
          }
        }
      }));
      if let Err(panic) = result {
        log::error!("Panic caught in proxy traffic flush task; continuing: {panic:?}");
      }
    }
  });

  // Self-reaping supervisor. The worker is a detached process that outlives the
  // GUI, so it cannot rely on the GUI's in-memory death-monitor (which is lost
  // when the GUI restarts). Once the GUI records the browser PID this worker
  // serves, poll it and exit when that browser is gone — never while it is
  // alive, and never before a PID is recorded (covers the launch window and
  // pre-upgrade configs lacking the field). A 2-miss debounce avoids exiting on
  // a transient sysinfo false-negative under load / sleep-wake.
  {
    let watch_id = config.id.clone();
    tokio::spawn(async move {
      let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(15));
      interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
      let mut consecutive_misses: u32 = 0;
      loop {
        interval.tick().await;
        match crate::proxy::proxy_storage::get_proxy_config(&watch_id) {
          Some(cfg) => match cfg.browser_pid {
            Some(bpid) if bpid != 0 => {
              if crate::proxy::proxy_storage::is_process_running(bpid) {
                consecutive_misses = 0;
              } else {
                consecutive_misses += 1;
                if consecutive_misses >= 2 {
                  log::info!("Browser PID {bpid} for config {watch_id} is gone; worker exiting");
                  crate::proxy::proxy_storage::delete_proxy_config(&watch_id);
                  std::process::exit(0);
                }
              }
            }
            // No browser PID recorded yet (launch window / old config): keep running.
            _ => consecutive_misses = 0,
          },
          // Our own config was removed (e.g. GUI stopped us): nothing to serve.
          None => {
            log::info!("Proxy config {watch_id} was removed; worker exiting");
            std::process::exit(0);
          }
        }
      }
    });
  }

  let bypass_matcher = BypassMatcher::new(&config.bypass_rules);
  let blocklist_matcher = if let Some(ref path) = config.blocklist_file {
    match BlocklistMatcher::from_file(path) {
      Ok(m) => m,
      Err(e) => {
        log::error!("[blocklist] Failed to load from {}: {}", path, e);
        BlocklistMatcher::new()
      }
    }
  } else {
    BlocklistMatcher::new()
  };

  // Bound concurrent connection handlers. A client retry-storm (e.g. a browser
  // hammering CONNECT requests while DNS is failing) must not spawn unbounded
  // tasks,
  // each of which parks a Tokio blocking thread inside getaddrinfo — that is
  // what exhausted the resolver pool and pegged the CPU on long-lived workers.
  // A real browser never approaches this ceiling; waiting for a permit
  // backpressures a storm instead of amplifying it.
  let conn_semaphore = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_CONNECTIONS));

  // Keep the runtime alive with an infinite loop
  // This ensures the process doesn't exit even if there are no active connections
  loop {
    match listener.accept().await {
      Ok((stream, _peer_addr)) => {
        // The semaphore is never closed, so acquire cannot fail.
        let permit = conn_semaphore
          .clone()
          .acquire_owned()
          .await
          .expect("connection semaphore is never closed");
        let upstream = upstream_url.clone();
        let matcher = bypass_matcher.clone();
        let blocker = blocklist_matcher.clone();
        if serve_socks5 {
          tokio::task::spawn(async move {
            let _permit = permit;
            crate::proxy::socks5_local::handle_socks5_connection(
              stream, upstream, matcher, blocker,
            )
            .await;
          });
        } else {
          tokio::task::spawn(async move {
            let _permit = permit;
            handle_proxy_connection(stream, upstream, matcher, blocker).await;
          });
        }
      }
      Err(e) => {
        log::error!("Error accepting connection: {:?}", e);
        // Continue accepting connections even if one fails
        // Add a small delay to avoid busy-waiting on errors
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
      }
    }
  }
}

async fn handle_connect_from_buffer(
  mut client_stream: TcpStream,
  request_buffer: Vec<u8>,
  upstream_url: Option<String>,
  bypass_matcher: BypassMatcher,
  blocklist_matcher: BlocklistMatcher,
) -> Result<(), Box<dyn std::error::Error>> {
  // Parse the CONNECT request from the buffer
  let request_str = String::from_utf8_lossy(&request_buffer);
  let lines: Vec<&str> = request_str.lines().collect();

  if lines.is_empty() {
    let _ = client_stream
      .write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n")
      .await;
    return Err("Empty CONNECT request".into());
  }

  // Parse CONNECT request: "CONNECT host:port HTTP/1.1"
  let parts: Vec<&str> = lines[0].split_whitespace().collect();
  if parts.len() < 2 || parts[0] != "CONNECT" {
    let _ = client_stream
      .write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n")
      .await;
    return Err("Invalid CONNECT request".into());
  }

  let target = parts[1];
  let (target_host, target_port) = if let Some(colon_pos) = target.find(':') {
    let host = &target[..colon_pos];
    let port: u16 = target[colon_pos + 1..].parse().unwrap_or(443);
    (host, port)
  } else {
    (target, 443)
  };

  // Block if domain is in the DNS blocklist (before any connection)
  if blocklist_matcher.is_blocked(target_host) {
    log::debug!("[blocklist] Blocked CONNECT tunnel to {}", target_host);
    let _ = client_stream
      .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 24\r\n\r\nBlocked by DNS blocklist")
      .await;
    return Ok(());
  }

  // Record domain access in traffic tracker
  let domain = target_host.to_string();
  if let Some(tracker) = get_traffic_tracker() {
    tracker.record_request(&domain, 0, 0);
  }

  log::debug!(
    "CONNECT {}:{} (upstream={})",
    target_host,
    target_port,
    upstream_url.as_deref().unwrap_or("DIRECT")
  );

  // Connect to target (directly or via upstream proxy).
  let target_stream = connect_to_target_via_upstream(
    target_host,
    target_port,
    upstream_url.as_deref(),
    &bypass_matcher,
  )
  .await?;

  // Send 200 Connection Established response to client
  // CRITICAL: Must flush after writing to ensure response is sent before tunneling
  client_stream
    .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
    .await?;
  client_stream.flush().await?;

  log::trace!("Sent 200 Connection Established response, starting tunnel");

  tunnel_streams(client_stream, target_stream, domain).await;

  Ok(())
}

/// Upper bound on concurrent connection handlers per worker. A real browser
/// never holds anywhere near this many simultaneous tunnels; the cap stops a
/// client retry-storm from spawning unbounded tasks (each of which parks a
/// Tokio blocking thread inside getaddrinfo).
const MAX_CONCURRENT_CONNECTIONS: usize = 512;

/// Connect timeout for the direct (no-upstream) dial path. Bounds a wedged
/// `getaddrinfo` so a broken resolver can't park a blocking thread for the
/// full OS timeout.
const DIRECT_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Overall timeout for dialing an UPSTREAM proxy (TCP connect + CONNECT/SOCKS/SS
/// handshake). Without it, an upstream that accepts TCP but stalls before
/// replying hangs the worker task forever and holds a connection slot; under
/// load (e.g. two profiles sharing one proxy) the slots exhaust and the browser
/// sees `ERR_PROXY_CONNECTION_FAILED` until the profile is restarted (issue
/// #439). A bounded dial fails fast and releases the slot.
const UPSTREAM_DIAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Per-host failure state (last failure instant, consecutive failure count) for
/// the direct dial path. Process-global — each worker is its own process.
fn direct_dial_failures() -> &'static Mutex<HashMap<String, (std::time::Instant, u32)>> {
  static M: OnceLock<Mutex<HashMap<String, (std::time::Instant, u32)>>> = OnceLock::new();
  M.get_or_init(|| Mutex::new(HashMap::new()))
}

/// If `host` is inside its failure backoff window, return the remaining time so
/// the caller can short-circuit without a fresh getaddrinfo/connect. Never
/// mutates state, so the window always expires and the path self-heals once
/// DNS recovers.
fn direct_backoff_remaining(host: &str) -> Option<std::time::Duration> {
  let map = direct_dial_failures();
  let guard = map.lock().unwrap();
  let (last, fails) = guard.get(host).copied()?;
  // Exponential window capped at 30s: 2, 4, 8, 16, 30, 30, ...
  let window = std::time::Duration::from_secs((1u64 << fails.min(5)).min(30));
  let elapsed = last.elapsed();
  if elapsed < window {
    Some(window - elapsed)
  } else {
    None
  }
}

/// Record a direct-dial failure for `host`, growing its backoff window.
fn direct_backoff_record(host: &str) {
  let map = direct_dial_failures();
  let mut guard = map.lock().unwrap();
  // Bound memory against a page that emits many distinct failing hosts.
  if guard.len() > 2048 {
    guard.retain(|_, (last, _)| last.elapsed() < std::time::Duration::from_secs(60));
  }
  let entry = guard
    .entry(host.to_string())
    .or_insert_with(|| (std::time::Instant::now(), 0));
  entry.0 = std::time::Instant::now();
  entry.1 = entry.1.saturating_add(1);
}

/// Clear `host`'s failure state after a successful dial.
fn direct_backoff_clear(host: &str) {
  direct_dial_failures().lock().unwrap().remove(host);
}

/// Dial a target directly (no upstream) with a connect timeout and per-host
/// failure backoff. This is the server-side counterpart to the browser's
/// instant client-side retry: when a host's DNS/connect is failing (e.g. the
/// macOS resolver wedges after sleep/wake), repeated CONNECT requests
/// short-circuit
/// here instead of each spawning a fresh blocking getaddrinfo — which is what
/// let a retry-storm exhaust the blocking thread pool and peg the CPU.
async fn dial_direct(host: &str, port: u16) -> Result<TcpStream, Box<dyn std::error::Error>> {
  if let Some(remaining) = direct_backoff_remaining(host) {
    return Err(
      format!(
        "skipping direct dial to {host}: backing off ~{}s after repeated connect failures",
        remaining.as_secs().max(1)
      )
      .into(),
    );
  }
  match tokio::time::timeout(DIRECT_CONNECT_TIMEOUT, TcpStream::connect((host, port))).await {
    Ok(Ok(stream)) => {
      let _ = stream.set_nodelay(true);
      direct_backoff_clear(host);
      Ok(stream)
    }
    Ok(Err(e)) => {
      direct_backoff_record(host);
      Err(e.into())
    }
    Err(_) => {
      direct_backoff_record(host);
      Err(
        format!(
          "direct connect to {host}:{port} timed out after {}s",
          DIRECT_CONNECT_TIMEOUT.as_secs()
        )
        .into(),
      )
    }
  }
}

/// Rate-limit a repetitive log line keyed by `key`: returns `Some(suppressed)`
/// when the caller should emit (first time or after a 30s window, with the
/// count dropped since the last emit), or `None` to skip. Stops a connect/DNS
/// storm from writing the same WARN millions of times (the line that grew
/// worker logs to 100MB).
pub(crate) fn log_throttle(key: &str) -> Option<u64> {
  fn throttle_map() -> &'static Mutex<HashMap<String, (std::time::Instant, u64)>> {
    static M: OnceLock<Mutex<HashMap<String, (std::time::Instant, u64)>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
  }
  let map = throttle_map();
  let mut guard = map.lock().unwrap();
  if guard.len() > 2048 {
    guard.retain(|_, (last, _)| last.elapsed() < std::time::Duration::from_secs(60));
  }
  let now = std::time::Instant::now();
  match guard.get_mut(key) {
    Some((last, suppressed)) => {
      if now.duration_since(*last) >= std::time::Duration::from_secs(30) {
        let dropped = *suppressed;
        *last = now;
        *suppressed = 0;
        Some(dropped)
      } else {
        *suppressed += 1;
        None
      }
    }
    None => {
      guard.insert(key.to_string(), (now, 0));
      Some(0)
    }
  }
}

/// Establish a stream to `target_host:target_port`, either directly or through
/// the configured upstream proxy. Shared by the HTTP CONNECT path and the
/// local SOCKS5 server so every upstream type (direct, HTTP/HTTPS CONNECT,
/// SOCKS4/5, Shadowsocks) is dialed in exactly one place. Returns a
/// `BoxedAsyncStream` so the caller can tunnel over any upstream uniformly.
pub(crate) async fn connect_to_target_via_upstream(
  target_host: &str,
  target_port: u16,
  upstream_url: Option<&str>,
  bypass_matcher: &BypassMatcher,
) -> Result<BoxedAsyncStream, Box<dyn std::error::Error>> {
  let should_bypass = bypass_matcher.should_bypass(target_host);
  // Helper: configure outbound TCP to match browser TCP fingerprint
  let configure_tcp = |stream: &TcpStream| {
    let _ = stream.set_nodelay(true);
  };
  let target_stream: BoxedAsyncStream = match upstream_url {
    None | Some("DIRECT") => Box::new(dial_direct(target_host, target_port).await?),
    _ if should_bypass => Box::new(dial_direct(target_host, target_port).await?),
    Some(upstream_url_str) => {
      let upstream = Url::parse(upstream_url_str)?;
      let scheme = upstream.scheme();

      match scheme {
        "http" | "https" => {
          let proxy_host = upstream.host_str().unwrap_or("127.0.0.1");
          let proxy_port = upstream.port().unwrap_or(8080);
          let mut proxy_stream = tokio::time::timeout(
            UPSTREAM_DIAL_TIMEOUT,
            TcpStream::connect((proxy_host, proxy_port)),
          )
          .await
          .map_err(|_| {
            format!("upstream proxy connect to {proxy_host}:{proxy_port} timed out")
          })??;
          configure_tcp(&proxy_stream);

          let mut connect_req = format!(
            "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
            target_host, target_port, target_host, target_port
          );

          let (username, password) = upstream_userpass(&upstream);
          if !username.is_empty() {
            use base64::{engine::general_purpose, Engine as _};
            let auth = general_purpose::STANDARD.encode(format!("{}:{}", username, password));
            connect_req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", auth));
          }

          connect_req.push_str("\r\n");

          proxy_stream.write_all(connect_req.as_bytes()).await?;

          let mut buffer = [0u8; 4096];
          let n = tokio::time::timeout(UPSTREAM_DIAL_TIMEOUT, proxy_stream.read(&mut buffer))
            .await
            .map_err(|_| "upstream proxy CONNECT response timed out")??;
          let response_full = String::from_utf8_lossy(&buffer[..n]).to_string();
          let status_line = response_full.lines().next().unwrap_or("").to_string();

          if !response_full.starts_with("HTTP/1.1 200")
            && !response_full.starts_with("HTTP/1.0 200")
          {
            log::warn!(
              "Upstream CONNECT to {}:{} via {}:{} rejected: {}",
              target_host,
              target_port,
              proxy_host,
              proxy_port,
              status_line
            );
            return Err(format!("Upstream proxy CONNECT failed: {response_full}").into());
          }

          // Detect the buffer-drop race where the upstream returned the
          // 200 response coalesced with destination bytes — those bytes
          // would otherwise be silently discarded and the browser would
          // see a TLS stream missing its first record.
          let header_end_in_buffer = response_full.find("\r\n\r\n").map(|i| i + 4);
          if let Some(end) = header_end_in_buffer {
            if end < n {
              log::warn!(
                "Upstream CONNECT response coalesced {} byte(s) of payload — these would be dropped without forwarding",
                n - end
              );
            }
          }

          log::info!(
            "Upstream CONNECT to {}:{} via {}:{} accepted ({})",
            target_host,
            target_port,
            proxy_host,
            proxy_port,
            status_line
          );

          Box::new(proxy_stream)
        }
        "socks4" | "socks5" => {
          let socks_host = upstream.host_str().unwrap_or("127.0.0.1");
          let socks_port = upstream.port().unwrap_or(1080);
          let socks_addr = format!("{}:{}", socks_host, socks_port);

          let (username, password) = upstream_userpass(&upstream);
          let auth = (!username.is_empty()).then_some((username.as_str(), password.as_str()));

          let stream = connect_via_socks(
            &socks_addr,
            target_host,
            target_port,
            scheme == "socks5",
            auth,
          )
          .await?;
          Box::new(stream)
        }
        "ss" | "shadowsocks" => {
          // Shadowsocks: URL format is ss://method:password@host:port
          // where "method" is the cipher (e.g. aes-256-gcm, chacha20-ietf-poly1305)
          // and "password" is the SS server password.
          let ss_host = upstream.host_str().unwrap_or("127.0.0.1");
          let ss_port = upstream.port().unwrap_or(8388);

          // The "username" field carries the cipher method
          let method_str = urlencoding::decode(upstream.username())
            .unwrap_or_default()
            .to_string();
          let password = urlencoding::decode(upstream.password().unwrap_or(""))
            .unwrap_or_default()
            .to_string();

          if method_str.is_empty() || password.is_empty() {
            return Err(
              "Shadowsocks requires method and password (URL: ss://method:password@host:port)"
                .into(),
            );
          }

          let cipher = method_str.parse::<shadowsocks::crypto::CipherKind>().map_err(|_| {
            format!("Unsupported Shadowsocks cipher: {method_str}. Use e.g. aes-256-gcm, chacha20-ietf-poly1305, aes-128-gcm")
          })?;

          let context =
            shadowsocks::context::Context::new_shared(shadowsocks::config::ServerType::Local);
          let svr_cfg = shadowsocks::config::ServerConfig::new(
            shadowsocks::config::ServerAddr::from((ss_host.to_string(), ss_port)),
            &password,
            cipher,
          )
          .map_err(|e| format!("Invalid Shadowsocks config: {e}"))?;

          let target_addr =
            shadowsocks::relay::Address::DomainNameAddress(target_host.to_string(), target_port);

          let stream = tokio::time::timeout(
            UPSTREAM_DIAL_TIMEOUT,
            shadowsocks::relay::tcprelay::proxy_stream::ProxyClientStream::connect(
              context,
              &svr_cfg,
              target_addr,
            ),
          )
          .await
          .map_err(|_| "Shadowsocks connection timed out".to_string())?
          .map_err(|e| format!("Shadowsocks connection failed: {e}"))?;

          Box::new(stream)
        }
        _ => {
          return Err(format!("Unsupported upstream proxy scheme: {}", scheme).into());
        }
      }
    }
  };

  Ok(target_stream)
}

/// Bidirectionally relay `client_stream` <-> `target_stream` until either side
/// closes, counting bytes for traffic stats and attributing them to `domain`.
/// The caller is responsible for having already sent any protocol-specific
/// success reply (HTTP `200` or SOCKS5 reply) before calling this.
pub(crate) async fn tunnel_streams(
  client_stream: TcpStream,
  target_stream: BoxedAsyncStream,
  domain: String,
) {
  // Wrap streams to count bytes transferred
  let counting_client = CountingStream::new(client_stream);
  let counting_target = CountingStream::new(target_stream);

  // Get references for final stats
  let client_read_counter = counting_client.bytes_read.clone();
  let client_write_counter = counting_client.bytes_written.clone();
  let target_read_counter = counting_target.bytes_read.clone();
  let target_write_counter = counting_target.bytes_written.clone();

  // Split streams for bidirectional copying
  let (mut client_read, mut client_write) = tokio::io::split(counting_client);
  let (mut target_read, mut target_write) = tokio::io::split(counting_target);

  log::trace!("Starting bidirectional tunnel");

  // Spawn two tasks to forward data in both directions
  let client_to_target = tokio::spawn(async move {
    let result = tokio::io::copy(&mut client_read, &mut target_write).await;
    match result {
      Ok(bytes) => {
        log::trace!("Tunneled {bytes} bytes from client->target");
      }
      Err(e) => {
        log::debug!("Error forwarding client->target: {e:?}");
      }
    }
  });

  let target_to_client = tokio::spawn(async move {
    let result = tokio::io::copy(&mut target_read, &mut client_write).await;
    match result {
      Ok(bytes) => {
        log::trace!("Tunneled {bytes} bytes from target->client");
      }
      Err(e) => {
        log::debug!("Error forwarding target->client: {e:?}");
      }
    }
  });

  // Wait for either direction to finish (connection closed)
  tokio::select! {
    _ = client_to_target => {
      log::trace!("Client->target tunnel closed");
    }
    _ = target_to_client => {
      log::trace!("Target->client tunnel closed");
    }
  }

  // Log final byte counts and update domain stats
  let final_sent =
    client_read_counter.load(Ordering::Relaxed) + target_write_counter.load(Ordering::Relaxed);
  let final_recv =
    target_read_counter.load(Ordering::Relaxed) + client_write_counter.load(Ordering::Relaxed);
  log::trace!("Tunnel closed - sent: {final_sent} bytes, received: {final_recv} bytes");

  // Update domain-specific byte counts now that tunnel is complete
  if let Some(tracker) = get_traffic_tracker() {
    tracker.update_domain_bytes(&domain, final_sent, final_recv);
  }
}

