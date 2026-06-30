//! Profile Automation Pipeline Engine
//!
//! Executes a linear sequence of automation nodes (before_open / after_close)
//! for profile lifecycle hooks. Each node is executed sequentially, with
//! optional stop-on-failure behavior and retry logic.

pub mod context;
pub mod nodes;
pub mod types;

#[cfg(test)]
mod pipeline_integration_tests;

use async_trait::async_trait;
use context::ExecutionContext;
use nodes::{
  CleanupNode, DynamicProxyNode, IpCheckNode, LocalCommandNode, TelegramAlertNode, WebhookNode,
};
use types::{AutomationErrorCode, AutomationNodeConfig};

/// Result type for node execution.
/// Ok(()) means success, Err contains error code and message.
pub type NodeResult = Result<(), (AutomationErrorCode, String)>;

/// Trait for automation nodes that can be executed in the pipeline.
#[async_trait]
pub trait AutomationNode: Send + Sync {
  /// Execute the node with the given context.
  /// Nodes can read from and mutate the context (e.g., set variables, dynamic proxy).
  async fn execute(&self, context: &mut ExecutionContext) -> NodeResult;

  /// Get a human-readable label for this node (for logging).
  fn label(&self) -> &str;

  /// Get the node type name (for logging).
  fn node_type(&self) -> &str;
}

/// Core automation engine that executes a pipeline of nodes sequentially.
pub struct AutomationEngine;

impl AutomationEngine {
  /// Execute a pipeline of nodes sequentially.
  ///
  /// # Arguments
  /// - `stage`: "before_open" or "after_close" (for logging)
  /// - `nodes`: Array of node configs to execute
  /// - `context`: Mutable execution context
  /// - `stop_on_failure`: If true, stop pipeline on first node failure
  ///
  /// # Returns
  /// - Ok(()) if all nodes succeeded (or stop_on_failure=false)
  /// - Err with details of first failure if stop_on_failure=true
  pub async fn run_pipeline(
    stage: &str,
    nodes: &[AutomationNodeConfig],
    context: &mut ExecutionContext,
    stop_on_failure: bool,
  ) -> Result<(), String> {
    log::info!(
      "[AUTOMATION] [{}] Starting pipeline for profile {} ({}) with {} nodes",
      stage,
      context.profile_name,
      context.profile_id,
      nodes.len()
    );

    let mut failed_nodes = Vec::new();

    for (index, node_config) in nodes.iter().enumerate() {
      let node_type = Self::node_type_name(node_config);
      let label = Self::node_label(node_config);

      log::info!(
        "[AUTOMATION] [{}] [{}] Executing node {}/{}: {}",
        stage,
        node_type,
        index + 1,
        nodes.len(),
        label
      );

      // Execute the node with retry logic
      let result = Self::execute_node_with_retry(node_config, context).await;

      match result {
        Ok(()) => {
          log::info!(
            "[AUTOMATION] [{}] [{}] Node {}/{} succeeded: {}",
            stage,
            node_type,
            index + 1,
            nodes.len(),
            label
          );
        }
        Err((error_code, error_msg)) => {
          log::error!(
            "[AUTOMATION] [{}] [{}] Node {}/{} failed: {} - {:?}: {}",
            stage,
            node_type,
            index + 1,
            nodes.len(),
            label,
            error_code,
            error_msg
          );

          failed_nodes.push((index + 1, label.to_string(), error_code, error_msg.clone()));

          if stop_on_failure {
            return Err(format!(
              "Pipeline stopped at node {}/{} ({}): {} - {}",
              index + 1,
              nodes.len(),
              label,
              serde_json::to_string(&error_code).unwrap_or_default(),
              error_msg
            ));
          }
        }
      }
    }

    if failed_nodes.is_empty() {
      log::info!(
        "[AUTOMATION] [{}] Pipeline completed successfully for profile {}",
        stage,
        context.profile_name
      );
      Ok(())
    } else {
      log::warn!(
        "[AUTOMATION] [{}] Pipeline completed with {} failed nodes (stop_on_failure=false)",
        stage,
        failed_nodes.len()
      );
      // When stop_on_failure=false, we continue but report failures
      Ok(())
    }
  }

  /// Execute a node with retry logic and exponential backoff.
  async fn execute_node_with_retry(
    config: &AutomationNodeConfig,
    context: &mut ExecutionContext,
  ) -> NodeResult {
    let (max_attempts, retry_delay_ms, backoff_multiplier) = Self::get_retry_config(config);

    let mut last_error = None;

    for attempt in 1..=max_attempts {
      let result = Self::execute_node(config, context).await;

      match result {
        Ok(()) => return Ok(()),
        Err((code, msg)) => {
          last_error = Some((code, msg.clone()));

          if attempt < max_attempts {
            let delay =
              (retry_delay_ms as f32 * backoff_multiplier.powi(attempt as i32 - 1)) as u64;
            log::warn!(
              "[AUTOMATION] [{}] Attempt {}/{} failed: {}. Retrying in {}ms",
              Self::node_type_name(config),
              attempt,
              max_attempts,
              msg,
              delay
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
          }
        }
      }
    }

    // All attempts failed
    Err(last_error.unwrap())
  }

  /// Get retry configuration from a node config.
  fn get_retry_config(config: &AutomationNodeConfig) -> (u32, u64, f32) {
    match config {
      AutomationNodeConfig::DynamicProxy(c) => {
        (c.max_attempts, c.retry_delay_ms, c.backoff_multiplier)
      }
      AutomationNodeConfig::IpCheck(c) => (c.max_attempts, c.retry_delay_ms, c.backoff_multiplier),
      AutomationNodeConfig::LocalCommand(c) => {
        (c.max_attempts, c.retry_delay_ms, c.backoff_multiplier)
      }
      AutomationNodeConfig::Webhook(c) => (c.max_attempts, c.retry_delay_ms, c.backoff_multiplier),
      AutomationNodeConfig::TelegramAlert(c) => {
        (c.max_attempts, c.retry_delay_ms, c.backoff_multiplier)
      }
      AutomationNodeConfig::Cleanup(_) => (1, 0, 1.0), // No retry for cleanup
    }
  }

  /// Execute a single node based on its config.
  async fn execute_node(
    config: &AutomationNodeConfig,
    context: &mut ExecutionContext,
  ) -> NodeResult {
    match config {
      AutomationNodeConfig::DynamicProxy(c) => {
        let node = DynamicProxyNode::new(c.clone());
        node.execute(context).await
      }
      AutomationNodeConfig::IpCheck(c) => {
        let node = IpCheckNode::new(c.clone());
        node.execute(context).await
      }
      AutomationNodeConfig::LocalCommand(c) => {
        let node = LocalCommandNode::new(c.clone());
        node.execute(context).await
      }
      AutomationNodeConfig::Webhook(c) => {
        let node = WebhookNode::new(c.clone());
        node.execute(context).await
      }
      AutomationNodeConfig::TelegramAlert(c) => {
        let node = TelegramAlertNode::new(c.clone());
        node.execute(context).await
      }
      AutomationNodeConfig::Cleanup(c) => {
        let node = CleanupNode::new(c.clone());
        node.execute(context).await
      }
    }
  }

  /// Get the type name of a node config.
  fn node_type_name(config: &AutomationNodeConfig) -> &'static str {
    match config {
      AutomationNodeConfig::DynamicProxy(_) => "DYNAMIC_PROXY",
      AutomationNodeConfig::IpCheck(_) => "IP_CHECK",
      AutomationNodeConfig::LocalCommand(_) => "LOCAL_COMMAND",
      AutomationNodeConfig::Webhook(_) => "WEBHOOK",
      AutomationNodeConfig::TelegramAlert(_) => "TELEGRAM_ALERT",
      AutomationNodeConfig::Cleanup(_) => "CLEANUP",
    }
  }

  /// Get the label of a node config.
  fn node_label(config: &AutomationNodeConfig) -> &str {
    match config {
      AutomationNodeConfig::DynamicProxy(c) => &c.label,
      AutomationNodeConfig::IpCheck(c) => &c.label,
      AutomationNodeConfig::LocalCommand(c) => &c.label,
      AutomationNodeConfig::Webhook(c) => &c.label,
      AutomationNodeConfig::TelegramAlert(c) => &c.label,
      AutomationNodeConfig::Cleanup(c) => &c.label,
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn test_empty_pipeline() {
    let mut ctx = ExecutionContext::new("test-id".to_string(), "Test".to_string());
    let result = AutomationEngine::run_pipeline("before_open", &[], &mut ctx, true).await;
    assert!(result.is_ok());
  }

  #[tokio::test]
  async fn test_node_type_names() {
    use std::collections::HashMap;
    use types::*;

    let configs = [AutomationNodeConfig::DynamicProxy(DynamicProxyNodeConfig {
      label: "Test".to_string(),
      api_url: "http://test".to_string(),
      headers: HashMap::new(),
      response_format: "json".to_string(),
      json_path_ip: None,
      json_path_port: None,
      json_path_username: None,
      json_path_password: None,
      protocol: "http".to_string(),
      timeout_seconds: 30,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    })];

    assert_eq!(
      AutomationEngine::node_type_name(&configs[0]),
      "DYNAMIC_PROXY"
    );
    assert_eq!(AutomationEngine::node_label(&configs[0]), "Test");
  }
}
