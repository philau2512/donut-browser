impl McpServer {
  async fn handle_navigate(
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
    let url = arguments
      .get("url")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing url".to_string(),
      })?;

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    self
      .send_cdp_and_wait_for_load(
        &ws_url,
        "Page.navigate",
        serde_json::json!({ "url": url }),
        30,
      )
      .await?;

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Navigated to {url}")
      }]
    }))
  }

  async fn handle_screenshot(
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
    let format = arguments
      .get("format")
      .and_then(|v| v.as_str())
      .unwrap_or("png");
    let quality = arguments.get("quality").and_then(|v| v.as_i64());
    let full_page = arguments
      .get("full_page")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let mut params = serde_json::json!({ "format": format });

    if let Some(q) = quality {
      params["quality"] = serde_json::json!(q);
    }

    if full_page {
      let layout = self
        .send_cdp(&ws_url, "Page.getLayoutMetrics", serde_json::json!({}))
        .await?;

      if let Some(content_size) = layout.get("contentSize") {
        params["clip"] = serde_json::json!({
          "x": 0,
          "y": 0,
          "width": content_size.get("width").and_then(|v| v.as_f64()).unwrap_or(1920.0),
          "height": content_size.get("height").and_then(|v| v.as_f64()).unwrap_or(1080.0),
          "scale": 1
        });
        params["captureBeyondViewport"] = serde_json::json!(true);
      }
    }

    let result = self
      .send_cdp(&ws_url, "Page.captureScreenshot", params)
      .await?;

    let data = result
      .get("data")
      .and_then(|v| v.as_str())
      .unwrap_or_default();

    Ok(serde_json::json!({
      "content": [{
        "type": "image",
        "data": data,
        "mimeType": format!("image/{format}")
      }]
    }))
  }
}
