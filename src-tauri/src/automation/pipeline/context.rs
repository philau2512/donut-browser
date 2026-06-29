use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Proxy settings that can be dynamically configured by DynamicProxyNode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxySettings {
  pub protocol: String, // "http", "https", "socks5"
  pub host: String,
  pub port: u16,
  pub username: Option<String>,
  pub password: Option<String>,
}

impl ProxySettings {
  /// Format proxy as URL string (e.g., "http://user:pass@host:port")
  pub fn to_url(&self) -> String {
    match (&self.username, &self.password) {
      (Some(user), Some(pass)) => {
        format!(
          "{}://{}:{}@{}:{}",
          self.protocol, user, pass, self.host, self.port
        )
      }
      _ => format!("{}://{}:{}", self.protocol, self.host, self.port),
    }
  }
}

/// Execution context passed through the automation pipeline.
/// Maintains state across node executions within a single pipeline run.
pub struct ExecutionContext {
  /// Profile ID being automated
  pub profile_id: String,

  /// Profile name
  pub profile_name: String,

  /// Variables available for interpolation in node configs.
  /// Populated progressively as nodes execute:
  /// - {{profile_id}}, {{profile_name}} - available from start
  /// - {{proxy_ip}}, {{proxy_port}}, {{proxy_protocol}} - after DynamicProxyNode
  /// - {{ip_country}}, {{ip_fraud_score}} - after IpCheckNode
  pub variables: HashMap<String, String>,

  /// Dynamic proxy settings set by DynamicProxyNode.
  /// Used by IpCheckNode (if use_proxy=true) and applied to the browser profile.
  pub dynamic_proxy: Option<ProxySettings>,
}

impl ExecutionContext {
  /// Create a new execution context for a profile.
  pub fn new(profile_id: String, profile_name: String) -> Self {
    let mut variables = HashMap::new();
    variables.insert("profile_id".to_string(), profile_id.clone());
    variables.insert("profile_name".to_string(), profile_name.clone());

    Self {
      profile_id,
      profile_name,
      variables,
      dynamic_proxy: None,
    }
  }

  /// Set a variable value.
  pub fn set_variable(&mut self, key: &str, value: String) {
    self.variables.insert(key.to_string(), value);
  }

  /// Get a variable value.
  pub fn get_variable(&self, key: &str) -> Option<&String> {
    self.variables.get(key)
  }

  /// Interpolate variables in a string template.
  /// Replaces {{variable_name}} with the corresponding value from variables.
  /// Returns error if a referenced variable is not available.
  pub fn interpolate(&self, template: &str) -> Result<String, String> {
    let mut result = template.to_string();

    // Find all {{variable}} patterns
    let re = regex::Regex::new(r"\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}")
      .map_err(|e| format!("Regex error: {}", e))?;

    for cap in re.captures_iter(template) {
      let var_name = &cap[1];
      let value = self
        .variables
        .get(var_name)
        .ok_or_else(|| format!("Variable '{}' not available in context", var_name))?;

      result = result.replace(&format!("{{{{{}}}}}", var_name), value);
    }

    Ok(result)
  }

  /// Set the dynamic proxy configuration.
  pub fn set_dynamic_proxy(&mut self, proxy: ProxySettings) {
    // Also populate proxy-related variables
    self.set_variable("proxy_ip", proxy.host.clone());
    self.set_variable("proxy_port", proxy.port.to_string());
    self.set_variable("proxy_protocol", proxy.protocol.clone());

    self.dynamic_proxy = Some(proxy);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_context_initialization() {
    let ctx = ExecutionContext::new("test-id".to_string(), "Test Profile".to_string());
    assert_eq!(ctx.get_variable("profile_id"), Some(&"test-id".to_string()));
    assert_eq!(
      ctx.get_variable("profile_name"),
      Some(&"Test Profile".to_string())
    );
    assert!(ctx.dynamic_proxy.is_none());
  }

  #[test]
  fn test_variable_interpolation() {
    let mut ctx = ExecutionContext::new("123".to_string(), "MyProfile".to_string());
    ctx.set_variable("custom", "value".to_string());

    let result = ctx.interpolate("Profile {{profile_name}} has ID {{profile_id}} and {{custom}}");
    assert_eq!(
      result,
      Ok("Profile MyProfile has ID 123 and value".to_string())
    );
  }

  #[test]
  fn test_missing_variable_error() {
    let ctx = ExecutionContext::new("123".to_string(), "MyProfile".to_string());
    let result = ctx.interpolate("Missing {{unknown_var}}");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("unknown_var"));
  }

  #[test]
  fn test_set_dynamic_proxy() {
    let mut ctx = ExecutionContext::new("123".to_string(), "MyProfile".to_string());
    let proxy = ProxySettings {
      protocol: "http".to_string(),
      host: "192.168.1.1".to_string(),
      port: 8080,
      username: Some("user".to_string()),
      password: Some("pass".to_string()),
    };

    ctx.set_dynamic_proxy(proxy.clone());

    assert_eq!(
      ctx.get_variable("proxy_ip"),
      Some(&"192.168.1.1".to_string())
    );
    assert_eq!(ctx.get_variable("proxy_port"), Some(&"8080".to_string()));
    assert_eq!(
      ctx.get_variable("proxy_protocol"),
      Some(&"http".to_string())
    );
    assert!(ctx.dynamic_proxy.is_some());
  }

  #[test]
  fn test_proxy_to_url() {
    let proxy_with_auth = ProxySettings {
      protocol: "http".to_string(),
      host: "proxy.example.com".to_string(),
      port: 8080,
      username: Some("user".to_string()),
      password: Some("pass".to_string()),
    };
    assert_eq!(
      proxy_with_auth.to_url(),
      "http://user:pass@proxy.example.com:8080"
    );

    let proxy_no_auth = ProxySettings {
      protocol: "socks5".to_string(),
      host: "proxy.example.com".to_string(),
      port: 1080,
      username: None,
      password: None,
    };
    assert_eq!(proxy_no_auth.to_url(), "socks5://proxy.example.com:1080");
  }
}
