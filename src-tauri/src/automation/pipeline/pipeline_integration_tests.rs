//! Integration tests for the automation pipeline engine.
//!
//! These tests verify the complete pipeline execution flow, including:
//! - Sequential node execution
//! - Error handling and retry logic
//! - stop_on_failure behavior
//! - Context mutation and variable passing
//! - Integration with profile lifecycle

use super::context::ExecutionContext;
use super::types::*;
use super::AutomationEngine;

#[cfg(test)]
mod pipeline_execution_tests {
  use super::*;

  #[tokio::test]
  async fn test_empty_pipeline_succeeds() {
    let mut ctx = ExecutionContext::new("test-id".to_string(), "Test Profile".to_string());
    let result = AutomationEngine::run_pipeline("before_open", &[], &mut ctx, true).await;

    assert!(result.is_ok(), "Empty pipeline should succeed");
  }

  #[tokio::test]
  async fn test_pipeline_with_single_cleanup_node() {
    let mut ctx = ExecutionContext::new("test-id".to_string(), "Test Profile".to_string());

    let nodes = vec![AutomationNodeConfig::Cleanup(CleanupNodeConfig {
      label: "Test Cleanup".to_string(),
      mode: "cookies_and_cache".to_string(),
      exclude_domains: vec![],
    })];

    // This will fail because the profile doesn't exist, but we're testing the pipeline flow
    let result = AutomationEngine::run_pipeline("after_close", &nodes, &mut ctx, false).await;

    // With stop_on_failure=false, pipeline should complete even if node fails
    assert!(
      result.is_ok(),
      "Pipeline should complete with stop_on_failure=false"
    );
  }

  #[tokio::test]
  async fn test_stop_on_failure_true_stops_pipeline() {
    let mut ctx = ExecutionContext::new("test-id".to_string(), "Test Profile".to_string());

    // Create nodes where first one will fail (profile directory doesn't exist in test env)
    let nodes = vec![
      AutomationNodeConfig::Cleanup(CleanupNodeConfig {
        label: "Failing Cleanup".to_string(),
        mode: "cookies_and_cache".to_string(),
        exclude_domains: vec![],
      }),
      AutomationNodeConfig::Cleanup(CleanupNodeConfig {
        label: "Should Not Run".to_string(),
        mode: "full".to_string(),
        exclude_domains: vec![],
      }),
    ];

    let result = AutomationEngine::run_pipeline("after_close", &nodes, &mut ctx, true).await;

    // With stop_on_failure=true, pipeline should stop on first error
    assert!(
      result.is_err(),
      "Pipeline should stop on first failure when stop_on_failure=true"
    );
    let error_msg = result.unwrap_err();
    assert!(
      error_msg.contains("node 1/2"),
      "Error should mention it stopped at first node"
    );
    assert!(
      error_msg.contains("Failing Cleanup"),
      "Error should mention the failing node label"
    );
  }

  #[tokio::test]
  async fn test_stop_on_failure_false_continues_pipeline() {
    let mut ctx = ExecutionContext::new("test-id".to_string(), "Test Profile".to_string());

    // Create nodes where first one fails but second one should still run
    let nodes = vec![
      AutomationNodeConfig::Cleanup(CleanupNodeConfig {
        label: "Invalid Cleanup".to_string(),
        mode: "invalid_mode".to_string(),
        exclude_domains: vec![],
      }),
      AutomationNodeConfig::LocalCommand(LocalCommandNodeConfig {
        label: "Echo Command".to_string(),
        command: "echo test".to_string(),
        working_dir: None,
        env_vars: std::collections::HashMap::new(),
        timeout_seconds: 30,
        max_attempts: 1,
        retry_delay_ms: 1000,
        backoff_multiplier: 2.0,
      }),
    ];

    let result = AutomationEngine::run_pipeline("before_open", &nodes, &mut ctx, false).await;

    // Pipeline should complete even with failures
    assert!(
      result.is_ok(),
      "Pipeline should continue with stop_on_failure=false"
    );
  }
}

#[cfg(test)]
mod profile_automation_helpers_tests {
  use super::*;

  #[test]
  fn test_profile_automation_empty() {
    let automation = ProfileAutomation::empty();

    assert!(
      automation.is_empty(),
      "Empty automation should return true for is_empty()"
    );
    assert_eq!(
      automation.node_count(),
      0,
      "Empty automation should have 0 nodes"
    );
    assert_eq!(automation.before_open.len(), 0);
    assert_eq!(automation.after_close.len(), 0);
  }

  #[test]
  fn test_profile_automation_default() {
    let automation = ProfileAutomation::default();

    assert!(automation.is_empty(), "Default automation should be empty");
    assert_eq!(automation.node_count(), 0);
  }

  #[test]
  fn test_profile_automation_before_open() {
    let nodes = vec![AutomationNodeConfig::LocalCommand(LocalCommandNodeConfig {
      label: "Test".to_string(),
      command: "echo test".to_string(),
      working_dir: None,
      env_vars: std::collections::HashMap::new(),
      timeout_seconds: 30,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    })];

    let automation = ProfileAutomation::before_open(nodes.clone());

    assert!(
      !automation.is_empty(),
      "Automation with nodes should not be empty"
    );
    assert_eq!(automation.node_count(), 1, "Should have 1 node");
    assert_eq!(automation.before_open.len(), 1);
    assert_eq!(automation.after_close.len(), 0);
  }

  #[test]
  fn test_profile_automation_after_close() {
    let nodes = vec![AutomationNodeConfig::Cleanup(CleanupNodeConfig {
      label: "Test Cleanup".to_string(),
      mode: "cookies_and_cache".to_string(),
      exclude_domains: vec![],
    })];

    let automation = ProfileAutomation::after_close(nodes.clone());

    assert!(
      !automation.is_empty(),
      "Automation with nodes should not be empty"
    );
    assert_eq!(automation.node_count(), 1, "Should have 1 node");
    assert_eq!(automation.before_open.len(), 0);
    assert_eq!(automation.after_close.len(), 1);
  }

  #[test]
  fn test_profile_automation_new() {
    let before = vec![AutomationNodeConfig::LocalCommand(LocalCommandNodeConfig {
      label: "Before".to_string(),
      command: "echo before".to_string(),
      working_dir: None,
      env_vars: std::collections::HashMap::new(),
      timeout_seconds: 30,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    })];

    let after = vec![AutomationNodeConfig::Cleanup(CleanupNodeConfig {
      label: "After".to_string(),
      mode: "full".to_string(),
      exclude_domains: vec![],
    })];

    let automation = ProfileAutomation::new(before.clone(), after.clone());

    assert!(
      !automation.is_empty(),
      "Automation with nodes should not be empty"
    );
    assert_eq!(automation.node_count(), 2, "Should have 2 nodes total");
    assert_eq!(automation.before_open.len(), 1);
    assert_eq!(automation.after_close.len(), 1);
  }

  #[test]
  fn test_profile_automation_node_count() {
    let nodes_before = vec![
      AutomationNodeConfig::LocalCommand(LocalCommandNodeConfig {
        label: "Cmd 1".to_string(),
        command: "echo 1".to_string(),
        working_dir: None,
        env_vars: std::collections::HashMap::new(),
        timeout_seconds: 30,
        max_attempts: 3,
        retry_delay_ms: 1000,
        backoff_multiplier: 2.0,
      }),
      AutomationNodeConfig::LocalCommand(LocalCommandNodeConfig {
        label: "Cmd 2".to_string(),
        command: "echo 2".to_string(),
        working_dir: None,
        env_vars: std::collections::HashMap::new(),
        timeout_seconds: 30,
        max_attempts: 3,
        retry_delay_ms: 1000,
        backoff_multiplier: 2.0,
      }),
    ];

    let nodes_after = vec![
      AutomationNodeConfig::Cleanup(CleanupNodeConfig {
        label: "Cleanup 1".to_string(),
        mode: "cookies_and_cache".to_string(),
        exclude_domains: vec![],
      }),
      AutomationNodeConfig::Cleanup(CleanupNodeConfig {
        label: "Cleanup 2".to_string(),
        mode: "full".to_string(),
        exclude_domains: vec![],
      }),
      AutomationNodeConfig::Cleanup(CleanupNodeConfig {
        label: "Cleanup 3".to_string(),
        mode: "cookies_and_cache".to_string(),
        exclude_domains: vec!["example.com".to_string()],
      }),
    ];

    let automation = ProfileAutomation::new(nodes_before, nodes_after);

    assert_eq!(
      automation.node_count(),
      5,
      "Should count all nodes across both stages"
    );
    assert_eq!(automation.before_open.len(), 2);
    assert_eq!(automation.after_close.len(), 3);
  }
}

#[cfg(test)]
mod context_tests {
  use super::*;

  #[test]
  fn test_execution_context_creation() {
    let ctx = ExecutionContext::new("profile-123".to_string(), "My Profile".to_string());

    assert_eq!(ctx.profile_id, "profile-123");
    assert_eq!(ctx.profile_name, "My Profile");
  }

  #[test]
  fn test_execution_context_dynamic_proxy_mutation() {
    let mut ctx = ExecutionContext::new("profile-123".to_string(), "My Profile".to_string());

    assert!(
      ctx.dynamic_proxy.is_none(),
      "Context should start with no dynamic proxy"
    );

    // Simulate a DynamicProxy node setting the proxy
    ctx.dynamic_proxy = Some(super::super::context::ProxySettings {
      protocol: "http".to_string(),
      host: "proxy.example.com".to_string(),
      port: 8080,
      username: Some("user".to_string()),
      password: Some("pass".to_string()),
    });

    assert!(ctx.dynamic_proxy.is_some(), "Dynamic proxy should be set");
    let proxy = ctx.dynamic_proxy.as_ref().unwrap();
    assert_eq!(proxy.host, "proxy.example.com");
    assert_eq!(proxy.port, 8080);
  }
}
