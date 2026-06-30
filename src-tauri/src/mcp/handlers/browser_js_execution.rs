impl McpServer {
  async fn handle_evaluate_javascript(
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
    let expression = arguments
      .get("expression")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing expression".to_string(),
      })?;
    let await_promise = arguments
      .get("await_promise")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);
    let wait_for_load = arguments
      .get("wait_for_load")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let cdp_params = serde_json::json!({
      "expression": expression,
      "returnByValue": true,
      "awaitPromise": await_promise,
    });

    let result = if wait_for_load {
      self
        .send_cdp_and_wait_for_load(&ws_url, "Runtime.evaluate", cdp_params, 30)
        .await?
    } else {
      self
        .send_cdp(&ws_url, "Runtime.evaluate", cdp_params)
        .await?
    };

    let value = if let Some(exception) = result.get("exceptionDetails") {
      let text = exception
        .get("text")
        .or_else(|| {
          exception
            .get("exception")
            .and_then(|e| e.get("description"))
        })
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown error");
      serde_json::json!({ "error": text })
    } else if let Some(r) = result.get("result") {
      let val = r.get("value").cloned().unwrap_or(serde_json::json!(null));
      serde_json::json!({ "value": val, "type": r.get("type") })
    } else {
      serde_json::json!({ "value": null })
    };

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&value).unwrap_or_default()
      }]
    }))
  }
}
