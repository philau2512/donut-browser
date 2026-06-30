impl McpServer {
  async fn handle_get_interactive_elements(
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
    let max_chars = arguments
      .get("max_chars")
      .and_then(|v| v.as_u64())
      .map(|n| n as usize)
      .unwrap_or(40_000);

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let js = INTERACTIVE_ELEMENTS_JS.replace("__MAX_CHARS__", &max_chars.to_string());

    let result = self
      .send_cdp(
        &ws_url,
        "Runtime.evaluate",
        serde_json::json!({
          "expression": js,
          "returnByValue": true,
        }),
      )
      .await?;

    if let Some(exception) = result.get("exceptionDetails") {
      let msg = exception
        .get("exception")
        .and_then(|e| e.get("description"))
        .or_else(|| exception.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Enumeration failed");
      return Err(McpError {
        code: -32000,
        message: msg.to_string(),
      });
    }

    let payload_str = result
      .get("result")
      .and_then(|r| r.get("value"))
      .and_then(|v| v.as_str())
      .unwrap_or("{}");

    let payload: serde_json::Value =
      serde_json::from_str(payload_str).unwrap_or(serde_json::json!({}));
    let elements = payload
      .get("elements")
      .and_then(|v| v.as_str())
      .unwrap_or("");
    let count = payload.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
    let truncated = payload
      .get("truncated")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);

    let header = if truncated {
      format!("{count} interactive elements (truncated at {max_chars} chars — re-call with a larger max_chars or scroll the page):")
    } else {
      format!("{count} interactive elements:")
    };

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("{header}\n{elements}")
      }]
    }))
  }

  async fn handle_click_by_index(
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
    let index = arguments
      .get("index")
      .and_then(|v| v.as_u64())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing index".to_string(),
      })?;

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let js = format!(
      r#"(() => {{
        const arr = window.__donut_interactive;
        if (!arr || !arr[{index}]) throw new Error('No element at index {index}. Call get_interactive_elements first or after navigation.');
        const el = arr[{index}];
        el.scrollIntoView({{block: 'center'}});
        el.click();
        return true;
      }})()"#
    );

    let result = self
      .send_cdp_and_wait_for_load(
        &ws_url,
        "Runtime.evaluate",
        serde_json::json!({
          "expression": js,
          "returnByValue": true,
        }),
        10,
      )
      .await?;

    if let Some(exception) = result.get("exceptionDetails") {
      let msg = exception
        .get("exception")
        .and_then(|e| e.get("description"))
        .or_else(|| exception.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Click failed");
      return Err(McpError {
        code: -32000,
        message: msg.to_string(),
      });
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Clicked element at index {index}")
      }]
    }))
  }

  async fn handle_type_by_index(
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
    let index = arguments
      .get("index")
      .and_then(|v| v.as_u64())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing index".to_string(),
      })?;
    let text = arguments
      .get("text")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing text".to_string(),
      })?;
    let clear_first = arguments
      .get("clear_first")
      .and_then(|v| v.as_bool())
      .unwrap_or(true);
    let instant = arguments
      .get("instant")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);
    let wpm = arguments.get("wpm").and_then(|v| v.as_f64());

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let focus_js = if clear_first {
      format!(
        r#"(() => {{
          const arr = window.__donut_interactive;
          if (!arr || !arr[{index}]) throw new Error('No element at index {index}. Call get_interactive_elements first or after navigation.');
          const el = arr[{index}];
          el.scrollIntoView({{block: 'center'}});
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', {{bubbles: true}}));
          return true;
        }})()"#
      )
    } else {
      format!(
        r#"(() => {{
          const arr = window.__donut_interactive;
          if (!arr || !arr[{index}]) throw new Error('No element at index {index}. Call get_interactive_elements first or after navigation.');
          const el = arr[{index}];
          el.scrollIntoView({{block: 'center'}});
          el.focus();
          return true;
        }})()"#
      )
    };

    let focus_result = self
      .send_cdp(
        &ws_url,
        "Runtime.evaluate",
        serde_json::json!({
          "expression": focus_js,
          "returnByValue": true,
        }),
      )
      .await?;

    if let Some(exception) = focus_result.get("exceptionDetails") {
      let msg = exception
        .get("exception")
        .and_then(|e| e.get("description"))
        .or_else(|| exception.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Focus failed");
      return Err(McpError {
        code: -32000,
        message: msg.to_string(),
      });
    }

    if instant {
      self
        .send_cdp(
          &ws_url,
          "Input.insertText",
          serde_json::json!({ "text": text }),
        )
        .await?;
    } else {
      self.send_human_keystrokes(&ws_url, text, wpm).await?;
    }

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": format!("Typed text into element at index {index}")
      }]
    }))
  }
}
