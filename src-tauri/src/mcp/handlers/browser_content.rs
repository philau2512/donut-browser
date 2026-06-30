impl McpServer {
  async fn handle_get_page_content(
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
      .unwrap_or("text");
    let selector = arguments.get("selector").and_then(|v| v.as_str());
    let max_chars = arguments
      .get("max_chars")
      .and_then(|v| v.as_u64())
      .map(|n| n as usize)
      .unwrap_or(40_000);

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let js = if let Some(sel) = selector {
      let sel_escaped = sel.replace('\\', "\\\\").replace('\'', "\\'");
      if format == "html" {
        format!(
          r#"(() => {{
            const el = document.querySelector('{}');
            return el ? el.outerHTML : null;
          }})()"#,
          sel_escaped
        )
      } else {
        format!(
          r#"(() => {{
            const el = document.querySelector('{}');
            return el ? el.innerText : null;
          }})()"#,
          sel_escaped
        )
      }
    } else if format == "html" {
      "document.documentElement.outerHTML".to_string()
    } else {
      "document.body.innerText".to_string()
    };

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

    let content = result
      .get("result")
      .and_then(|r| r.get("value"))
      .and_then(|v| v.as_str())
      .unwrap_or("");

    let total_chars = content.chars().count();
    let (text, truncated) = if total_chars > max_chars {
      (content.chars().take(max_chars).collect::<String>(), true)
    } else {
      (content.to_string(), false)
    };

    let payload = if truncated {
      format!(
        "{text}\n\n[truncated: showing {max_chars} of {total_chars} chars — call with a larger max_chars or use get_interactive_elements for an indexed view]"
      )
    } else {
      text
    };

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": payload
      }]
    }))
  }

  async fn handle_get_page_info(
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

    let profile = self.get_running_profile(profile_id)?;
    let cdp_port = self.get_cdp_port_for_profile(&profile).await?;
    let ws_url = self.get_cdp_ws_url(cdp_port).await?;

    let result = self
      .send_cdp(
        &ws_url,
        "Runtime.evaluate",
        serde_json::json!({
          "expression": "JSON.stringify({url: location.href, title: document.title, readyState: document.readyState})",
          "returnByValue": true,
        }),
      )
      .await?;

    let info_str = result
      .get("result")
      .and_then(|r| r.get("value"))
      .and_then(|v| v.as_str())
      .unwrap_or("{}");

    let info: serde_json::Value = serde_json::from_str(info_str).unwrap_or(serde_json::json!({}));

    Ok(serde_json::json!({
      "content": [{
        "type": "text",
        "text": serde_json::to_string_pretty(&info).unwrap_or_default()
      }]
    }))
  }
}
