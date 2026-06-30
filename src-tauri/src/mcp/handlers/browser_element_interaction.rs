impl McpServer {
  async fn handle_click_element(
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
    let selector = arguments
      .get("selector")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing selector".to_string(),
      })?;

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let selector_escaped = selector.replace('\\', "\\\\").replace('\'', "\\'");
    let js = format!(
      r#"(() => {{
        const el = document.querySelector('{}');
        if (!el) throw new Error('Element not found: {}');
        el.scrollIntoView({{block: 'center'}});
        el.click();
        return true;
      }})()"#,
      selector_escaped, selector_escaped
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
        "text": format!("Clicked element: {selector}")
      }]
    }))
  }

  async fn handle_type_text(
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
    let selector = arguments
      .get("selector")
      .and_then(|v| v.as_str())
      .ok_or_else(|| McpError {
        code: -32602,
        message: "Missing selector".to_string(),
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

    let selector_escaped = selector.replace('\\', "\\\\").replace('\'', "\\'");
    let focus_js = if clear_first {
      format!(
        r#"(() => {{
          const el = document.querySelector('{}');
          if (!el) throw new Error('Element not found: {}');
          el.scrollIntoView({{block: 'center'}});
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', {{bubbles: true}}));
          return true;
        }})()"#,
        selector_escaped, selector_escaped
      )
    } else {
      format!(
        r#"(() => {{
          const el = document.querySelector('{}');
          if (!el) throw new Error('Element not found: {}');
          el.scrollIntoView({{block: 'center'}});
          el.focus();
          return true;
        }})()"#,
        selector_escaped, selector_escaped
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
        "text": format!("Typed text into element: {selector}")
      }]
    }))
  }
}
