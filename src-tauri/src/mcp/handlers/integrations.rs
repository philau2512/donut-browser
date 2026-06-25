impl McpServer {
  async fn handle_tool_call(
    &self,
    params: Option<serde_json::Value>,
  ) -> Result<serde_json::Value, McpError> {
    let params = params.ok_or_else(|| McpError {
      code: -32602,
      message: "Missing parameters".to_string(),
    })?;

    let tool_name = params
      .get("name")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing tool name".to_string(),
      })?;

    let arguments = params
      .get("arguments")
      .cloned()
      .unwrap_or(serde_json::json!({}));

    // Surface the call in logs so customer reports show which tools the MCP
    // client is actually invoking (and therefore which gate any subsequent
    // error came from). Log only the tool name and the profile_id arg —
    // arbitrary URLs / JS / selectors can be sensitive.
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .unwrap_or("<none>");
    log::info!("[mcp] tools/call name={tool_name} profile_id={profile_id}");

    let started = std::time::Instant::now();
    let result = self.dispatch_tool_call(tool_name, &arguments).await;
    let elapsed_ms = started.elapsed().as_millis();
    match &result {
      Ok(_) => {
        log::info!(
          "[mcp] tools/call name={tool_name} profile_id={profile_id} -> ok ({elapsed_ms} ms)"
        );
      }
      Err(e) => {
        log::warn!(
          "[mcp] tools/call name={tool_name} profile_id={profile_id} -> error code={} msg={:?} ({elapsed_ms} ms)",
          e.code,
          e.message
        );
      }
    }
    result
  }

  async fn dispatch_tool_call(
    &self,
    tool_name: &str,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    match tool_name {
      "list_profiles" => self.handle_list_profiles().await,
      "get_profile" => self.handle_get_profile(arguments).await,
      "run_profile" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_run_profile(arguments).await
      }
      "kill_profile" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_kill_profile(arguments).await
      }
      "batch_run_profiles" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_batch_run_profiles(arguments).await
      }
      "batch_stop_profiles" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_batch_stop_profiles(arguments).await
      }
      "create_profile" => self.handle_create_profile(arguments).await,
      "update_profile" => self.handle_update_profile(arguments).await,
      "delete_profile" => self.handle_delete_profile(arguments).await,
      "list_tags" => self.handle_list_tags().await,
      "list_proxies" => self.handle_list_proxies().await,
      "get_profile_status" => self.handle_get_profile_status(arguments).await,
      // Group management
      "list_groups" => self.handle_list_groups().await,
      "get_group" => self.handle_get_group(arguments).await,
      "create_group" => self.handle_create_group(arguments).await,
      "update_group" => self.handle_update_group(arguments).await,
      "delete_group" => self.handle_delete_group(arguments).await,
      "assign_profiles_to_group" => self.handle_assign_profiles_to_group(arguments).await,
      // Full proxy management
      "get_proxy" => self.handle_get_proxy(arguments).await,
      "create_proxy" => self.handle_create_proxy(arguments).await,
      "update_proxy" => self.handle_update_proxy(arguments).await,
      "delete_proxy" => self.handle_delete_proxy(arguments).await,
      // Proxy import/export
      "export_proxies" => self.handle_export_proxies(arguments).await,
      "import_proxies" => self.handle_import_proxies(arguments).await,
      // VPN management
      "import_vpn" => self.handle_import_vpn(arguments).await,
      "list_vpn_configs" => self.handle_list_vpn_configs().await,
      "delete_vpn" => self.handle_delete_vpn(arguments).await,
      "connect_vpn" => self.handle_connect_vpn(arguments).await,
      "disconnect_vpn" => self.handle_disconnect_vpn(arguments).await,
      "get_vpn_status" => self.handle_get_vpn_status(arguments).await,
      // Fingerprint management — viewing is free everywhere (matches the REST
      // API and the get_profile tool, which already expose the config); only
      // editing requires a paid plan.
      "get_profile_fingerprint" => self.handle_get_profile_fingerprint(arguments).await,
      "update_profile_fingerprint" => {
        Self::require_capability(
          "Fingerprint editing",
          CLOUD_AUTH.can_use_cross_os_fingerprints().await,
        )
        .await?;
        self.handle_update_profile_fingerprint(arguments).await
      }
      "update_profile_proxy_bypass_rules" => {
        self
          .handle_update_profile_proxy_bypass_rules(arguments)
          .await
      }
      // DNS blocklist management
      "update_profile_dns_blocklist" => self.handle_update_profile_dns_blocklist(arguments).await,
      "get_dns_blocklist_status" => self.handle_get_dns_blocklist_status().await,
      // Extension management
      "list_extensions" => self.handle_list_extensions().await,
      "list_extension_groups" => self.handle_list_extension_groups().await,
      "create_extension_group" => self.handle_create_extension_group(arguments).await,
      "delete_extension" => self.handle_delete_extension_mcp(arguments).await,
      "delete_extension_group" => self.handle_delete_extension_group_mcp(arguments).await,
      "assign_extension_group_to_profile" => {
        self
          .handle_assign_extension_group_to_profile(arguments)
          .await
      }
      // Cookie management
      "import_profile_cookies" => self.handle_import_profile_cookies(arguments).await,
      // Team lock tools
      "get_team_locks" => self.handle_get_team_locks().await,
      "get_team_lock_status" => self.handle_get_team_lock_status(arguments).await,
      // Synchronizer tools
      "start_sync_session" => {
        Self::require_capability(
          "Synchronizer",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_start_sync_session(arguments).await
      }
      "stop_sync_session" => self.handle_stop_sync_session(arguments).await,
      "get_sync_sessions" => self.handle_get_sync_sessions().await,
      "remove_sync_follower" => self.handle_remove_sync_follower(arguments).await,
      // Browser interaction tools (require paid subscription)
      "navigate" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_navigate(arguments).await
      }
      "screenshot" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_screenshot(arguments).await
      }
      "evaluate_javascript" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_evaluate_javascript(arguments).await
      }
      "click_element" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_click_element(arguments).await
      }
      "type_text" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_type_text(arguments).await
      }
      "get_page_content" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_get_page_content(arguments).await
      }
      "get_page_info" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_get_page_info(arguments).await
      }
      "get_interactive_elements" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_get_interactive_elements(arguments).await
      }
      "click_by_index" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_click_by_index(arguments).await
      }
      "type_by_index" => {
        Self::require_capability(
          "Browser automation",
          CLOUD_AUTH.can_use_browser_automation().await,
        )
        .await?;
        self.handle_type_by_index(arguments).await
      }
      _ => Err(McpError {
        code: -32602,
        message: format!("Unknown tool: {tool_name}"),
      }),
    }
  }

  async fn handle_list_extensions(&self) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.has_active_paid_subscription().await {
      return Err(McpError {
        code: -32000,
        message: "Extension management requires an active Pro subscription".to_string(),
      });
    }
    let mgr = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let extensions = mgr.list_extensions().map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to list extensions: {e}"),
    })?;
    Ok(serde_json::to_value(extensions).unwrap())
  }

  async fn handle_delete_extension_mcp(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.has_active_paid_subscription().await {
      return Err(McpError {
        code: -32000,
        message: "Extension management requires an active Pro subscription".to_string(),
      });
    }
    let extension_id = arguments
      .get("extension_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing required parameter: extension_id".to_string(),
      })?;
    let mgr = crate::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    mgr
      .delete_extension_internal(extension_id)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to delete extension: {e}"),
      })?;
    Ok(serde_json::json!({"success": true}))
  }

  async fn handle_get_team_locks(&self) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.is_on_team_plan().await {
      return Err(McpError {
        code: -32000,
        message: "Team features require an active team plan".to_string(),
      });
    }
    let locks = crate::team_lock::TEAM_LOCK.get_locks().await;
    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&locks).unwrap_or_default()
      }]
    }))
  }

  async fn handle_get_team_lock_status(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.is_on_team_plan().await {
      return Err(McpError {
        code: -32000,
        message: "Team features require an active team plan".to_string(),
      });
    }
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;
    let lock_status = crate::team_lock::TEAM_LOCK
      .get_lock_status(profile_id)
      .await;
    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&lock_status).unwrap_or_default()
      }]
    }))
  }

  // --- CDP utility methods for browser interaction ---

  async fn get_cdp_port_for_profile(&self, profile: &BrowserProfile) -> Result<u16, McpError> {
    let profiles_dir = ProfileManager::instance().get_profiles_dir();
    let profile_path = profile.get_profile_data_path(&profiles_dir);
    let profile_path_str = profile_path.to_string_lossy();

    // Retry a few times — port info may not be stored yet right after launch
    for attempt in 0..10 {
      if attempt > 0 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
      }
      let port = if profile.browser == "wayfern" {
        crate::browser::wayfern_manager::WayfernManager::instance()
          .get_cdp_port(&profile_path_str)
          .await
      } else if profile.browser == "camoufox" {
        crate::browser::camoufox_manager::CamoufoxManager::instance()
          .get_cdp_port(&profile_path_str)
          .await
      } else {
        None
      };
      if let Some(p) = port {
        return Ok(p);
      }
    }

    Err(McpError {
      code: -32000,
      message: format!(
        "No CDP connection available for profile '{}'. Make sure the browser is running.",
        profile.name
      ),
    })
  }

  async fn get_cdp_ws_url(&self, port: u16) -> Result<String, McpError> {
    let url = format!("http://127.0.0.1:{port}/json");
    let client = reqwest::Client::new();

    // Retry connecting to CDP endpoint (browser may still be starting up)
    let max_attempts = 15;
    let mut last_err = String::new();
    for attempt in 0..max_attempts {
      if attempt > 0 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
      }
      match client
        .get(&url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
      {
        Ok(resp) => match resp.json::<Vec<serde_json::Value>>().await {
          Ok(targets) => {
            if let Some(ws_url) = targets
              .iter()
              .find(|t| t.get("type").and_then(|v| v.as_str()) == Some("page"))
              .and_then(|t| t.get("webSocketDebuggerUrl"))
              .and_then(|v| v.as_str())
            {
              return Ok(ws_url.to_string());
            }
            last_err = "No page target found in browser".to_string();
          }
          Err(e) => {
            last_err = format!("Failed to parse CDP targets: {e}");
          }
        },
        Err(e) => {
          last_err = format!("Failed to connect to browser CDP endpoint: {e}");
        }
      }
    }

    Err(McpError {
      code: -32000,
      message: last_err,
    })
  }

  async fn send_cdp(
    &self,
    ws_url: &str,
    method: &str,
    params: serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {

    let (mut ws_stream, _) = connect_async(ws_url).await.map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to connect to CDP WebSocket: {e}"),
    })?;

    let command = serde_json::json!({
      "id": 1,
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

    while let Some(msg) = ws_stream.next().await {
      let msg = msg.map_err(|e| McpError {
        code: -32000,
        message: format!("CDP WebSocket error: {e}"),
      })?;
      if let Message::Text(text) = msg {
        let response: serde_json::Value =
          serde_json::from_str(text.as_str()).map_err(|e| McpError {
            code: -32000,
            message: format!("Failed to parse CDP response: {e}"),
          })?;
        if response.get("id") == Some(&serde_json::json!(1)) {
          if let Some(error) = response.get("error") {
            return Err(McpError {
              code: -32000,
              message: format!("CDP error: {error}"),
            });
          }
          return Ok(
            response
              .get("result")
              .cloned()
              .unwrap_or(serde_json::json!({})),
          );
        }
      }
    }

    Err(McpError {
      code: -32000,
      message: "No response received from CDP".to_string(),
    })
  }

  async fn send_human_keystrokes(
    &self,
    ws_url: &str,
    text: &str,
    wpm: Option<f64>,
  ) -> Result<(), McpError> {

    let events = MarkovTyper::new(text, wpm).run();

    let (mut ws_stream, _) = connect_async(ws_url).await.map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to connect to CDP WebSocket: {e}"),
    })?;

    let mut cmd_id = 1u64;
    let mut last_time = 0.0;

    for event in &events {
      let delay = event.time - last_time;
      if delay > 0.0 {
        tokio::time::sleep(std::time::Duration::from_secs_f64(delay)).await;
      }
      last_time = event.time;

      match &event.action {
        TypingAction::Char(ch) => {
          let text_str = ch.to_string();
          // keyDown
          let down = serde_json::json!({
            "id": cmd_id,
            "method": "Input.dispatchKeyEvent",
            "params": {
              "type": "keyDown",
              "text": text_str,
              "key": text_str,
              "unmodifiedText": text_str,
            }
          });
          cmd_id += 1;
          ws_stream
            .send(Message::Text(down.to_string().into()))
            .await
            .map_err(|e| McpError {
              code: -32000,
              message: format!("Failed to send key event: {e}"),
            })?;
          // Drain response
          let _ = ws_stream.next().await;

          // keyUp
          let up = serde_json::json!({
            "id": cmd_id,
            "method": "Input.dispatchKeyEvent",
            "params": {
              "type": "keyUp",
              "key": text_str,
            }
          });
          cmd_id += 1;
          ws_stream
            .send(Message::Text(up.to_string().into()))
            .await
            .map_err(|e| McpError {
              code: -32000,
              message: format!("Failed to send key event: {e}"),
            })?;
          let _ = ws_stream.next().await;
        }
        TypingAction::Backspace => {
          let down = serde_json::json!({
            "id": cmd_id,
            "method": "Input.dispatchKeyEvent",
            "params": {
              "type": "keyDown",
              "key": "Backspace",
              "code": "Backspace",
              "windowsVirtualKeyCode": 8,
              "nativeVirtualKeyCode": 8,
            }
          });
          cmd_id += 1;
          ws_stream
            .send(Message::Text(down.to_string().into()))
            .await
            .map_err(|e| McpError {
              code: -32000,
              message: format!("Failed to send key event: {e}"),
            })?;
          let _ = ws_stream.next().await;

          let up = serde_json::json!({
            "id": cmd_id,
            "method": "Input.dispatchKeyEvent",
            "params": {
              "type": "keyUp",
              "key": "Backspace",
              "code": "Backspace",
              "windowsVirtualKeyCode": 8,
              "nativeVirtualKeyCode": 8,
            }
          });
          cmd_id += 1;
          ws_stream
            .send(Message::Text(up.to_string().into()))
            .await
            .map_err(|e| McpError {
              code: -32000,
              message: format!("Failed to send key event: {e}"),
            })?;
          let _ = ws_stream.next().await;
        }
      }
    }

    Ok(())
  }

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

    let info = crate::synchronizer::SynchronizerManager::instance()
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

    crate::synchronizer::SynchronizerManager::instance()
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
    let sessions = crate::synchronizer::SynchronizerManager::instance()
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

    crate::synchronizer::SynchronizerManager::instance()
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
