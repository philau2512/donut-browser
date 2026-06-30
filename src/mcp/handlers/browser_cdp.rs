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
        }})()"#,
        selector_escaped, selector_escaped
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
        "text": format!("Typed text into element at index {index}")
      }]
    }))
  }
}
