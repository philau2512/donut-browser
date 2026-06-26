impl ProxyManager {
  fn classify_proxy_error(raw_error: &str, settings: &ProxySettings) -> String {
    let err = raw_error.to_lowercase();
    let proxy_addr = format!("{}:{}", settings.host, settings.port);

    if err.contains("connection refused") {
      return format!(
        "Connection refused by {proxy_addr}. The proxy server is not accepting connections."
      );
    }
    if err.contains("connection reset") {
      return format!(
        "Connection reset by {proxy_addr}. The proxy server closed the connection unexpectedly."
      );
    }
    if err.contains("timed out") || err.contains("deadline has elapsed") {
      return format!("Connection to {proxy_addr} timed out. The proxy server is not responding.");
    }
    if err.contains("no such host") || err.contains("dns") || err.contains("resolve") {
      return format!(
        "Could not resolve proxy host '{}'. Check that the hostname is correct.",
        settings.host
      );
    }
    if err.contains("authentication") || err.contains("407") || err.contains("proxy auth") {
      return format!(
        "Proxy authentication failed for {proxy_addr}. Check your username and password."
      );
    }
    if err.contains("403") || err.contains("forbidden") {
      return format!("Access denied by {proxy_addr} (403 Forbidden).");
    }
    if err.contains("402") {
      return format!(
        "Payment required by {proxy_addr} (402). Your proxy subscription may have expired."
      );
    }
    if err.contains("502") || err.contains("bad gateway") {
      return format!(
        "Bad gateway from {proxy_addr} (502). The upstream proxy server may be down."
      );
    }
    if err.contains("503") || err.contains("service unavailable") {
      return format!("Proxy {proxy_addr} is temporarily unavailable (503).");
    }
    if err.contains("socks") && err.contains("unreachable") {
      return format!("SOCKS proxy {proxy_addr} could not reach the target. The proxy server may not have internet access.");
    }
    if err.contains("invalid proxy") || err.contains("unsupported proxy") {
      return format!(
        "Invalid proxy configuration for {proxy_addr}. Check the proxy type and address."
      );
    }

    // Generic fallback — still show the proxy address for context
    format!("Proxy check failed for {proxy_addr}. Could not connect through the proxy.")
  }

  // Build proxy URL string from ProxySettings
  fn build_proxy_url(proxy_settings: &ProxySettings) -> String {
    let mut url = format!("{}://", proxy_settings.proxy_type);

    let username_opt = proxy_settings.username.as_deref().filter(|u| !u.is_empty());
    let password_opt = proxy_settings.password.as_deref().filter(|p| !p.is_empty());

    if let (Some(username), Some(password)) = (username_opt, password_opt) {
      url.push_str(&urlencoding::encode(username));
      url.push(':');
      url.push_str(&urlencoding::encode(password));
      url.push('@');
    } else if let Some(username) = username_opt {
      url.push_str(&urlencoding::encode(username));
      url.push('@');
    }

    url.push_str(&proxy_settings.host);
    url.push(':');
    url.push_str(&proxy_settings.port.to_string());

    url
  }

  // Check if a proxy is valid by routing through a temporary donut-proxy process.
  // This tests the exact same code path the browser uses.
  // Falls back to direct reqwest check if the proxy worker fails to start.
  pub async fn check_proxy_validity(
    &self,
    proxy_id: &str,
    proxy_settings: &ProxySettings,
  ) -> Result<ProxyCheckResult, String> {
    let upstream_url = Self::build_proxy_url(proxy_settings);

    // Try process-based check first (identical to browser launch path)
    // Try process-based check first (identical to browser launch path).
    // If the proxy worker fails to start (e.g. Gatekeeper, antivirus, signing
    // restrictions), fall back to a direct reqwest check.
    let proxy_start_result =
      crate::proxy::proxy_runner::start_proxy_process(Some(upstream_url.clone()), None)
        .await
        .map_err(|e| e.to_string());

    let ip_result = match proxy_start_result {
      Ok(proxy_config) => {
        let local_url = format!("http://127.0.0.1:{}", proxy_config.local_port.unwrap_or(0));
        let config_id = proxy_config.id.clone();
        // Wrap in a timeout so the check worker doesn't stay alive indefinitely
        // if the upstream is slow or unreachable.
        let result = tokio::time::timeout(
          std::time::Duration::from_secs(30),
          ip_utils::fetch_public_ip(Some(&local_url)),
        )
        .await
        .unwrap_or_else(|_| {
          Err(ip_utils::IpError::Network(
            "Proxy check timed out after 30s".to_string(),
          ))
        });
        // Always stop the worker — even if the check failed or timed out
        let _ = crate::proxy::proxy_runner::stop_proxy_process(&config_id).await;
        result
      }
      Err(err_msg) => {
        log::warn!(
          "Proxy worker failed to start ({}), falling back to direct check",
          err_msg
        );
        ip_utils::fetch_public_ip(Some(&upstream_url)).await
      }
    };

    let ip = match ip_result {
      Ok(ip) => ip,
      Err(e) => {
        let failed_result = ProxyCheckResult {
          ip: String::new(),
          city: None,
          country: None,
          country_code: None,
          timestamp: Self::get_current_timestamp(),
          is_valid: false,
        };
        let _ = self.save_proxy_check_cache(proxy_id, &failed_result);

        let err_str = e.to_string();
        let user_message = Self::classify_proxy_error(&err_str, proxy_settings);
        return Err(user_message);
      }
    };

    // Get geolocation
    let (city, country, country_code): (Option<String>, Option<String>, Option<String>) =
      Self::get_ip_geolocation(&ip).await.unwrap_or_default();

    // Create successful result
    let result = ProxyCheckResult {
      ip: ip.clone(),
      city,
      country,
      country_code,
      timestamp: Self::get_current_timestamp(),
      is_valid: true,
    };

    // Save to cache
    let _ = self.save_proxy_check_cache(proxy_id, &result);

    Ok(result)
  }

  // Get cached proxy check result
  pub fn get_cached_proxy_check(&self, proxy_id: &str) -> Option<ProxyCheckResult> {
    self.load_proxy_check_cache(proxy_id)
  }

  // Export all proxies as JSON
  pub fn export_proxies_json(&self) -> Result<String, String> {
    let stored_proxies = self.stored_proxies.lock().unwrap();
    let proxies: Vec<ExportedProxy> = stored_proxies
      .values()
      .filter(|p| !p.is_cloud_managed && !p.is_cloud_derived)
      .map(|p| ExportedProxy {
        name: p.name.clone(),
        proxy_type: p.proxy_settings.proxy_type.clone(),
        host: p.proxy_settings.host.clone(),
        port: p.proxy_settings.port,
        username: p.proxy_settings.username.clone(),
        password: p.proxy_settings.password.clone(),
      })
      .collect();

    let export_data = ProxyExportData {
      version: "1.0".to_string(),
      proxies,
      exported_at: Utc::now().to_rfc3339(),
      source: "DonutBrowser".to_string(),
    };

    serde_json::to_string_pretty(&export_data).map_err(|e| format!("Failed to serialize: {e}"))
  }

  // Export all proxies as TXT (one per line: protocol://user:pass@host:port)
  pub fn export_proxies_txt(&self) -> String {
    let stored_proxies = self.stored_proxies.lock().unwrap();
    stored_proxies
      .values()
      .filter(|p| !p.is_cloud_managed && !p.is_cloud_derived)
      .map(|p| Self::build_proxy_url(&p.proxy_settings))
      .collect::<Vec<_>>()
      .join("\n")
  }

  // Parse TXT content with auto-detection of formats
  pub fn parse_txt_proxies(content: &str) -> Vec<ProxyParseResult> {
    content
      .lines()
      .filter(|line| !line.trim().is_empty() && !line.trim().starts_with('#'))
      .map(|line| Self::parse_single_proxy_line(line.trim()))
      .collect()
  }

  // Parse a single proxy line with format auto-detection
  fn parse_single_proxy_line(line: &str) -> ProxyParseResult {
    // Format 1: protocol://username:password@host:port (full URL)
    if let Some(result) = Self::try_parse_url_format(line) {
      return result;
    }

    // Try colon-separated formats
    let parts: Vec<&str> = line.split(':').collect();

    match parts.len() {
      // host:port (no auth)
      2 => {
        if let Ok(port) = parts[1].parse::<u16>() {
          return ProxyParseResult::Parsed(ParsedProxyLine {
            proxy_type: "http".to_string(),
            host: parts[0].to_string(),
            port,
            username: None,
            password: None,
            original_line: line.to_string(),
          });
        }
        ProxyParseResult::Invalid {
          line: line.to_string(),
          reason: "Invalid port number".to_string(),
        }
      }
      // Could be: host:port:user or user:pass@host (with @ in the middle)
      3 => {
        // Try username:password@host:port first
        if let Some(result) = Self::try_parse_user_pass_at_host_port(line) {
          return result;
        }
        ProxyParseResult::Invalid {
          line: line.to_string(),
          reason: "Could not determine format with 3 parts".to_string(),
        }
      }
      // 4 parts: could be host:port:user:pass OR user:pass:host:port
      4 => {
        // Try to detect which format
        let port_at_1 = parts[1].parse::<u16>().is_ok();
        let port_at_3 = parts[3].parse::<u16>().is_ok();

        match (port_at_1, port_at_3) {
          // host:port:user:pass
          (true, false) => {
            let port = parts[1].parse::<u16>().unwrap();
            ProxyParseResult::Parsed(ParsedProxyLine {
              proxy_type: "http".to_string(),
              host: parts[0].to_string(),
              port,
              username: Some(parts[2].to_string()),
              password: Some(parts[3].to_string()),
              original_line: line.to_string(),
            })
          }
          // user:pass:host:port
          (false, true) => {
            let port = parts[3].parse::<u16>().unwrap();
            ProxyParseResult::Parsed(ParsedProxyLine {
              proxy_type: "http".to_string(),
              host: parts[2].to_string(),
              port,
              username: Some(parts[0].to_string()),
              password: Some(parts[1].to_string()),
              original_line: line.to_string(),
            })
          }
          // Both could be ports - ambiguous
          (true, true) => ProxyParseResult::Ambiguous {
            line: line.to_string(),
            possible_formats: vec![
              "host:port:username:password".to_string(),
              "username:password:host:port".to_string(),
            ],
          },
          // Neither is a valid port
          (false, false) => ProxyParseResult::Invalid {
            line: line.to_string(),
            reason: "No valid port number found".to_string(),
          },
        }
      }
      _ => ProxyParseResult::Invalid {
        line: line.to_string(),
        reason: format!("Unexpected format with {} parts", parts.len()),
      },
    }
  }

  // Try to parse URL format: protocol://username:password@host:port
  fn try_parse_url_format(line: &str) -> Option<ProxyParseResult> {
    // Check for protocol prefix using strip_prefix
    let (protocol, rest) = if let Some(rest) = line.strip_prefix("http://") {
      ("http", rest)
    } else if let Some(rest) = line.strip_prefix("https://") {
      ("https", rest)
    } else if let Some(rest) = line.strip_prefix("socks4://") {
      ("socks4", rest)
    } else if let Some(rest) = line.strip_prefix("socks5://") {
      ("socks5", rest)
    } else if let Some(rest) = line.strip_prefix("socks://") {
      ("socks5", rest) // Default socks to socks5
    } else if let Some(rest) = line.strip_prefix("ss://") {
      ("ss", rest)
    } else if let Some(rest) = line.strip_prefix("shadowsocks://") {
      ("ss", rest)
    } else {
      return None;
    };

    // Check if there's auth (contains @)
    if let Some(at_pos) = rest.rfind('@') {
      let auth = &rest[..at_pos];
      let host_port = &rest[at_pos + 1..];

      // Parse auth (user:pass)
      let (username, password) = if let Some(colon_pos) = auth.find(':') {
        let user = urlencoding::decode(&auth[..colon_pos]).unwrap_or_default();
        let pass = urlencoding::decode(&auth[colon_pos + 1..]).unwrap_or_default();
        (Some(user.to_string()), Some(pass.to_string()))
      } else {
        (
          Some(urlencoding::decode(auth).unwrap_or_default().to_string()),
          None,
        )
      };

      // Parse host:port
      if let Some(colon_pos) = host_port.rfind(':') {
        let host = &host_port[..colon_pos];
        if let Ok(port) = host_port[colon_pos + 1..].parse::<u16>() {
          return Some(ProxyParseResult::Parsed(ParsedProxyLine {
            proxy_type: protocol.to_string(),
            host: host.to_string(),
            port,
            username,
            password,
            original_line: line.to_string(),
          }));
        }
      }
    } else {
      // No auth, just host:port
      if let Some(colon_pos) = rest.rfind(':') {
        let host = &rest[..colon_pos];
        if let Ok(port) = rest[colon_pos + 1..].parse::<u16>() {
          return Some(ProxyParseResult::Parsed(ParsedProxyLine {
            proxy_type: protocol.to_string(),
            host: host.to_string(),
            port,
            username: None,
            password: None,
            original_line: line.to_string(),
          }));
        }
      }
    }

    Some(ProxyParseResult::Invalid {
      line: line.to_string(),
      reason: "Invalid URL format".to_string(),
    })
  }

  // Try to parse: username:password@host:port format (no protocol)
  fn try_parse_user_pass_at_host_port(line: &str) -> Option<ProxyParseResult> {
    if let Some(at_pos) = line.rfind('@') {
      let auth = &line[..at_pos];
      let host_port = &line[at_pos + 1..];

      // Parse auth
      let (username, password) = if let Some(colon_pos) = auth.find(':') {
        (
          Some(auth[..colon_pos].to_string()),
          Some(auth[colon_pos + 1..].to_string()),
        )
      } else {
        return None;
      };

      // Parse host:port
      if let Some(colon_pos) = host_port.rfind(':') {
        let host = &host_port[..colon_pos];
        if let Ok(port) = host_port[colon_pos + 1..].parse::<u16>() {
          return Some(ProxyParseResult::Parsed(ParsedProxyLine {
            proxy_type: "http".to_string(),
            host: host.to_string(),
            port,
            username,
            password,
            original_line: line.to_string(),
          }));
        }
      }
    }
    None
  }

  // Import proxies from JSON content
  pub fn import_proxies_json(
    &self,
    app_handle: &tauri::AppHandle,
    content: &str,
  ) -> Result<ProxyImportResult, String> {
    let export_data: ProxyExportData =
      serde_json::from_str(content).map_err(|e| format!("Invalid JSON format: {e}"))?;

    let mut imported = Vec::new();
    let mut skipped = 0;
    let mut errors = Vec::new();

    for exported in export_data.proxies {
      let proxy_settings = ProxySettings {
        proxy_type: exported.proxy_type,
        host: exported.host,
        port: exported.port,
        username: exported.username,
        password: exported.password,
      };

      match self.create_stored_proxy(app_handle, exported.name.clone(), proxy_settings) {
        Ok(proxy) => imported.push(proxy),
        Err(e) => {
          if e.contains("already exists") {
            skipped += 1;
          } else {
            errors.push(format!("Failed to import '{}': {}", exported.name, e));
          }
        }
      }
    }

    Ok(ProxyImportResult {
      imported_count: imported.len(),
      skipped_count: skipped,
      errors,
      proxies: imported,
    })
  }

  // Import proxies from already parsed proxy lines
  pub fn import_proxies_from_parsed(
    &self,
    app_handle: &tauri::AppHandle,
    parsed_proxies: Vec<ParsedProxyLine>,
    name_prefix: Option<String>,
  ) -> Result<ProxyImportResult, String> {
    let mut imported = Vec::new();
    let mut skipped = 0;
    let mut errors = Vec::new();
    let prefix = name_prefix.unwrap_or_else(|| "Imported".to_string());

    for (i, parsed) in parsed_proxies.into_iter().enumerate() {
      let proxy_name = format!("{} Proxy {}", prefix, i + 1);
      let proxy_settings = ProxySettings {
        proxy_type: parsed.proxy_type,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
      };

      match self.create_stored_proxy(app_handle, proxy_name.clone(), proxy_settings) {
        Ok(proxy) => imported.push(proxy),
        Err(e) => {
          if e.contains("already exists") {
            skipped += 1;
          } else {
            errors.push(format!("Failed to import '{}': {}", proxy_name, e));
          }
        }
      }
    }

    Ok(ProxyImportResult {
      imported_count: imported.len(),
      skipped_count: skipped,
      errors,
      proxies: imported,
    })
  }

}

include!("connection_lifecycle.rs");
include!("connection_tests.rs");
include!("connection_tests2.rs");
