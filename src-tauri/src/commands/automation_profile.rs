// ═══════════════════════════════════════════════════════════════════════════════
// automation_profile.rs
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tauri commands for Profile Flow Nodes (openProfile, closeProfile).
// Bridges flow-canvas frontend to Rust backend profile operations.
//
// Responsibilities:
// - open_profile_with_automation: Launch profile with dynamic proxy, IP check, webhooks
// - close_profile_with_cleanup: Close profile with cleanup modes (cookies/full)
//
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Deserialize)]
pub struct AutomationConfig {
  #[serde(rename = "dynamicProxy")]
  pub dynamic_proxy: Option<DynamicProxyConfig>,
  #[serde(rename = "ipCheck")]
  pub ip_check: Option<IpCheckConfig>,
  pub webhooks: Option<Vec<WebhookConfig>>,
  pub telegram: Option<TelegramConfig>,
}

#[derive(Debug, Deserialize)]
pub struct DynamicProxyConfig {
  pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct IpCheckConfig {
  #[serde(rename = "allowedCountries")]
  pub allowed_countries: Vec<String>,
  #[serde(rename = "maxFraudScore")]
  pub max_fraud_score: u8,
}

#[derive(Debug, Deserialize)]
pub struct WebhookConfig {
  pub url: String,
  pub method: String, // "GET" | "POST"
  pub body: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelegramConfig {
  #[serde(rename = "chatId")]
  pub chat_id: String,
  pub message: String,
}

#[derive(Debug, Serialize)]
pub struct OpenProfileResult {
  #[serde(rename = "cdpPort")]
  pub cdp_port: u16,
  #[serde(rename = "browserPid")]
  pub browser_pid: u32,
  #[serde(rename = "proxyIp")]
  pub proxy_ip: Option<String>,
  #[serde(rename = "ipCountry")]
  pub ip_country: Option<String>,
}

#[command]
pub async fn open_profile_with_automation(
  profile_id: String,
  automation: Option<AutomationConfig>,
) -> Result<OpenProfileResult, String> {
  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Opening profile {} with automation config: {:?}",
    profile_id,
    automation.is_some()
  );

  crate::automation::profile_node::execute_open_profile(profile_id, automation).await
}

#[command]
pub async fn close_profile_with_cleanup(
  profile_id: String,
  cleanup_mode: String, // "cookies" | "full"
) -> Result<(), String> {
  log::info!(
    "[AUTOMATION] [PROFILE_NODE] Closing profile {} with cleanup mode {}",
    profile_id,
    cleanup_mode
  );

  crate::automation::profile_node::execute_close_profile(profile_id, cleanup_mode).await
}
