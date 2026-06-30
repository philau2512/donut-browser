use axum::{
  body::Body,
  extract::State,
  http::{header, Request, StatusCode},
  middleware::{self, Next},
  response::{IntoResponse, Response},
  routing::{get, post},
  Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::api::cloud_auth::CLOUD_AUTH;
use crate::browser::human_typing::{MarkovTyper, TypingAction};
use crate::browser::wayfern_terms::WayfernTermsManager;
use crate::browser::ProxySettings;
use crate::profile::group_manager::GROUP_MANAGER;
use crate::profile::{BrowserProfile, ProfileManager};
use crate::proxy::proxy_manager::PROXY_MANAGER;
use crate::proxy::proxy_manager::{ProxyManager, ProxyParseResult};
use crate::settings::settings_manager::SettingsManager;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
  pub name: String,
  pub description: String,
  pub input_schema: serde_json::Value,
}

/// JavaScript executed in the target page to enumerate visible interactive
/// elements. Returns a JSON string `{elements, count, truncated}` where
/// `elements` is the newline-joined labeled list. Live references are stashed
/// on `window.__donut_interactive` so subsequent `click_by_index` /
/// `type_by_index` calls can resolve `index → Element` without round-tripping
/// a selector. `__MAX_CHARS__` is substituted at call time.
const INTERACTIVE_ELEMENTS_JS: &str = r#"(() => {
  const SELECTORS = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="combobox"], [role="option"], [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const ATTRS = ['type','name','id','role','aria-label','aria-checked','aria-expanded','placeholder','title','value','href','alt'];
  const MAX_CHARS = __MAX_CHARS__;
  const interactive = [];
  const lines = [];
  let truncated = false;
  let total = 0;
  const nodes = document.querySelectorAll(SELECTORS);
  for (const el of nodes) {
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    const tag = el.tagName.toLowerCase();
    const parts = [];
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) parts.push(a + '="' + String(v).slice(0,100).replace(/"/g,'\\"') + '"');
    }
    let text = '';
    if (!['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) {
      text = (el.innerText || el.textContent || '').trim().replace(/\s+/g,' ').slice(0,100);
    }
    const idx = interactive.length;
    const line = '[' + idx + ']<' + tag + (parts.length ? ' ' + parts.join(' ') : '') + '>' + text + '</' + tag + '>';
    if (total + line.length + 1 > MAX_CHARS) { truncated = true; break; }
    total += line.length + 1;
    interactive.push(el);
    lines.push(line);
  }
  window.__donut_interactive = interactive;
  return JSON.stringify({ elements: lines.join('\n'), count: interactive.length, truncated: truncated });
})()"#;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct McpRequest {
  jsonrpc: String,
  id: Option<serde_json::Value>,
  method: String,
  params: Option<serde_json::Value>,
}

const PROTOCOL_VERSION: &str = "2025-11-25";
const SERVER_NAME: &str = "donut-browser";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize)]
pub struct McpResponse {
  jsonrpc: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  id: Option<serde_json::Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  result: Option<serde_json::Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<McpError>,
}

#[derive(Debug, Serialize)]
pub struct McpError {
  code: i32,
  message: String,
}

const DEFAULT_MCP_PORT: u16 = 51080;

struct McpSession {
  initialized: bool,
}

struct McpServerInner {
  app_handle: Option<AppHandle>,
  token: Option<String>,
  shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
  sessions: HashMap<String, McpSession>,
}

#[derive(Clone)]
struct McpHttpState {
  server: &'static McpServer,
  token: String,
}

pub struct McpServer {
  inner: Arc<AsyncMutex<McpServerInner>>,
  is_running: AtomicBool,
  port: AtomicU16,
}

impl McpServer {
  fn new() -> Self {
    Self {
      inner: Arc::new(AsyncMutex::new(McpServerInner {
        app_handle: None,
        token: None,
        shutdown_tx: None,
        sessions: HashMap::new(),
      })),
      is_running: AtomicBool::new(false),
      port: AtomicU16::new(0),
    }
  }

  pub fn instance() -> &'static McpServer {
    &MCP_SERVER
  }

  pub fn is_running(&self) -> bool {
    self.is_running.load(Ordering::SeqCst)
  }

  /// Gate an MCP tool on a capability the caller already resolved (e.g.
  /// `CLOUD_AUTH.can_use_browser_automation().await`). Logs the rejected gate
  /// with enough state for support to diagnose, without leaking secrets.
  async fn require_capability(feature: &str, allowed: bool) -> Result<(), McpError> {
    if !allowed {
      let summary = match CLOUD_AUTH.get_user().await {
        Some(state) => format!(
          "logged_in=true plan={} status={} period={:?}",
          state.user.plan, state.user.subscription_status, state.user.plan_period,
        ),
        None => "logged_in=false".to_string(),
      };
      log::warn!("[mcp] Rejected '{feature}' — plan does not include it ({summary})");
      return Err(McpError {
        code: -32000,
        message: format!("{feature} requires a plan that includes this feature"),
      });
    }
    Ok(())
  }

  pub fn get_port(&self) -> Option<u16> {
    let port = self.port.load(Ordering::SeqCst);
    if port > 0 {
      Some(port)
    } else {
      None
    }
  }

  pub async fn start(&self, app_handle: AppHandle) -> Result<u16, String> {
    if !WayfernTermsManager::instance().is_terms_accepted() {
      return Err(
        "Wayfern Terms and Conditions must be accepted before starting MCP server".to_string(),
      );
    }

    if self.is_running() {
      return Err("MCP server is already running".to_string());
    }

    let settings_manager = SettingsManager::instance();
    let settings = settings_manager
      .load_settings()
      .map_err(|e| format!("Failed to load settings: {e}"))?;

    // Get or generate token
    let existing_token = settings_manager
      .get_mcp_token(&app_handle)
      .await
      .ok()
      .flatten();

    let token = if let Some(t) = existing_token {
      t
    } else {
      settings_manager
        .generate_mcp_token(&app_handle)
        .await
        .map_err(|e| format!("Failed to generate MCP token: {e}"))?
    };

    // Determine port (use saved port, or try default, or random)
    let preferred_port = settings.mcp_port.unwrap_or(DEFAULT_MCP_PORT);
    let actual_port = self.bind_to_available_port(preferred_port).await?;

    // Save port if it changed
    if settings.mcp_port != Some(actual_port) {
      let mut new_settings = settings;
      new_settings.mcp_port = Some(actual_port);
      settings_manager
        .save_settings(&new_settings)
        .map_err(|e| format!("Failed to save settings: {e}"))?;
    }

    // Store state
    let mut inner = self.inner.lock().await;
    inner.app_handle = Some(app_handle);
    inner.token = Some(token.clone());

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    inner.shutdown_tx = Some(shutdown_tx);

    self.port.store(actual_port, Ordering::SeqCst);
    self.is_running.store(true, Ordering::SeqCst);

    // Start HTTP server in background
    let http_state = McpHttpState {
      server: McpServer::instance(),
      token,
    };
    tokio::spawn(Self::run_http_server(actual_port, http_state, shutdown_rx));

    log::info!("[mcp] Server started on port {}", actual_port);
    Ok(actual_port)
  }

  async fn bind_to_available_port(&self, preferred: u16) -> Result<u16, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], preferred));
    if TcpListener::bind(addr).await.is_ok() {
      return Ok(preferred);
    }

    for _ in 0..10 {
      let port = 51000 + (rand::random::<u16>() % 1000);
      let addr = SocketAddr::from(([127, 0, 0, 1], port));
      if TcpListener::bind(addr).await.is_ok() {
        return Ok(port);
      }
    }

    Err("Could not find available port for MCP server".to_string())
  }

  async fn run_http_server(
    port: u16,
    state: McpHttpState,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
  ) {
    let app = Router::new()
      .route(
        "/mcp/{token}",
        post(Self::handle_mcp_post)
          .get(Self::handle_mcp_get)
          .delete(Self::handle_mcp_delete),
      )
      .route(
        "/mcp",
        post(Self::handle_mcp_post)
          .get(Self::handle_mcp_get)
          .delete(Self::handle_mcp_delete),
      )
      .route("/health", get(Self::handle_health))
      // Inert chokepoint (innermost → runs after auth) for the future per-hour
      // automation request limit. See rate_limit_middleware.
      .layer(middleware::from_fn(Self::rate_limit_middleware))
      .layer(middleware::from_fn_with_state(
        state.clone(),
        Self::auth_middleware,
      ))
      .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let server = async {
      match TcpListener::bind(addr).await {
        Ok(listener) => {
          log::info!("[mcp] Server listening on http://127.0.0.1:{}/mcp", port);
          if let Err(e) = axum::serve(listener, app).await {
            log::error!("[mcp] Server error: {}", e);
          }
        }
        Err(e) => {
          log::error!("[mcp] Failed to bind on port {}: {}", port, e);
        }
      }
    };

    tokio::select! {
      _ = server => {},
      _ = shutdown_rx => {
        log::info!("[mcp] Server shutting down");
      },
    }
  }

  /// Chokepoint for the future per-hour automation request limit, mirroring the
  /// REST API's. The limit (`requests_per_hour`, default 100) is plumbed through
  /// entitlements; this is intentionally inert today — it resolves the limit but
  /// never blocks. To enforce, count authenticated tool calls per rolling hour
  /// and return StatusCode::TOO_MANY_REQUESTS once the limit (when > 0) is hit.
  async fn rate_limit_middleware(req: Request<Body>, next: Next) -> Result<Response, StatusCode> {
    let _requests_per_hour = CLOUD_AUTH.requests_per_hour().await;
    // TODO(rate-limit): enforce `_requests_per_hour` for MCP tool calls.
    Ok(next.run(req).await)
  }

  async fn auth_middleware(
    State(state): State<McpHttpState>,
    req: Request<Body>,
    next: Next,
  ) -> Result<Response, StatusCode> {
    let path = req.uri().path();

    if path == "/health" {
      return Ok(next.run(req).await);
    }

    // Check token from URL path: /mcp/{token}
    let path_token = path
      .strip_prefix("/mcp/")
      .filter(|t| !t.is_empty() && !t.contains('/'));

    // Check token from Authorization header
    let header_token = req
      .headers()
      .get(header::AUTHORIZATION)
      .and_then(|h| h.to_str().ok())
      .and_then(|h| h.strip_prefix("Bearer "));

    // Constant-time comparison to avoid leaking the token prefix via timing.
    use subtle::ConstantTimeEq;
    let expected = state.token.as_bytes();
    let ct_eq = |t: Option<&str>| {
      t.is_some_and(|t| {
        let b = t.as_bytes();
        b.len() == expected.len() && b.ct_eq(expected).into()
      })
    };
    let valid = ct_eq(path_token) || ct_eq(header_token);

    if !valid {
      return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(req).await)
  }

  async fn handle_health() -> impl IntoResponse {
    Json(serde_json::json!({
      "status": "ok",
      "server": SERVER_NAME,
      "version": SERVER_VERSION,
      "protocolVersion": PROTOCOL_VERSION,
    }))
  }

  async fn handle_mcp_get() -> impl IntoResponse {
    // We don't support server-initiated SSE streams
    StatusCode::METHOD_NOT_ALLOWED
  }

  async fn handle_mcp_delete(
    State(state): State<McpHttpState>,
    req: Request<Body>,
  ) -> impl IntoResponse {
    let session_id = req
      .headers()
      .get("mcp-session-id")
      .and_then(|h| h.to_str().ok())
      .map(|s| s.to_string());

    if let Some(sid) = session_id {
      let mut inner = state.server.inner.lock().await;
      inner.sessions.remove(&sid);
      log::info!("[mcp] Session terminated: {}", sid);
    }

    StatusCode::OK
  }

  async fn handle_mcp_post(State(state): State<McpHttpState>, req: Request<Body>) -> Response {
    let session_id = req
      .headers()
      .get("mcp-session-id")
      .and_then(|h| h.to_str().ok())
      .map(|s| s.to_string());

    let body_bytes = match axum::body::to_bytes(req.into_body(), 1024 * 1024).await {
      Ok(b) => b,
      Err(_) => {
        return (StatusCode::BAD_REQUEST, "Invalid request body").into_response();
      }
    };

    let request: McpRequest = match serde_json::from_slice(&body_bytes) {
      Ok(r) => r,
      Err(_) => {
        return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response();
      }
    };

    let is_notification = request.id.is_none();
    let method = request.method.clone();

    // Handle initialize (no session required)
    if method == "initialize" {
      let response = state.server.handle_initialize(request).await;
      match response {
        Ok((session_id, result)) => {
          let body = McpResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(result.0),
            result: Some(result.1),
            error: None,
          };
          Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header("mcp-session-id", &session_id)
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
        }
        Err((id, error)) => {
          let body = McpResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(id),
            result: None,
            error: Some(error),
          };
          Json(body).into_response()
        }
      }
    } else if is_notification {
      // Notifications (like notifications/initialized) -> 202 Accepted
      if method == "notifications/initialized" {
        if let Some(sid) = &session_id {
          let mut inner = state.server.inner.lock().await;
          if let Some(session) = inner.sessions.get_mut(sid) {
            session.initialized = true;
          }
        }
      }
      StatusCode::ACCEPTED.into_response()
    } else {
      // Validate session exists
      if let Some(sid) = &session_id {
        let inner = state.server.inner.lock().await;
        if !inner.sessions.contains_key(sid) {
          return StatusCode::NOT_FOUND.into_response();
        }
      }

      let response = state.server.handle_request(request).await;
      Json(response).into_response()
    }
  }

  pub async fn stop(&self) -> Result<(), String> {
    if !self.is_running() {
      return Err("MCP server is not running".to_string());
    }

    let mut inner = self.inner.lock().await;
    inner.app_handle = None;
    inner.token = None;
    inner.sessions.clear();

    // Send shutdown signal
    if let Some(tx) = inner.shutdown_tx.take() {
      let _ = tx.send(());
    }

    self.port.store(0, Ordering::SeqCst);
    self.is_running.store(false, Ordering::SeqCst);

    log::info!("[mcp] Server stopped");
    Ok(())
  }

  async fn handle_initialize(
    &self,
    request: McpRequest,
  ) -> Result<(String, (serde_json::Value, serde_json::Value)), (serde_json::Value, McpError)> {
    let id = request.id.clone().unwrap_or(serde_json::Value::Null);

    if !self.is_running() {
      return Err((
        id,
        McpError {
          code: -32001,
          message: "MCP server is not running".to_string(),
        },
      ));
    }

    // Create session
    let session_id = Uuid::new_v4().to_string();
    {
      let mut inner = self.inner.lock().await;
      inner
        .sessions
        .insert(session_id.clone(), McpSession { initialized: false });
    }

    let result = serde_json::json!({
      "protocolVersion": PROTOCOL_VERSION,
      "capabilities": {
        "tools": {
          "listChanged": false
        }
      },
      "serverInfo": {
        "name": SERVER_NAME,
        "version": SERVER_VERSION,
      },
      "instructions": "Donut Browser MCP server. Use tools/list to discover available browser automation tools."
    });

    log::info!("[mcp] New session initialized: {}", session_id);
    Ok((session_id, (id, result)))
  }

  pub async fn handle_request(&self, request: McpRequest) -> McpResponse {
    let id = request.id.clone().unwrap_or(serde_json::Value::Null);

    if !self.is_running() {
      return McpResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(id),
        result: None,
        error: Some(McpError {
          code: -32001,
          message: "MCP server is not running".to_string(),
        }),
      };
    }

    let result = match request.method.as_str() {
      "ping" => Ok(serde_json::json!({})),
      "tools/list" => self.handle_tools_list().await,
      "tools/call" => self.handle_tool_call(request.params).await,
      _ => Err(McpError {
        code: -32601,
        message: format!("Method not found: {}", request.method),
      }),
    };

    match result {
      Ok(value) => McpResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(id),
        result: Some(value),
        error: None,
      },
      Err(error) => McpResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(id),
        result: None,
        error: Some(error),
      },
    }
  }

  async fn handle_tools_list(&self) -> Result<serde_json::Value, McpError> {
    Ok(serde_json::json!({
      "tools": self.get_tools()
    }))
  }
}

include!("tools.rs");
include!("handlers.rs");
