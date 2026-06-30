impl McpServer {
  fn get_tools_part2(&self) -> Vec<McpTool> {
    vec![
      // Fingerprint management tools
      McpTool {
        name: "get_profile_fingerprint".to_string(),
        description: "Get the fingerprint configuration for a Wayfern or Camoufox profile"
          .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the profile"
            }
          },
          "required": ["profile_id"]
        }),
      },
      McpTool {
        name: "update_profile_fingerprint".to_string(),
        description:
          "Update the fingerprint configuration for a Wayfern or Camoufox profile. Requires an active Pro subscription."
            .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the profile to update"
            },
            "fingerprint": {
              "type": "string",
              "description": "JSON string of the fingerprint configuration, or null to clear"
            },
            "os": {
              "type": "string",
              "enum": ["windows", "macos", "linux"],
              "description": "Operating system for fingerprint generation"
            },
            "randomize_fingerprint_on_launch": {
              "type": "boolean",
              "description": "Whether to generate a new fingerprint on every launch"
            }
          },
          "required": ["profile_id"]
        }),
      },
      McpTool {
        name: "update_profile_proxy_bypass_rules".to_string(),
        description:
          "Update proxy bypass rules for a profile. Requests matching these rules will connect directly, bypassing the proxy."
            .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the profile to update"
            },
            "rules": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Array of bypass rules. Supports hostnames (e.g. 'example.com'), IP addresses, and regex patterns."
            }
          },
          "required": ["profile_id", "rules"]
        }),
      },
      McpTool {
        name: "update_profile_dns_blocklist".to_string(),
        description:
          "Update the DNS blocklist level for a profile. Blocks ads, trackers, and malware domains at the proxy level."
            .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the profile to update"
            },
            "level": {
              "type": "string",
              "enum": ["none", "light", "normal", "pro", "pro_plus", "ultimate"],
              "description": "DNS blocklist level. 'none' disables blocking."
            }
          },
          "required": ["profile_id", "level"]
        }),
      },
      McpTool {
        name: "get_dns_blocklist_status".to_string(),
        description: "Get the cache status of all DNS blocklist tiers including entry counts and freshness.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {},
          "required": []
        }),
      },
      McpTool {
        name: "list_extensions".to_string(),
        description: "List all managed browser extensions. Requires Pro subscription.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {},
          "required": []
        }),
      },
      McpTool {
        name: "list_extension_groups".to_string(),
        description: "List all extension groups. Requires Pro subscription.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {},
          "required": []
        }),
      },
      McpTool {
        name: "create_extension_group".to_string(),
        description: "Create a new extension group. Requires Pro subscription.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "name": { "type": "string", "description": "Name for the extension group" }
          },
          "required": ["name"]
        }),
      },
      McpTool {
        name: "delete_extension".to_string(),
        description: "Delete a managed extension. Requires Pro subscription.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "extension_id": { "type": "string", "description": "The extension ID to delete" }
          },
          "required": ["extension_id"]
        }),
      },
      McpTool {
        name: "delete_extension_group".to_string(),
        description: "Delete an extension group. Requires Pro subscription.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "group_id": { "type": "string", "description": "The extension group ID to delete" }
          },
          "required": ["group_id"]
        }),
      },
      McpTool {
        name: "assign_extension_group_to_profile".to_string(),
        description: "Assign an extension group to a profile, or remove the assignment. Requires Pro subscription.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": { "type": "string", "description": "The profile ID" },
            "extension_group_id": { "type": "string", "description": "The extension group ID, or empty string to remove" }
          },
          "required": ["profile_id"]
        }),
      },
      // Cookie management tools
      McpTool {
        name: "import_profile_cookies".to_string(),
        description: "Import cookies into a Wayfern or Camoufox profile from a JSON array (Puppeteer / EditThisCookie format) or a Netscape cookies.txt. Format is auto-detected. The browser must not be running.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the target profile"
            },
            "content": {
              "type": "string",
              "description": "Raw cookie file content (JSON array or Netscape cookies.txt)"
            }
          },
          "required": ["profile_id", "content"]
        }),
      },
      // Team lock tools
      McpTool {
        name: "get_team_locks".to_string(),
        description: "List all active team profile locks. Requires team plan.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {},
          "required": []
        }),
      },
      McpTool {
        name: "get_team_lock_status".to_string(),
        description: "Check if a profile is locked by a team member. Requires team plan.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the profile to check"
            }
          },
          "required": ["profile_id"]
        }),
      },
      // Synchronizer tools
      McpTool {
        name: "start_sync_session".to_string(),
        description: "Start a synchronizer session. Launches a leader profile and follower profiles, then mirrors all actions from the leader to the followers in real time. Only Wayfern profiles are supported. Requires paid subscription.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "leader_profile_id": {
              "type": "string",
              "description": "The UUID of the leader profile"
            },
            "follower_profile_ids": {
              "type": "array",
              "items": { "type": "string" },
              "description": "UUIDs of follower profiles"
            }
          },
          "required": ["leader_profile_id", "follower_profile_ids"]
        }),
      },
      McpTool {
        name: "stop_sync_session".to_string(),
        description: "Stop an active synchronizer session. Kills all follower profiles and the leader.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "session_id": {
              "type": "string",
              "description": "The sync session ID"
            }
          },
          "required": ["session_id"]
        }),
      },
      McpTool {
        name: "get_sync_sessions".to_string(),
        description: "List all active synchronizer sessions.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {}
        }),
      },
      McpTool {
        name: "remove_sync_follower".to_string(),
        description: "Remove a follower from an active synchronizer session.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "session_id": {
              "type": "string",
              "description": "The sync session ID"
            },
            "follower_profile_id": {
              "type": "string",
              "description": "The UUID of the follower to remove"
            }
          },
          "required": ["session_id", "follower_profile_id"]
        }),
      },
      // Browser interaction tools
      McpTool {
        name: "navigate".to_string(),
        description: "Navigate a running browser profile to a URL. Waits for the page to fully load before returning.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "url": {
              "type": "string",
              "description": "The URL to navigate to"
            }
          },
          "required": ["profile_id", "url"]
        }),
      },
      McpTool {
        name: "screenshot".to_string(),
        description: "Take a screenshot of the current page in a running browser profile. Returns base64-encoded image."
          .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "format": {
              "type": "string",
              "enum": ["png", "jpeg", "webp"],
              "description": "Image format (default: png)"
            },
            "quality": {
              "type": "integer",
              "description": "Image quality 0-100 for jpeg/webp (default: 80)"
            },
            "full_page": {
              "type": "boolean",
              "description": "Capture the full scrollable page (default: false)"
            }
          },
          "required": ["profile_id"]
        }),
      },
      McpTool {
        name: "evaluate_javascript".to_string(),
        description:
          "Execute JavaScript in the context of the current page and return the result. Works with both static and dynamically-generated content. Set wait_for_load=true if the script triggers navigation (e.g., form.submit())."
            .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "expression": {
              "type": "string",
              "description": "JavaScript expression to evaluate"
            },
            "await_promise": {
              "type": "boolean",
              "description": "Whether to await the result if it's a Promise (default: false)"
            },
            "wait_for_load": {
              "type": "boolean",
              "description": "Wait for page load after execution, use when the script triggers navigation like form.submit() (default: false)"
            }
          },
          "required": ["profile_id", "expression"]
        }),
      },
      McpTool {
        name: "click_element".to_string(),
        description: "Click on an element identified by a CSS selector. If the click triggers a page navigation, waits for the new page to load before returning.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "selector": {
              "type": "string",
              "description": "CSS selector for the element to click"
            }
          },
          "required": ["profile_id", "selector"]
        }),
      },
      McpTool {
        name: "type_text".to_string(),
        description: "Focus an element by CSS selector and type text into it. By default uses realistic human-like typing with variable speed, natural errors, and self-corrections. Only set instant=true when you are certain the target does not have bot detection (e.g. browser address bars, developer tools, internal apps) — using instant on public websites risks the profile being flagged as a bot.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "selector": {
              "type": "string",
              "description": "CSS selector for the input element"
            },
            "text": {
              "type": "string",
              "description": "Text to type into the element"
            },
            "clear_first": {
              "type": "boolean",
              "description": "Clear the input before typing (default: true)"
            },
            "instant": {
              "type": "boolean",
              "description": "Paste all text at once instead of human typing. WARNING: only use on targets without bot detection — using this on public websites risks the profile being flagged."
            },
            "wpm": {
              "type": "number",
              "description": "Target words per minute for human typing (default: 80)"
            }
          },
          "required": ["profile_id", "selector", "text"]
        }),
      },
      McpTool {
        name: "get_page_content".to_string(),
        description:
          "Get the content of the current page. Works with both static HTML and JavaScript-rendered content."
            .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "format": {
              "type": "string",
              "enum": ["html", "text"],
              "description": "Content format: 'html' for full HTML, 'text' for visible text only (default: text)"
            },
            "selector": {
              "type": "string",
              "description": "Optional CSS selector to get content of a specific element instead of the whole page"
            }
          },
          "required": ["profile_id"]
        }),
      },
      McpTool {
        name: "get_page_info".to_string(),
        description: "Get metadata about the current page including URL, title, and readiness state"
          .to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            }
          },
          "required": ["profile_id"]
        }),
      },
      McpTool {
        name: "get_interactive_elements".to_string(),
        description: "Enumerate visible interactive elements on the page (buttons, links, inputs, etc.) as a compact indexed list. The returned indices are stable for the current page and can be used with click_by_index and type_by_index instead of guessing CSS selectors. Call this before click_by_index / type_by_index, and re-call after any navigation or major DOM change. Far cheaper in tokens than get_page_content for agentic browsing.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "max_chars": {
              "type": "integer",
              "description": "Cap on the serialized output length (default: 40000). The response carries a `truncated` flag if the list was cut off — narrow the viewport or scroll if you need elements past the cutoff."
            }
          },
          "required": ["profile_id"]
        }),
      },
      McpTool {
        name: "click_by_index".to_string(),
        description: "Click the element at the given index from the last get_interactive_elements call. Indices are valid until the next navigation. If the click triggers navigation, waits for the new page to load before returning.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "index": {
              "type": "integer",
              "description": "Zero-based index from the last get_interactive_elements response"
            }
          },
          "required": ["profile_id", "index"]
        }),
      },
      McpTool {
        name: "type_by_index".to_string(),
        description: "Focus the element at the given index from the last get_interactive_elements call and type text into it. Same human-like-typing defaults as type_text; only set instant=true when you're sure the target lacks bot detection.".to_string(),
        input_schema: serde_json::json!({
          "type": "object",
          "properties": {
            "profile_id": {
              "type": "string",
              "description": "The UUID of the running profile"
            },
            "index": {
              "type": "integer",
              "description": "Zero-based index from the last get_interactive_elements response"
            },
            "text": {
              "type": "string",
              "description": "Text to type into the element"
            },
            "clear_first": {
              "type": "boolean",
              "description": "Clear the input before typing (default: true)"
            },
            "instant": {
              "type": "boolean",
              "description": "Paste all text at once instead of human typing. WARNING: only use on targets without bot detection."
            },
            "wpm": {
              "type": "number",
              "description": "Target words per minute for human typing (default: 80)"
            }
          },
          "required": ["profile_id", "index", "text"]
        }),
      },
    ]
  }
}
