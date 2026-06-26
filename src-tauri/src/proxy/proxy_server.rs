use crate::proxy::proxy_storage::ProxyConfig;
use crate::proxy::traffic_stats::{get_traffic_tracker, init_traffic_tracker};
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use regex_lite::Regex;
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;

/// Combined read+write trait for tunnel target streams, allowing
/// `handle_connect_from_buffer` to handle plain TCP, SOCKS, and
/// Shadowsocks through the same bidirectional-copy path.
pub(crate) trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncStream for T {}
pub(crate) type BoxedAsyncStream = Box<dyn AsyncStream>;
use url::Url;

enum CompiledRule {
  Regex(Regex),
  Exact(String),
}

#[derive(Clone)]
pub struct BypassMatcher {
  rules: Arc<Vec<CompiledRule>>,
}

impl BypassMatcher {
  pub fn new(rules: &[String]) -> Self {
    let compiled = rules
      .iter()
      .map(|rule| match Regex::new(rule) {
        Ok(re) => CompiledRule::Regex(re),
        Err(_) => CompiledRule::Exact(rule.clone()),
      })
      .collect();
    Self {
      rules: Arc::new(compiled),
    }
  }

  pub fn should_bypass(&self, host: &str) -> bool {
    self.rules.iter().any(|rule| match rule {
      CompiledRule::Regex(re) => re.is_match(host),
      CompiledRule::Exact(exact) => host == exact,
    })
  }
}

#[derive(Clone)]
pub struct BlocklistMatcher {
  domains: Arc<HashSet<String>>,
}

impl Default for BlocklistMatcher {
  fn default() -> Self {
    Self::new()
  }
}

impl BlocklistMatcher {
  pub fn new() -> Self {
    Self {
      domains: Arc::new(HashSet::new()),
    }
  }

  pub fn from_file(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
    let content = std::fs::read_to_string(path)?;
    let domains: HashSet<String> = content
      .lines()
      .filter(|line| !line.starts_with('#') && !line.trim().is_empty())
      .map(|line| line.trim().to_lowercase())
      .collect();
    log::info!("[blocklist] Loaded {} domains from {}", domains.len(), path);
    Ok(Self {
      domains: Arc::new(domains),
    })
  }

  pub fn is_blocked(&self, host: &str) -> bool {
    if self.domains.is_empty() {
      return false;
    }
    let host_lower = host.to_lowercase();
    // Exact match
    if self.domains.contains(host_lower.as_str()) {
      return true;
    }
    // Suffix matching: check parent domains (like uBlock)
    let mut start = 0;
    while let Some(dot_pos) = host_lower[start..].find('.') {
      start += dot_pos + 1;
      if self.domains.contains(&host_lower[start..]) {
        return true;
      }
    }
    false
  }
}

/// Wrapper stream that counts bytes read and written
struct CountingStream<S> {
  inner: S,
  bytes_read: Arc<AtomicU64>,
  bytes_written: Arc<AtomicU64>,
}

impl<S> CountingStream<S> {
  fn new(inner: S) -> Self {
    Self {
      inner,
      bytes_read: Arc::new(AtomicU64::new(0)),
      bytes_written: Arc::new(AtomicU64::new(0)),
    }
  }
}

impl<S: AsyncRead + Unpin> AsyncRead for CountingStream<S> {
  fn poll_read(
    mut self: Pin<&mut Self>,
    cx: &mut Context<'_>,
    buf: &mut ReadBuf<'_>,
  ) -> Poll<io::Result<()>> {
    let filled_before = buf.filled().len();
    let result = Pin::new(&mut self.inner).poll_read(cx, buf);
    if let Poll::Ready(Ok(())) = &result {
      let bytes_read = buf.filled().len() - filled_before;
      if bytes_read > 0 {
        self
          .bytes_read
          .fetch_add(bytes_read as u64, Ordering::Relaxed);
        // Update global tracker - count as received (data coming into proxy)
        if let Some(tracker) = get_traffic_tracker() {
          tracker.add_bytes_received(bytes_read as u64);
        }
      }
    }
    result
  }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for CountingStream<S> {
  fn poll_write(
    mut self: Pin<&mut Self>,
    cx: &mut Context<'_>,
    buf: &[u8],
  ) -> Poll<io::Result<usize>> {
    let result = Pin::new(&mut self.inner).poll_write(cx, buf);
    if let Poll::Ready(Ok(n)) = &result {
      self.bytes_written.fetch_add(*n as u64, Ordering::Relaxed);
      // Update global tracker - count as sent (data going out of proxy)
      if let Some(tracker) = get_traffic_tracker() {
        tracker.add_bytes_sent(*n as u64);
      }
    }
    result
  }

  fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
    Pin::new(&mut self.inner).poll_flush(cx)
  }

  fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
    Pin::new(&mut self.inner).poll_shutdown(cx)
  }
}

// Wrapper to prepend consumed bytes to a stream
struct PrependReader {
  prepended: Vec<u8>,
  prepended_pos: usize,
  inner: TcpStream,
}

impl AsyncRead for PrependReader {
  fn poll_read(
    mut self: Pin<&mut Self>,
    cx: &mut Context<'_>,
    buf: &mut ReadBuf<'_>,
  ) -> Poll<io::Result<()>> {
    // First, read from prepended bytes if any
    if self.prepended_pos < self.prepended.len() {
      let available = self.prepended.len() - self.prepended_pos;
      let to_copy = available.min(buf.remaining());
      buf.put_slice(&self.prepended[self.prepended_pos..self.prepended_pos + to_copy]);
      self.prepended_pos += to_copy;
      return Poll::Ready(Ok(()));
    }

    // Then read from inner stream
    Pin::new(&mut self.inner).poll_read(cx, buf)
  }
}

impl AsyncWrite for PrependReader {
  fn poll_write(
    mut self: Pin<&mut Self>,
    cx: &mut Context<'_>,
    buf: &[u8],
  ) -> Poll<io::Result<usize>> {
    Pin::new(&mut self.inner).poll_write(cx, buf)
  }

  fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
    Pin::new(&mut self.inner).poll_flush(cx)
  }

  fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
    Pin::new(&mut self.inner).poll_shutdown(cx)
  }
}

async fn handle_request(
  req: Request<hyper::body::Incoming>,
  upstream_url: Option<String>,
  bypass_matcher: BypassMatcher,
  blocklist_matcher: BlocklistMatcher,
) -> Result<Response<Full<Bytes>>, Infallible> {
  // Handle CONNECT method for HTTPS tunneling
  if req.method() == Method::CONNECT {
    return handle_connect(req, upstream_url, bypass_matcher, blocklist_matcher).await;
  }

  // Handle regular HTTP requests
  handle_http(req, upstream_url, bypass_matcher, blocklist_matcher).await
}

async fn handle_connect(
  req: Request<hyper::body::Incoming>,
  upstream_url: Option<String>,
  bypass_matcher: BypassMatcher,
  blocklist_matcher: BlocklistMatcher,
) -> Result<Response<Full<Bytes>>, Infallible> {
  let authority = req.uri().authority().cloned();

  if let Some(authority) = authority {
    let target_addr = format!("{}", authority);

    // Parse target host and port
    let (target_host, target_port) = if let Some(colon_pos) = target_addr.find(':') {
      let host = &target_addr[..colon_pos];
      let port: u16 = target_addr[colon_pos + 1..].parse().unwrap_or(443);
      (host, port)
    } else {
      (&target_addr[..], 443)
    };

    // Block if domain is in the DNS blocklist (before any connection)
    if blocklist_matcher.is_blocked(target_host) {
      log::debug!("[blocklist] Blocked CONNECT to {}", target_host);
      let mut response = Response::new(Full::new(Bytes::from("Blocked by DNS blocklist")));
      *response.status_mut() = StatusCode::FORBIDDEN;
      return Ok(response);
    }

    // If no upstream proxy, or bypass rule matches, connect directly
    if upstream_url.is_none()
      || upstream_url
        .as_ref()
        .map(|s| s == "DIRECT")
        .unwrap_or(false)
      || bypass_matcher.should_bypass(target_host)
    {
      match TcpStream::connect(&target_addr).await {
        Ok(_stream) => {
          let mut response = Response::new(Full::new(Bytes::from("")));
          *response.status_mut() = StatusCode::from_u16(200).unwrap();
          return Ok(response);
        }
        Err(e) => {
          log::error!("Failed to connect to {}: {}", target_addr, e);
          let mut response =
            Response::new(Full::new(Bytes::from(format!("Connection failed: {}", e))));
          *response.status_mut() = StatusCode::BAD_GATEWAY;
          return Ok(response);
        }
      }
    }

    // Connect through upstream proxy
    let upstream = match upstream_url.as_ref().and_then(|u| Url::parse(u).ok()) {
      Some(url) => url,
      None => {
        let mut response = Response::new(Full::new(Bytes::from("Invalid upstream URL")));
        *response.status_mut() = StatusCode::BAD_GATEWAY;
        return Ok(response);
      }
    };

    let scheme = upstream.scheme();
    match scheme {
      "http" | "https" => {
        // Use manual CONNECT for HTTP/HTTPS proxies
        match connect_via_http_proxy(&upstream, target_host, target_port).await {
          Ok(_) => {
            let mut response = Response::new(Full::new(Bytes::from("")));
            *response.status_mut() = StatusCode::from_u16(200).unwrap();
            Ok(response)
          }
          Err(e) => {
            log::error!("HTTP proxy CONNECT failed: {}", e);
            let mut response = Response::new(Full::new(Bytes::from(format!(
              "Proxy connection failed: {}",
              e
            ))));
            *response.status_mut() = StatusCode::BAD_GATEWAY;
            Ok(response)
          }
        }
      }
      "socks4" | "socks5" => {
        // Use async-socks5 for SOCKS proxies
        let host = upstream.host_str().unwrap_or("127.0.0.1");
        let port = upstream.port().unwrap_or(1080);
        let socks_addr = format!("{}:{}", host, port);

        let (username, password) = upstream_userpass(&upstream);
        let auth = (!username.is_empty()).then_some((username.as_str(), password.as_str()));

        match connect_via_socks(
          &socks_addr,
          target_host,
          target_port,
          scheme == "socks5",
          auth,
        )
        .await
        {
          Ok(_stream) => {
            let mut response = Response::new(Full::new(Bytes::from("")));
            *response.status_mut() = StatusCode::from_u16(200).unwrap();
            Ok(response)
          }
          Err(e) => {
            log::error!("SOCKS connection failed: {}", e);
            let mut response = Response::new(Full::new(Bytes::from(format!(
              "SOCKS connection failed: {}",
              e
            ))));
            *response.status_mut() = StatusCode::BAD_GATEWAY;
            Ok(response)
          }
        }
      }
      _ => {
        let mut response = Response::new(Full::new(Bytes::from("Unsupported upstream scheme")));
        *response.status_mut() = StatusCode::BAD_GATEWAY;
        Ok(response)
      }
    }
  } else {
    let mut response = Response::new(Full::new(Bytes::from("Bad Request")));
    *response.status_mut() = StatusCode::BAD_REQUEST;
    Ok(response)
  }
}

async fn connect_via_http_proxy(
  upstream: &Url,
  target_host: &str,
  target_port: u16,
) -> Result<TcpStream, Box<dyn std::error::Error>> {
  let proxy_host = upstream.host_str().unwrap_or("127.0.0.1");
  let proxy_port = upstream.port().unwrap_or(8080);
  let mut stream = tokio::time::timeout(
    UPSTREAM_DIAL_TIMEOUT,
    TcpStream::connect((proxy_host, proxy_port)),
  )
  .await
  .map_err(|_| format!("upstream proxy connect to {proxy_host}:{proxy_port} timed out"))??;

  // Add proxy authentication if provided
  let mut connect_req = format!(
    "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
    target_host, target_port, target_host, target_port
  );

  let (username, password) = upstream_userpass(upstream);
  if !username.is_empty() {
    use base64::{engine::general_purpose, Engine as _};
    let auth = general_purpose::STANDARD.encode(format!("{}:{}", username, password));
    connect_req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", auth));
  }

  connect_req.push_str("\r\n");

  stream.write_all(connect_req.as_bytes()).await?;

  let mut buffer = [0u8; 4096];
  let n = tokio::time::timeout(UPSTREAM_DIAL_TIMEOUT, stream.read(&mut buffer))
    .await
    .map_err(|_| "upstream proxy CONNECT response timed out")??;
  let response = String::from_utf8_lossy(&buffer[..n]);

  if response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200") {
    Ok(stream)
  } else {
    Err(format!("Upstream proxy CONNECT failed: {}", response).into())
  }
}

/// Extract percent-decoded (username, password) from the upstream URL.
///
/// `url::Url::username()` / `Url::password()` return percent-encoded ASCII
/// strings per the WHATWG spec. `build_proxy_url` on the producer side
/// already percent-encodes the credentials with `urlencoding::encode`, so
/// we must decode here — otherwise the upstream SOCKS5 / HTTP CONNECT
/// receives `%40` instead of `@`, breaking RFC1929 user/password
/// authentication or HTTP Basic-Auth
fn upstream_userpass(upstream: &Url) -> (String, String) {
  let username = urlencoding::decode(upstream.username())
    .map(|cow| cow.into_owned())
    .unwrap_or_default();
  let password = urlencoding::decode(upstream.password().unwrap_or(""))
    .map(|cow| cow.into_owned())
    .unwrap_or_default();
  (username, password)
}

/// Transparent AsyncRead/AsyncWrite wrapper that logs every read/write
/// byte of the SOCKS5 handshake. Used only during the handshake — the
/// inner stream is taken back via `into_inner` once the handshake
/// completes, so the tunnel phase pays no overhead
struct SocksHandshakeLogger<S> {
  inner: S,
  label: String,
}

impl<S> SocksHandshakeLogger<S> {
  fn new(inner: S, label: String) -> Self {
    Self { inner, label }
  }

  fn into_inner(self) -> S {
    self.inner
  }
}

impl<S: AsyncRead + Unpin> AsyncRead for SocksHandshakeLogger<S> {
  fn poll_read(
    mut self: Pin<&mut Self>,
    cx: &mut Context<'_>,
    buf: &mut ReadBuf<'_>,
  ) -> Poll<io::Result<()>> {
    let before = buf.filled().len();
    let result = Pin::new(&mut self.inner).poll_read(cx, buf);
    if let Poll::Ready(Ok(())) = &result {
      let after = buf.filled().len();
      if after > before {
        let bytes = &buf.filled()[before..after];
        log::trace!(
          "[socks-handshake:{}] <- {} byte(s): {:02x?}",
          self.label,
          bytes.len(),
          bytes
        );
      } else {
        log::trace!("[socks-handshake:{}] <- EOF (peer closed)", self.label);
      }
    }
    result
  }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for SocksHandshakeLogger<S> {
  fn poll_write(
    mut self: Pin<&mut Self>,
    cx: &mut Context<'_>,
    buf: &[u8],
  ) -> Poll<io::Result<usize>> {
    let result = Pin::new(&mut self.inner).poll_write(cx, buf);
    if let Poll::Ready(Ok(n)) = &result {
      log::trace!(
        "[socks-handshake:{}] -> {} byte(s): {:02x?}",
        self.label,
        n,
        &buf[..*n]
      );
    }
    result
  }

  fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
    Pin::new(&mut self.inner).poll_flush(cx)
  }

  fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
    Pin::new(&mut self.inner).poll_shutdown(cx)
  }
}

async fn connect_via_socks(
  socks_addr: &str,
  target_host: &str,
  target_port: u16,
  is_socks5: bool,
  auth: Option<(&str, &str)>,
) -> Result<TcpStream, Box<dyn std::error::Error>> {
  let stream = tokio::time::timeout(UPSTREAM_DIAL_TIMEOUT, TcpStream::connect(socks_addr))
    .await
    .map_err(|_| format!("SOCKS upstream connect to {socks_addr} timed out"))??;

  if is_socks5 {
    // SOCKS5 connection using async_socks5
    use async_socks5::{connect, AddrKind, Auth};

    let target = if let Ok(ip) = target_host.parse::<std::net::IpAddr>() {
      AddrKind::Ip(std::net::SocketAddr::new(ip, target_port))
    } else {
      AddrKind::Domain(target_host.to_string(), target_port)
    };

    let auth_info: Option<Auth> = auth.map(|(user, pass)| Auth {
      username: user.to_string(),
      password: pass.to_string(),
    });

    let has_auth = auth_info.is_some();
    log::trace!(
      "[socks-handshake] dialing {} (target={}:{}, has_auth={})",
      socks_addr,
      target_host,
      target_port,
      has_auth
    );

    // Disable Nagle so the kernel doesn't further delay/coalesce the
    // syscalls issued when BufStream flushes
    let _ = stream.set_nodelay(true);

    // BufStream wrapping is required: async_socks5 calls write_u8 for every
    // single-byte SOCKS5 / RFC1929 field, and on a raw TcpStream each call
    // becomes its own TCP segment. Some upstream SOCKS5 implementations
    // treat such a "fragmented auth submission" as a misbehaving client
    // and silently FIN instead of returning an RFC1929 status. BufStream
    // coalesces those small writes into one syscall on flush — this is
    // the usage pattern shown in the async_socks5 README
    let label = format!("{socks_addr}->{target_host}:{target_port}");
    let logged = SocksHandshakeLogger::new(stream, label);
    let mut buffered = tokio::io::BufStream::new(logged);
    let handshake = tokio::time::timeout(
      UPSTREAM_DIAL_TIMEOUT,
      connect(&mut buffered, target, auth_info),
    )
    .await;
    // Unwrap the layered stream: BufStream → SocksHandshakeLogger → TcpStream
    let stream = buffered.into_inner().into_inner();
    match handshake {
      Ok(Ok(_)) => {
        log::trace!("[socks-handshake] handshake completed ok");
        Ok(stream)
      }
      Ok(Err(e)) => {
        log::trace!("[socks-handshake] handshake failed: {:?}", e);
        Err(e.into())
      }
      Err(_) => {
        log::trace!("[socks-handshake] handshake timed out");
        Err("SOCKS5 upstream handshake timed out".into())
      }
    }
  } else {
    let mut stream = stream;
    // SOCKS4 - simplified implementation
    let ip: std::net::IpAddr = target_host.parse()?;

    let mut request = vec![0x04, 0x01]; // SOCKS4, CONNECT
    request.extend_from_slice(&target_port.to_be_bytes());
    match ip {
      std::net::IpAddr::V4(ipv4) => {
        request.extend_from_slice(&ipv4.octets());
      }
      std::net::IpAddr::V6(_) => {
        return Err("SOCKS4 does not support IPv6".into());
      }
    }
    request.push(0); // NULL terminator for userid

    stream.write_all(&request).await?;

    let mut response = [0u8; 8];
    stream.read_exact(&mut response).await?;

    if response[1] != 0x5A {
      return Err("SOCKS4 connection failed".into());
    }

    Ok(stream)
  }
}

include!("proxy_server_handlers.rs");
include!("proxy_server_run.rs");
include!("proxy_server_inline_tests.rs");
