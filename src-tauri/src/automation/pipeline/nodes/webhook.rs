use crate::automation::pipeline::context::ExecutionContext;
use crate::automation::pipeline::types::{AutomationErrorCode, WebhookNodeConfig};
use crate::automation::pipeline::{AutomationNode, NodeResult};
use async_trait::async_trait;
use std::collections::HashMap;

pub struct WebhookNode {
  config: WebhookNodeConfig,
}

impl WebhookNode {
  pub fn new(config: WebhookNodeConfig) -> Self {
    Self { config }
  }

  /// Interpolate variables in headers map
  fn interpolate_headers(
    &self,
    context: &ExecutionContext,
  ) -> Result<HashMap<String, String>, (AutomationErrorCode, String)> {
    let mut interpolated = HashMap::new();

    for (key, value) in &self.config.headers {
      let interpolated_value = context.interpolate(value).map_err(|e| {
        (
          AutomationErrorCode::VariableNotAvailable,
          format!("Variable interpolation failed in header '{}': {}", key, e),
        )
      })?;
      interpolated.insert(key.clone(), interpolated_value);
    }

    Ok(interpolated)
  }

  /// Send HTTP request
  async fn send_request(
    &self,
    url: &str,
    method: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
    timeout_seconds: u64,
  ) -> Result<(), (AutomationErrorCode, String)> {
    // Validate URL
    if url::Url::parse(url).is_err() {
      return Err((
        AutomationErrorCode::WebhookInvalidUrl,
        format!("Invalid URL: {}", url),
      ));
    }

    let client = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(timeout_seconds))
      .build()
      .map_err(|e| {
        (
          AutomationErrorCode::WebhookRequestFailed,
          format!("Failed to create HTTP client: {}", e),
        )
      })?;

    log::info!(
      "[AUTOMATION] [WEBHOOK] Sending {} request to {}",
      method,
      url
    );

    let method_upper = method.to_uppercase();
    let mut request_builder = match method_upper.as_str() {
      "GET" => client.get(url),
      "POST" => client.post(url),
      _ => {
        return Err((
          AutomationErrorCode::WebhookRequestFailed,
          format!("Unsupported HTTP method: {}", method),
        ))
      }
    };

    // Add headers
    for (key, value) in headers {
      request_builder = request_builder.header(key, value);
    }

    // Add body for POST
    if method_upper == "POST" {
      if let Some(body_content) = body {
        log::debug!("[AUTOMATION] [WEBHOOK] Request body: {}", body_content);
        request_builder = request_builder.body(body_content.to_string());
      }
    }

    let response = request_builder.send().await.map_err(|e| {
      if e.is_timeout() {
        (
          AutomationErrorCode::WebhookTimeout,
          format!("Request timeout after {}s", timeout_seconds),
        )
      } else if e.is_connect() {
        (
          AutomationErrorCode::WebhookRequestFailed,
          format!("Connection error: {}", e),
        )
      } else {
        (
          AutomationErrorCode::WebhookRequestFailed,
          format!("HTTP request failed: {}", e),
        )
      }
    })?;

    let status = response.status();
    if !status.is_success() {
      let error_body = response
        .text()
        .await
        .unwrap_or_else(|_| "Unable to read response body".to_string());

      return Err((
        AutomationErrorCode::WebhookRequestFailed,
        format!("Webhook failed (HTTP {}): {}", status, error_body),
      ));
    }

    log::info!("[AUTOMATION] [WEBHOOK] Request succeeded (HTTP {})", status);
    Ok(())
  }
}

#[async_trait]
impl AutomationNode for WebhookNode {
  async fn execute(&self, context: &mut ExecutionContext) -> NodeResult {
    log::info!("[AUTOMATION] [WEBHOOK] Executing: {}", self.config.label);

    // Interpolate URL
    let url = context.interpolate(&self.config.url).map_err(|e| {
      (
        AutomationErrorCode::VariableNotAvailable,
        format!("Variable interpolation failed in URL: {}", e),
      )
    })?;

    // Interpolate headers
    let headers = self.interpolate_headers(context)?;

    // Interpolate body (if present)
    let body = if let Some(ref body_template) = self.config.body {
      Some(context.interpolate(body_template).map_err(|e| {
        (
          AutomationErrorCode::VariableNotAvailable,
          format!("Variable interpolation failed in body: {}", e),
        )
      })?)
    } else {
      None
    };

    // Send request
    self
      .send_request(
        &url,
        &self.config.method,
        &headers,
        body.as_deref(),
        self.config.timeout_seconds,
      )
      .await?;

    Ok(())
  }

  fn label(&self) -> &str {
    &self.config.label
  }

  fn node_type(&self) -> &str {
    "WEBHOOK"
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_node_creation() {
    let config = WebhookNodeConfig {
      label: "Test Webhook".to_string(),
      url: "https://example.com/webhook".to_string(),
      method: "POST".to_string(),
      headers: HashMap::new(),
      body: Some("test body".to_string()),
      timeout_seconds: 30,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    };

    let node = WebhookNode::new(config);
    assert_eq!(node.label(), "Test Webhook");
    assert_eq!(node.node_type(), "WEBHOOK");
  }

  #[tokio::test]
  async fn test_url_interpolation() {
    let config = WebhookNodeConfig {
      label: "Test".to_string(),
      url: "https://example.com/profile/{{profile_id}}".to_string(),
      method: "GET".to_string(),
      headers: HashMap::new(),
      body: None,
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = WebhookNode::new(config);
    let mut ctx = ExecutionContext::new("test-123".to_string(), "MyProfile".to_string());

    // This will fail on network, but should successfully interpolate the URL
    let result = node.execute(&mut ctx).await;
    assert!(result.is_err());
    let (code, msg) = result.unwrap_err();
    // Should fail on HTTP request, not interpolation
    assert!(matches!(
      code,
      AutomationErrorCode::WebhookRequestFailed | AutomationErrorCode::WebhookTimeout
    ));
    assert!(!msg.contains("Variable"));
  }

  #[test]
  fn test_header_interpolation() {
    let mut headers = HashMap::new();
    headers.insert("X-Profile-Name".to_string(), "{{profile_name}}".to_string());
    headers.insert("X-Profile-ID".to_string(), "{{profile_id}}".to_string());

    let config = WebhookNodeConfig {
      label: "Test".to_string(),
      url: "https://example.com".to_string(),
      method: "POST".to_string(),
      headers,
      body: None,
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = WebhookNode::new(config);
    let ctx = ExecutionContext::new("test-123".to_string(), "MyProfile".to_string());

    let interpolated = node.interpolate_headers(&ctx).unwrap();
    assert_eq!(
      interpolated.get("X-Profile-Name"),
      Some(&"MyProfile".to_string())
    );
    assert_eq!(
      interpolated.get("X-Profile-ID"),
      Some(&"test-123".to_string())
    );
  }
}
