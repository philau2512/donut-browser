use crate::browser::browser_runner::BrowserRunner;
use crate::browser::camoufox::{CamoufoxConfigBuilder, GeoIPOption, ScreenConstraints};
use crate::profile::BrowserProfile;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CamoufoxConfig {
  pub proxy: Option<String>,
  pub screen_max_width: Option<u32>,
  pub screen_max_height: Option<u32>,
  pub screen_min_width: Option<u32>,
  pub screen_min_height: Option<u32>,
  pub geoip: Option<serde_json::Value>, // Can be String or bool
  pub block_images: Option<bool>,
  pub block_webrtc: Option<bool>,
  pub webrtc_mode: Option<String>,
  pub block_webgl: Option<bool>,
  pub fingerprint: Option<String>, // JSON string of the complete fingerprint config
  pub randomize_fingerprint_on_launch: Option<bool>, // Generate new fingerprint on every launch
  pub os: Option<String>, // Operating system for fingerprint generation: "windows", "macos", or "linux"
}

impl Default for CamoufoxConfig {
  fn default() -> Self {
    Self {
      proxy: None,
      screen_max_width: None,
      screen_max_height: None,
      screen_min_width: None,
      screen_min_height: None,
      geoip: Some(serde_json::Value::Bool(true)),
      block_images: None,
      block_webrtc: None,
      webrtc_mode: None,
      block_webgl: None,
      fingerprint: None,
      randomize_fingerprint_on_launch: None,
      os: None,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct CamoufoxLaunchResult {
  pub id: String,
  #[serde(alias = "process_id")]
  pub processId: Option<u32>,
  #[serde(alias = "profile_path")]
  pub profilePath: Option<String>,
  pub url: Option<String>,
  pub cdp_port: Option<u16>,
}

#[derive(Debug)]
struct CamoufoxInstance {
  #[allow(dead_code)]
  id: String,
  process_id: Option<u32>,
  profile_path: Option<String>,
  url: Option<String>,
  cdp_port: Option<u16>,
}

struct CamoufoxManagerInner {
  instances: HashMap<String, CamoufoxInstance>,
}

pub struct CamoufoxManager {
  inner: Arc<AsyncMutex<CamoufoxManagerInner>>,
}

impl CamoufoxManager {
  fn new() -> Self {
    Self {
      inner: Arc::new(AsyncMutex::new(CamoufoxManagerInner {
        instances: HashMap::new(),
      })),
    }
  }

  pub fn instance() -> &'static CamoufoxManager {
    &CAMOUFOX_LAUNCHER
  }

  async fn find_free_port() -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
  }

  #[allow(dead_code)]
  pub async fn get_cdp_port(&self, profile_path: &str) -> Option<u16> {
    let inner = self.inner.lock().await;
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    for instance in inner.instances.values() {
      if let Some(path) = &instance.profile_path {
        let instance_path = std::path::Path::new(path)
          .canonicalize()
          .unwrap_or_else(|_| std::path::Path::new(path).to_path_buf());
        if instance_path == target_path {
          return instance.cdp_port;
        }
      }
    }
    None
  }

  pub fn get_profiles_dir(&self) -> PathBuf {
    crate::settings::app_dirs::profiles_dir()
  }

  /// Generate Camoufox fingerprint configuration during profile creation
  pub async fn generate_fingerprint_config(
    &self,
    _app_handle: &AppHandle,
    profile: &crate::profile::BrowserProfile,
    config: &CamoufoxConfig,
  ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Get executable path
    let executable_path = BrowserRunner::instance()
      .get_browser_executable_path(profile)
      .map_err(|e| format!("Failed to get Camoufox executable path: {e}"))?;

    // Build the config using CamoufoxConfigBuilder
    let mut builder = CamoufoxConfigBuilder::new()
      .block_images(config.block_images.unwrap_or(false))
      .block_webrtc(config.block_webrtc.unwrap_or(false))
      .webrtc_mode(config.webrtc_mode.clone())
      .block_webgl(config.block_webgl.unwrap_or(false));

    // Set operating system
    if let Some(os) = &config.os {
      builder = builder.operating_system(os);
    }

    // Build screen constraints if provided
    if config.screen_min_width.is_some()
      || config.screen_max_width.is_some()
      || config.screen_min_height.is_some()
      || config.screen_max_height.is_some()
    {
      let screen_constraints = ScreenConstraints {
        min_width: config.screen_min_width,
        max_width: config.screen_max_width,
        min_height: config.screen_min_height,
        max_height: config.screen_max_height,
      };
      builder = builder.screen_constraints(screen_constraints);
    }

    // Parse proxy if provided
    if let Some(proxy_str) = &config.proxy {
      let proxy_config = crate::browser::camoufox::ProxyConfig::from_url(proxy_str)
        .map_err(|e| format!("Failed to parse proxy URL: {e}"))?;
      builder = builder.proxy(proxy_config);
    }

    // Set Firefox version from executable
    if let Some(version) = crate::browser::camoufox::config::get_firefox_version(&executable_path) {
      builder = builder.ff_version(version);
    }

    // Handle geoip option
    if let Some(geoip_value) = &config.geoip {
      match geoip_value {
        serde_json::Value::Bool(true) => {
          // Auto-detect IP (through proxy if set)
          builder = builder.geoip(GeoIPOption::Auto);
        }
        serde_json::Value::String(ip) => {
          // Use specific IP
          builder = builder.geoip(GeoIPOption::IP(ip.clone()));
        }
        _ => {
          // geoip: false or other values - don't apply geolocation
        }
      }
    }

    // Build the config (async to handle geoip)
    let launch_config = builder
      .build_async()
      .await
      .map_err(|e| format!("Failed to build Camoufox config: {e}"))?;

    // Return the fingerprint config as JSON
    let config_json = serde_json::to_string(&launch_config.fingerprint_config)
      .map_err(|e| format!("Failed to serialize config: {e}"))?;

    Ok(config_json)
  }

  /// Launch Camoufox browser by directly spawning the process
  #[allow(clippy::too_many_arguments)]
  pub async fn launch_camoufox(
    &self,
    app_handle: &AppHandle,
    profile: &crate::profile::BrowserProfile,
    profile_path: &str,
    config: &CamoufoxConfig,
    url: Option<&str>,
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<CamoufoxLaunchResult, Box<dyn std::error::Error + Send + Sync>> {
    let custom_config = if let Some(existing_fingerprint) = &config.fingerprint {
      log::info!("Using existing fingerprint from profile metadata");
      existing_fingerprint.clone()
    } else {
      return Err("No fingerprint provided".into());
    };

    // Get executable path
    let executable_path = BrowserRunner::instance()
      .get_browser_executable_path(profile)
      .map_err(|e| format!("Failed to get Camoufox executable path: {e}"))?;

    // Parse the fingerprint config JSON
    let mut fingerprint_config: HashMap<String, serde_json::Value> =
      serde_json::from_str(&custom_config)
        .map_err(|e| format!("Failed to parse fingerprint config: {e}"))?;

    // Strip `window.history.length` even when present in a previously-saved
    // fingerprint. Newer Camoufox clamps the docShell session history to the
    // spoofed value, which disables the toolbar back/forward buttons. See
    // the matching note in camoufox/config.rs.
    fingerprint_config.remove("window.history.length");

    // Convert to environment variables using CAMOU_CONFIG chunking
    let env_vars = crate::browser::camoufox::env_vars::config_to_env_vars(&fingerprint_config)
      .map_err(|e| format!("Failed to convert config to env vars: {e}"))?;

    // Build command arguments
    // Note: We intentionally do NOT use -no-remote to allow opening URLs in existing instances
    // via Firefox's remote messaging mechanism. This enables "open in new tab" functionality
    // when Donut is set as the default browser.
    let mut args = vec![
      "-profile".to_string(),
      std::path::Path::new(profile_path)
        .canonicalize()
        .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf())
        .to_string_lossy()
        .to_string(),
    ];

    let cdp_port = match remote_debugging_port {
      Some(p) => p,
      None => Self::find_free_port().await?,
    };
    args.push(format!("--remote-debugging-port={cdp_port}"));

    // Add URL if provided
    if let Some(url) = url {
      args.push("-new-tab".to_string());
      args.push(url.to_string());
    }

    // Add headless flag when requested via the API or via the CAMOUFOX_HEADLESS
    // env var (used by integration tests)
    if headless || std::env::var("CAMOUFOX_HEADLESS").is_ok() {
      args.push("--headless".to_string());
    }

    log::info!(
      "Launching Camoufox: {:?} with args: {:?}",
      executable_path,
      args
    );

    // Spawn the browser process. Camoufox prints NSS/PSM and proxy failures
    // to stderr (e.g. cert errors, CONNECT failures) and the user otherwise
    // sees only an opaque "Secure Connection Failed" page — capture stderr
    // to a per-launch file so diagnostics survive without a TTY.
    let stderr_log_path = std::env::temp_dir().join(format!("camoufox-stderr-{}.log", profile.id));
    let mut command = TokioCommand::new(&executable_path);
    command
      .args(&args)
      .stdin(Stdio::null())
      .stdout(Stdio::null());

    match std::fs::File::create(&stderr_log_path) {
      Ok(file) => {
        log::info!(
          "Camoufox stderr will be logged to: {}",
          stderr_log_path.display()
        );
        command.stderr(Stdio::from(file));
      }
      Err(e) => {
        log::warn!(
          "Failed to open Camoufox stderr log {}: {e}",
          stderr_log_path.display()
        );
        command.stderr(Stdio::null());
      }
    }

    // Add environment variables
    for (key, value) in &env_vars {
      command.env(key, value);
    }

    // Handle fontconfig on Linux
    if cfg!(target_os = "linux") {
      let target_os = config.os.as_deref().unwrap_or("linux");
      if let Some(fontconfig_path) =
        crate::browser::camoufox::env_vars::get_fontconfig_env(target_os, &executable_path)
      {
        command.env("FONTCONFIG_PATH", fontconfig_path);
      }
    }

    let mut child = command
      .spawn()
      .map_err(|e| format!("Failed to spawn Camoufox process: {e}"))?;

    let process_id = child.id();
    let instance_id = format!("camoufox_{}", process_id.unwrap_or(0));

    log::info!("Camoufox launched with PID: {:?}", process_id);

    // Watch the child so its exit status (signal / non-zero code) lands in
    // the log. Without this, all we see is "PID X is no longer running" via
    // the periodic sysinfo poll, with no clue why it died.
    let watch_profile_path = profile_path.to_string();
    let app_handle_exit = app_handle.clone();
    let profile_id_exit = profile.id.to_string();
    let profile_name_exit = profile.name.clone();
    tokio::spawn(async move {
      let (exit_details, is_crash) = match child.wait().await {
        Ok(status) => {
          if status.success() {
            log::info!(
              "Camoufox PID {:?} for {} exited cleanly (status=0)",
              process_id,
              watch_profile_path
            );
            ("Clean exit".to_string(), false)
          } else {
            log::warn!(
              "Camoufox PID {:?} for {} exited abnormally: {}",
              process_id,
              watch_profile_path,
              status
            );
            (format!("Abnormal exit: {}", status), true)
          }
        }
        Err(e) => {
          log::warn!("Failed to await Camoufox PID {:?} exit: {}", process_id, e);
          (format!("wait_error={}", e), true)
        }
      };
      let runner = BrowserRunner::instance();
      if let Err(e) = runner
        .handle_profile_stopped(
          &app_handle_exit,
          &profile_id_exit,
          Some(&exit_details),
          is_crash,
        )
        .await
      {
        log::warn!(
          "Error running handle_profile_stopped for Camoufox {}: {e}",
          profile_name_exit
        );
      }
    });

    // Store the instance
    let instance = CamoufoxInstance {
      id: instance_id.clone(),
      process_id,
      profile_path: Some(profile_path.to_string()),
      url: url.map(String::from),
      cdp_port: Some(cdp_port),
    };

    let launch_result = CamoufoxLaunchResult {
      id: instance_id.clone(),
      processId: process_id,
      profilePath: Some(profile_path.to_string()),
      url: url.map(String::from),
      cdp_port: Some(cdp_port),
    };

    {
      let mut inner = self.inner.lock().await;
      inner.instances.insert(instance_id, instance);
    }

    Ok(launch_result)
  }

  /// Stop a Camoufox process by ID
  pub async fn stop_camoufox(
    &self,
    _app_handle: &AppHandle,
    id: &str,
  ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    // Get the process ID from our tracking
    let process_id = {
      let inner = self.inner.lock().await;
      inner
        .instances
        .get(id)
        .and_then(|instance| instance.process_id)
    };

    if let Some(pid) = process_id {
      // Kill the process
      let success = self.kill_process(pid);

      if success {
        // Remove from our tracking
        let mut inner = self.inner.lock().await;
        inner.instances.remove(id);
        log::info!("Stopped Camoufox instance {} (PID: {})", id, pid);
      }

      Ok(success)
    } else {
      // No process ID found, just remove from tracking
      let mut inner = self.inner.lock().await;
      inner.instances.remove(id);
      Ok(true)
    }
  }

  /// Kill a process by PID
  fn kill_process(&self, pid: u32) -> bool {
    #[cfg(unix)]
    {
      use std::os::unix::process::ExitStatusExt;
      let result = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();

      match result {
        Ok(status) => status.success() || status.signal() == Some(0),
        Err(e) => {
          log::warn!("Failed to kill process {}: {}", pid, e);
          false
        }
      }
    }

    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      const CREATE_NO_WINDOW: u32 = 0x08000000;
      let result = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

      match result {
        Ok(status) => status.success(),
        Err(e) => {
          log::warn!("Failed to kill process {}: {}", pid, e);
          false
        }
      }
    }
  }

  /// Find Camoufox server by profile path (for integration with browser_runner)
  /// This method first checks in-memory instances, then scans system processes
  /// to detect Camoufox instances that may have been started before the app restarted.
  pub async fn find_camoufox_by_profile(
    &self,
    profile_path: &str,
  ) -> Result<Option<CamoufoxLaunchResult>, Box<dyn std::error::Error + Send + Sync>> {
    // First clean up any dead instances
    self.cleanup_dead_instances().await?;

    // Convert paths to canonical form for comparison
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    // Check in-memory instances first
    {
      let inner = self.inner.lock().await;

      for (id, instance) in inner.instances.iter() {
        if let Some(instance_profile_path) = &instance.profile_path {
          let instance_path = std::path::Path::new(instance_profile_path)
            .canonicalize()
            .unwrap_or_else(|_| std::path::Path::new(instance_profile_path).to_path_buf());

          if instance_path == target_path {
            // Verify the server is actually running by checking the process
            if let Some(process_id) = instance.process_id {
              if self.is_server_running(process_id).await {
                // Found running Camoufox instance
                return Ok(Some(CamoufoxLaunchResult {
                  id: id.clone(),
                  processId: instance.process_id,
                  profilePath: instance.profile_path.clone(),
                  url: instance.url.clone(),
                  cdp_port: instance.cdp_port,
                }));
              }
            }
          }
        }
      }
    }

    // If not found in in-memory instances, scan system processes
    // This handles the case where the app was restarted but Camoufox is still running
    if let Some((pid, found_profile_path, cdp_port)) =
      self.find_camoufox_process_by_profile(&target_path)
    {
      log::info!(
        "Found running Camoufox process (PID: {}) for profile path via system scan",
        pid
      );

      // Register this instance in our tracking
      let instance_id = format!("recovered_{}", pid);
      let mut inner = self.inner.lock().await;
      inner.instances.insert(
        instance_id.clone(),
        CamoufoxInstance {
          id: instance_id.clone(),
          process_id: Some(pid),
          profile_path: Some(found_profile_path.clone()),
          url: None,
          cdp_port,
        },
      );

      return Ok(Some(CamoufoxLaunchResult {
        id: instance_id,
        processId: Some(pid),
        profilePath: Some(found_profile_path),
        url: None,
        cdp_port,
      }));
    }

    Ok(None)
  }

  /// Scan system processes to find a Camoufox process using a specific profile path
  fn find_camoufox_process_by_profile(
    &self,
    target_path: &std::path::Path,
  ) -> Option<(u32, String, Option<u16>)> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );

    let target_path_str = target_path.to_string_lossy();

    for (pid, process) in system.processes() {
      let cmd = process.cmd();
      if cmd.is_empty() {
        continue;
      }

      // Check if this is a Camoufox/Firefox process
      let exe_name = process.name().to_string_lossy().to_lowercase();
      let is_firefox_like = exe_name.contains("firefox")
        || exe_name.contains("camoufox")
        || exe_name.contains("firefox-bin");

      if !is_firefox_like {
        continue;
      }

      let mut matched = false;
      let mut found_profile_path = None;
      let mut cdp_port: Option<u16> = None;

      // Check if the command line contains our profile path
      for (i, arg) in cmd.iter().enumerate() {
        if let Some(arg_str) = arg.to_str() {
          // Check for -profile argument followed by our path
          if arg_str == "-profile" && i + 1 < cmd.len() {
            if let Some(next_arg) = cmd.get(i + 1).and_then(|a| a.to_str()) {
              let cmd_path = std::path::Path::new(next_arg)
                .canonicalize()
                .unwrap_or_else(|_| std::path::Path::new(next_arg).to_path_buf());

              if cmd_path == target_path {
                matched = true;
                found_profile_path = Some(next_arg.to_string());
              }
            }
          }

          // Also check if the argument contains the profile path directly
          if !matched && arg_str.contains(&*target_path_str) {
            matched = true;
            found_profile_path = Some(target_path_str.to_string());
          }

          if let Some(port_val) = arg_str.strip_prefix("--remote-debugging-port=") {
            cdp_port = port_val.parse().ok();
          }
        }
      }

      if matched {
        if let Some(profile_path) = found_profile_path {
          return Some((pid.as_u32(), profile_path, cdp_port));
        }
      }
    }

    None
  }

  /// Check if servers are still alive and clean up dead instances
  pub async fn cleanup_dead_instances(
    &self,
  ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let mut dead_instances = Vec::new();
    let mut instances_to_remove = Vec::new();

    {
      let inner = self.inner.lock().await;

      for (id, instance) in inner.instances.iter() {
        if let Some(process_id) = instance.process_id {
          if !self.is_server_running(process_id).await {
            log::info!(
              "Camoufox instance {} (PID {}) is no longer running; profile_path={:?}",
              id,
              process_id,
              instance.profile_path
            );
            dead_instances.push(id.clone());
            instances_to_remove.push(id.clone());
          }
        } else {
          log::info!("Camoufox instance {} has no PID, marking as dead", id);
          dead_instances.push(id.clone());
          instances_to_remove.push(id.clone());
        }
      }
    }

    if !instances_to_remove.is_empty() {
      let mut inner = self.inner.lock().await;
      for id in &instances_to_remove {
        inner.instances.remove(id);
      }
    }

    Ok(dead_instances)
  }

  /// Check if a Camoufox server is running with the given process ID
  async fn is_server_running(&self, process_id: u32) -> bool {
    // Check if the process is still running
    use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
    if let Some(process) = system.process(Pid::from(process_id as usize)) {
      // Check if this is actually a Camoufox process by looking at the command line
      let cmd = process.cmd();
      let is_camoufox = cmd.iter().any(|arg| {
        let arg_str = arg.to_str().unwrap_or("");
        arg_str.contains("camoufox-worker") || arg_str.contains("camoufox")
      });

      if is_camoufox {
        // Found running Camoufox process
        return true;
      }
    }

    false
  }
}

include!("camoufox_manager_launch.rs");
