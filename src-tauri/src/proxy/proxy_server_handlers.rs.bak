async fn handle_http_via_socks4(
  req: Request<hyper::body::Incoming>,
  upstream_url: &str,
) -> Result<Response<Full<Bytes>>, Infallible> {
  // Extract domain for traffic tracking
  let domain = req
    .uri()
    .host()
    .map(|h| h.to_string())
    .unwrap_or_else(|| "unknown".to_string());

  // Parse upstream SOCKS4 proxy URL
  let upstream = match Url::parse(upstream_url) {
    Ok(url) => url,
    Err(e) => {
      log::error!("Failed to parse SOCKS4 proxy URL: {}", e);
      let mut response = Response::new(Full::new(Bytes::from("Invalid proxy URL")));
      *response.status_mut() = StatusCode::BAD_GATEWAY;
      return Ok(response);
    }
  };

  let socks_host = upstream.host_str().unwrap_or("127.0.0.1");
  let socks_port = upstream.port().unwrap_or(1080);
  let socks_addr = format!("{}:{}", socks_host, socks_port);

  // Parse target from request URI
  let target_uri = req.uri();
  let target_host = target_uri.host().unwrap_or("localhost");
  let target_port = target_uri.port_u16().unwrap_or(80);

  // Connect to SOCKS4 proxy
  let mut socks_stream = match TcpStream::connect(&socks_addr).await {
    Ok(stream) => stream,
    Err(e) => {
      log::error!("Failed to connect to SOCKS4 proxy {}: {}", socks_addr, e);
      let mut response = Response::new(Full::new(Bytes::from(format!(
        "Failed to connect to SOCKS4 proxy: {}",
        e
      ))));
      *response.status_mut() = StatusCode::BAD_GATEWAY;
      return Ok(response);
    }
  };

  // Build a SOCKS4a CONNECT request. We deliberately do NOT resolve the target
  // hostname locally: tokio::net::lookup_host would call the HOST resolver
  // (getaddrinfo), leaking the destination domain to the host's DNS server and
  // defeating the per-profile proxy. SOCKS4a has the PROXY resolve the name —
  // send the sentinel IP 0.0.0.x (x != 0), then the NULL-terminated userid, then
  // the NULL-terminated hostname. (Most SOCKS4 proxies support 4a; a legacy
  // SOCKS4-only proxy without remote DNS cannot be used leak-free for plaintext
  // HTTP — prefer SOCKS5 there.)
  let mut socks_request = vec![0x04, 0x01]; // SOCKS4, CONNECT
  socks_request.extend_from_slice(&target_port.to_be_bytes());
  socks_request.extend_from_slice(&[0, 0, 0, 1]); // 0.0.0.1 => SOCKS4a remote-DNS marker
  socks_request.push(0); // empty userid, NULL-terminated
  socks_request.extend_from_slice(target_host.as_bytes()); // hostname for the proxy to resolve
  socks_request.push(0); // NULL-terminated hostname

  // Send SOCKS4 CONNECT request
  if let Err(e) = socks_stream.write_all(&socks_request).await {
    log::error!("Failed to send SOCKS4 CONNECT request: {}", e);
    let mut response = Response::new(Full::new(Bytes::from(format!(
      "Failed to send SOCKS4 request: {}",
      e
    ))));
    *response.status_mut() = StatusCode::BAD_GATEWAY;
    return Ok(response);
  }

  // Read SOCKS4 response
  let mut socks_response = [0u8; 8];
  if let Err(e) = socks_stream.read_exact(&mut socks_response).await {
    log::error!("Failed to read SOCKS4 response: {}", e);
    let mut response = Response::new(Full::new(Bytes::from(format!(
      "Failed to read SOCKS4 response: {}",
      e
    ))));
    *response.status_mut() = StatusCode::BAD_GATEWAY;
    return Ok(response);
  }

  // Check SOCKS4 response (second byte should be 0x5A for success)
  if socks_response[1] != 0x5A {
    log::error!(
      "SOCKS4 connection failed, response code: {}",
      socks_response[1]
    );
    let mut response = Response::new(Full::new(Bytes::from("SOCKS4 connection failed")));
    *response.status_mut() = StatusCode::BAD_GATEWAY;
    return Ok(response);
  }

  // Now send the HTTP request through the SOCKS4 connection
  // Build HTTP request line
  let method = req.method().as_str();
  let path = target_uri
    .path_and_query()
    .map(|pq| pq.as_str())
    .unwrap_or("/");
  let http_version = if req.version() == hyper::Version::HTTP_11 {
    "HTTP/1.1"
  } else {
    "HTTP/1.0"
  };

  let mut http_request = format!("{} {} {}\r\n", method, path, http_version);

  // Add Host header if not present
  let mut has_host = false;
  for (name, value) in req.headers().iter() {
    if name.as_str().eq_ignore_ascii_case("host") {
      has_host = true;
    }
    // Skip proxy-specific headers
    if name.as_str().eq_ignore_ascii_case("proxy-authorization")
      || name.as_str().eq_ignore_ascii_case("proxy-connection")
      || name.as_str().eq_ignore_ascii_case("proxy-authenticate")
    {
      continue;
    }
    // Skip Content-Length and Transfer-Encoding - we'll add our own Content-Length
    // based on the collected body size. Having both violates HTTP/1.1 (RFC 7230).
    if name.as_str().eq_ignore_ascii_case("content-length")
      || name.as_str().eq_ignore_ascii_case("transfer-encoding")
    {
      continue;
    }
    if let Ok(val) = value.to_str() {
      http_request.push_str(&format!("{}: {}\r\n", name.as_str(), val));
    }
  }

  if !has_host {
    http_request.push_str(&format!("Host: {}:{}\r\n", target_host, target_port));
  }

  // Get body
  let body_bytes = match req.collect().await {
    Ok(collected) => collected.to_bytes(),
    Err(_) => Bytes::new(),
  };

  // Add Content-Length if there's a body
  if !body_bytes.is_empty() {
    http_request.push_str(&format!("Content-Length: {}\r\n", body_bytes.len()));
  }

  http_request.push_str("\r\n");

  // Send HTTP request
  if let Err(e) = socks_stream.write_all(http_request.as_bytes()).await {
    log::error!("Failed to send HTTP request through SOCKS4: {}", e);
    let mut response = Response::new(Full::new(Bytes::from(format!(
      "Failed to send HTTP request: {}",
      e
    ))));
    *response.status_mut() = StatusCode::BAD_GATEWAY;
    return Ok(response);
  }

  // Send body if present
  if !body_bytes.is_empty() {
    if let Err(e) = socks_stream.write_all(&body_bytes).await {
      log::error!("Failed to send HTTP body through SOCKS4: {}", e);
      let mut response = Response::new(Full::new(Bytes::from(format!(
        "Failed to send HTTP body: {}",
        e
      ))));
      *response.status_mut() = StatusCode::BAD_GATEWAY;
      return Ok(response);
    }
  }

  // Read HTTP response
  let mut response_buffer = Vec::with_capacity(8192);
  let mut temp_buf = [0u8; 4096];
  let mut content_length: Option<usize> = None;
  let mut is_chunked = false;

  // Read until we have complete headers
  loop {
    match socks_stream.read(&mut temp_buf).await {
      Ok(0) => break, // Connection closed
      Ok(n) => {
        response_buffer.extend_from_slice(&temp_buf[..n]);
        // Check for end of headers (\r\n\r\n)
        if let Some(pos) = response_buffer.windows(4).position(|w| w == b"\r\n\r\n") {
          // Parse headers
          let headers_str = String::from_utf8_lossy(&response_buffer[..pos + 4]);
          for line in headers_str.lines() {
            let line_lower = line.to_lowercase();
            if line_lower.starts_with("content-length:") {
              if let Some(len_str) = line.split(':').nth(1) {
                if let Ok(len) = len_str.trim().parse::<usize>() {
                  content_length = Some(len);
                }
              }
            } else if line_lower.starts_with("transfer-encoding:") && line_lower.contains("chunked")
            {
              is_chunked = true;
            }
          }
          // Read body if Content-Length is specified and we don't have it all
          if let Some(cl) = content_length {
            let body_start = pos + 4;
            let body_received = response_buffer.len() - body_start;
            if body_received < cl {
              // Read remaining body (but don't use read_exact as connection might close)
              let remaining = cl - body_received;
              let mut read_so_far = 0;
              while read_so_far < remaining {
                match socks_stream.read(&mut temp_buf).await {
                  Ok(0) => break, // Connection closed
                  Ok(m) => {
                    let to_read = (remaining - read_so_far).min(m);
                    response_buffer.extend_from_slice(&temp_buf[..to_read]);
                    read_so_far += to_read;
                    if to_read < m {
                      // More data than needed, might be next response - stop here
                      break;
                    }
                  }
                  Err(_) => break,
                }
              }
            }
          } else if !is_chunked {
            // No Content-Length and not chunked - read until connection closes
            // But limit to reasonable size to avoid memory issues
            let max_body_size = 10 * 1024 * 1024; // 10MB max
            while response_buffer.len() < max_body_size {
              match socks_stream.read(&mut temp_buf).await {
                Ok(0) => break, // Connection closed
                Ok(n) => {
                  response_buffer.extend_from_slice(&temp_buf[..n]);
                }
                Err(_) => break,
              }
            }
          }
          // Note: Chunked encoding is complex to parse manually, so we'll read what we can
          // For full chunked support, we'd need a proper HTTP parser
          break;
        }
      }
      Err(e) => {
        log::error!("Error reading HTTP response from SOCKS4: {}", e);
        break;
      }
    }
  }

  // Parse HTTP response
  let response_str = String::from_utf8_lossy(&response_buffer);
  let mut lines = response_str.lines();
  let status_line = lines.next().unwrap_or("HTTP/1.1 500 Internal Server Error");
  let status_parts: Vec<&str> = status_line.split_whitespace().collect();
  let status_code = status_parts
    .get(1)
    .and_then(|s| s.parse::<u16>().ok())
    .unwrap_or(500);

  // Find header/body boundary
  let header_end = response_buffer
    .windows(4)
    .position(|w| w == b"\r\n\r\n")
    .map(|p| p + 4)
    .unwrap_or(response_buffer.len());

  let body = response_buffer[header_end..].to_vec();

  // Record request in traffic tracker
  let response_size = body.len() as u64;
  if let Some(tracker) = get_traffic_tracker() {
    tracker.record_request(&domain, body_bytes.len() as u64, response_size);
  }

  let mut hyper_response = Response::new(Full::new(Bytes::from(body)));
  *hyper_response.status_mut() = StatusCode::from_u16(status_code).unwrap();

  Ok(hyper_response)
}

/// Handle plain HTTP requests through a Shadowsocks upstream.
/// reqwest doesn't support SS natively, so we connect through the SS tunnel
/// manually and forward the HTTP request/response.
async fn handle_http_via_shadowsocks(
  req: Request<hyper::body::Incoming>,
  upstream: &Url,
) -> Result<Response<Full<Bytes>>, Infallible> {
  let domain = req
    .uri()
    .host()
    .map(|h| h.to_string())
    .unwrap_or_else(|| "unknown".to_string());
  let port = req.uri().port_u16().unwrap_or(80);

  let ss_host = upstream.host_str().unwrap_or("127.0.0.1");
  let ss_port = upstream.port().unwrap_or(8388);
  let method_str = urlencoding::decode(upstream.username())
    .unwrap_or_default()
    .to_string();
  let password = urlencoding::decode(upstream.password().unwrap_or(""))
    .unwrap_or_default()
    .to_string();

  let cipher = match method_str.parse::<shadowsocks::crypto::CipherKind>() {
    Ok(c) => c,
    Err(_) => {
      let mut resp = Response::new(Full::new(Bytes::from(format!(
        "Bad SS cipher: {method_str}"
      ))));
      *resp.status_mut() = StatusCode::BAD_GATEWAY;
      return Ok(resp);
    }
  };

  let context = shadowsocks::context::Context::new_shared(shadowsocks::config::ServerType::Local);
  let svr_cfg = match shadowsocks::config::ServerConfig::new(
    shadowsocks::config::ServerAddr::from((ss_host.to_string(), ss_port)),
    &password,
    cipher,
  ) {
    Ok(c) => c,
    Err(e) => {
      let mut resp = Response::new(Full::new(Bytes::from(format!("SS config error: {e}"))));
      *resp.status_mut() = StatusCode::BAD_GATEWAY;
      return Ok(resp);
    }
  };

  let target_addr = shadowsocks::relay::Address::DomainNameAddress(domain.clone(), port);

  let mut stream = match shadowsocks::relay::tcprelay::proxy_stream::ProxyClientStream::connect(
    context,
    &svr_cfg,
    target_addr,
  )
  .await
  {
    Ok(s) => s,
    Err(e) => {
      let mut resp = Response::new(Full::new(Bytes::from(format!("SS connect: {e}"))));
      *resp.status_mut() = StatusCode::BAD_GATEWAY;
      return Ok(resp);
    }
  };

  // Build and send the HTTP request through the SS tunnel
  let path = req
    .uri()
    .path_and_query()
    .map(|pq| pq.as_str())
    .unwrap_or("/");
  let method = req.method().as_str();
  let mut raw_req = format!("{method} {path} HTTP/1.1\r\nHost: {domain}\r\nConnection: close\r\n");
  for (name, value) in req.headers() {
    if name != "host" && name != "connection" {
      raw_req.push_str(&format!("{}: {}\r\n", name, value.to_str().unwrap_or("")));
    }
  }
  raw_req.push_str("\r\n");

  use tokio::io::{AsyncReadExt, AsyncWriteExt};
  if let Err(e) = stream.write_all(raw_req.as_bytes()).await {
    let mut resp = Response::new(Full::new(Bytes::from(format!("SS write: {e}"))));
    *resp.status_mut() = StatusCode::BAD_GATEWAY;
    return Ok(resp);
  }

  let mut response_buf = Vec::new();
  if let Err(e) = stream.read_to_end(&mut response_buf).await {
    log::warn!("SS read error (may be partial): {e}");
  }

  if let Some(tracker) = get_traffic_tracker() {
    tracker.record_request(&domain, raw_req.len() as u64, response_buf.len() as u64);
  }

  // Parse the raw HTTP response
  let response_str = String::from_utf8_lossy(&response_buf);
  let header_end = response_str.find("\r\n\r\n").unwrap_or(response_str.len());
  let status_line = response_str
    .lines()
    .next()
    .unwrap_or("HTTP/1.1 502 Bad Gateway");
  let status_code: u16 = status_line
    .split_whitespace()
    .nth(1)
    .and_then(|s| s.parse().ok())
    .unwrap_or(502);
  let body = if header_end + 4 < response_buf.len() {
    &response_buf[header_end + 4..]
  } else {
    b""
  };

  let mut hyper_response = Response::new(Full::new(Bytes::from(body.to_vec())));
  *hyper_response.status_mut() =
    StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY);

  Ok(hyper_response)
}

async fn handle_http(
  req: Request<hyper::body::Incoming>,
  upstream_url: Option<String>,
  bypass_matcher: BypassMatcher,
  blocklist_matcher: BlocklistMatcher,
) -> Result<Response<Full<Bytes>>, Infallible> {
  // Extract domain for traffic tracking
  let domain = req
    .uri()
    .host()
    .map(|h| h.to_string())
    .unwrap_or_else(|| "unknown".to_string());

  // Block if domain is in the DNS blocklist (before any connection)
  if blocklist_matcher.is_blocked(&domain) {
    log::debug!("[blocklist] Blocked HTTP request to {}", domain);
    let mut response = Response::new(Full::new(Bytes::from("Blocked by DNS blocklist")));
    *response.status_mut() = StatusCode::FORBIDDEN;
    return Ok(response);
  }

  log::trace!(
    "Handling HTTP request: {} {} (host: {:?})",
    req.method(),
    req.uri(),
    req.uri().host()
  );

  let should_bypass = bypass_matcher.should_bypass(&domain);

  // Handle proxy types that reqwest doesn't support natively
  if !should_bypass {
    if let Some(ref upstream) = upstream_url {
      if upstream != "DIRECT" {
        if let Ok(url) = Url::parse(upstream) {
          match url.scheme() {
            "socks4" => {
              return handle_http_via_socks4(req, upstream).await;
            }
            "ss" | "shadowsocks" => {
              return handle_http_via_shadowsocks(req, &url).await;
            }
            _ => {}
          }
        }
      }
    }
  }

  // Use reqwest for HTTP/HTTPS/SOCKS5 proxies
  use reqwest::Client;

  let client_builder = Client::builder();
  let client = if should_bypass {
    client_builder.build().unwrap_or_default()
  } else if let Some(ref upstream) = upstream_url {
    if upstream == "DIRECT" {
      client_builder.build().unwrap_or_default()
    } else {
      // Build reqwest client with proxy
      match build_reqwest_client_with_proxy(upstream) {
        Ok(c) => c,
        Err(e) => {
          log::error!("Failed to create proxy client: {}", e);
          let mut response = Response::new(Full::new(Bytes::from(format!(
            "Proxy configuration error: {}",
            e
          ))));
          *response.status_mut() = StatusCode::BAD_GATEWAY;
          return Ok(response);
        }
      }
    }
  } else {
    client_builder.build().unwrap_or_default()
  };

  // Convert hyper request to reqwest request
  let uri = req.uri().to_string();
  let method = req.method().clone();
  let headers = req.headers().clone();

  let mut request_builder = match method.as_str() {
    "GET" => client.get(&uri),
    "POST" => client.post(&uri),
    "PUT" => client.put(&uri),
    "DELETE" => client.delete(&uri),
    "PATCH" => client.patch(&uri),
    "HEAD" => client.head(&uri),
    _ => {
      let mut response = Response::new(Full::new(Bytes::from("Unsupported method")));
      *response.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
      return Ok(response);
    }
  };

  // Copy headers, but skip proxy-specific headers that shouldn't be forwarded
  for (name, value) in headers.iter() {
    // Skip proxy-specific headers - these are for the local proxy, not the upstream
    if name.as_str().eq_ignore_ascii_case("proxy-authorization")
      || name.as_str().eq_ignore_ascii_case("proxy-connection")
      || name.as_str().eq_ignore_ascii_case("proxy-authenticate")
    {
      continue;
    }
    if let Ok(val) = value.to_str() {
      request_builder = request_builder.header(name.as_str(), val);
    }
  }

  // Get body
  let body_bytes = match req.collect().await {
    Ok(collected) => collected.to_bytes(),
    Err(_) => Bytes::new(),
  };

  if !body_bytes.is_empty() {
    request_builder = request_builder.body(body_bytes.to_vec());
  }

  // Execute request
  match request_builder.send().await {
    Ok(response) => {
      let status = response.status();
      let headers = response.headers().clone();
      let body = response.bytes().await.unwrap_or_default();

      // Record request in traffic tracker
      let response_size = body.len() as u64;
      if let Some(tracker) = get_traffic_tracker() {
        tracker.record_request(&domain, body_bytes.len() as u64, response_size);
      }

      let mut hyper_response = Response::new(Full::new(body));
      *hyper_response.status_mut() = StatusCode::from_u16(status.as_u16()).unwrap();

      // Copy response headers
      for (name, value) in headers.iter() {
        if let Ok(val) = value.to_str() {
          hyper_response
            .headers_mut()
            .insert(name, val.parse().unwrap());
        }
      }

      Ok(hyper_response)
    }
    Err(e) => {
      log::error!("Request failed: {}", e);
      let mut response = Response::new(Full::new(Bytes::from(format!("Request failed: {}", e))));
      *response.status_mut() = StatusCode::BAD_GATEWAY;
      Ok(response)
    }
  }
}

fn build_reqwest_client_with_proxy(
  upstream_url: &str,
) -> Result<reqwest::Client, Box<dyn std::error::Error>> {
  use reqwest::Proxy;

  let client_builder = reqwest::Client::builder();

  // Parse the upstream URL
  let url = Url::parse(upstream_url)?;
  let scheme = url.scheme();

  let proxy = match scheme {
    "http" | "https" => {
      // For HTTP/HTTPS proxies, reqwest handles them directly
      // Note: HTTPS proxy URLs still use HTTP CONNECT method, reqwest handles TLS automatically
      Proxy::http(upstream_url)?
    }
    "socks5" => {
      // Donut: force REMOTE (proxy-side) DNS for plaintext HTTP over a SOCKS5
      // upstream. reqwest maps the bare `socks5` scheme to DnsResolve::Local,
      // which resolves the destination hostname on the HOST (getaddrinfo) BEFORE
      // connecting — leaking the destination domain to the host's DNS resolver
      // and defeating the per-profile proxy. The `socks5h` scheme maps to
      // DnsResolve::Proxy, so the proxy resolves the hostname and nothing leaks.
      // (The CONNECT/HTTPS path already does remote DNS via connect_via_socks's
      // AddrKind::Domain.)
      let remote_dns_url = match upstream_url.strip_prefix("socks5://") {
        Some(rest) => format!("socks5h://{rest}"),
        None => upstream_url.to_string(),
      };
      Proxy::all(remote_dns_url)?
    }
    "socks4" => {
      // SOCKS4 is handled manually in handle_http_via_socks4
      // This should not be reached, but return error as fallback
      return Err("SOCKS4 should be handled manually".into());
    }
    _ => {
      return Err(format!("Unsupported proxy scheme: {}", scheme).into());
    }
  };

  Ok(client_builder.proxy(proxy).build()?)
}

/// Handle a single proxy connection (used by both the proxy worker and in-process proxy checks).
pub async fn handle_proxy_connection(
  mut stream: tokio::net::TcpStream,
  upstream_url: Option<String>,
  bypass_matcher: BypassMatcher,
  blocklist_matcher: BlocklistMatcher,
) {
  let _ = stream.set_nodelay(true);

  if stream.readable().await.is_err() {
    return;
  }

  let mut peek_buffer = [0u8; 16];
  match stream.read(&mut peek_buffer).await {
    Ok(0) => {}
    Ok(n) => {
      let request_start_upper = String::from_utf8_lossy(&peek_buffer[..n.min(7)]).to_uppercase();
      let is_connect = request_start_upper.starts_with("CONNECT");

      if is_connect {
        let mut full_request = Vec::with_capacity(4096);
        full_request.extend_from_slice(&peek_buffer[..n]);

        let mut remaining = [0u8; 4096];
        let mut total_read = n;
        let max_reads = 100;
        let mut reads = 0;

        loop {
          if reads >= max_reads {
            break;
          }
          match stream.read(&mut remaining).await {
            Ok(0) => {
              if full_request.ends_with(b"\r\n\r\n")
                || full_request.ends_with(b"\n\n")
                || total_read > 0
              {
                break;
              }
              return;
            }
            Ok(m) => {
              reads += 1;
              total_read += m;
              full_request.extend_from_slice(&remaining[..m]);
              if full_request.ends_with(b"\r\n\r\n") || full_request.ends_with(b"\n\n") {
                break;
              }
            }
            Err(_) => {
              if total_read > 0 {
                break;
              }
              return;
            }
          }
        }

        if let Err(e) = handle_connect_from_buffer(
          stream,
          full_request,
          upstream_url,
          bypass_matcher,
          blocklist_matcher,
        )
        .await
        {
          let msg = e.to_string();
          if let Some(suppressed) = log_throttle(&msg) {
            if suppressed > 0 {
              log::warn!(
                "CONNECT tunnel ended with error: {msg} ({suppressed} more suppressed in last 30s)"
              );
            } else {
              log::warn!("CONNECT tunnel ended with error: {msg}");
            }
          }
        }
        return;
      }

      // Non-CONNECT: prepend consumed bytes and pass to hyper
      let prepended_bytes = peek_buffer[..n].to_vec();
      let prepended_reader = PrependReader {
        prepended: prepended_bytes,
        prepended_pos: 0,
        inner: stream,
      };
      let io = TokioIo::new(prepended_reader);
      let service = service_fn(move |req| {
        handle_request(
          req,
          upstream_url.clone(),
          bypass_matcher.clone(),
          blocklist_matcher.clone(),
        )
      });

      let _ = http1::Builder::new().serve_connection(io, service).await;
    }
    Err(_) => {}
  }
}

