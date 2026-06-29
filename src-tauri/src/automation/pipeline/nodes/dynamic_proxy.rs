use crate::automation::pipeline::context::{ExecutionContext, ProxySettings};
use crate::automation::pipeline::types::{AutomationErrorCode, DynamicProxyNodeConfig};
use crate::automation::pipeline::{AutomationNode, NodeResult};
use async_trait::async_trait;
use serde_json::Value;

pub struct DynamicProxyNode {
  config: DynamicProxyNodeConfig,
}

impl DynamicProxyNode {
  pub fn new(config: DynamicProxyNodeConfig) -> Self {
    Self { config }
  }

  /// Fetch proxy data from API
  async fn fetch_proxy_data(&self) -> Result<String, (AutomationErrorCode, String)> {
    let client = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(self.config.timeout_seconds))
      .build()
      .map_err(|e| {
        (
          AutomationErrorCode::ProxyFetchFailed,
          format!("Failed to create HTTP client: {}", e),
        )
      })?;

    log::info!(
      "[AUTOMATION] [DYNAMIC_PROXY] Fetching proxy from {}",
      self.config.api_url
    );

    let mut request = client.get(&self.config.api_url);

    // Add custom headers
    for (key, value) in &self.config.headers {
      request = request.header(key, value);
    }

    let response = request.send().await.map_err(|e| {
      if e.is_timeout() {
        (
          AutomationErrorCode::ProxyFetchFailed,
          format!("Request timeout after {}s", self.config.timeout_seconds),
        )
      } else {
        (
          AutomationErrorCode::ProxyFetchFailed,
          format!("HTTP request failed: {}", e),
        )
      }
    })?;

    if !response.status().is_success() {
      return Err((
        AutomationErrorCode::ProxyFetchFailed,
        format!("API returned HTTP {}", response.status()),
      ));
    }

    let body = response.text().await.map_err(|e| {
      (
        AutomationErrorCode::ProxyFetchFailed,
        format!("Failed to read response body: {}", e),
      )
    })?;

    Ok(body)
  }

  /// Parse proxy from JSON response using JSON paths
  fn parse_json(&self, json_str: &str) -> Result<ProxySettings, (AutomationErrorCode, String)> {
    let json: Value = serde_json::from_str(json_str).map_err(|e| {
      (
        AutomationErrorCode::ProxyParseError,
        format!("Invalid JSON response: {}", e),
      )
    })?;

    // Extract fields using JSON paths
    let host = self
      .extract_json_value(&json, self.config.json_path_ip.as_deref())
      .ok_or_else(|| {
        (
          AutomationErrorCode::ProxyParseError,
          format!(
            "Failed to extract IP from JSON path: {:?}",
            self.config.json_path_ip
          ),
        )
      })?;

    let port_str = self
      .extract_json_value(&json, self.config.json_path_port.as_deref())
      .ok_or_else(|| {
        (
          AutomationErrorCode::ProxyParseError,
          format!(
            "Failed to extract port from JSON path: {:?}",
            self.config.json_path_port
          ),
        )
      })?;

    let port: u16 = port_str.parse().map_err(|_| {
      (
        AutomationErrorCode::ProxyParseError,
        format!("Invalid port number: {}", port_str),
      )
    })?;

    let username = self.extract_json_value(&json, self.config.json_path_username.as_deref());
    let password = self.extract_json_value(&json, self.config.json_path_password.as_deref());

    Ok(ProxySettings {
      protocol: self.config.protocol.clone(),
      host,
      port,
      username,
      password,
    })
  }

  /// Extract value from JSON using dot-notation path (e.g., "data.proxy.host")
  fn extract_json_value(&self, json: &Value, path: Option<&str>) -> Option<String> {
    let path = path?;
    let parts: Vec<&str> = path.split('.').collect();

    let mut current = json;
    for part in parts {
      current = current.get(part)?;
    }

    match current {
      Value::String(s) => Some(s.clone()),
      Value::Number(n) => Some(n.to_string()),
      _ => None,
    }
  }

  /// Parse proxy from text response (format: "ip:port" or "ip:port:user:pass")
  fn parse_text(&self, text: &str) -> Result<ProxySettings, (AutomationErrorCode, String)> {
    let trimmed = text.trim();

    // Support two formats:
    // 1. "ip:port"
    // 2. "ip:port:username:password"
    let parts: Vec<&str> = trimmed.split(':').collect();

    if parts.len() < 2 {
      return Err((
        AutomationErrorCode::ProxyInvalidFormat,
        format!(
          "Invalid proxy format (expected ip:port or ip:port:user:pass): {}",
          trimmed
        ),
      ));
    }

    let host = parts[0].to_string();
    let port: u16 = parts[1].parse().map_err(|_| {
      (
        AutomationErrorCode::ProxyInvalidFormat,
        format!("Invalid port number: {}", parts[1]),
      )
    })?;

    let (username, password) = if parts.len() >= 4 {
      (Some(parts[2].to_string()), Some(parts[3].to_string()))
    } else {
      (None, None)
    };

    Ok(ProxySettings {
      protocol: self.config.protocol.clone(),
      host,
      port,
      username,
      password,
    })
  }
}

#[async_trait]
impl AutomationNode for DynamicProxyNode {
  async fn execute(&self, context: &mut ExecutionContext) -> NodeResult {
    log::info!(
      "[AUTOMATION] [DYNAMIC_PROXY] Executing: {}",
      self.config.label
    );

    // Fetch proxy data from API
    let response_body = self.fetch_proxy_data().await?;

    // Parse based on response format
    let proxy = if self.config.response_format == "json" {
      self.parse_json(&response_body)?
    } else {
      self.parse_text(&response_body)?
    };

    log::info!(
      "[AUTOMATION] [DYNAMIC_PROXY] Resolved proxy: {}:{} ({})",
      proxy.host,
      proxy.port,
      proxy.protocol
    );

    // Store proxy in context
    context.set_dynamic_proxy(proxy);

    Ok(())
  }

  fn label(&self) -> &str {
    &self.config.label
  }

  fn node_type(&self) -> &str {
    "DYNAMIC_PROXY"
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::HashMap;

  #[test]
  fn test_parse_text_basic() {
    let config = DynamicProxyNodeConfig {
      label: "Test".to_string(),
      api_url: "http://test".to_string(),
      headers: HashMap::new(),
      response_format: "text".to_string(),
      json_path_ip: None,
      json_path_port: None,
      json_path_username: None,
      json_path_password: None,
      protocol: "http".to_string(),
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = DynamicProxyNode::new(config);
    let proxy = node.parse_text("192.168.1.1:8080").unwrap();
    assert_eq!(proxy.host, "192.168.1.1");
    assert_eq!(proxy.port, 8080);
    assert!(proxy.username.is_none());
    assert!(proxy.password.is_none());
  }

  #[test]
  fn test_parse_text_with_auth() {
    let config = DynamicProxyNodeConfig {
      label: "Test".to_string(),
      api_url: "http://test".to_string(),
      headers: HashMap::new(),
      response_format: "text".to_string(),
      json_path_ip: None,
      json_path_port: None,
      json_path_username: None,
      json_path_password: None,
      protocol: "socks5".to_string(),
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = DynamicProxyNode::new(config);
    let proxy = node.parse_text("192.168.1.1:8080:myuser:mypass").unwrap();
    assert_eq!(proxy.host, "192.168.1.1");
    assert_eq!(proxy.port, 8080);
    assert_eq!(proxy.username, Some("myuser".to_string()));
    assert_eq!(proxy.password, Some("mypass".to_string()));
  }

  #[test]
  fn test_parse_json() {
    let config = DynamicProxyNodeConfig {
      label: "Test".to_string(),
      api_url: "http://test".to_string(),
      headers: HashMap::new(),
      response_format: "json".to_string(),
      json_path_ip: Some("proxy.host".to_string()),
      json_path_port: Some("proxy.port".to_string()),
      json_path_username: Some("proxy.username".to_string()),
      json_path_password: Some("proxy.password".to_string()),
      protocol: "http".to_string(),
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = DynamicProxyNode::new(config);
    let json =
      r#"{"proxy": {"host": "192.168.1.1", "port": 8080, "username": "user", "password": "pass"}}"#;
    let proxy = node.parse_json(json).unwrap();
    assert_eq!(proxy.host, "192.168.1.1");
    assert_eq!(proxy.port, 8080);
    assert_eq!(proxy.username, Some("user".to_string()));
    assert_eq!(proxy.password, Some("pass".to_string()));
  }
}
