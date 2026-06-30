use crate::automation::pipeline::context::ExecutionContext;
use crate::automation::pipeline::types::{AutomationErrorCode, LocalCommandNodeConfig};
use crate::automation::pipeline::{AutomationNode, NodeResult};
use async_trait::async_trait;
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

pub struct LocalCommandNode {
  config: LocalCommandNodeConfig,
}

impl LocalCommandNode {
  pub fn new(config: LocalCommandNodeConfig) -> Self {
    Self { config }
  }

  /// Execute a shell command with timeout
  async fn execute_command(
    &self,
    command: &str,
    working_dir: Option<&str>,
    env_vars: &std::collections::HashMap<String, String>,
    timeout_seconds: u64,
  ) -> Result<String, (AutomationErrorCode, String)> {
    log::info!(
      "[AUTOMATION] [LOCAL_COMMAND] Executing command: {}",
      command
    );

    // Determine shell based on platform
    let (shell, shell_arg) = if cfg!(target_os = "windows") {
      ("powershell.exe", "-Command")
    } else {
      ("sh", "-c")
    };

    let mut cmd = Command::new(shell);
    cmd.arg(shell_arg).arg(command);

    // Set working directory if specified
    if let Some(dir) = working_dir {
      cmd.current_dir(dir);
      log::debug!("[AUTOMATION] [LOCAL_COMMAND] Working directory: {}", dir);
    }

    // Set environment variables
    for (key, value) in env_vars {
      cmd.env(key, value);
    }

    // Capture output
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // Spawn the process
    let child = cmd.spawn().map_err(|e| {
      if e.kind() == std::io::ErrorKind::NotFound {
        (
          AutomationErrorCode::CommandNotFound,
          format!("Command not found: {}", e),
        )
      } else if e.kind() == std::io::ErrorKind::PermissionDenied {
        (
          AutomationErrorCode::CommandPermissionDenied,
          format!("Permission denied: {}", e),
        )
      } else {
        (
          AutomationErrorCode::CommandExitCodeError,
          format!("Failed to spawn command: {}", e),
        )
      }
    })?;

    // Wait for completion with timeout
    let output_future = child.wait_with_output();
    let output = timeout(Duration::from_secs(timeout_seconds), output_future)
      .await
      .map_err(|_| {
        (
          AutomationErrorCode::CommandTimeout,
          format!("Command timed out after {} seconds", timeout_seconds),
        )
      })?
      .map_err(|e| {
        (
          AutomationErrorCode::CommandExitCodeError,
          format!("Failed to wait for command: {}", e),
        )
      })?;

    // Check exit status
    if !output.status.success() {
      let exit_code = output.status.code().unwrap_or(-1);
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err((
        AutomationErrorCode::CommandExitCodeError,
        format!("Command failed with exit code {}: {}", exit_code, stderr),
      ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    log::info!(
      "[AUTOMATION] [LOCAL_COMMAND] Command completed successfully (output length: {} bytes)",
      stdout.len()
    );

    Ok(stdout)
  }
}

#[async_trait]
impl AutomationNode for LocalCommandNode {
  async fn execute(&self, context: &mut ExecutionContext) -> NodeResult {
    log::info!(
      "[AUTOMATION] [LOCAL_COMMAND] Executing: {}",
      self.config.label
    );

    // Interpolate command
    let command = context.interpolate(&self.config.command).map_err(|e| {
      (
        AutomationErrorCode::VariableNotAvailable,
        format!("Variable interpolation failed in command: {}", e),
      )
    })?;

    // Interpolate working directory if present
    let working_dir = if let Some(ref dir) = self.config.working_dir {
      Some(context.interpolate(dir).map_err(|e| {
        (
          AutomationErrorCode::VariableNotAvailable,
          format!("Variable interpolation failed in working_dir: {}", e),
        )
      })?)
    } else {
      None
    };

    // Interpolate environment variables
    let mut env_vars = std::collections::HashMap::new();
    for (key, value) in &self.config.env_vars {
      let interpolated_value = context.interpolate(value).map_err(|e| {
        (
          AutomationErrorCode::VariableNotAvailable,
          format!("Variable interpolation failed in env var '{}': {}", key, e),
        )
      })?;
      env_vars.insert(key.clone(), interpolated_value);
    }

    // Execute command
    let _output = self
      .execute_command(
        &command,
        working_dir.as_deref(),
        &env_vars,
        self.config.timeout_seconds,
      )
      .await?;

    Ok(())
  }

  fn label(&self) -> &str {
    &self.config.label
  }

  fn node_type(&self) -> &str {
    "LOCAL_COMMAND"
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::HashMap;

  #[test]
  fn test_node_creation() {
    let config = LocalCommandNodeConfig {
      label: "Test Command".to_string(),
      command: "echo hello".to_string(),
      working_dir: None,
      env_vars: HashMap::new(),
      timeout_seconds: 300,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    };

    let node = LocalCommandNode::new(config);
    assert_eq!(node.label(), "Test Command");
    assert_eq!(node.node_type(), "LOCAL_COMMAND");
  }

  #[tokio::test]
  async fn test_simple_command() {
    let config = LocalCommandNodeConfig {
      label: "Test".to_string(),
      command: if cfg!(target_os = "windows") {
        "Write-Output 'test'".to_string()
      } else {
        "echo test".to_string()
      },
      working_dir: None,
      env_vars: HashMap::new(),
      timeout_seconds: 10,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = LocalCommandNode::new(config);
    let mut ctx = ExecutionContext::new("test-id".to_string(), "TestProfile".to_string());

    let result = node.execute(&mut ctx).await;
    assert!(result.is_ok());
  }

  #[tokio::test]
  async fn test_command_with_interpolation() {
    let config = LocalCommandNodeConfig {
      label: "Test".to_string(),
      command: if cfg!(target_os = "windows") {
        "Write-Output '{{profile_name}}'".to_string()
      } else {
        "echo {{profile_name}}".to_string()
      },
      working_dir: None,
      env_vars: HashMap::new(),
      timeout_seconds: 10,
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = LocalCommandNode::new(config);
    let mut ctx = ExecutionContext::new("test-id".to_string(), "MyProfile".to_string());

    let result = node.execute(&mut ctx).await;
    assert!(result.is_ok());
  }

  #[tokio::test]
  async fn test_command_timeout() {
    let config = LocalCommandNodeConfig {
      label: "Test".to_string(),
      command: if cfg!(target_os = "windows") {
        "Start-Sleep -Seconds 10".to_string()
      } else {
        "sleep 10".to_string()
      },
      working_dir: None,
      env_vars: HashMap::new(),
      timeout_seconds: 1, // 1 second timeout for 10 second sleep
      max_attempts: 1,
      retry_delay_ms: 1000,
      backoff_multiplier: 1.0,
    };

    let node = LocalCommandNode::new(config);
    let mut ctx = ExecutionContext::new("test-id".to_string(), "TestProfile".to_string());

    let result = node.execute(&mut ctx).await;
    assert!(result.is_err());
    let (code, _) = result.unwrap_err();
    assert!(matches!(code, AutomationErrorCode::CommandTimeout));
  }
}
