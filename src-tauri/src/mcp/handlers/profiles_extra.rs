impl McpServer {
  async fn handle_delete_profile(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    ProfileManager::instance()
      .delete_profile(app_handle, profile_id)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to delete profile: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Profile '{profile_id}' deleted successfully")
      }]
    }))
  }

  async fn handle_list_tags(&self) -> Result<serde_json::Value, McpError> {
    let tags = crate::profile::tag_manager::TAG_MANAGER
      .lock()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to access tag manager: {e}"),
      })?
      .get_all_tags()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to get tags: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&tags).unwrap_or_default()
      }]
    }))
  }

  async fn handle_get_profile_status(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    // Get the profile
    let profiles = ProfileManager::instance()
      .list_profiles()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
      })?;

    let profile = profiles
      .iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| McpError {
        code: -32000,
        message: format!("Profile not found: {profile_id}"),
      })?;

    // Check if it's a Wayfern or Camoufox profile
    if profile.browser != "wayfern" && profile.browser != "camoufox" {
      return Err(McpError {
        code: -32000,
        message: "MCP only supports Wayfern and Camoufox profiles".to_string(),
      });
    }

    let is_running = profile.process_id.is_some();

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::json!({
          "profile_id": profile_id,
          "is_running": is_running
        }).to_string()
      }]
    }))
  }

  // Group management handlers
  async fn handle_import_profile_cookies(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    let content = arguments
      .get("content")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing content".to_string(),
      })?;

    let app_handle = {
      let inner = self.inner.lock().await;
      inner
        .app_handle
        .as_ref()
        .ok_or_else(|| McpError {
          code: -32000,
          message: "MCP server not properly initialized".to_string(),
        })?
        .clone()
    };

    let result =
      crate::profile::cookie_manager::CookieManager::import_cookies(&app_handle, profile_id, content)
        .await
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to import cookies: {e}"),
        })?;

    if let Some(scheduler) = crate::sync::get_global_scheduler() {
      let profile_manager = crate::profile::manager::ProfileManager::instance();
      if let Ok(profiles) = profile_manager.list_profiles() {
        if let Some(profile) = profiles.iter().find(|p| p.id.to_string() == profile_id) {
          if profile.is_sync_enabled() {
            let pid = profile_id.to_string();
            tauri::async_runtime::spawn(async move {
              scheduler.queue_profile_sync(pid).await;
            });
          }
        }
      }
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!(
          "Import complete: {} imported, {} replaced, {} parse error(s)",
          result.cookies_imported,
          result.cookies_replaced,
          result.errors.len()
        )
      }]
    }))
  }

  // VPN management handlers
  async fn handle_get_profile_fingerprint(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    let profiles = ProfileManager::instance()
      .list_profiles()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
      })?;

    let profile = profiles
      .iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| McpError {
        code: -32000,
        message: format!("Profile not found: {profile_id}"),
      })?;

    let fingerprint_info = match profile.browser.as_str() {
      "camoufox" => {
        let config = profile
          .camoufox_config
          .as_ref()
          .cloned()
          .unwrap_or_default();
        serde_json::json!({
          "browser": "camoufox",
          "fingerprint": config.fingerprint,
          "os": config.os,
          "randomize_fingerprint_on_launch": config.randomize_fingerprint_on_launch,
          "screen_max_width": config.screen_max_width,
          "screen_max_height": config.screen_max_height,
          "screen_min_width": config.screen_min_width,
          "screen_min_height": config.screen_min_height,
        })
      }
      "wayfern" => {
        let config = profile.wayfern_config.as_ref().cloned().unwrap_or_default();
        serde_json::json!({
          "browser": "wayfern",
          "fingerprint": config.fingerprint,
          "os": config.os,
          "randomize_fingerprint_on_launch": config.randomize_fingerprint_on_launch,
          "screen_max_width": config.screen_max_width,
          "screen_max_height": config.screen_max_height,
          "screen_min_width": config.screen_min_width,
          "screen_min_height": config.screen_min_height,
        })
      }
      _ => {
        return Err(McpError {
          code: -32000,
          message: "MCP only supports Wayfern and Camoufox profiles".to_string(),
        })
      }
    };

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&fingerprint_info).unwrap_or_default()
      }]
    }))
  }

  async fn handle_update_profile_fingerprint(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    if !CLOUD_AUTH.can_use_cross_os_fingerprints().await {
      return Err(McpError {
        code: -32000,
        message: "Fingerprint editing requires a plan that includes it".to_string(),
      });
    }

    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    let fingerprint = arguments.get("fingerprint").and_then(|v| v.as_str());
    let os = arguments.get("os").and_then(|v| v.as_str());
    let randomize = arguments
      .get("randomize_fingerprint_on_launch")
      .and_then(|v| v.as_bool());

    if let Some(os_val) = os {
      if !CLOUD_AUTH.is_fingerprint_os_allowed(Some(os_val)).await {
        return Err(McpError {
          code: -32000,
          message: format!(
            "OS spoofing to '{}' requires an active Pro subscription",
            os_val
          ),
        });
      }
    }

    let profiles = ProfileManager::instance()
      .list_profiles()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
      })?;

    let profile = profiles
      .iter()
      .find(|p| p.id.to_string() == profile_id)
      .ok_or_else(|| McpError {
        code: -32000,
        message: format!("Profile not found: {profile_id}"),
      })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    match profile.browser.as_str() {
      "camoufox" => {
        let mut config = profile
          .camoufox_config
          .as_ref()
          .cloned()
          .unwrap_or_default();
        if let Some(fp) = fingerprint {
          config.fingerprint = Some(fp.to_string());
        }
        if let Some(os_val) = os {
          config.os = Some(os_val.to_string());
        }
        if let Some(r) = randomize {
          config.randomize_fingerprint_on_launch = Some(r);
        }
        ProfileManager::instance()
          .update_camoufox_config(app_handle.clone(), profile_id, config)
          .await
          .map_err(|e| McpError {
            code: -32000,
            message: format!("Failed to update camoufox config: {e}"),
          })?;
      }
      "wayfern" => {
        let mut config = profile.wayfern_config.as_ref().cloned().unwrap_or_default();
        if let Some(fp) = fingerprint {
          config.fingerprint = Some(fp.to_string());
        }
        if let Some(os_val) = os {
          config.os = Some(os_val.to_string());
        }
        if let Some(r) = randomize {
          config.randomize_fingerprint_on_launch = Some(r);
        }
        ProfileManager::instance()
          .update_wayfern_config(app_handle.clone(), profile_id, config)
          .await
          .map_err(|e| McpError {
            code: -32000,
            message: format!("Failed to update wayfern config: {e}"),
          })?;
      }
      _ => {
        return Err(McpError {
          code: -32000,
          message: "MCP only supports Wayfern and Camoufox profiles".to_string(),
        })
      }
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Fingerprint configuration updated for profile '{}'", profile.name)
      }]
    }))
  }

  async fn handle_update_profile_proxy_bypass_rules(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    let rules: Vec<String> = arguments
      .get("rules")
      .and_then(|v| v.as_array())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing rules array".to_string(),
      })?
      .iter()
      .filter_map(|v| v.as_str().map(|s| s.to_string()))
      .collect();

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    let profile = ProfileManager::instance()
      .update_profile_proxy_bypass_rules(app_handle, profile_id, rules.clone())
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to update proxy bypass rules: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!(
          "Proxy bypass rules updated for profile '{}': {} rule(s) configured",
          profile.name,
          rules.len()
        )
      }]
    }))
  }

  async fn handle_update_profile_dns_blocklist(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    let level = arguments
      .get("level")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing level".to_string(),
      })?;

    let dns_blocklist = if level == "none" {
      None
    } else {
      Some(level.to_string())
    };

    let profile = ProfileManager::instance()
      .update_profile_dns_blocklist(profile_id, dns_blocklist)
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to update DNS blocklist: {e}"),
      })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!(
          "DNS blocklist updated for profile '{}': {}",
          profile.name,
          level
        )
      }]
    }))
  }

  async fn handle_get_dns_blocklist_status(&self) -> Result<serde_json::Value, McpError> {
    let statuses = crate::profile::dns_blocklist::BlocklistManager::get_cache_status();
    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&statuses).unwrap_or_default()
      }]
    }))
  }

}
