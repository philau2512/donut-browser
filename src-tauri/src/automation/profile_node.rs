// ═══════════════════════════════════════════════════════════════════════════════
// profile_node.rs
// ═══════════════════════════════════════════════════════════════════════════════
//
// Profile Flow Node execution logic for openProfile and closeProfile nodes.
// Handles dynamic proxy fetching, IP validation, webhooks, Telegram alerts,
// and profile cleanup operations.
//
// ═══════════════════════════════════════════════════════════════════════════════

use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

use crate::browser::browser_runner::BrowserRunner;
use crate::commands::automation_profile::{
  AutomationConfig, IpCheckConfig, OpenProfileResult, TelegramConfig, WebhookConfig,
};
use crate::profile::BrowserProfile;

fn find_profile_for_close(profile_id: &str) -> Result<BrowserProfile, String> {
  let pm = BrowserRunner::instance().profile_manager;
  let profiles = pm
    .list_profiles()
    .map_err(|e| format!("Failed to list profiles: {e}"))?;
  profiles
    .into_iter()
    .find(|p| p.id.to_string() == profile_id)
    .ok_or_else(|| format!("Profile not found: {profile_id}"))
}

/// Proxy/IP/webhooks only — browser already launched by the flow orchestrator (same profile + CDP).
pub async fn execute_open_profile_automation_only(
  profile_id: String,
  automation: Option<AutomationConfig>,
  cdp_port: u16,
) -> Result<OpenProfileResult, String> {
  let (proxy_ip, ip_country) =
    run_proxy_and_ip_checks(profile_id.as_str(), automation.as_ref()).await?;
  run_post_open_side_effects(
    profile_id.as_str(),
    automation.as_ref(),
    &proxy_ip,
    &ip_country,
  )
  .await;
  Ok(OpenProfileResult {
    cdp_port,
    browser_pid: 0,
    proxy_ip,
    ip_country,
  })
}

fn parse_proxy_override(
  proxy_string: &str,
  proxy_type: Option<&str>,
  proxy_login: Option<&str>,
  proxy_password: Option<&str>,
) -> Result<crate::browser::ProxySettings, String> {
  let mut p_type = proxy_type.unwrap_or("http").to_lowercase();
  let mut host = String::new();
  let mut port = 80;
  let mut user = proxy_login.map(|s| s.to_string());
  let mut pass = proxy_password.map(|s| s.to_string());

  let cleaned = proxy_string.trim();
  if cleaned.is_empty() {
    return Err("Proxy string cannot be empty".to_string());
  }

  if cleaned.contains("://") {
    if let Ok(url) = url::Url::parse(cleaned) {
      p_type = url.scheme().to_string();
      host = url.host_str().unwrap_or("").to_string();
      port = url.port().unwrap_or(80);
      if !url.username().is_empty() {
        user = Some(url.username().to_string());
      }
      if let Some(password) = url.password() {
        pass = Some(password.to_string());
      }
    }
  } else {
    let parts: Vec<&str> = cleaned.split(':').collect();
    match parts.len() {
      2 => {
        host = parts[0].to_string();
        port = parts[1]
          .parse::<u16>()
          .map_err(|e| format!("Invalid port: {e}"))?;
      }
      3 => {
        if cleaned.contains('@') {
          let at_parts: Vec<&str> = cleaned.split('@').collect();
          if at_parts.len() == 2 {
            let creds: Vec<&str> = at_parts[0].split(':').collect();
            let addr: Vec<&str> = at_parts[1].split(':').collect();
            if creds.len() == 2 && addr.len() == 2 {
              user = Some(creds[0].to_string());
              pass = Some(creds[1].to_string());
              host = addr[0].to_string();
              port = addr[1]
                .parse::<u16>()
                .map_err(|e| format!("Invalid port: {e}"))?;
            }
          }
        }
        if host.is_empty() {
          return Err("Invalid proxy format (3 parts without @ not supported)".to_string());
        }
      }
      4 => {
        let port_at_1 = parts[1].parse::<u16>();
        let port_at_3 = parts[3].parse::<u16>();
        match (port_at_1, port_at_3) {
          (Ok(p), Err(_)) => {
            host = parts[0].to_string();
            port = p;
            user = Some(parts[2].to_string());
            pass = Some(parts[3].to_string());
          }
          (Err(_), Ok(p)) => {
            host = parts[2].to_string();
            port = p;
            user = Some(parts[0].to_string());
            pass = Some(parts[1].to_string());
          }
          _ => {
            return Err("Ambiguous proxy format with 4 parts".to_string());
          }
        }
      }
      _ => {
        return Err("Invalid proxy string format".to_string());
      }
    }
  }

  if host.is_empty() {
    return Err("Proxy host cannot be empty".to_string());
  }

  if !matches!(p_type.as_str(), "http" | "https" | "socks4" | "socks5") {
    p_type = "http".to_string();
  }

  Ok(crate::browser::ProxySettings {
    proxy_type: p_type,
    host,
    port,
    username: user.filter(|s| !s.is_empty()),
    password: pass.filter(|s| !s.is_empty()),
  })
}

pub async fn execute_open_profile(
  profile_id: String,
  automation: Option<AutomationConfig>,
) -> Result<OpenProfileResult, String> {
  // Parse and build launch overrides
  let mut overrides = crate::browser::browser_runner::LaunchOverrides::default();

  if let Some(ref config) = automation {
    // 1. Proxy
    if let Some(ref proxy_str) = config.proxy_string {
      if !proxy_str.trim().is_empty() {
        let p_settings = parse_proxy_override(
          proxy_str,
          config.proxy_type.as_deref(),
          config.proxy_login.as_deref(),
          config.proxy_password.as_deref(),
        )?;
        overrides.proxy = Some(Some(p_settings));
      } else {
        overrides.proxy = Some(None); // Direct
      }
    }

    // 2. WebRTC
    if let Some(ref webrtc_mode) = config.webrtc_mode {
      overrides.webrtc_mode = Some(webrtc_mode.clone());
      overrides.block_webrtc = Some(webrtc_mode == "block");
    }

    // 3. Custom DNS / DNS Blocklist
    if let Some(ref custom_dns) = config.custom_dns {
      if !custom_dns.trim().is_empty() {
        overrides.dns_blocklist = Some(Some(custom_dns.clone()));
      }
    }

    // 4. Geolocation
    if let Some(ref geo) = config.change_geolocation {
      overrides.change_geolocation = Some(geo.clone());
    }

    // 5. Timezone
    if let Some(ref tz) = config.change_timezone {
      overrides.change_timezone = Some(tz.clone());
    }

    // 6. Language
    if let Some(ref lang) = config.change_language {
      overrides.change_language = Some(lang.clone());
    }
  }

  // Save overrides to global map before launching
  if let Ok(mut guard) = crate::browser::browser_runner::LAUNCH_OVERRIDES.lock() {
    guard.insert(profile_id.clone(), overrides);
  }

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Launching profile {} with custom overrides",
    profile_id
  );

  let app_handle = crate::automation::app_handle_store::get_automation_app_handle()?;
  let launch_result = crate::browser::browser_runner_dynamic_config::launch_with_dynamic_config(
    app_handle,
    profile_id.as_str(),
    None,
  )
  .await
  .map_err(|e| format!("Profile launch failed: {}", e))?;

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Profile {} launched successfully. CDP port: {}, PID: {}",
    profile_id,
    launch_result.cdp_port,
    launch_result.browser_pid
  );

  // Trigger optional legacy webhooks/telegram if they exist in the config
  if let Some(ref config) = automation {
    run_post_open_side_effects(profile_id.as_str(), Some(config), &None, &None).await;
  }

  Ok(OpenProfileResult {
    cdp_port: launch_result.cdp_port,
    browser_pid: launch_result.browser_pid,
    proxy_ip: None,
    ip_country: None,
  })
}

async fn run_proxy_and_ip_checks(
  profile_id: &str,
  automation: Option<&AutomationConfig>,
) -> Result<(Option<String>, Option<String>), String> {
  let mut proxy_ip: Option<String> = None;
  let mut ip_country: Option<String> = None;

  if let Some(config) = automation {
    if let Some(ref proxy_config) = config.dynamic_proxy {
      let url = interpolate_profile_placeholders(&proxy_config.url, profile_id, &None, &None);
      log::info!(
        "[AUTOMATION] [PROFILE_NODE] Fetching proxy from URL: {}",
        url
      );
      proxy_ip = Some(fetch_proxy_from_url(&url).await?);
      log::info!(
        "[AUTOMATION] [PROFILE_NODE] Proxy IP fetched: {:?}",
        proxy_ip
      );
    }
  }

  if let Some(config) = automation {
    if let Some(ref ip_config) = config.ip_check {
      log::info!(
        "[AUTOMATION] [PROFILE_NODE] Validating IP with allowed countries: {:?}",
        ip_config.allowed_countries
      );
      ip_country = Some(validate_ip(&proxy_ip, ip_config).await?);
      log::info!(
        "[AUTOMATION] [PROFILE_NODE] IP country validated: {:?}",
        ip_country
      );
    }
  }

  Ok((proxy_ip, ip_country))
}

async fn run_post_open_side_effects(
  profile_id: &str,
  automation: Option<&AutomationConfig>,
  proxy_ip: &Option<String>,
  ip_country: &Option<String>,
) {
  let Some(config) = automation else {
    return;
  };
  if let Some(ref webhooks) = config.webhooks {
    for webhook in webhooks {
      log::info!(
        "[AUTOMATION] [PROFILE_NODE] Sending webhook to: {}",
        webhook.url
      );
      if let Err(e) = send_webhook(webhook, profile_id, proxy_ip, ip_country).await {
        log::error!(
          "[AUTOMATION] [PROFILE_NODE] Webhook failed: {}. Continuing...",
          e
        );
      }
    }
  }
  if let Some(ref telegram) = config.telegram {
    log::info!(
      "[AUTOMATION] [PROFILE_NODE] Sending Telegram alert to chat: {}",
      telegram.chat_id
    );
    if let Err(e) = send_telegram_alert(telegram, profile_id, proxy_ip, ip_country).await {
      log::error!(
        "[AUTOMATION] [PROFILE_NODE] Telegram alert failed: {}. Continuing...",
        e
      );
    }
  }
}

fn interpolate_profile_placeholders(
  template: &str,
  profile_id: &str,
  proxy_ip: &Option<String>,
  ip_country: &Option<String>,
) -> String {
  template
    .replace("{{PROFILE_ID}}", profile_id)
    .replace("{{profile_id}}", profile_id)
    .replace("{{PROXY_IP}}", proxy_ip.as_deref().unwrap_or(""))
    .replace("{{proxy_ip}}", proxy_ip.as_deref().unwrap_or(""))
    .replace("{{IP_COUNTRY}}", ip_country.as_deref().unwrap_or(""))
    .replace("{{ip_country}}", ip_country.as_deref().unwrap_or(""))
}

async fn fetch_proxy_from_url(url: &str) -> Result<String, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(5))
    .build()
    .map_err(|e| format!("HTTP client build failed: {}", e))?;

  let response = client
    .get(url)
    .send()
    .await
    .map_err(|e| format!("Proxy fetch failed: {}", e))?;

  let text = response
    .text()
    .await
    .map_err(|e| format!("Proxy response read failed: {}", e))?;

  log::debug!(
    "[AUTOMATION] [PROFILE_NODE] Proxy response: {}",
    text.chars().take(100).collect::<String>()
  );

  parse_proxy_response_body(&text)
}

/// Parse proxy API body (JSON or plain text). Used by fetch_proxy_from_url and unit tests.
pub(crate) fn parse_proxy_response_body(text: &str) -> Result<String, String> {
  let trimmed = text.trim();
  if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
    if let Some(ip) = json.get("ip").and_then(|v| v.as_str()) {
      return Ok(ip.to_string());
    }
    if let Some(proxy) = json.get("proxy") {
      if let Some(ip) = proxy.get("ip").and_then(|v| v.as_str()) {
        return Ok(ip.to_string());
      }
    }
  }

  let ip = trimmed
    .split(':')
    .next()
    .unwrap_or(trimmed)
    .trim()
    .to_string();
  if ip.is_empty() {
    return Err("PROXY_INVALID_FORMAT: Empty response".to_string());
  }

  Ok(ip)
}

fn country_allowed(country: &str, allowed: &[String]) -> Result<(), String> {
  if allowed.is_empty() || allowed.contains(&country.to_string()) {
    Ok(())
  } else {
    Err(format!(
      "IP_COUNTRY_BLOCKED: Country {} not in allowed list {:?}",
      country, allowed
    ))
  }
}

async fn validate_ip(proxy_ip: &Option<String>, config: &IpCheckConfig) -> Result<String, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(3))
    .build()
    .map_err(|e| format!("HTTP client build failed: {}", e))?;

  // Use proxy IP if available, otherwise check current IP
  let check_url = if let Some(ref ip) = proxy_ip {
    format!("https://ipapi.co/{}/json/", ip)
  } else {
    "https://ipapi.co/json/".to_string()
  };

  log::info!("[AUTOMATION] [PROFILE_NODE] Checking IP at: {}", check_url);

  let response = client
    .get(&check_url)
    .send()
    .await
    .map_err(|e| format!("IP check request failed: {}", e))?;

  let json: Value = response
    .json()
    .await
    .map_err(|e| format!("IP check response parse failed: {}", e))?;

  let country = json
    .get("country_code")
    .and_then(|v| v.as_str())
    .ok_or("IP check response missing country_code")?
    .to_string();

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] IP country detected: {}",
    country
  );

  country_allowed(&country, &config.allowed_countries)?;

  // TODO: Check fraud score if available from API (future enhancement)
  // For now, we only validate country

  Ok(country)
}

async fn send_webhook(
  webhook: &WebhookConfig,
  profile_id: &str,
  proxy_ip: &Option<String>,
  ip_country: &Option<String>,
) -> Result<(), String> {
  let url = interpolate_profile_placeholders(&webhook.url, profile_id, proxy_ip, ip_country);

  let client = Client::builder()
    .timeout(Duration::from_secs(10))
    .build()
    .map_err(|e| format!("HTTP client build failed: {}", e))?;

  let request = if webhook.method.to_uppercase() == "POST" {
    let body = interpolate_profile_placeholders(
      webhook.body.as_deref().unwrap_or(""),
      profile_id,
      proxy_ip,
      ip_country,
    );
    log::debug!(
      "[AUTOMATION] [PROFILE_NODE] Webhook POST body: {}",
      body.chars().take(200).collect::<String>()
    );
    client.post(&url).body(body)
  } else {
    client.get(&url)
  };

  let response = request
    .send()
    .await
    .map_err(|e| format!("WEBHOOK_FAILED: {}", e))?;

  if !response.status().is_success() {
    return Err(format!("WEBHOOK_FAILED: HTTP status {}", response.status()));
  }

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Webhook sent successfully to {}",
    url.chars().take(50).collect::<String>()
  );

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::{country_allowed, interpolate_profile_placeholders, parse_proxy_response_body};

  #[test]
  fn parse_proxy_json_flat_ip() {
    let ip = parse_proxy_response_body(r#"{"ip":"1.2.3.4","port":8080}"#).unwrap();
    assert_eq!(ip, "1.2.3.4");
  }

  #[test]
  fn parse_proxy_json_nested() {
    let ip = parse_proxy_response_body(r#"{"proxy":{"ip":"5.6.7.8"}}"#).unwrap();
    assert_eq!(ip, "5.6.7.8");
  }

  #[test]
  fn parse_proxy_plain_text_with_port() {
    let ip = parse_proxy_response_body("9.9.9.9:3128").unwrap();
    assert_eq!(ip, "9.9.9.9");
  }

  #[test]
  fn parse_proxy_empty_fails() {
    assert!(parse_proxy_response_body("").is_err());
  }

  #[test]
  fn country_allowed_when_list_empty() {
    assert!(country_allowed("CN", &[]).is_ok());
  }

  #[test]
  fn country_blocked_when_not_in_list() {
    let err = country_allowed("CN", &["US".into(), "CA".into()]).unwrap_err();
    assert!(err.contains("IP_COUNTRY_BLOCKED"));
  }

  #[test]
  fn interpolate_profile_placeholders_mixed_case() {
    let out = interpolate_profile_placeholders(
      "p={{PROFILE_ID}} ip={{proxy_ip}} cc={{IP_COUNTRY}}",
      "prof-1",
      &Some("1.2.3.4".into()),
      &Some("US".into()),
    );
    assert_eq!(out, "p=prof-1 ip=1.2.3.4 cc=US");
  }
}

async fn send_telegram_alert(
  telegram: &TelegramConfig,
  profile_id: &str,
  proxy_ip: &Option<String>,
  ip_country: &Option<String>,
) -> Result<(), String> {
  let message =
    interpolate_profile_placeholders(&telegram.message, profile_id, proxy_ip, ip_country);

  // TODO: Implement Telegram Bot API call
  // Requires bot token from environment or config
  // For now, log the alert (implementation depends on Telegram bot setup)
  log::info!(
        "[AUTOMATION] [PROFILE_NODE] Telegram alert (NOT SENT - requires bot token): Chat={}, Message={}",
        telegram.chat_id,
        message.chars().take(100).collect::<String>()
    );

  // Placeholder: In production, implement:
  // let bot_token = std::env::var("TELEGRAM_BOT_TOKEN").map_err(|_| "TELEGRAM_BOT_TOKEN not configured")?;
  // let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
  // POST to Telegram API with chat_id and message

  Ok(())
}

pub async fn execute_close_profile(profile_id: String, cleanup_mode: String) -> Result<(), String> {
  // 1. Close browser gracefully
  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Closing browser for profile {}",
    profile_id
  );
  let profile = find_profile_for_close(&profile_id)?;
  let app_handle = crate::automation::app_handle_store::get_automation_app_handle()?;
  BrowserRunner::instance()
    .kill_browser_process(app_handle, &profile)
    .await
    .map_err(|e| format!("Browser close failed: {e}"))?;

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Browser closed for profile {}. Cleanup mode: {}",
    profile_id,
    cleanup_mode
  );

  // 2. Cleanup based on mode
  match cleanup_mode.as_str() {
    "cookies" => {
      log::info!(
        "[AUTOMATION] [PROFILE_NODE] Cleaning cookies only for profile {}",
        profile_id
      );
      cleanup_cookies_only(&profile_id).await?;
    }
    "full" => {
      log::warn!(
                "[AUTOMATION] [PROFILE_NODE] FULL CLEANUP requested for profile {} - deleting entire directory",
                profile_id
            );
      cleanup_full_directory(&profile_id).await?;
    }
    _ => {
      return Err(format!("INVALID_CLEANUP_MODE: {}", cleanup_mode));
    }
  }

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Profile {} cleanup completed",
    profile_id
  );

  Ok(())
}

async fn cleanup_cookies_only(profile_id: &str) -> Result<(), String> {
  // TODO: Implement cookies/cache deletion while preserving passwords/config
  // Target directories to delete (typical Chromium profile structure):
  // - Cache/
  // - Code Cache/
  // - GPUCache/
  // - Service Worker/
  // - blob_storage/
  // Keep: Cookies, Login Data, Preferences, etc.

  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Cookies-only cleanup (NOT IMPLEMENTED): Profile {}",
    profile_id
  );

  // Placeholder implementation:
  // use std::fs;
  // let profile_path = get_profile_directory(profile_id)?;
  // for dir in ["Cache", "Code Cache", "GPUCache", "Service Worker", "blob_storage"] {
  //     let dir_path = profile_path.join(dir);
  //     if dir_path.exists() {
  //         fs::remove_dir_all(&dir_path).map_err(|e| format!("Failed to delete {}: {}", dir, e))?;
  //     }
  // }

  Ok(())
}

async fn cleanup_full_directory(profile_id: &str) -> Result<(), String> {
  // TODO: Implement full profile directory deletion
  // WARNING: This is destructive and irreversible

  log::warn!(
    "[AUTOMATION] [PROFILE_NODE] Full directory cleanup (NOT IMPLEMENTED): Profile {}",
    profile_id
  );

  // Placeholder implementation:
  // use std::fs;
  // let profile_path = get_profile_directory(profile_id)?;
  // if profile_path.exists() {
  //     fs::remove_dir_all(&profile_path).map_err(|e| format!("Failed to delete profile directory: {}", e))?;
  // }

  Ok(())
}
