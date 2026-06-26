impl McpServer {
  /// Send a CDP command and wait for the page to finish loading.
  /// Uses a single WebSocket connection to: enable Page events, send the command,
  /// wait for the command response, then wait for `Page.loadEventFired`.
  async fn send_cdp_and_wait_for_load(
    &self,
    ws_url: &str,
    method: &str,
    params: serde_json::Value,
    timeout_secs: u64,
  ) -> Result<serde_json::Value, McpError> {

    let (mut ws_stream, _) = connect_async(ws_url).await.map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to connect to CDP WebSocket: {e}"),
    })?;

    // Enable Page domain events so we receive loadEventFired
    let enable_cmd = serde_json::json!({
      "id": 1,
      "method": "Page.enable",
      "params": {}
    });
    ws_stream
      .send(Message::Text(enable_cmd.to_string().into()))
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to send Page.enable: {e}"),
      })?;

    // Wait for Page.enable response
    loop {
      let msg = ws_stream
        .next()
        .await
        .ok_or_else(|| McpError {
          code: -32000,
          message: "WebSocket closed waiting for Page.enable response".to_string(),
        })?
        .map_err(|e| McpError {
          code: -32000,
          message: format!("CDP WebSocket error: {e}"),
        })?;
      if let Message::Text(text) = msg {
        let resp: serde_json::Value = serde_json::from_str(text.as_str()).unwrap_or_default();
        if resp.get("id") == Some(&serde_json::json!(1)) {
          break;
        }
      }
    }

    // Send the actual command (e.g., Page.navigate)
    let command = serde_json::json!({
      "id": 2,
      "method": method,
      "params": params
    });
    ws_stream
      .send(Message::Text(command.to_string().into()))
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to send CDP command: {e}"),
      })?;

    // Wait for command response and then for Page.loadEventFired
    let mut command_result = None;
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout_secs);

    loop {
      let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
      if remaining.is_zero() {
        // Timed out waiting for load — return the command result if we have it
        break;
      }

      let msg = match tokio::time::timeout(remaining, ws_stream.next()).await {
        Ok(Some(Ok(msg))) => msg,
        Ok(Some(Err(e))) => {
          return Err(McpError {
            code: -32000,
            message: format!("CDP WebSocket error: {e}"),
          });
        }
        Ok(None) => break, // stream ended
        Err(_) => break,   // timeout
      };

      if let Message::Text(text) = msg {
        let response: serde_json::Value = serde_json::from_str(text.as_str()).unwrap_or_default();

        // Check for command response
        if response.get("id") == Some(&serde_json::json!(2)) {
          if let Some(error) = response.get("error") {
            return Err(McpError {
              code: -32000,
              message: format!("CDP error: {error}"),
            });
          }
          command_result = Some(
            response
              .get("result")
              .cloned()
              .unwrap_or(serde_json::json!({})),
          );
        }

        // Check for Page.loadEventFired — page is fully loaded
        if response.get("method") == Some(&serde_json::json!("Page.loadEventFired")) {
          break;
        }
      }
    }

    // Disable Page domain events
    let disable_cmd = serde_json::json!({
      "id": 3,
      "method": "Page.disable",
      "params": {}
    });
    let _ = ws_stream
      .send(Message::Text(disable_cmd.to_string().into()))
      .await;

    command_result.ok_or_else(|| McpError {
      code: -32000,
      message: "No response received from CDP".to_string(),
    })
  }

  fn get_running_profile(&self, profile_id: &str) -> Result<BrowserProfile, McpError> {
    let profiles = ProfileManager::instance()
      .list_profiles()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
      })?;

    let profile = profiles
      .into_iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| McpError {
        code: -32000,
        message: format!("Profile not found: {profile_id}"),
      })?;

    if profile.browser != "wayfern" && profile.browser != "camoufox" {
      return Err(McpError {
        code: -32000,
        message: "MCP only supports Wayfern and Camoufox profiles".to_string(),
      });
    }

    if profile.process_id.is_none() {
      return Err(McpError {
        code: -32000,
        message: format!("Profile '{}' is not running", profile.name),
      });
    }

    Ok(profile)
  }

  // --- Browser interaction handlers ---

  async fn handle_start_sync_session(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let leader_id = arguments
      .get("leader_profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing leader_profile_id".to_string(),
      })?;
    let follower_ids: Vec<String> = arguments
      .get("follower_profile_ids")
      .and_then(|v| v.as_array())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing follower_profile_ids".to_string(),
      })?
      .iter()
      .filter_map(|v| v.as_str().map(|s| s.to_string()))
      .collect();

    let app = {
      let inner = self.inner.lock().await;
      inner.app_handle.clone().ok_or_else(|| McpError {
        code: -32000,
        message: "MCP server not properly initialized".to_string(),
      })?
    };

    let info = crate::sync::synchronizer::SynchronizerManager::instance()
      .start_session(app, leader_id.to_string(), follower_ids)
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: e,
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&info).unwrap_or_default()
      }]
    }))
  }

  async fn handle_stop_sync_session(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let session_id = arguments
      .get("session_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing session_id".to_string(),
      })?;

    let app = {
      let inner = self.inner.lock().await;
      inner.app_handle.clone().ok_or_else(|| McpError {
        code: -32000,
        message: "MCP server not properly initialized".to_string(),
      })?
    };

    crate::sync::synchronizer::SynchronizerManager::instance()
      .stop_session(app, session_id)
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: e,
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": "Sync session stopped"
      }]
    }))
  }

  async fn handle_get_sync_sessions(&self) -> Result<serde_json::Value, McpError> {
    let sessions = crate::sync::synchronizer::SynchronizerManager::instance()
      .get_sessions()
      .await;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&sessions).unwrap_or_default()
      }]
    }))
  }

  async fn handle_remove_sync_follower(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let session_id = arguments
      .get("session_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing session_id".to_string(),
      })?;
    let follower_id = arguments
      .get("follower_profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing follower_profile_id".to_string(),
      })?;

    let app = {
      let inner = self.inner.lock().await;
      inner.app_handle.clone().ok_or_else(|| McpError {
        code: -32000,
        message: "MCP server not properly initialized".to_string(),
      })?
    };

    crate::sync::synchronizer::SynchronizerManager::instance()
      .remove_follower(app, session_id, follower_id)
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: e,
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": "Follower removed from sync session"
      }]
    }))
  }
}

lazy_static::lazy_static! {
  static ref MCP_SERVER: McpServer = McpServer::new();
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_mcp_tools_count() {
    let server = McpServer::new();
    let tools = server.get_tools();

    // Should have at least 41 tools (34 + 7 browser interaction tools)
    assert!(tools.len() >= 41);

    // Check tool names
    let tool_names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
    // Profile tools
    assert!(tool_names.contains(&"list_profiles"));
    assert!(tool_names.contains(&"get_profile"));
    assert!(tool_names.contains(&"run_profile"));
    assert!(tool_names.contains(&"kill_profile"));
    assert!(tool_names.contains(&"get_profile_status"));
    // Group tools
    assert!(tool_names.contains(&"list_groups"));
    assert!(tool_names.contains(&"get_group"));
    assert!(tool_names.contains(&"create_group"));
    assert!(tool_names.contains(&"update_group"));
    assert!(tool_names.contains(&"delete_group"));
    assert!(tool_names.contains(&"assign_profiles_to_group"));
    // Proxy tools
    assert!(tool_names.contains(&"list_proxies"));
    assert!(tool_names.contains(&"get_proxy"));
    assert!(tool_names.contains(&"create_proxy"));
    assert!(tool_names.contains(&"update_proxy"));
    assert!(tool_names.contains(&"delete_proxy"));
    // Proxy import/export tools
    assert!(tool_names.contains(&"export_proxies"));
    assert!(tool_names.contains(&"import_proxies"));
    // VPN tools
    assert!(tool_names.contains(&"import_vpn"));
    assert!(tool_names.contains(&"list_vpn_configs"));
    assert!(tool_names.contains(&"delete_vpn"));
    assert!(tool_names.contains(&"connect_vpn"));
    assert!(tool_names.contains(&"disconnect_vpn"));
    assert!(tool_names.contains(&"get_vpn_status"));
    // Fingerprint tools
    assert!(tool_names.contains(&"get_profile_fingerprint"));
    assert!(tool_names.contains(&"update_profile_fingerprint"));
    assert!(tool_names.contains(&"update_profile_proxy_bypass_rules"));
    // Extension tools
    assert!(tool_names.contains(&"list_extensions"));
    assert!(tool_names.contains(&"list_extension_groups"));
    assert!(tool_names.contains(&"create_extension_group"));
    assert!(tool_names.contains(&"delete_extension"));
    assert!(tool_names.contains(&"delete_extension_group"));
    assert!(tool_names.contains(&"assign_extension_group_to_profile"));
    // Cookie tools
    assert!(tool_names.contains(&"import_profile_cookies"));
    // Team lock tools
    assert!(tool_names.contains(&"get_team_locks"));
    assert!(tool_names.contains(&"get_team_lock_status"));
    // Synchronizer tools
    assert!(tool_names.contains(&"start_sync_session"));
    assert!(tool_names.contains(&"stop_sync_session"));
    assert!(tool_names.contains(&"get_sync_sessions"));
    assert!(tool_names.contains(&"remove_sync_follower"));
    // Browser interaction tools
    assert!(tool_names.contains(&"navigate"));
    assert!(tool_names.contains(&"screenshot"));
    assert!(tool_names.contains(&"evaluate_javascript"));
    assert!(tool_names.contains(&"click_element"));
    assert!(tool_names.contains(&"type_text"));
    assert!(tool_names.contains(&"get_page_content"));
    assert!(tool_names.contains(&"get_page_info"));
  }

  #[test]
  fn test_mcp_server_initial_state() {
    let server = McpServer::new();
    assert!(!server.is_running());
  }
}
