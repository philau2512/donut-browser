use crate::browser::browser_runner::BrowserRunner;
use crate::browser::wayfern_launch_args::{
  build_wayfern_launch_args, resolve_webrtc_mode, WayfernLaunchArgsOptions,
  WAYFERN_DISABLE_FEATURES,
};
use crate::profile::BrowserProfile;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex as AsyncMutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WayfernConfig {
  #[serde(default)]
  pub fingerprint: Option<String>,
  #[serde(default)]
  pub randomize_fingerprint_on_launch: Option<bool>,
  #[serde(default)]
  pub os: Option<String>,
  #[serde(default)]
  pub screen_max_width: Option<u32>,
  #[serde(default)]
  pub screen_max_height: Option<u32>,
  #[serde(default)]
  pub screen_min_width: Option<u32>,
  #[serde(default)]
  pub screen_min_height: Option<u32>,
  #[serde(default)]
  pub geoip: Option<serde_json::Value>, // For compatibility with shared config form
  #[serde(default)]
  pub block_images: Option<bool>, // For compatibility with shared config form
  #[serde(default)]
  pub block_webrtc: Option<bool>,
  #[serde(default)]
  pub webrtc_mode: Option<String>,
  #[serde(default)]
  pub block_webgl: Option<bool>,
  #[serde(default, skip_serializing)]
  pub proxy: Option<String>,
  /// Stable signature of the proxy/VPN/geoip the fingerprint's location data
  /// (timezone, latitude/longitude, language) was last computed for. Compared
  /// on launch to detect that the routing changed since creation, so the
  /// location can be refreshed instead of showing stale data.
  #[serde(default)]
  pub geo_proxy_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct WayfernLaunchResult {
  pub id: String,
  #[serde(alias = "process_id")]
  pub processId: Option<u32>,
  #[serde(alias = "profile_path")]
  pub profilePath: Option<String>,
  pub url: Option<String>,
  pub cdp_port: Option<u16>,
  /// The fingerprint Wayfern actually applied, echoed back by
  /// Wayfern.setFingerprint. It may be UPGRADED from the stored fingerprint
  /// (e.g. when the stored one targets an older browser version). Internal
  /// only — the caller persists it to the profile; never sent to the frontend.
  #[serde(default, skip_serializing)]
  pub used_fingerprint: Option<String>,
}

struct WayfernInstance {
  id: String,
  process_id: Option<u32>,
  profile_path: Option<String>,
  url: Option<String>,
  cdp_port: Option<u16>,
  /// CDP params last sent to `Wayfern.setFingerprint` — used to re-spoof new tabs.
  fingerprint_params: Option<Arc<serde_json::Value>>,
  /// Page-target WebSocket URLs that already received `Wayfern.setFingerprint`.
  fingerprinted_targets: Arc<AsyncMutex<HashSet<String>>>,
  /// Signals the background fingerprint watcher to stop when the instance is torn down.
  /// Uses watch channel (bool) for reliable cancellation signaling.
  watcher_cancel: Option<tokio::sync::watch::Sender<bool>>,
}

struct WayfernManagerInner {
  instances: HashMap<String, WayfernInstance>,
}

pub struct WayfernManager {
  inner: Arc<AsyncMutex<WayfernManagerInner>>,
  http_client: Client,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CdpTarget {
  id: Option<String>,
  #[serde(rename = "type")]
  target_type: String,
  #[serde(rename = "webSocketDebuggerUrl")]
  websocket_debugger_url: Option<String>,
}

impl WayfernManager {
  fn new() -> Self {
    Self {
      inner: Arc::new(AsyncMutex::new(WayfernManagerInner {
        instances: HashMap::new(),
      })),
      http_client: Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .expect("Failed to build reqwest client for wayfern_manager"),
    }
  }

  pub fn instance() -> &'static WayfernManager {
    &WAYFERN_MANAGER
  }

  #[allow(dead_code)]
  pub fn get_profiles_dir(&self) -> PathBuf {
    crate::settings::app_dirs::profiles_dir()
  }

  #[allow(dead_code)]
  fn get_binaries_dir(&self) -> PathBuf {
    crate::settings::app_dirs::binaries_dir()
  }

  async fn find_free_port() -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
  }

  /// Normalize fingerprint data from Wayfern CDP format to our storage format.
  /// Wayfern returns fields like fonts, webglParameters as JSON strings which we keep as-is.
  fn normalize_fingerprint(fingerprint: serde_json::Value) -> serde_json::Value {
    // Our storage format matches what Wayfern returns:
    // - fonts, plugins, mimeTypes, voices are JSON strings
    // - webglParameters, webgl2Parameters, etc. are JSON strings
    // The form displays them as JSON text areas, so no conversion needed.
    fingerprint
  }

  /// Denormalize fingerprint data from our storage format to Wayfern CDP format.
  /// Wayfern expects certain fields as JSON strings.
  fn denormalize_fingerprint(fingerprint: serde_json::Value) -> serde_json::Value {
    // Our storage format matches what Wayfern expects:
    // - fonts, plugins, mimeTypes, voices are JSON strings
    // - webglParameters, webgl2Parameters, etc. are JSON strings
    // So no conversion is needed
    fingerprint
  }

  /// Derive the on-screen window size Chromium should open at, from the stored
  /// fingerprint. `Wayfern.setFingerprint` only spoofs what the page *reports*
  /// for `windowOuterWidth`/`screenWidth`/etc.; it does not move or resize the
  /// real top-level window. Without `--window-size` the OS window keeps
  /// Chromium's default, so the visible window contradicts the reported
  /// dimensions — a detectable mismatch. We pass `--window-size` so the actual
  /// window matches the fingerprint.
  ///
  /// Keys are the camelCase fields Wayfern uses in its fingerprint
  /// (`windowOuterWidth`, `screenAvailWidth`, …) — NOT the dotted
  /// Camoufox-style keys. Preference order, matching how the fingerprint
  /// describes the window:
  /// 1. `windowOuterWidth` / `windowOuterHeight` — the real window size.
  /// 2. `screenAvailWidth` / `screenAvailHeight` — usable screen area.
  /// 3. `screenWidth` / `screenHeight` — full screen.
  ///
  /// Returns `None` when the fingerprint carries no usable dimensions, leaving
  /// Chromium's default untouched. The fingerprint JSON may be the bare object
  /// or the legacy `{ "fingerprint": {...} }` wrapper.
  fn window_size_from_fingerprint(fingerprint_json: &str) -> Option<(u32, u32)> {
    let parsed: serde_json::Value = serde_json::from_str(fingerprint_json).ok()?;
    let fp = parsed.get("fingerprint").unwrap_or(&parsed);
    let obj = fp.as_object()?;

    // Accept both numeric and stringified numbers (Wayfern emits numbers, but a
    // CDP echo or older saved fingerprint may stringify them).
    let read = |key: &str| -> Option<u32> {
      let v = obj.get(key)?;
      v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<u64>().ok()))
        .filter(|n| *n > 0)
        .map(|n| n as u32)
    };
    let pair = |w: &str, h: &str| -> Option<(u32, u32)> { Some((read(w)?, read(h)?)) };

    pair("windowOuterWidth", "windowOuterHeight")
      .or_else(|| pair("screenAvailWidth", "screenAvailHeight"))
      .or_else(|| pair("screenWidth", "screenHeight"))
  }

  async fn wait_for_cdp_ready(
    &self,
    port: u16,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("http://127.0.0.1:{port}/json/version");
    // On first launch, macOS Gatekeeper verifies the binary which can take 30+ seconds.
    // Use a generous timeout (60s) to handle this.
    let max_attempts = 120;
    let delay = Duration::from_millis(500);

    let mut last_error: Option<String> = None;
    for attempt in 0..max_attempts {
      match self.http_client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
          log::info!("CDP ready on port {port} after {attempt} attempts");
          return Ok(());
        }
        Ok(resp) => {
          last_error = Some(format!("HTTP {} from {url}", resp.status()));
          tokio::time::sleep(delay).await;
        }
        Err(e) => {
          last_error = Some(format!("request failed: {e}"));
          tokio::time::sleep(delay).await;
        }
      }
    }

    let detail = last_error.unwrap_or_else(|| "no attempts completed".to_string());
    // Log at error level so we can diagnose Windows/AV/firewall-induced CDP hangs
    // in customer reports without needing them to reproduce in the moment.
    log::error!("CDP not ready after {max_attempts} attempts on port {port}: {detail}");
    Err(format!("CDP not ready after {max_attempts} attempts on port {port}: {detail}").into())
  }

  async fn get_cdp_targets(
    &self,
    port: u16,
  ) -> Result<Vec<CdpTarget>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("http://127.0.0.1:{port}/json");
    let resp = self.http_client.get(&url).send().await?;
    let targets: Vec<CdpTarget> = resp.json().await?;
    Ok(targets)
  }

  async fn send_cdp_command(
    &self,
    ws_url: &str,
    method: &str,
    params: serde_json::Value,
  ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
    let (mut ws_stream, _) = connect_async(ws_url).await?;

    let command = json!({
      "id": 1,
      "method": method,
      "params": params
    });

    use futures_util::sink::SinkExt;
    use futures_util::stream::StreamExt;

    ws_stream
      .send(Message::Text(command.to_string().into()))
      .await?;

    while let Some(msg) = ws_stream.next().await {
      match msg? {
        Message::Text(text) => {
          let response: serde_json::Value = serde_json::from_str(text.as_str())?;
          if response.get("id") == Some(&json!(1)) {
            if let Some(error) = response.get("error") {
              return Err(format!("CDP error: {}", error).into());
            }
            return Ok(response.get("result").cloned().unwrap_or(json!({})));
          }
        }
        Message::Close(_) => break,
        _ => {}
      }
    }

    Err("No response received from CDP".into())
  }

  /// Stable signature describing what determines this profile's geolocation
  /// (timezone, latitude/longitude, language): the geoip mode first, then the
  /// VPN, the proxy, or a direct connection. Compared across creation and
  /// launch to detect a change. The VPN case keys off `vpn_id` rather than the
  /// per-launch local port, and the proxy case off type/host/port/username so
  /// that editing the proxy is also caught.
  pub fn geo_signature(
    proxy: Option<&crate::browser::ProxySettings>,
    vpn_id: Option<&str>,
    geoip: Option<&serde_json::Value>,
  ) -> String {
    match geoip {
      Some(serde_json::Value::Bool(false)) => "off".to_string(),
      Some(serde_json::Value::String(ip)) if !ip.is_empty() => format!("ip:{ip}"),
      _ => {
        if let Some(id) = vpn_id {
          format!("vpn:{id}")
        } else if let Some(p) = proxy {
          format!(
            "proxy:{}://{}@{}:{}",
            p.proxy_type.to_lowercase(),
            p.username.as_deref().unwrap_or(""),
            p.host,
            p.port
          )
        } else {
          "direct".to_string()
        }
      }
    }
  }

  /// Apply timezone/geolocation fields to a fingerprint object from the proxy's
  /// exit IP (or a fixed geoip IP). Mutates `fingerprint` in place. Returns true
  /// if fresh geolocation was fetched and applied, false if geolocation is
  /// disabled or could not be resolved (in which case only safe defaults are
  /// filled in). Shared by fingerprint generation and the launch-time refresh
  /// so both produce identical location data.
  async fn apply_geolocation(
    fingerprint: &mut serde_json::Value,
    proxy: Option<&str>,
    geoip: Option<&serde_json::Value>,
  ) -> bool {
    // Default to auto-detect; only an explicit `false` disables geolocation.
    let should_geolocate = !matches!(geoip, Some(serde_json::Value::Bool(false)));
    if !should_geolocate {
      return false;
    }

    let geo_result = async {
      let ip = match geoip {
        Some(serde_json::Value::String(ip_str)) => ip_str.clone(),
        _ => crate::proxy::ip_utils::fetch_public_ip(proxy)
          .await
          .map_err(|e| format!("Failed to fetch public IP: {e}"))?,
      };
      crate::browser::camoufox::geolocation::get_geolocation(&ip)
        .map_err(|e| format!("Failed to get geolocation for IP {ip}: {e}"))
    }
    .await;

    match geo_result {
      Ok(geo) => {
        if let Some(obj) = fingerprint.as_object_mut() {
          obj.insert("timezone".to_string(), json!(geo.timezone));
          // Calculate timezone offset from IANA timezone name
          if let Ok(tz) = geo.timezone.parse::<chrono_tz::Tz>() {
            use chrono::Offset;
            let now = chrono::Utc::now().with_timezone(&tz);
            let offset_seconds = now.offset().fix().local_minus_utc();
            // timezoneOffset = minutes west of UTC (Firefox convention)
            // America/Los_Angeles (PDT) = +420, Europe/London (BST) = -60
            let offset_minutes = offset_seconds / 60;
            obj.insert("timezoneOffset".to_string(), json!(offset_minutes));
          }
          obj.insert("latitude".to_string(), json!(geo.latitude));
          obj.insert("longitude".to_string(), json!(geo.longitude));
          let locale_str = geo.locale.as_string();
          obj.insert("language".to_string(), json!(&locale_str));
          obj.insert(
            "languages".to_string(),
            json!([&locale_str, &geo.locale.language]),
          );
        }
        log::info!(
          "Applied geolocation to Wayfern fingerprint: {} ({})",
          geo.locale.as_string(),
          geo.timezone
        );
        true
      }
      Err(e) => {
        log::warn!("Geolocation failed, using defaults: {e}");
        if let Some(obj) = fingerprint.as_object_mut() {
          if !obj.contains_key("timezone") {
            obj.insert("timezone".to_string(), json!("America/New_York"));
          }
          if !obj.contains_key("timezoneOffset") {
            // Firefox convention: minutes west of UTC
            // America/New_York (EDT in summer) = +240
            obj.insert("timezoneOffset".to_string(), json!(240));
          }
        }
        false
      }
    }
  }

  /// Refresh ONLY the location fields (timezone, offset, latitude/longitude,
  /// language) of an already-generated fingerprint to match the current proxy,
  /// leaving every other fingerprint field untouched. `proxy` is the local
  /// proxy URL the browser will use. Returns the updated fingerprint JSON on
  /// success, or None if geolocation is disabled or could not be resolved, in
  /// which case the caller keeps the existing fingerprint and retries on the
  /// next launch.
  pub async fn refresh_fingerprint_geolocation(
    fingerprint_json: &str,
    proxy: Option<&str>,
    geoip: Option<&serde_json::Value>,
  ) -> Option<String> {
    let mut fp: serde_json::Value = serde_json::from_str(fingerprint_json).ok()?;
    if Self::apply_geolocation(&mut fp, proxy, geoip).await {
      serde_json::to_string(&fp).ok()
    } else {
      None
    }
  }

  pub async fn generate_fingerprint_config(
    &self,
    _app_handle: &AppHandle,
    profile: &BrowserProfile,
    config: &WayfernConfig,
  ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let executable_path = BrowserRunner::instance()
      .get_browser_executable_path(profile)
      .map_err(|e| format!("Failed to get Wayfern executable path: {e}"))?;

    let port = Self::find_free_port().await?;
    log::info!("Launching headless Wayfern on port {port} for fingerprint generation");

    let temp_profile_dir =
      std::env::temp_dir().join(format!("wayfern_fingerprint_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_profile_dir)?;

    let mut cmd = TokioCommand::new(&executable_path);
    cmd
      .arg("--headless=new")
      .arg(format!("--remote-debugging-port={port}"))
      .arg("--remote-debugging-address=127.0.0.1")
      .arg(format!("--user-data-dir={}", temp_profile_dir.display()))
      .arg("--disable-gpu")
      .arg("--no-first-run")
      .arg("--no-default-browser-check")
      .arg("--disable-background-mode")
      .arg("--use-mock-keychain")
      .arg("--password-store=basic")
      .arg(format!("--disable-features={WAYFERN_DISABLE_FEATURES}"));

    #[cfg(target_os = "linux")]
    cmd
      .arg("--no-sandbox")
      .arg("--disable-setuid-sandbox")
      .arg("--disable-dev-shm-usage");

    cmd.stdout(Stdio::null()).stderr(Stdio::piped());

    let child = cmd.spawn().map_err(|e| {
      // OS error 14001 = SxS / missing Visual C++ Redistributable
      let hint = if e.raw_os_error() == Some(14001) {
        ". This usually means the Visual C++ Redistributable is not installed. \
         Download it from https://aka.ms/vs/17/release/vc_redist.x64.exe"
      } else {
        ""
      };
      format!("Failed to spawn headless Wayfern: {e}{hint}")
    })?;
    let child_id = child.id();

    let cleanup = || async {
      if let Some(id) = child_id {
        #[cfg(unix)]
        {
          use nix::sys::signal::{kill, Signal};
          use nix::unistd::Pid;
          let _ = kill(Pid::from_raw(id as i32), Signal::SIGTERM);
        }
        #[cfg(windows)]
        {
          use std::os::windows::process::CommandExt;
          const CREATE_NO_WINDOW: u32 = 0x08000000;
          let _ = std::process::Command::new("taskkill")
            .args(["/PID", &id.to_string(), "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        }
      }
      let _ = std::fs::remove_dir_all(&temp_profile_dir);
    };

    if let Err(e) = self.wait_for_cdp_ready(port).await {
      // Try to capture stderr from the failed process for diagnostics
      let stderr_output = if let Some(id) = child_id {
        // Check if process is still running
        let is_running = sysinfo::System::new_with_specifics(
          sysinfo::RefreshKind::nothing().with_processes(sysinfo::ProcessRefreshKind::nothing()),
        )
        .process(sysinfo::Pid::from(id as usize))
        .is_some();

        if !is_running {
          // Process exited — try to read its stderr
          String::from("(process exited before CDP became ready)")
        } else {
          String::from("(process still running but not responding on CDP)")
        }
      } else {
        String::new()
      };

      log::error!(
        "Fingerprint-generation Wayfern (headless, pid={child_id:?}) never became CDP-ready: {e}. {stderr_output}"
      );
      cleanup().await;
      return Err(e);
    }

    let targets = match self.get_cdp_targets(port).await {
      Ok(t) => t,
      Err(e) => {
        cleanup().await;
        return Err(e);
      }
    };

    let page_target = targets
      .iter()
      .find(|t| t.target_type == "page" && t.websocket_debugger_url.is_some());

    let ws_url = match page_target {
      Some(target) => target.websocket_debugger_url.as_ref().unwrap().clone(),
      None => {
        cleanup().await;
        return Err("No page target found for CDP".into());
      }
    };

    let os = config
      .os
      .as_deref()
      .unwrap_or(if cfg!(target_os = "macos") {
        "macos"
      } else if cfg!(target_os = "linux") {
        "linux"
      } else {
        "windows"
      });

    // Include wayfern token if available (enables cross-OS fingerprinting for paid users)
    let wayfern_token = crate::api::cloud_auth::CLOUD_AUTH.get_wayfern_token().await;
    let mut refresh_params = json!({ "operatingSystem": os });
    if let Some(ref token) = wayfern_token {
      refresh_params
        .as_object_mut()
        .unwrap()
        .insert("wayfernToken".to_string(), json!(token));
    }

    let refresh_result = self
      .send_cdp_command(&ws_url, "Wayfern.refreshFingerprint", refresh_params)
      .await;

    if let Err(e) = refresh_result {
      cleanup().await;
      return Err(format!("Failed to refresh fingerprint: {e}").into());
    }

    let get_result = self
      .send_cdp_command(&ws_url, "Wayfern.getFingerprint", json!({}))
      .await;

    let mut fingerprint = match get_result {
      Ok(result) => {
        // Wayfern.getFingerprint returns { fingerprint: {...} }
        // We need to extract just the fingerprint object
        let fp = result.get("fingerprint").cloned().unwrap_or(result);
        // Normalize the fingerprint: convert JSON string fields to proper types
        let mut normalized = Self::normalize_fingerprint(fp);

        // Apply timezone/geolocation for the proxy this fingerprint is being
        // generated against. Shared with the launch-time location refresh.
        Self::apply_geolocation(
          &mut normalized,
          config.proxy.as_deref(),
          config.geoip.as_ref(),
        )
        .await;

        normalized
      }
      Err(e) => {
        cleanup().await;
        return Err(format!("Failed to get fingerprint: {e}").into());
      }
    };

    // Post-process: Clamp screen resolution to OS-appropriate integer values
    // This fixes pixelscan "inconsistent fingerprint" detection where Wayfern
    // generates Mac Retina fractional pixels (e.g., 2560.5) for Windows profiles
    if let Err(e) = Self::clamp_screen_resolution(&mut fingerprint, os) {
      cleanup().await;
      return Err(format!("Failed to clamp screen resolution: {e}").into());
    }

    // Validate fingerprint consistency before storing (fail fast)
    if let Err(e) = Self::validate_fingerprint_consistency(&fingerprint, os) {
      cleanup().await;
      return Err(format!("Fingerprint validation failed: {e}").into());
    }

    cleanup().await;

    let fingerprint_json = serde_json::to_string(&fingerprint)
      .map_err(|e| format!("Failed to serialize fingerprint: {e}"))?;

    log::info!(
      "Generated Wayfern fingerprint for OS: {}, fields: {:?}",
      os,
      fingerprint
        .as_object()
        .map(|o| o.keys().collect::<Vec<_>>())
    );

    // Log timezone/geolocation fields specifically for debugging
    if let Some(obj) = fingerprint.as_object() {
      log::info!(
        "Generated fingerprint - timezone: {:?}, timezoneOffset: {:?}, latitude: {:?}, longitude: {:?}, language: {:?}",
        obj.get("timezone"),
        obj.get("timezoneOffset"),
        obj.get("latitude"),
        obj.get("longitude"),
        obj.get("language")
      );
    }

    Ok(fingerprint_json)
  }

  /// Clamp screen resolution to OS-appropriate integer values.
  /// Fixes Wayfern generating Mac Retina fractional pixels (e.g., 2560.5) for Windows profiles.
  /// Adjusts related fields (windowOuterWidth, screenAvailWidth) to maintain consistency.
  fn clamp_screen_resolution(fingerprint: &mut serde_json::Value, os: &str) -> Result<(), String> {
    let obj = fingerprint
      .as_object_mut()
      .ok_or("Fingerprint must be a JSON object")?;

    // Helper to read numeric field (accepts both number and string)
    // Note: We read all needed values first to avoid borrow conflicts
    let read_screen_w = obj.get("screenWidth").and_then(|v| {
      v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    });
    let read_screen_h = obj.get("screenHeight").and_then(|v| {
      v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    });
    let read_window_outer_w = obj.get("windowOuterWidth").and_then(|v| {
      v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    });
    let read_window_outer_h = obj.get("windowOuterHeight").and_then(|v| {
      v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    });
    let read_avail_w = obj.get("screenAvailWidth").and_then(|v| {
      v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    });
    let read_avail_h = obj.get("screenAvailHeight").and_then(|v| {
      v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    });

    if read_screen_w.is_none() || read_screen_h.is_none() {
      // No screen dimensions in fingerprint — nothing to clamp
      return Ok(());
    }

    // macOS and Linux allow fractional pixels (Retina/High-DPI displays)
    // Only apply clamping logic for Windows
    if os != "windows" {
      return Ok(());
    }

    let mut w = read_screen_w.unwrap();
    let mut h = read_screen_h.unwrap();

    // Check if fractional pixels exist (Mac Retina format: 2560.5)
    let has_fractional = w.fract() != 0.0 || h.fract() != 0.0;

    // Only clamp fractional pixels for Windows
    if has_fractional {
      log::warn!(
        "Clamping fractional screen resolution for Windows: {}x{} → rounding to integers",
        w,
        h
      );
      w = w.round();
      h = h.round();
    }

    // If OS is Windows but resolution looks like Mac Retina preset, replace with Windows resolution
    // Common Mac Retina: 2560x1600, 2880x1800, 3072x1920
    // These are unlikely on Windows (Windows uses 1920x1080, 2560x1440, 3840x2160)
    let looks_like_mac_retina =
      (w == 2560.0 && h == 1600.0) || (w == 2880.0 && h == 1800.0) || (w == 3072.0 && h == 1920.0);

    if looks_like_mac_retina {
      log::warn!(
        "Replacing Mac Retina preset {}x{} with Windows resolution for Windows OS",
        w,
        h
      );
      // Use common Windows resolution (1920x1080 is most popular)
      w = 1920.0;
      h = 1080.0;
    }

    // Write clamped integer values
    obj.insert("screenWidth".to_string(), serde_json::json!(w as u32));
    obj.insert("screenHeight".to_string(), serde_json::json!(h as u32));

    // Adjust related fields to maintain consistency
    // windowOuterWidth should be <= screenWidth (typically screenWidth - window chrome)
    if let Some(outer_w) = read_window_outer_w {
      if outer_w > w {
        obj.insert("windowOuterWidth".to_string(), serde_json::json!(w as u32));
      }
    }
    if let Some(outer_h) = read_window_outer_h {
      if outer_h > h {
        obj.insert("windowOuterHeight".to_string(), serde_json::json!(h as u32));
      }
    }

    // screenAvailWidth/Height should be <= screenWidth/Height
    if let Some(avail_w) = read_avail_w {
      if avail_w > w {
        obj.insert("screenAvailWidth".to_string(), serde_json::json!(w as u32));
      }
    }
    if let Some(avail_h) = read_avail_h {
      if avail_h > h {
        obj.insert("screenAvailHeight".to_string(), serde_json::json!(h as u32));
      }
    }

    if has_fractional || looks_like_mac_retina {
      log::info!(
        "Screen resolution clamped: {}x{} (OS: {})",
        w as u32,
        h as u32,
        os
      );
    }

    Ok(())
  }

  /// Validate fingerprint consistency.
  /// Rejects fingerprints that would trigger "inconsistent" warnings on fingerprint scanners.
  /// Checks: integer screen pixels, OS-appropriate resolution, window/screen field sanity.
  fn validate_fingerprint_consistency(
    fingerprint: &serde_json::Value,
    os: &str,
  ) -> Result<(), String> {
    let obj = fingerprint
      .as_object()
      .ok_or("Fingerprint must be a JSON object")?;

    // Helper to read numeric field
    let read_num = |key: &str| -> Option<f64> {
      obj.get(key).and_then(|v| {
        v.as_f64()
          .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
      })
    };

    // Check 1: Screen dimensions must be integers (no fractional pixels) for Windows
    // macOS and Linux allow fractional pixels (Retina/High-DPI displays)
    if os == "windows" {
      if let Some(w) = read_num("screenWidth") {
        if w.fract() != 0.0 {
          return Err(format!(
            "screenWidth has fractional pixels ({}), expected integer for Windows",
            w
          ));
        }
      }
      if let Some(h) = read_num("screenHeight") {
        if h.fract() != 0.0 {
          return Err(format!(
            "screenHeight has fractional pixels ({}), expected integer for Windows",
            h
          ));
        }
      }
    }

    // Check 2: Windows should not have Mac Retina-style resolutions
    // (defense in depth — clamp_screen_resolution should have fixed this)
    if os == "windows" {
      if let (Some(w), Some(h)) = (read_num("screenWidth"), read_num("screenHeight")) {
        let looks_like_mac_retina = (w == 2560.0 && h == 1600.0)
          || (w == 2880.0 && h == 1800.0)
          || (w == 3072.0 && h == 1920.0);
        if looks_like_mac_retina {
          return Err(format!(
            "Windows profile has Mac Retina resolution {}x{} — this will trigger inconsistent fingerprint detection",
            w, h
          ));
        }
      }
    }

    // Check 3: windowOuterWidth <= screenWidth (sanity check)
    if let (Some(outer_w), Some(screen_w)) = (read_num("windowOuterWidth"), read_num("screenWidth"))
    {
      if outer_w > screen_w {
        return Err(format!(
          "windowOuterWidth ({}) exceeds screenWidth ({})",
          outer_w, screen_w
        ));
      }
    }

    // Check 4: screenAvailWidth <= screenWidth
    if let (Some(avail_w), Some(screen_w)) = (read_num("screenAvailWidth"), read_num("screenWidth"))
    {
      if avail_w > screen_w {
        return Err(format!(
          "screenAvailWidth ({}) exceeds screenWidth ({})",
          avail_w, screen_w
        ));
      }
    }

    Ok(())
  }
}

include!("wayfern_manager_fingerprint.rs");
include!("wayfern_manager_launch.rs");
include!("wayfern_manager_tests.rs");
