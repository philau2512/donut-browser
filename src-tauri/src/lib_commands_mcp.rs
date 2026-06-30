// MCP server commands extracted from lib.rs

use tauri::Manager;

#[derive(serde::Serialize)]
pub struct McpConfig {
  pub port: u16,
  pub token: String,
}

#[tauri::command]
pub async fn start_mcp_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
  crate::mcp::mcp_server::McpServer::instance().start(app_handle).await
}

#[tauri::command]
pub async fn stop_mcp_server() -> Result<(), String> {
  crate::mcp::mcp_server::McpServer::instance().stop().await
}

#[tauri::command]
pub fn get_mcp_server_status() -> bool {
  crate::mcp::mcp_server::McpServer::instance().is_running()
}

#[tauri::command]
pub async fn get_mcp_config(app_handle: tauri::AppHandle) -> Result<Option<McpConfig>, String> {
  let mcp_server = crate::mcp::mcp_server::McpServer::instance();
  if !mcp_server.is_running() {
    return Ok(None);
  }

  let port = mcp_server
    .get_port()
    .ok_or("MCP server port not available")?;

  let settings_manager = crate::settings::settings_manager::SettingsManager::instance();
  let token = settings_manager
    .get_mcp_token(&app_handle)
    .await
    .map_err(|e| format!("Failed to get MCP token: {e}"))?
    .ok_or("MCP token not found")?;

  Ok(Some(McpConfig { port, token }))
}

fn claude_desktop_extension_dir() -> Option<std::path::PathBuf> {
  #[cfg(target_os = "macos")]
  {
    dirs::home_dir().map(|h| {
      h.join("Library")
        .join("Application Support")
        .join("Claude")
        .join("Claude Extensions")
        .join("local.mcpb.donut-browser.donut-browser")
    })
  }
  #[cfg(target_os = "windows")]
  {
    std::env::var("APPDATA").ok().map(|appdata| {
      std::path::PathBuf::from(appdata)
        .join("Claude")
        .join("Claude Extensions")
        .join("local.mcpb.donut-browser.donut-browser")
    })
  }
  #[cfg(target_os = "linux")]
  {
    dirs::config_dir().map(|c| {
      c.join("Claude")
        .join("Claude Extensions")
        .join("local.mcpb.donut-browser.donut-browser")
    })
  }
}

pub fn is_mcp_in_claude_desktop_internal() -> bool {
  let Some(dir) = claude_desktop_extension_dir() else {
    return false;
  };
  dir.join("manifest.json").exists()
}

pub async fn add_mcp_to_claude_desktop_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
  let mcp_server = crate::mcp::mcp_server::McpServer::instance();
  let port = mcp_server.get_port().ok_or("MCP server is not running")?;

  let settings_manager = crate::settings::settings_manager::SettingsManager::instance();
  let token = settings_manager
    .get_mcp_token(app_handle)
    .await
    .map_err(|e| format!("Failed to get MCP token: {e}"))?
    .ok_or("MCP token not found")?;

  let ext_dir = claude_desktop_extension_dir().ok_or("Unsupported platform")?;
  let server_dir = ext_dir.join("server");
  std::fs::create_dir_all(&server_dir)
    .map_err(|e| format!("Failed to create extension directory: {e}"))?;

  let mcp_url = format!("http://127.0.0.1:{port}/mcp/{token}");

  let manifest = serde_json::json!({
    "manifest_version": "0.3",
    "name": "donut-browser",
    "display_name": "Donut Browser",
    "version": env!("CARGO_PKG_VERSION"),
    "description": "Control Donut Browser profiles, proxies, and automation via MCP",
    "author": { "name": "Donut Browser" },
    "tools_generated": true,
    "server": {
      "type": "node",
      "entry_point": "server/index.js",
      "mcp_config": {
        "command": "node",
        "args": ["${__dirname}/server/index.js"],
        "env": {}
      }
    },
    "license": "AGPL-3.0"
  });
  std::fs::write(
    ext_dir.join("manifest.json"),
    serde_json::to_string_pretty(&manifest)
      .map_err(|e| format!("Failed to serialize manifest: {e}"))?,
  )
  .map_err(|e| format!("Failed to write manifest: {e}"))?;

  let bridge_js = format!(
    r#"#!/usr/bin/env node
const http = require("http");
const readline = require("readline");
const MCP_URL = "{mcp_url}";
let sid = null;
function post(line) {{
  return new Promise((resolve, reject) => {{
    const u = new URL(MCP_URL);
    const o = {{
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: {{ "Content-Type": "application/json", Accept: "application/json" }},
    }};
    if (sid) o.headers["mcp-session-id"] = sid;
    const r = http.request(o, (res) => {{
      const s = res.headers["mcp-session-id"];
      if (s) sid = s;
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve(b));
    }});
    r.on("error", reject);
    r.write(line);
    r.end();
  }});
}}
const rl = readline.createInterface({{ input: process.stdin, crlfDelay: Infinity }});
rl.on("line", (line) => {{
  if (!line.trim()) return;
  let notif = false;
  try {{ notif = JSON.parse(line).id == null; }} catch {{}}
  post(line).then((b) => {{
    if (!notif && b.trim()) process.stdout.write(b.trim() + "\n");
  }}).catch((e) => {{
    if (!notif) process.stdout.write(JSON.stringify({{
      jsonrpc: "2.0", id: null, error: {{ code: -32000, message: "HTTP error: " + e.message }}
    }}) + "\n");
  }});
}});
rl.on("close", () => setTimeout(() => process.exit(0), 500));
"#
  );
  std::fs::write(server_dir.join("index.js"), bridge_js)
    .map_err(|e| format!("Failed to write bridge script: {e}"))?;

  // Update the extensions-installations.json registry so Claude Desktop picks it up
  update_claude_extensions_registry("local.mcpb.donut-browser.donut-browser", Some(manifest))?;

  Ok(())
}

pub fn remove_mcp_from_claude_desktop_internal() -> Result<(), String> {
  let ext_dir = claude_desktop_extension_dir().ok_or("Unsupported platform")?;
  if ext_dir.exists() {
    std::fs::remove_dir_all(&ext_dir).map_err(|e| format!("Failed to remove extension: {e}"))?;
  }
  update_claude_extensions_registry("local.mcpb.donut-browser.donut-browser", None)?;
  Ok(())
}

fn update_claude_extensions_registry(
  ext_id: &str,
  manifest: Option<serde_json::Value>,
) -> Result<(), String> {
  let registry_path = claude_desktop_extension_dir()
    .ok_or("Unsupported platform")?
    .parent()
    .and_then(|p| p.parent())
    .map(|p| p.join("extensions-installations.json"))
    .ok_or("Failed to resolve registry path")?;

  let mut registry: serde_json::Value = if registry_path.exists() {
    let content = std::fs::read_to_string(&registry_path)
      .map_err(|e| format!("Failed to read registry: {e}"))?;
    serde_json::from_str(&content).unwrap_or(serde_json::json!({"extensions": {}}))
  } else {
    serde_json::json!({"extensions": {}})
  };

  if registry.get("extensions").is_none() {
    registry["extensions"] = serde_json::json!({});
  }

  match manifest {
    Some(m) => {
      registry["extensions"][ext_id] = serde_json::json!({
        "id": ext_id,
        "version": m.get("version").and_then(|v| v.as_str()).unwrap_or("0.0.0"),
        "hash": "",
        "installedAt": chrono::Utc::now().to_rfc3339(),
        "manifest": m,
        "signatureInfo": { "status": "unsigned" },
        "source": "local"
      });
    }
    None => {
      if let Some(exts) = registry
        .get_mut("extensions")
        .and_then(|e| e.as_object_mut())
      {
        exts.remove(ext_id);
      }
    }
  }

  let output =
    serde_json::to_string(&registry).map_err(|e| format!("Failed to serialize registry: {e}"))?;
  let tmp = registry_path.with_extension("json.tmp");
  std::fs::write(&tmp, &output).map_err(|e| format!("Failed to write registry: {e}"))?;
  std::fs::rename(&tmp, &registry_path).map_err(|e| format!("Failed to save registry: {e}"))?;
  Ok(())
}

pub async fn current_mcp_url(app_handle: &tauri::AppHandle) -> Result<String, String> {
  let mcp_server = crate::mcp::mcp_server::McpServer::instance();
  let port = mcp_server.get_port().ok_or("MCP server is not running")?;
  let settings_manager = crate::settings::settings_manager::SettingsManager::instance();
  let token = settings_manager
    .get_mcp_token(app_handle)
    .await
    .map_err(|e| format!("Failed to get MCP token: {e}"))?
    .ok_or("MCP token not found")?;
  Ok(format!("http://127.0.0.1:{port}/mcp/{token}"))
}
