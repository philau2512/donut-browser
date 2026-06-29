use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Error codes for automation pipeline failures.
/// Each code maps to a translated error message in frontend via backend-errors.ts.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutomationErrorCode {
  // Dynamic Proxy Node Errors
  ProxyFetchFailed,
  ProxyParseError,
  ProxyInvalidFormat,

  // IP Check Node Errors
  IpCheckRequestFailed,
  IpCheckCountryBlocked,
  IpCheckFraudScoreHigh,
  IpCheckInvalidResponse,

  // Local Command Node Errors
  CommandTimeout,
  CommandExitCodeError,
  CommandNotFound,
  CommandPermissionDenied,

  // Webhook Node Errors
  WebhookRequestFailed,
  WebhookInvalidUrl,
  WebhookTimeout,

  // Telegram Alert Node Errors
  TelegramSendFailed,
  TelegramInvalidToken,
  TelegramInvalidChatId,

  // Cleanup Node Errors
  CleanupDeleteFailed,
  CleanupPathNotFound,
  CleanupPermissionDenied,

  // Generic Pipeline Errors
  PipelineStoppedOnFailure,
  NodeConfigInvalid,
  VariableNotAvailable,
}

/// Top-level automation configuration for a profile.
/// Contains arrays of node configs for before_open and after_close stages.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileAutomation {
  /// Nodes to execute before opening the browser (pre-launch)
  #[serde(default)]
  pub before_open: Vec<AutomationNodeConfig>,

  /// Nodes to execute after closing the browser (post-close)
  #[serde(default)]
  pub after_close: Vec<AutomationNodeConfig>,
}

impl ProfileAutomation {
  /// Create a new empty automation config (no nodes).
  pub fn empty() -> Self {
    Self::default()
  }

  /// Create automation config with only before_open nodes.
  pub fn before_open(nodes: Vec<AutomationNodeConfig>) -> Self {
    Self {
      before_open: nodes,
      after_close: Vec::new(),
    }
  }

  /// Create automation config with only after_close nodes.
  pub fn after_close(nodes: Vec<AutomationNodeConfig>) -> Self {
    Self {
      before_open: Vec::new(),
      after_close: nodes,
    }
  }

  /// Create automation config with both before_open and after_close nodes.
  pub fn new(
    before_open: Vec<AutomationNodeConfig>,
    after_close: Vec<AutomationNodeConfig>,
  ) -> Self {
    Self {
      before_open,
      after_close,
    }
  }

  /// Check if automation is empty (no nodes configured).
  pub fn is_empty(&self) -> bool {
    self.before_open.is_empty() && self.after_close.is_empty()
  }

  /// Count total number of nodes across both stages.
  pub fn node_count(&self) -> usize {
    self.before_open.len() + self.after_close.len()
  }
}

/// Tagged union of all node types.
/// Each variant contains the config for that specific node type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AutomationNodeConfig {
  DynamicProxy(DynamicProxyNodeConfig),
  IpCheck(IpCheckNodeConfig),
  LocalCommand(LocalCommandNodeConfig),
  Webhook(WebhookNodeConfig),
  TelegramAlert(TelegramAlertNodeConfig),
  Cleanup(CleanupNodeConfig),
}

/// Configuration for Dynamic Proxy Node.
/// Fetches proxy credentials from an API and applies them to the profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicProxyNodeConfig {
  /// User-visible label for this node
  pub label: String,

  /// API endpoint URL to fetch proxy from
  pub api_url: String,

  /// HTTP headers to include in the request (e.g., Authorization)
  #[serde(default)]
  pub headers: HashMap<String, String>,

  /// Expected response format: "json" or "text"
  #[serde(default = "default_response_format")]
  pub response_format: String,

  /// JSON path for extracting IP (e.g., "data.proxy.host")
  /// Only used when response_format is "json"
  #[serde(default)]
  pub json_path_ip: Option<String>,

  /// JSON path for extracting port
  #[serde(default)]
  pub json_path_port: Option<String>,

  /// JSON path for extracting username
  #[serde(default)]
  pub json_path_username: Option<String>,

  /// JSON path for extracting password
  #[serde(default)]
  pub json_path_password: Option<String>,

  /// Proxy protocol: "http", "https", "socks5"
  #[serde(default = "default_proxy_protocol")]
  pub protocol: String,

  /// Request timeout in seconds
  #[serde(default = "default_timeout_seconds")]
  pub timeout_seconds: u64,

  /// Retry attempts on failure
  #[serde(default = "default_max_attempts")]
  pub max_attempts: u32,

  /// Delay between retries in milliseconds
  #[serde(default = "default_retry_delay_ms")]
  pub retry_delay_ms: u64,

  /// Exponential backoff multiplier for retries
  #[serde(default = "default_backoff_multiplier")]
  pub backoff_multiplier: f32,
}

/// Configuration for IP Check Node.
/// Validates the current IP address against geolocation and fraud criteria.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpCheckNodeConfig {
  pub label: String,

  /// List of allowed country codes (ISO 3166-1 alpha-2, e.g., "US", "GB")
  /// Empty = all countries allowed
  #[serde(default)]
  pub allowed_countries: Vec<String>,

  /// Maximum allowed fraud score (0-100)
  /// Set to 100 to disable fraud check
  #[serde(default = "default_max_fraud_score")]
  pub max_fraud_score: u8,

  /// Whether to use the proxy for the IP check request
  #[serde(default = "default_true")]
  pub use_proxy: bool,

  /// Request timeout in seconds
  #[serde(default = "default_timeout_seconds")]
  pub timeout_seconds: u64,

  #[serde(default = "default_max_attempts")]
  pub max_attempts: u32,

  #[serde(default = "default_retry_delay_ms")]
  pub retry_delay_ms: u64,

  #[serde(default = "default_backoff_multiplier")]
  pub backoff_multiplier: f32,
}

/// Configuration for Local Command Node.
/// Executes a shell command on the host system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCommandNodeConfig {
  pub label: String,

  /// Shell command to execute (supports variable interpolation)
  pub command: String,

  /// Working directory for the command
  #[serde(default)]
  pub working_dir: Option<String>,

  /// Environment variables to set
  #[serde(default)]
  pub env_vars: HashMap<String, String>,

  /// Command timeout in seconds
  #[serde(default = "default_command_timeout_seconds")]
  pub timeout_seconds: u64,

  #[serde(default = "default_max_attempts")]
  pub max_attempts: u32,

  #[serde(default = "default_retry_delay_ms")]
  pub retry_delay_ms: u64,

  #[serde(default = "default_backoff_multiplier")]
  pub backoff_multiplier: f32,
}

/// Configuration for Webhook Node.
/// Sends HTTP request to a webhook URL with profile data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookNodeConfig {
  pub label: String,

  /// Webhook URL (supports variable interpolation)
  pub url: String,

  /// HTTP method: "GET" or "POST"
  #[serde(default = "default_http_method")]
  pub method: String,

  /// HTTP headers
  #[serde(default)]
  pub headers: HashMap<String, String>,

  /// Request body for POST requests (supports variable interpolation)
  #[serde(default)]
  pub body: Option<String>,

  /// Request timeout in seconds
  #[serde(default = "default_timeout_seconds")]
  pub timeout_seconds: u64,

  #[serde(default = "default_max_attempts")]
  pub max_attempts: u32,

  #[serde(default = "default_retry_delay_ms")]
  pub retry_delay_ms: u64,

  #[serde(default = "default_backoff_multiplier")]
  pub backoff_multiplier: f32,
}

/// Configuration for Telegram Alert Node.
/// Sends a message to a Telegram chat via Bot API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramAlertNodeConfig {
  pub label: String,

  /// Telegram bot token
  pub bot_token: String,

  /// Telegram chat ID (can be user ID, group ID, or channel username)
  pub chat_id: String,

  /// Message text (supports variable interpolation)
  pub message: String,

  /// Request timeout in seconds
  #[serde(default = "default_timeout_seconds")]
  pub timeout_seconds: u64,

  #[serde(default = "default_max_attempts")]
  pub max_attempts: u32,

  #[serde(default = "default_retry_delay_ms")]
  pub retry_delay_ms: u64,

  #[serde(default = "default_backoff_multiplier")]
  pub backoff_multiplier: f32,
}

/// Configuration for Cleanup Node.
/// Cleans browser data after the profile is closed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupNodeConfig {
  pub label: String,

  /// Cleanup mode:
  /// - "cookies_and_cache": Delete only cookies and cache (preserves config and saved passwords)
  /// - "full": Delete entire profile directory
  #[serde(default = "default_cleanup_mode")]
  pub mode: String,

  /// Domains to exclude from cleanup (only applies to cookies_and_cache mode)
  #[serde(default)]
  pub exclude_domains: Vec<String>,
}

// Default value functions
fn default_response_format() -> String {
  "json".to_string()
}

fn default_proxy_protocol() -> String {
  "http".to_string()
}

fn default_timeout_seconds() -> u64 {
  30
}

fn default_command_timeout_seconds() -> u64 {
  300 // 5 minutes for commands
}

fn default_max_attempts() -> u32 {
  3
}

fn default_retry_delay_ms() -> u64 {
  1000
}

fn default_backoff_multiplier() -> f32 {
  2.0
}

fn default_http_method() -> String {
  "POST".to_string()
}

fn default_cleanup_mode() -> String {
  "cookies_and_cache".to_string()
}

fn default_max_fraud_score() -> u8 {
  100
}

fn default_true() -> bool {
  true
}
