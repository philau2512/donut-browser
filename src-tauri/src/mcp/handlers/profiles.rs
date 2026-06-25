impl McpServer {
  async fn handle_list_profiles(&self) -> Result<serde_json::Value, McpError> {
    let profiles = ProfileManager::instance()
      .list_profiles()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
      })?;

    // Filter to only Wayfern and Camoufox profiles
    let filtered: Vec<&BrowserProfile> = profiles
      .iter()
      .filter(|p| p.browser == "wayfern" || p.browser == "camoufox")
      .collect();

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&filtered).unwrap_or_default()
      }]
    }))
  }

  async fn handle_get_profile(
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

    // Check if it's a Wayfern or Camoufox profile
    if profile.browser != "wayfern" && profile.browser != "camoufox" {
      return Err(McpError {
        code: -32000,
        message: "MCP only supports Wayfern and Camoufox profiles".to_string(),
      });
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&profile).unwrap_or_default()
      }]
    }))
  }

  async fn handle_run_profile(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    // Launching profiles programmatically requires the automation capability.
    Self::require_capability(
      "Launching a profile",
      CLOUD_AUTH.can_use_browser_automation().await,
    )
    .await?;

    let profile_id = arguments
      .get("profile_id")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_id".to_string(),
      })?;

    let url = arguments.get("url").and_then(|v| v.as_str());
    let headless = arguments
      .get("headless")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);

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

    // Team lock check
    crate::team_lock::acquire_team_lock_if_needed(profile)
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: e,
      })?;

    // Get app handle to launch
    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    // Launch a fresh instance, honoring the requested headless mode. The CDP
    // port is self-allocated and discovered later via get_cdp_port_for_profile.
    crate::browser::browser_runner::launch_browser_profile_impl(
      app_handle.clone(),
      profile.clone(),
      url.map(|s| s.to_string()),
      None,
      headless,
      true,
    )
    .await
    .map_err(|e| McpError {
      code: -32000,
      message: format!("Failed to launch browser: {e}"),
    })?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Browser profile '{}' launched successfully", profile.name)
      }]
    }))
  }

  async fn handle_kill_profile(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    // Stopping profiles programmatically requires the automation capability.
    Self::require_capability(
      "Killing a profile",
      CLOUD_AUTH.can_use_browser_automation().await,
    )
    .await?;

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

    // Get app handle to kill
    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    // Kill the browser
    crate::browser::browser_runner::BrowserRunner::instance()
      .kill_browser_process(app_handle.clone(), profile)
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to kill browser: {e}"),
      })?;

    crate::team_lock::release_team_lock_if_needed(profile).await;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Browser profile '{}' stopped successfully", profile.name)
      }]
    }))
  }

  async fn handle_batch_run_profiles(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    Self::require_capability(
      "Batch launching profiles",
      CLOUD_AUTH.can_use_browser_automation().await,
    )
    .await?;

    let profile_ids: Vec<String> = arguments
      .get("profile_ids")
      .and_then(|v| v.as_array())
      .map(|a| {
        a.iter()
          .filter_map(|v| v.as_str().map(|s| s.to_string()))
          .collect()
      })
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_ids array".to_string(),
      })?;

    let url = arguments.get("url").and_then(|v| v.as_str());
    let headless = arguments
      .get("headless")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);

    let profiles = ProfileManager::instance()
      .list_profiles()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
      })?;

    // Clone the app handle and release the lock before the launch loop so we
    // never hold the inner mutex across the per-profile awaits.
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

    let mut launched = 0usize;
    let mut lines: Vec<String> = Vec::with_capacity(profile_ids.len());
    for profile_id in &profile_ids {
      let Some(profile) = profiles.iter().find(|p| p.id.to_string() == *profile_id) else {
        lines.push(format!("{profile_id}: not found"));
        continue;
      };
      if profile.browser != "wayfern" && profile.browser != "camoufox" {
        lines.push(format!(
          "{profile_id}: unsupported browser (MCP supports Wayfern/Camoufox)"
        ));
        continue;
      }
      if let Err(e) = crate::team_lock::acquire_team_lock_if_needed(profile).await {
        lines.push(format!("{profile_id}: {e}"));
        continue;
      }
      match crate::browser::browser_runner::launch_browser_profile_impl(
        app_handle.clone(),
        profile.clone(),
        url.map(|s| s.to_string()),
        None,
        headless,
        true,
      )
      .await
      {
        Ok(_) => {
          launched += 1;
          lines.push(format!("{}: launched", profile.name));
        }
        Err(e) => lines.push(format!("{}: launch failed: {e}", profile.name)),
      }
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Launched {}/{} profile(s):\n{}", launched, profile_ids.len(), lines.join("\n"))
      }]
    }))
  }

  async fn handle_batch_stop_profiles(
    &self,
    arguments: &serde_json::Value,
  ) -> Result<serde_json::Value, McpError> {
    Self::require_capability(
      "Batch stopping profiles",
      CLOUD_AUTH.can_use_browser_automation().await,
    )
    .await?;

    let profile_ids: Vec<String> = arguments
      .get("profile_ids")
      .and_then(|v| v.as_array())
      .map(|a| {
        a.iter()
          .filter_map(|v| v.as_str().map(|s| s.to_string()))
          .collect()
      })
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing profile_ids array".to_string(),
      })?;

    let profiles = ProfileManager::instance()
      .list_profiles()
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to list profiles: {e}"),
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

    let mut stopped = 0usize;
    let mut lines: Vec<String> = Vec::with_capacity(profile_ids.len());
    for profile_id in &profile_ids {
      let Some(profile) = profiles.iter().find(|p| p.id.to_string() == *profile_id) else {
        lines.push(format!("{profile_id}: not found"));
        continue;
      };
      match crate::browser::browser_runner::BrowserRunner::instance()
        .kill_browser_process(app_handle.clone(), profile)
        .await
      {
        Ok(_) => {
          crate::team_lock::release_team_lock_if_needed(profile).await;
          stopped += 1;
          lines.push(format!("{}: stopped", profile.name));
        }
        Err(e) => lines.push(format!("{}: stop failed: {e}", profile.name)),
      }
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Stopped {}/{} profile(s):\n{}", stopped, profile_ids.len(), lines.join("\n"))
      }]
    }))
  }

  async fn handle_create_profile(
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
    let browser = arguments
      .get("browser")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing browser".to_string(),
      })?;

    if browser != "wayfern" && browser != "camoufox" {
      return Err(McpError {
        code: -32602,
        message: "browser must be 'wayfern' or 'camoufox'".to_string(),
      });
    }

    let proxy_id = arguments
      .get("proxy_id")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());
    let launch_hook = arguments
      .get("launch_hook")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());
    let group_id = arguments
      .get("group_id")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string());
    let tags: Option<Vec<String>> = arguments.get("tags").and_then(|v| {
      v.as_array().map(|arr| {
        arr
          .iter()
          .filter_map(|item| item.as_str().map(|s| s.to_string()))
          .collect()
      })
    });

    // Pick the latest downloaded version for this browser
    let registry = crate::browser::downloaded_browsers_registry::DownloadedBrowsersRegistry::instance();
    let versions = registry.get_downloaded_versions(browser);
    let version = versions.first().ok_or_else(|| McpError {
      code: -32000,
      message: format!("No downloaded version found for {browser}. Download it first."),
    })?;

    let inner = self.inner.lock().await;
    let app_handle = inner.app_handle.as_ref().ok_or_else(|| McpError {
      code: -32000,
      message: "MCP server not properly initialized".to_string(),
    })?;

    let mut profile = ProfileManager::instance()
      .create_profile_with_group(
        app_handle,
        name,
        browser,
        version,
        "stable",
        proxy_id,
        None,
        None,
        None,
        group_id,
        false,
        None,
        launch_hook,
      )
      .await
      .map_err(|e| McpError {
        code: -32000,
        message: format!("Failed to create profile: {e}"),
      })?;

    if let Some(tags) = tags {
      let _ =
        ProfileManager::instance().update_profile_tags(app_handle, &profile.name, tags.clone());
      profile.tags = tags;
      if let Ok(profiles) = ProfileManager::instance().list_profiles() {
        let _ = crate::tag_manager::TAG_MANAGER
          .lock()
          .map(|manager| manager.rebuild_from_profiles(&profiles));
      }
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Profile '{}' created (id: {})", profile.name, profile.id)
      }]
    }))
  }

  async fn handle_update_profile(
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
    let pm = ProfileManager::instance();

    if let Some(new_name) = arguments.get("name").and_then(|v| v.as_str()) {
      pm.rename_profile(app_handle, profile_id, new_name)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to rename profile: {e}"),
        })?;
    }

    if let Some(proxy_id) = arguments.get("proxy_id").and_then(|v| v.as_str()) {
      let pid = if proxy_id.is_empty() {
        None
      } else {
        Some(proxy_id.to_string())
      };
      pm.update_profile_proxy(app_handle.clone(), profile_id, pid)
        .await
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to update proxy: {e}"),
        })?;
    }

    if let Some(launch_hook) = arguments.get("launch_hook").and_then(|v| v.as_str()) {
      let normalized = if launch_hook.is_empty() {
        None
      } else {
        Some(launch_hook.to_string())
      };
      pm.update_profile_launch_hook(app_handle, profile_id, normalized)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to update launch hook: {e}"),
        })?;
    }

    if let Some(group_id) = arguments.get("group_id").and_then(|v| v.as_str()) {
      let gid = if group_id.is_empty() {
        None
      } else {
        Some(group_id.to_string())
      };
      pm.assign_profiles_to_group(app_handle, vec![profile_id.to_string()], gid)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to update group: {e}"),
        })?;
    }

    if let Some(tags) = arguments.get("tags").and_then(|v| v.as_array()) {
      let tag_list: Vec<String> = tags
        .iter()
        .filter_map(|item| item.as_str().map(|s| s.to_string()))
        .collect();
      pm.update_profile_tags(app_handle, profile_id, tag_list)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to update tags: {e}"),
        })?;
      if let Ok(profiles) = pm.list_profiles() {
        let _ = crate::tag_manager::TAG_MANAGER
          .lock()
          .map(|manager| manager.rebuild_from_profiles(&profiles));
      }
    }

    if let Some(ext_group_id) = arguments.get("extension_group_id").and_then(|v| v.as_str()) {
      let eid = if ext_group_id.is_empty() {
        None
      } else {
        Some(ext_group_id.to_string())
      };
      pm.update_profile_extension_group(profile_id, eid)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to update extension group: {e}"),
        })?;
    }

    if let Some(rules) = arguments
      .get("proxy_bypass_rules")
      .and_then(|v| v.as_array())
    {
      let rule_list: Vec<String> = rules
        .iter()
        .filter_map(|item| item.as_str().map(|s| s.to_string()))
        .collect();
      pm.update_profile_proxy_bypass_rules(app_handle, profile_id, rule_list)
        .map_err(|e| McpError {
          code: -32000,
          message: format!("Failed to update proxy bypass rules: {e}"),
        })?;
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Profile '{profile_id}' updated successfully")
      }]
    }))
  }

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
    let tags = crate::tag_manager::TAG_MANAGER
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
      crate::cookie_manager::CookieManager::import_cookies(&app_handle, profile_id, content)
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
    let statuses = crate::dns_blocklist::BlocklistManager::get_cache_status();
    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&statuses).unwrap_or_default()
      }]
    }))
  }

}
