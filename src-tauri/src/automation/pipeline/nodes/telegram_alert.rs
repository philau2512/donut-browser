use crate::automation::pipeline::context::ExecutionContext;
use crate::automation::pipeline::types::{AutomationErrorCode, TelegramAlertNodeConfig};
use crate::automation::pipeline::{AutomationNode, NodeResult};
use async_trait::async_trait;
use serde_json::json;

pub struct TelegramAlertNode {
  config: TelegramAlertNodeConfig,
}

impl TelegramAlertNode {
  pub fn new(config: TelegramAlertNodeConfig) -> Self {
    Self { config }
  }

  /// Send message to Telegram via Bot API
  async fn send_telegram_message(
    &self,
    bot_token: &str,
    chat_id: &str,
    message: &str,
    timeout_seconds: u64,
  ) -> Result<(), (AutomationErrorCode, String)> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);

    let client = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(timeout_seconds))
      .build()
      .map_err(|e| {
        (
          AutomationErrorCode::TelegramSendFailed,
          format!("Failed to create HTTP client: {}", e),
        )
      })?;

    let body = json!({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML"
    });

    log::info!(
      "[AUTOMATION] [TELEGRAM_ALERT] Sending message to chat_id={}: {}",
      chat_id,
      if message.len() > 50 {
        format!("{}...", &message[..50])
      } else {
        message.to_string()
      }
    );

    let response = client.post(&url).json(&body).send().await.map_err(|e| {
      if e.is_timeout() {
        (
          AutomationErrorCode::TelegramSendFailed,
          format!("Request timeout after {}s", timeout_seconds),
        )
      } else if e.is_connect() {
        (
          AutomationErrorCode::TelegramSendFailed,
          format!("Connection error: {}", e),
        )
      } else {
        (
          AutomationErrorCode::TelegramSendFailed,
          format!("HTTP request failed: {}", e),
        )
      }
    })?;

    let status = response.status();
    if !status.is_success() {
      let error_body = response
        .text()
        .await
        .unwrap_or_else(|_| "Unable to read error body".to_string());

      // Check for common Telegram API errors
      if error_body.contains("Unauthorized") || error_body.contains("bot token") {
        return Err((
          AutomationErrorCode::TelegramInvalidToken,
          format!("Invalid bot token (HTTP {}): {}", status, error_body),
        ));
      } else if error_body.contains("chat not found") || error_body.contains("PEER_ID_INVALID") {
        return Err((
          AutomationErrorCode::TelegramInvalidChatId,
          format!("Invalid chat_id (HTTP {}): {}", status, error_body),
        ));
      } else {
        return Err((
          AutomationErrorCode::TelegramSendFailed,
          format!("Telegram API error (HTTP {}): {}", status, error_body),
        ));
      }
    }

    log::info!("[AUTOMATION] [TELEGRAM_ALERT] Message sent successfully");
    Ok(())
  }
}

#[async_trait]
impl AutomationNode for TelegramAlertNode {
  async fn execute(&self, context: &mut ExecutionContext) -> NodeResult {
    log::info!(
      "[AUTOMATION] [TELEGRAM_ALERT] Executing: {}",
      self.config.label
    );

    // Interpolate variables in message
    let message = context.interpolate(&self.config.message).map_err(|e| {
      (
        AutomationErrorCode::VariableNotAvailable,
        format!("Variable interpolation failed in message: {}", e),
      )
    })?;

    // Send the message
    self
      .send_telegram_message(
        &self.config.bot_token,
        &self.config.chat_id,
        &message,
        self.config.timeout_seconds,
      )
      .await?;

    Ok(())
  }

  fn label(&self) -> &str {
    &self.config.label
  }

  fn node_type(&self) -> &str {
    "TELEGRAM_ALERT"
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_node_creation() {
    let config = TelegramAlertNodeConfig {
      label: "Test Alert".to_string(),
      bot_token: "fake_token".to_string(),
      chat_id: "12345".to_string(),
      message: "Profile {{profile_name}} started".to_string(),
      timeout_seconds: 30,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    };

    let node = TelegramAlertNode::new(config);
    assert_eq!(node.label(), "Test Alert");
    assert_eq!(node.node_type(), "TELEGRAM_ALERT");
  }

  #[tokio::test]
  async fn test_variable_interpolation() {
    let config = TelegramAlertNodeConfig {
      label: "Test".to_string(),
      bot_token: "fake_token".to_string(),
      chat_id: "12345".to_string(),
      message: "Profile {{profile_name}} ({{profile_id}}) started".to_string(),
      timeout_seconds: 30,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = TelegramAlertNode::new(config);
    let mut ctx = ExecutionContext::new("test-id".to_string(), "MyProfile".to_string());

    // This will fail because we're using a fake token, but it should get past interpolation
    let result = node.execute(&mut ctx).await;
    assert!(result.is_err());
    let (code, msg) = result.unwrap_err();
    // Should fail on HTTP request, not interpolation
    assert!(matches!(code, AutomationErrorCode::TelegramSendFailed));
    assert!(!msg.contains("Variable"));
  }
}
