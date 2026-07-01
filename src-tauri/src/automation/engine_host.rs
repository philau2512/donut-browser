// Local HTTP bridge for the automation sidecar (openProfile / closeProfile).
// Listens on 127.0.0.1 only; port published via AUTOMATION_ENGINE_HOST env.

use axum::{
  extract::State,
  http::StatusCode,
  response::{IntoResponse, Json},
  routing::post,
  Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

use crate::automation::profile_node::{
  execute_close_profile, execute_open_profile, execute_open_profile_automation_only,
};
use crate::commands::automation_profile::AutomationConfig;

#[derive(Clone)]
struct HostState {
  _base_url: String,
}

#[derive(Debug, Deserialize)]
struct OpenProfileBody {
  #[serde(rename = "profileId")]
  profile_id: String,
  automation: Option<AutomationConfig>,
  #[serde(rename = "runProfileId")]
  run_profile_id: Option<String>,
  #[serde(rename = "cdpPort")]
  cdp_port: Option<u16>,
}

#[derive(Debug, Serialize)]
struct OpenProfileResponse {
  #[serde(rename = "cdpPort")]
  cdp_port: u16,
  #[serde(rename = "browserPid")]
  browser_pid: u32,
  #[serde(rename = "proxyIp")]
  proxy_ip: Option<String>,
  #[serde(rename = "ipCountry")]
  ip_country: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CloseProfileBody {
  #[serde(rename = "profileId")]
  profile_id: String,
  #[serde(rename = "cleanupMode")]
  cleanup_mode: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
  error: String,
}

async fn open_profile(
  State(_state): State<Arc<HostState>>,
  Json(body): Json<OpenProfileBody>,
) -> impl IntoResponse {
  let reuse_run = body
    .run_profile_id
    .as_ref()
    .map(|r| r == &body.profile_id)
    .unwrap_or(false)
    && body.cdp_port.is_some();

  let result = if reuse_run {
    execute_open_profile_automation_only(
      body.profile_id,
      body.automation,
      body.cdp_port.unwrap_or(0),
    )
    .await
  } else {
    execute_open_profile(body.profile_id, body.automation).await
  };


  match result {
    Ok(r) => (
      StatusCode::OK,
      Json(OpenProfileResponse {
        cdp_port: r.cdp_port,
        browser_pid: r.browser_pid,
        proxy_ip: r.proxy_ip,
        ip_country: r.ip_country,
      }),
    )
      .into_response(),
    Err(e) => (StatusCode::BAD_REQUEST, Json(ErrorBody { error: e })).into_response(),
  }
}

async fn close_profile(
  State(_state): State<Arc<HostState>>,
  Json(body): Json<CloseProfileBody>,
) -> impl IntoResponse {
  let mode = body.cleanup_mode.unwrap_or_else(|| "cookies".to_string());
  match execute_close_profile(body.profile_id, mode).await {
    Ok(()) => (StatusCode::OK, Json(Value::Object(Default::default()))).into_response(),
    Err(e) => (StatusCode::BAD_REQUEST, Json(ErrorBody { error: e })).into_response(),
  }
}

static HOST_URL: Mutex<Option<String>> = Mutex::new(None);

/// Base URL for sidecar (e.g. `http://127.0.0.1:45123`).
pub fn automation_engine_host_url() -> Option<String> {
  HOST_URL.lock().ok().and_then(|g| g.clone())
}

/// Spawn the engine host on 127.0.0.1; sets `AUTOMATION_ENGINE_HOST` for child processes.
pub async fn start_automation_engine_host() -> Result<String, String> {
  let listener = TcpListener::bind("127.0.0.1:0")
    .await
    .map_err(|e| format!("automation engine host bind failed: {e}"))?;
  let port = listener
    .local_addr()
    .map_err(|e| format!("automation engine host local_addr: {e}"))?
    .port();
  let base_url = format!("http://127.0.0.1:{port}");

  let state = Arc::new(HostState {
    _base_url: base_url.clone(),
  });

  let app = Router::new()
    .route("/open-profile", post(open_profile))
    .route("/close-profile", post(close_profile))
    .with_state(state);

  tokio::spawn(async move {
    if let Err(e) = axum::serve(listener, app).await {
      log::error!("[AUTOMATION] engine host stopped: {e}");
    }
  });

  if let Ok(mut guard) = HOST_URL.lock() {
    *guard = Some(base_url.clone());
  }
  std::env::set_var("AUTOMATION_ENGINE_HOST", &base_url);
  log::info!("[AUTOMATION] engine host listening on {base_url}");
  Ok(base_url)
}
