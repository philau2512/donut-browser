impl McpServer {
  async fn handle_list_proxies(&self) -> Result<serde_json::Value, McpError> {
    let proxies = PROXY_MANAGER.get_stored_proxies();

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&proxies).unwrap_or_default()
      }]
    }))
  }

  async fn handle_list_groups(&self) -> Result<serde_json::Value, McpError> {
    let groups = GROUP_MANAGER
      .lock()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to lock group manager: {e}"),
      })?
      .get_all_groups()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list groups: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&groups).unwrap_or_default()
      }]
    }))
  }

  async fn handle_get_group(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let group_id = arguments
      .get("group_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing group_id".to_string(),
      })?;

    let groups = GROUP_MANAGER
      .lock()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to lock group manager: {e}"),
      })?
      .get_all_groups()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list groups: {e}"),
      })?;

    let group = groups
      .iter()
      .find(|g| g.id == group_id)
      .ok_or_else(|| McpError {
        code: -32000,
        message: format!("Group not found: {group_id}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&group).unwrap_or_default()
      }]
    }))
  }

  async fn handle_create_group(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let name = arguments
      .get("name")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing name".to_string(),
      })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    let group = GROUP_MANAGER
      .lock()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to lock group manager: {e}"),
      })?
      .create_group(app_handle, name.to_string())
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to create group: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Group '{}' created successfully with ID: {}", group.name, group.id)
      }]
    }))
  }

  async fn handle_update_group(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let group_id = arguments
      .get("group_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing group_id".to_string(),
      })?;

    let name = arguments
      .get("name")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing name".to_string(),
      })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    let group = GROUP_MANAGER
      .lock()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to lock group manager: {e}"),
      })?
      .update_group(app_handle, group_id.to_string(), name.to_string())
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to update group: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Group '{}' updated successfully", group.name)
      }]
    }))
  }

  async fn handle_delete_group(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let group_id = arguments
      .get("group_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing group_id".to_string(),
      })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    GROUP_MANAGER
      .lock()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to lock group manager: {e}"),
      })?
      .delete_group(app_handle, group_id.to_string())
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to delete group: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Group '{}' deleted successfully", group_id)
      }]
    }))
  }

  async fn handle_assign_profiles_to_group(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let profile_ids: Vec<String> = arguments
      .get("profile_ids")
      .and_then(|v| v.as_array())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_ids".to_string(),
      })?
      .iter()
      .filter_map(|v| v.as_str().map(|s| s.to_string()))
      .collect();

    let group_id = arguments
      .get("group_id")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    ProfileManager::instance()
      .assign_profiles_to_group(app_handle, profile_ids.clone(), group_id.clone())
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to assign profiles to group: {e}"),
      })?;

    let group_name = group_id.as_deref().unwrap_or("default");
    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("{} profile(s) assigned to group '{}'", profile_ids.len(), group_name)
      }]
    }))
  }

  // Full proxy management handlers
  async fn handle_get_proxy(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let proxy_id = arguments
      .get("proxy_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing proxy_id".to_string(),
      })?;

    let proxies = PROXY_MANAGER.get_stored_proxies();
    let proxy = proxies
      .iter()
      .find(|p| p.id == proxy_id)
      .ok_or_else(|| McpError {
        code: -32000,
        message: format!("Proxy not found: {proxy_id}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&proxy).unwrap_or_default()
      }]
    }))
  }

  async fn handle_create_proxy(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let name = arguments
      .get("name")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing name".to_string(),
      })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    let proxy_type = arguments
      .get("proxy_type")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing proxy_type".to_string(),
      })?;

    // The tool schema declares an enum, but JSON-Schema enums are advisory only;
    // enforce it here so a bad value can't produce a non-functional proxy.
    if !matches!(proxy_type, "http" | "https" | "socks4" | "socks5") {
      return Err(McpError {
        code: -32602,
        message: "proxy_type must be one of: http, https, socks4, socks5".to_string(),
      });
    }

    let host = arguments
      .get("host")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing host".to_string(),
      })?;

    let port = arguments
      .get("port")
      .and_then(|v| v.as_u64())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing port".to_string(),
      })? as u16;

    let username = arguments
      .get("username")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());
    let password = arguments
      .get("password")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());

    let proxy_settings = ProxySettings {
      proxy_type: proxy_type.to_string(),
      host: host.to_string(),
      port,
      username,
      password,
    };

    let proxy = PROXY_MANAGER
      .create_stored_proxy(app_handle, name.to_string(), proxy_settings)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to create proxy: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Proxy '{}' created successfully with ID: {}", proxy.name, proxy.id)
      }]
    }))
  }

  async fn handle_update_proxy(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let proxy_id = arguments
      .get("proxy_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing proxy_id".to_string(),
      })?;

    let name = arguments
      .get("name")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());

    // Build proxy_settings if any settings fields are provided
    let has_settings = arguments.get("proxy_type").is_some()
      || arguments.get("host").is_some()
      || arguments.get("port").is_some();

    let proxy_settings = if has_settings {
      // Get existing proxy to use as defaults
      let proxies = PROXY_MANAGER.get_stored_proxies();
      let existing = proxies
        .iter()
        .find(|p| p.id == proxy_id)
        .ok_or_else(|| McpError {
          code: -32000,
          message: format!("Proxy not found: {proxy_id}"),
        })?;

      let proxy_type = arguments
        .get("proxy_type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| existing.proxy_settings.proxy_type.clone());

      let host = arguments
        .get("host")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| existing.proxy_settings.host.clone());

      let port = arguments
        .get("port")
        .and_then(|v| v.as_u64())
        .map(|p| p as u16)
        .unwrap_or(existing.proxy_settings.port);

      let username = arguments
        .get("username")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| existing.proxy_settings.username.clone());

      let password = arguments
        .get("password")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| existing.proxy_settings.password.clone());

      Some(ProxySettings {
        proxy_type,
        host,
        port,
        username,
        password,
      })
    } else {
      None
    };

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    let proxy = PROXY_MANAGER
      .update_stored_proxy(app_handle, proxy_id, name, proxy_settings)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to update proxy: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Proxy '{}' updated successfully", proxy.name)
      }]
    }))
  }

  async fn handle_delete_proxy(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let proxy_id = arguments
      .get("proxy_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing proxy_id".to_string(),
      })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    PROXY_MANAGER
      .delete_stored_proxy(app_handle, proxy_id)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to delete proxy: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Proxy '{}' deleted successfully", proxy_id)
      }]
    }))
  }

  async fn handle_export_proxies(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let format = arguments
      .get("format")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing format".to_string(),
      })?;

    let content = match format {
      "json" => PROXY_MANAGER.export_proxies_json().map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to export proxies: {e}"),
      })?,
      "txt" => PROXY_MANAGER.export_proxies_txt(),
      _ => {
        return Err(McpError {
          code: -32602,
          message: format!("Invalid format '{}', must be 'json' or 'txt'", format),
        })
      }
    };

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": content
      }]
    }))
  }

  async fn handle_import_proxies(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let content = arguments
      .get("content")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing content".to_string(),
      })?;

    let format = arguments
      .get("format")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing format".to_string(),
      })?;

    let name_prefix = arguments
      .get("name_prefix")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    let result = match format {
      "json" => PROXY_MANAGER
        .import_proxies_json(app_handle, content)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to import proxies: {e}"),
        })?,
      "txt" => {

        let parse_results = ProxyManager::parse_txt_proxies(content);
        let parsed: Vec<_> = parse_results
          .into_iter()
          .filter_map(|r| {
            if let ProxyParseResult::Parsed(p) = r {
              Some(p)
            } else {
              None
            }
          })
          .collect();

        if parsed.is_empty() {
          return Err(McpError {
            code: -32000,
            message: "No valid proxies found in content".to_string(),
          });
        }

        PROXY_MANAGER
          .import_proxies_from_parsed(app_handle, parsed, name_prefix)
          .map_err(|e| McpError {
            code: -32000,
            message: format!("Failed to import proxies: {e}"),
          })?
      }
      _ => {
        return Err(McpError {
          code: -32602,
          message: format!("Invalid format '{}', must be 'json' or 'txt'", format),
        })
      }
    };

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!(
          "Import complete: {} imported, {} skipped, {} errors",
          result.imported_count,
          result.skipped_count,
          result.errors.len()
        )
      }]
    }))
  }

  // Cookie management handlers
  async fn handle_import_vpn(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let content = arguments
      .get("content")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing content".to_string(),
      })?;

    let filename = arguments
      .get("filename")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing filename".to_string(),
      })?;

    let name = arguments
      .get("name")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());

    let storage = crate::vpn::VPN_STORAGE.lock().map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to lock VPN storage: {e}"),
    })?;

    let config = storage
      .import_config(content, filename, name)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to import VPN config: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!(
          "VPN '{}' ({}) imported successfully with ID: {}",
          config.name,
          config.vpn_type,
          config.id
        )
      }]
    }))
  }

  async fn handle_list_vpn_configs(&self) -> Result<serde_json::Value, McpError> {
    let storage = crate::vpn::VPN_STORAGE.lock().map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to lock VPN storage: {e}"),
    })?;

    let configs = storage.list_configs().map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to list VPN configs: {e}"),
    })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&configs).unwrap_or_default()
      }]
    }))
  }

  async fn handle_delete_vpn(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let vpn_id = arguments
      .get("vpn_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing vpn_id".to_string(),
      })?;

    // First disconnect if connected (stop VPN worker)
    let _ = crate::vpn::vpn_worker_runner::stop_vpn_worker_by_vpn_id(vpn_id).await;

    let storage = crate::vpn::VPN_STORAGE.lock().map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to lock VPN storage: {e}"),
    })?;

    storage.delete_config(vpn_id).map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to delete VPN config: {e}"),
    })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("VPN '{}' deleted successfully", vpn_id)
      }]
    }))
  }

  async fn handle_connect_vpn(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let vpn_id = arguments
      .get("vpn_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing vpn_id".to_string(),
      })?;

    // Start VPN worker process
    crate::vpn::vpn_worker_runner::start_vpn_worker(vpn_id)
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to connect VPN: {e}"),
      })?;

    // Update last_used timestamp
    {
      let storage = crate::vpn::VPN_STORAGE.lock().map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to lock VPN storage: {e}"),
      })?;
      let _ = storage.update_last_used(vpn_id);
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("VPN '{}' connected successfully", vpn_id)
      }]
    }))
  }

  async fn handle_disconnect_vpn(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let vpn_id = arguments
      .get("vpn_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing vpn_id".to_string(),
      })?;

    crate::vpn::vpn_worker_runner::stop_vpn_worker_by_vpn_id(vpn_id)
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to disconnect VPN: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("VPN '{}' disconnected successfully", vpn_id)
      }]
    }))
  }

  async fn handle_get_vpn_status(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let vpn_id = arguments
      .get("vpn_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing vpn_id".to_string(),
      })?;

    let connected =
      if let Some(worker) = crate::vpn::vpn_worker_storage::find_vpn_worker_by_vpn_id(vpn_id) {
        worker
          .pid
          .map(crate::proxy::proxy_storage::is_process_running)
          .unwrap_or(false)
      } else {
        false
      };

    let status = crate::vpn::VpnStatus {
      connected,
      vpn_id: vpn_id.to_string(),
      connected_at: None,
      bytes_sent: None,
      bytes_received: None,
      last_handshake: None,
    };

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&status).unwrap_or_default()
      }]
    }))
  }

  // Fingerprint management handlers
  async fn handle_list_extension_groups(&self) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.has_active_paid_subscription().await {
      return Err(McpError {
        code: -32000,
        message: "Extension management requires an active Pro subscription".to_string(),
      });
    }
    let mgr = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let groups = mgr.list_groups().map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to list extension groups: {e}"),
    })?;
    Ok(serde_json::to_value(groups).unwrap())
  }

  async fn handle_create_extension_group(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.has_active_paid_subscription().await {
      return Err(McpError {
        code: -32000,
        message: "Extension management requires an active Pro subscription".to_string(),
      });
    }
    let name = arguments
      .get("name")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing required parameter: name".to_string(),
      })?;
    let mgr = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    let group = mgr.create_group(name.to_string()).map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to create extension group: {e}"),
    })?;
    Ok(serde_json::to_value(group).unwrap())
  }

  async fn handle_delete_extension_group_mcp(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.has_active_paid_subscription().await {
      return Err(McpError {
        code: -32000,
        message: "Extension management requires an active Pro subscription".to_string(),
      });
    }
    let group_id = arguments
      .get("group_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing required parameter: group_id".to_string(),
      })?;
    let mgr = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
    // For MCP, we don't have an app_handle, but we need one for sync deletion.
    // Use the delete_group_internal which skips sync remote deletion.
    mgr.delete_group_internal(group_id).map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to delete extension group: {e}"),
    })?;
    if let Err(e) = crate::events::emit_empty("extensions-changed") {
      log::error!("Failed to emit extensions-changed event: {e}");
    }
    Ok(serde_json::json!({"success": true}))
  }

  async fn handle_assign_extension_group_to_profile(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.has_active_paid_subscription().await {
      return Err(McpError {
        code: -32000,
        message: "Extension management requires an active Pro subscription".to_string(),
      });
    }
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing required parameter: profile_id".to_string(),
      })?;
    let extension_group_id = arguments
      .get("extension_group_id")
      .and_then(|v| v.as_str())
      .map(|s| {
        if s.is_empty() {
          None
        } else {
          Some(s.to_string())
        }
      })
      .unwrap_or(None);

    // Validate compatibility if assigning
    if let Some(ref gid) = extension_group_id {
      let profile_manager = ProfileManager::instance();
      let profiles = profile_manager.list_profiles().map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
      })?;
      let profile = profiles
        .iter()
        .find(|p| p.id.to_string() == profile_id)
        .ok_or_else(|| McpError {
          code: -32000,
          message: format!("Profile '{profile_id}' not found"),
        })?;
      let mgr = crate::browser::extension_manager::EXTENSION_MANAGER.lock().unwrap();
      mgr
        .validate_group_compatibility(gid, &profile.browser)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("{e}"),
        })?;
    }

    let profile_manager = ProfileManager::instance();
    let profile = profile_manager
      .update_profile_extension_group(profile_id, extension_group_id)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to assign extension group: {e}"),
      })?;
    Ok(serde_json::to_value(profile).unwrap())
  }

}
