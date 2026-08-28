//! Shared Chromium launch arguments for Wayfern.
//!
//! Both `WayfernManager::launch_wayfern` (production path) and
//! `WayfernBrowser::create_launch_args` (trait fallback + unit tests) must use
//! this module so antidetect hardening cannot drift between paths.

use std::path::Path;

/// Chromium features disabled to prevent DNS/prefetch leaks past the profile proxy.
pub const WAYFERN_DISABLE_FEATURES: &str =
  "DialMediaRouteProvider,DnsOverHttps,AsyncDns,Prefetch,PrefetchProxy,SpeculationRulesPrefetchFuture,NoStatePrefetch";

/// Prefer HTTPS for scheme-less omnibox navigations and opportunistic HTTP→HTTPS upgrades.
///
/// Critical: `OmniboxDefaultTypedNavigationsToHttps` makes the omnibox *construct*
/// `https://x.com` when the user types a bare host. Without it, Chromium always
/// builds `http://…` first and only upgrades later (prefs alone cannot fix that).
/// Confirmed present in Wayfern chrome.dll (Chromium 149).
pub const WAYFERN_ENABLE_FEATURES: &str = concat!(
  "OmniboxDefaultTypedNavigationsToHttps,",
  "HttpsUpgrades,",
  "HttpsFirstBalancedMode,",
  "HttpsUpgradesTypedSchemelessNavigationNoTimeoutFallback"
);

/// Resolve the effective WebRTC mode string from config toggles.
pub fn resolve_webrtc_mode(block_webrtc: bool, webrtc_mode: Option<&str>) -> &'static str {
  match webrtc_mode {
    Some("disable") => "disable",
    Some("forward") => "forward",
    Some("forward_google") => "forward_google",
    Some("real") => "real",
    Some("alter") => "alter",
    Some(other) => {
      log::warn!("Unknown webrtc_mode '{other}', defaulting to forward (disable_non_proxied_udp)");
      "forward"
    }
    None => {
      if block_webrtc {
        "disable"
      } else {
        "forward"
      }
    }
  }
}

/// Options for building Wayfern Chromium command-line arguments.
pub struct WayfernLaunchArgsOptions<'a> {
  pub profile_path: &'a str,
  /// When `Some`, emits `--remote-debugging-port` / `--remote-debugging-address`.
  pub remote_debugging_port: Option<u16>,
  pub headless: bool,
  /// Fingerprint JSON used to derive `--window-size` (skipped in headless mode).
  pub fingerprint_json: Option<&'a str>,
  pub ephemeral: bool,
  pub extension_paths: &'a [String],
  pub wayfern_token: Option<&'a str>,
  /// Full proxy URL (`socks5://host:port` or `http://host:port`).
  pub proxy_url: Option<&'a str>,
  pub webrtc_mode: &'a str,
  pub block_images: bool,
  pub block_webgl: bool,
  pub url: Option<&'a str>,
  /// Maximum screen width to clamp window size (prevents oversized windows)
  pub screen_max_width: Option<u32>,
  /// Maximum screen height to clamp window size (prevents oversized windows)
  pub screen_max_height: Option<u32>,
  /// Per-profile label shown in the window title (upstream 63a1f4c). None = omit flag.
  pub profile_name: Option<&'a str>,
  /// Per-profile frame color as bare RRGGBB (no '#'). None = omit flag.
  /// Caller is responsible for feature-flag check and color derivation.
  pub profile_color: Option<&'a str>,
}

/// Derive window dimensions from a fingerprint JSON blob.
/// Mirrors `WayfernManager::window_size_from_fingerprint` without needing the manager.
pub fn window_size_from_fingerprint_json(fingerprint_json: &str) -> Option<(u32, u32)> {
  let parsed: serde_json::Value = serde_json::from_str(fingerprint_json).ok()?;
  let fp = parsed.get("fingerprint").unwrap_or(&parsed);
  let obj = fp.as_object()?;

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

/// Host display scale factor (Windows DPI / 96, etc.).
///
/// Fingerprint samples often ship `devicePixelRatio: 1`, which makes Wayfern /
/// Chromium paint UI chrome + page layout at 1x on 2K/4K laptops with 125–200%
/// Windows scaling — tabs, fonts and page layout look "tiny" compared to normal
/// Chrome. We use the host scale for `--force-device-scale-factor` so the
/// browser chrome matches the OS.
pub fn host_device_scale_factor() -> f64 {
  // Optional global override (tests / power users)
  if let Ok(v) = std::env::var("WAYFERN_DEVICE_SCALE_FACTOR") {
    if let Ok(parsed) = v.parse::<f64>() {
      if parsed > 0.0 {
        return (parsed * 100.0).round() / 100.0;
      }
    }
  }

  #[cfg(target_os = "windows")]
  {
    #[link(name = "user32")]
    extern "system" {
      fn GetDpiForSystem() -> u32;
    }
    // SAFETY: GetDpiForSystem is available on Windows 10+ and only reads system DPI.
    let dpi = unsafe { GetDpiForSystem() };
    if dpi >= 96 {
      let scale = dpi as f64 / 96.0;
      // Round to 2 decimals (1.25, 1.5, 1.75, 2.0, …)
      return (scale * 100.0).round() / 100.0;
    }
  }

  #[cfg(target_os = "linux")]
  {
    if let Ok(v) = std::env::var("GDK_SCALE") {
      if let Ok(parsed) = v.parse::<f64>() {
        if parsed > 0.0 {
          return (parsed * 100.0).round() / 100.0;
        }
      }
    }
  }

  1.0
}

/// Prefer fingerprint DPR when it already matches a high-DPI profile; otherwise
/// lift 1.0 samples up to the host scale so layout is not undersized.
///
/// Drives Chromium `--force-device-scale-factor` (real UI chrome + page layout).
/// Fingerprint `devicePixelRatio` alone only spoofs JS APIs via CDP — without
/// the CLI flag, tabs/fonts stay tiny even when the user sets DPR to 1.5.
pub fn effective_device_scale_factor(fingerprint_json: Option<&str>) -> f64 {
  // Explicit env always wins (tests / power users).
  if let Ok(v) = std::env::var("WAYFERN_DEVICE_SCALE_FACTOR") {
    if let Ok(parsed) = v.parse::<f64>() {
      if parsed > 0.0 {
        return (parsed * 100.0).round() / 100.0;
      }
    }
  }

  let host = host_device_scale_factor();
  let fp_dpr = fingerprint_json
    .and_then(read_fingerprint_device_pixel_ratio)
    .unwrap_or(1.0);

  // User-set fingerprint DPR (e.g. 1.5 / 2.0) — honor for real UI scale.
  if fp_dpr >= 1.2 {
    return (fp_dpr * 100.0).round() / 100.0;
  }
  // Low/1.0 fingerprint on a high-DPI host → use host so UI is not tiny.
  if host > 1.01 {
    return host;
  }
  fp_dpr.max(1.0)
}

/// Read `devicePixelRatio` from fingerprint JSON (bare object, `{fingerprint:{…}}`
/// wrapper, or double-encoded JSON string).
fn read_fingerprint_device_pixel_ratio(raw: &str) -> Option<f64> {
  let mut parsed: serde_json::Value = serde_json::from_str(raw).ok()?;
  // Double-encoded string payloads show up after some FE/BE round-trips.
  if let Some(inner) = parsed.as_str() {
    parsed = serde_json::from_str(inner).ok()?;
  }
  let fp = parsed.get("fingerprint").unwrap_or(&parsed);
  let v = fp.get("devicePixelRatio")?;
  v.as_f64()
    .or_else(|| v.as_i64().map(|n| n as f64))
    .or_else(|| v.as_u64().map(|n| n as f64))
    .or_else(|| v.as_str()?.trim().parse().ok())
    .filter(|n| n.is_finite() && *n > 0.0)
}

/// Raw Windows system DPI scale (ignores WAYFERN_DEVICE_SCALE_FACTOR env).
fn raw_system_dpi_scale() -> f64 {
  #[cfg(target_os = "windows")]
  {
    #[link(name = "user32")]
    extern "system" {
      fn GetDpiForSystem() -> u32;
    }
    // SAFETY: read-only system DPI.
    let dpi = unsafe { GetDpiForSystem() };
    if dpi >= 96 {
      return ((dpi as f64 / 96.0) * 100.0).round() / 100.0;
    }
  }
  1.0
}

/// Primary monitor size in **physical** pixels (best-effort).
///
/// Used to clamp Chromium `--window-size` so DIPs × device-scale does not
/// create a window wider/taller than the real display.
pub fn host_screen_size_px() -> Option<(u32, u32)> {
  #[cfg(target_os = "windows")]
  {
    #[link(name = "user32")]
    extern "system" {
      fn GetSystemMetrics(n_index: i32) -> i32;
    }
    const SM_CXSCREEN: i32 = 0;
    const SM_CYSCREEN: i32 = 1;
    // SAFETY: pure read of system metrics.
    let (w, h) = unsafe {
      let w = GetSystemMetrics(SM_CXSCREEN);
      let h = GetSystemMetrics(SM_CYSCREEN);
      if w <= 0 || h <= 0 {
        return None;
      }
      (w as u32, h as u32)
    };

    // DPI-aware processes may get logical (DIP) metrics. Convert to physical
    // when values look logical (typical on 125–150% 2K laptops).
    let dpi_scale = raw_system_dpi_scale();
    if dpi_scale > 1.01 && w < 2400 {
      let phys_w = ((w as f64) * dpi_scale).round() as u32;
      let phys_h = ((h as f64) * dpi_scale).round() as u32;
      return Some((phys_w.max(w), phys_h.max(h)));
    }
    Some((w, h))
  }

  #[cfg(not(target_os = "windows"))]
  {
    None
  }
}

/// Clamp fingerprint-derived `--window-size` (DIPs) so the physical window
/// (≈ DIPs × scale) fits the host primary display.
///
/// Chromium treats `--window-size` as DIPs when `--force-device-scale-factor`
/// is set. A fingerprint of 1920×1080 with scale 1.5 becomes 2880×1620
/// physical — wider than a 2560×1440 2K panel. Always clamp.
pub fn clamp_window_size_to_host(
  w: u32,
  h: u32,
  scale: f64,
  screen_max_width: Option<u32>,
  screen_max_height: Option<u32>,
) -> (u32, u32) {
  let scale = if scale.is_finite() && scale > 0.0 {
    scale
  } else {
    1.0
  };

  let mut limit_w = screen_max_width.filter(|v| *v > 0);
  let mut limit_h = screen_max_height.filter(|v| *v > 0);

  if let Some((host_w, host_h)) = host_screen_size_px() {
    // DIPs max so physical size ≤ host pixels.
    let host_dip_w = ((host_w as f64) / scale).floor() as u32;
    let host_dip_h = ((host_h as f64) / scale).floor() as u32;
    // Small margins: window chrome / taskbar on restore bounds.
    let host_dip_w = host_dip_w.saturating_sub(16).max(640);
    let host_dip_h = host_dip_h.saturating_sub(48).max(480);

    limit_w = Some(limit_w.map(|m| m.min(host_dip_w)).unwrap_or(host_dip_w));
    limit_h = Some(limit_h.map(|m| m.min(host_dip_h)).unwrap_or(host_dip_h));
  }

  let cw = limit_w.map(|m| w.min(m)).unwrap_or(w).max(400);
  let ch = limit_h.map(|m| h.min(m)).unwrap_or(h).max(300);
  (cw, ch)
}

/// Seed `Default/Preferences` so scheme-less typed URLs open as `https://`.
///
/// Chromium prefs (from `chrome/common/pref_names.h`):
/// - `https_only_mode_enabled` — full HTTPS-Only (omnibox bare hosts open as https://)
/// - `https_first_balanced_mode_enabled` — also set for builds that only honor balanced
///
/// Must run while the browser process is not holding the profile lock (pre-spawn).
pub fn ensure_https_first_mode_prefs(user_data_dir: &Path) -> Result<(), String> {
  let default_dir = user_data_dir.join("Default");
  std::fs::create_dir_all(&default_dir)
    .map_err(|e| format!("create Default dir for HTTPS-First prefs: {e}"))?;

  let prefs_path = default_dir.join("Preferences");
  let mut root: serde_json::Value = if prefs_path.exists() {
    let raw = std::fs::read_to_string(&prefs_path)
      .map_err(|e| format!("read Preferences for HTTPS-First prefs: {e}"))?;
    serde_json::from_str(&raw).unwrap_or_else(|e| {
      log::warn!("Preferences JSON parse failed ({e}); recreating minimal object for HTTPS-First");
      serde_json::json!({})
    })
  } else {
    serde_json::json!({})
  };

  let obj = root
    .as_object_mut()
    .ok_or_else(|| "Preferences root is not a JSON object".to_string())?;

  // Full HTTPS-Only Mode (chrome://settings "Always use secure connections").
  // Works with HttpsUpgrades interceptor; pairs with OmniboxDefaultTypedNavigationsToHttps.
  obj.insert(
    "https_only_mode_enabled".to_string(),
    serde_json::Value::Bool(true),
  );
  // Also enable balanced for Chromium builds that only honor this pref.
  obj.insert(
    "https_first_balanced_mode_enabled".to_string(),
    serde_json::Value::Bool(true),
  );
  // Explicit product choice — disable auto-heuristic so it never clears the prefs.
  obj.insert(
    "https_only_mode_auto_enabled".to_string(),
    serde_json::Value::Bool(false),
  );
  // Keep opportunistic HTTP→HTTPS upgrades on (enterprise/policy gate in Chromium).
  obj.insert(
    "https_upgrades.policy.upgrades_enabled".to_string(),
    serde_json::Value::Bool(true),
  );

  let serialized = serde_json::to_string(&root)
    .map_err(|e| format!("serialize Preferences for HTTPS-First prefs: {e}"))?;
  std::fs::write(&prefs_path, serialized)
    .map_err(|e| format!("write Preferences for HTTPS-First prefs: {e}"))?;

  Ok(())
}

/// Build the Chromium argument list shared by production launch and the `Browser` trait.
pub fn build_wayfern_launch_args(opts: WayfernLaunchArgsOptions<'_>) -> Vec<String> {
  let mut args = Vec::new();

  if let Some(port) = opts.remote_debugging_port {
    args.push(format!("--remote-debugging-port={port}"));
    args.push("--remote-debugging-address=127.0.0.1".to_string());
  }

  args.push(format!("--user-data-dir={}", opts.profile_path));
  args.push("--no-first-run".to_string());
  args.push("--no-default-browser-check".to_string());
  args.push("--disable-background-mode".to_string());
  args.push("--disable-component-update".to_string());
  args.push("--disable-background-timer-throttling".to_string());
  args.push("--crash-server-url=".to_string());
  args.push("--disable-updater".to_string());
  args.push("--disable-session-crashed-bubble".to_string());
  args.push("--hide-crash-restore-bubble".to_string());
  args.push("--disable-infobars".to_string());
  // enable-features must be present; disable-features alone cannot turn HTTPS-First on.
  args.push(format!("--enable-features={WAYFERN_ENABLE_FEATURES}"));
  args.push(format!("--disable-features={WAYFERN_DISABLE_FEATURES}"));
  args.push("--use-mock-keychain".to_string());
  args.push("--password-store=basic".to_string());

  if opts.block_images {
    args.push("--blink-settings=imagesEnabled=false".to_string());
  }

  if opts.block_webgl {
    args.push("--disable-webgl".to_string());
    args.push("--disable-webgl2".to_string());
  }

  if opts.headless {
    args.push("--headless=new".to_string());
  } else {
    // Scale drives BOTH chrome UI size and how --window-size DIPs map to
    // physical pixels. Prefer fingerprint DPR (user-set 1.5 etc.), else host.
    // Env WAYFERN_DEVICE_SCALE_FACTOR still wins via host_device_scale_factor().
    let scale = effective_device_scale_factor(opts.fingerprint_json);

    // Restore bounds from fingerprint (used when user un-maximizes).
    // Clamp so DIPs × scale never exceeds the host panel (prevents the
    // "wider than external monitor" overflow when scale is 1.25–1.5).
    if let Some((w, h)) = opts
      .fingerprint_json
      .and_then(window_size_from_fingerprint_json)
    {
      let (clamped_w, clamped_h) =
        clamp_window_size_to_host(w, h, scale, opts.screen_max_width, opts.screen_max_height);
      if (clamped_w, clamped_h) != (w, h) {
        log::info!(
          "Clamped Wayfern --window-size from {w}x{h} to {clamped_w}x{clamped_h} (scale={scale})"
        );
      }

      args.push(format!("--window-size={clamped_w},{clamped_h}"));
      args.push("--window-position=0,0".to_string());
    }

    // Open maximized on the monitor the window lands on.
    args.push("--start-maximized".to_string());

    // Fingerprint devicePixelRatio only spoofs JS APIs via CDP — it does NOT
    // scale Chromium chrome/tabs/fonts. --force-device-scale-factor is required
    // for real UI scale (matches normal Chrome on 125–150% hosts, and honors
    // user-set DPR ≥ 1.2 in the fingerprint).
    if (scale - 1.0).abs() > 0.01 {
      let scale_str = if (scale * 100.0).fract().abs() < f64::EPSILON {
        format!("{scale:.2}")
      } else {
        // Trim trailing zeros from non-hundredths (e.g. 1.25)
        let s = format!("{scale:.2}");
        s
      };
      args.push(format!("--force-device-scale-factor={scale_str}"));
      log::info!("Wayfern launch using --force-device-scale-factor={scale_str}");
    }
  }

  #[cfg(target_os = "linux")]
  {
    args.push("--no-sandbox".to_string());
    args.push("--disable-setuid-sandbox".to_string());
    args.push("--disable-dev-shm-usage".to_string());
  }

  if opts.ephemeral {
    args.push("--disk-cache-size=1".to_string());
    args.push("--disable-breakpad".to_string());
    args.push("--disable-crash-reporter".to_string());
    args.push("--no-service-autorun".to_string());
    args.push("--disable-sync".to_string());
  }

  if !opts.extension_paths.is_empty() {
    args.push(format!(
      "--load-extension={}",
      opts.extension_paths.join(",")
    ));
  }

  // Per-profile window label and frame color so concurrent profile windows are
  // easy to tell apart. Only injected when the caller provides these fields
  // (gated by the window_colors feature flag in the caller).
  if let Some(name) = opts.profile_name {
    if !name.is_empty() {
      args.push(format!("--wayfern-profile-label={name}"));
    }
  }
  if let Some(color) = opts.profile_color {
    if !color.is_empty() {
      // Wayfern expects bare RRGGBB hex without '#'.
      let color = color.trim().trim_start_matches('#');
      args.push(format!("--wayfern-profile-color={color}"));
    }
  }

  if let Some(token) = opts.wayfern_token {
    args.push(format!("--wayfern-token={token}"));
  }

  if let Some(proxy) = opts.proxy_url {
    let (pac_directive, host_port) = if let Some(rest) = proxy.strip_prefix("socks5://") {
      ("SOCKS5", rest)
    } else {
      (
        "PROXY",
        proxy
          .trim_start_matches("http://")
          .trim_start_matches("https://"),
      )
    };
    let pac_data = format!(
      "data:application/x-ns-proxy-autoconfig,function FindProxyForURL(url,host){{return \"{pac_directive} {host_port}\";}}",
    );
    args.push(format!("--proxy-pac-url={pac_data}"));
    args.push("--dns-prefetch-disable".to_string());
  }

  match opts.webrtc_mode {
    "disable" | "forward" | "alter" => {
      args.push("--force-webrtc-ip-handling-policy=disable_non_proxied_udp".to_string());
    }
    "forward_google" => {
      args.push("--force-webrtc-ip-handling-policy=default_public_interface_only".to_string());
    }
    "real" => {
      args.push("--force-webrtc-ip-handling-policy=default".to_string());
    }
    _ => {
      args.push("--force-webrtc-ip-handling-policy=disable_non_proxied_udp".to_string());
    }
  }

  if let Some(url) = opts.url {
    args.push(url.to_string());
  }

  args
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn launch_args_include_antidetect_hardening_flags() {
    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path: "/tmp/profile",
      remote_debugging_port: Some(9222),
      headless: false,
      fingerprint_json: None,
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: None,
      webrtc_mode: "forward",
      block_images: false,
      block_webgl: false,
      url: None,
      screen_max_width: None,
      screen_max_height: None,
      profile_name: None,
      profile_color: None,
    });

    assert!(args.iter().any(|a| a.contains("--no-first-run")));
    assert!(args.iter().any(|a| a.contains(WAYFERN_DISABLE_FEATURES)));
    assert!(
      args
        .iter()
        .any(|a| a == &format!("--enable-features={WAYFERN_ENABLE_FEATURES}")),
      "expected HTTPS-First enable-features flag"
    );
    assert!(
      WAYFERN_ENABLE_FEATURES.contains("OmniboxDefaultTypedNavigationsToHttps"),
      "omnibox must default typed hosts to https://"
    );
    assert!(args.iter().any(|a| a == "--remote-debugging-port=9222"));
    // Non-headless launches open maximized (2K/4K hosts look like normal Chrome).
    assert!(args.iter().any(|a| a == "--start-maximized"));
  }

  #[test]
  fn ensure_https_first_mode_prefs_writes_https_only_keys() {
    let dir =
      std::env::temp_dir().join(format!("wayfern_https_first_prefs_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // Merge into existing Preferences without clobbering other keys.
    let default_dir = dir.join("Default");
    std::fs::create_dir_all(&default_dir).unwrap();
    std::fs::write(
      default_dir.join("Preferences"),
      r#"{"profile":{"name":"keep-me"}}"#,
    )
    .unwrap();

    ensure_https_first_mode_prefs(&dir).expect("seed prefs");

    let raw = std::fs::read_to_string(default_dir.join("Preferences")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
      parsed.get("https_only_mode_enabled"),
      Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
      parsed.get("https_first_balanced_mode_enabled"),
      Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
      parsed.get("https_only_mode_auto_enabled"),
      Some(&serde_json::Value::Bool(false))
    );
    assert_eq!(
      parsed.get("https_upgrades.policy.upgrades_enabled"),
      Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
      parsed.pointer("/profile/name").and_then(|v| v.as_str()),
      Some("keep-me")
    );

    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn headless_does_not_start_maximized() {
    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path: "/tmp/profile",
      remote_debugging_port: None,
      headless: true,
      fingerprint_json: Some(r#"{"windowOuterWidth":1280,"windowOuterHeight":720}"#),
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: None,
      webrtc_mode: "forward",
      block_images: false,
      block_webgl: false,
      url: None,
      screen_max_width: None,
      screen_max_height: None,
      profile_name: None,
      profile_color: None,
    });

    assert!(args.iter().any(|a| a == "--headless=new"));
    assert!(!args.iter().any(|a| a == "--start-maximized"));
    assert!(!args.iter().any(|a| a.starts_with("--window-size=")));
  }

  #[test]
  fn non_headless_uses_fingerprint_window_size_and_maximized() {
    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path: "/tmp/profile",
      remote_debugging_port: None,
      headless: false,
      fingerprint_json: Some(r#"{"windowOuterWidth":1920,"windowOuterHeight":1080}"#),
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: None,
      webrtc_mode: "forward",
      block_images: false,
      block_webgl: false,
      url: None,
      // Explicit max so CI/host DPI cannot make this flaky.
      screen_max_width: Some(1920),
      screen_max_height: Some(1080),
      profile_name: None,
      profile_color: None,
    });

    let size = args
      .iter()
      .find(|a| a.starts_with("--window-size="))
      .expect("expected --window-size");
    // Must not exceed requested fingerprint / screen max.
    let dims = size.strip_prefix("--window-size=").unwrap();
    let mut parts = dims.split(',');
    let w: u32 = parts.next().unwrap().parse().unwrap();
    let h: u32 = parts.next().unwrap().parse().unwrap();
    assert!(w <= 1920 && h <= 1080, "window-size too large: {size}");
    assert!(args.iter().any(|a| a == "--start-maximized"));
  }

  #[test]
  fn clamp_window_size_honors_scale_via_screen_max() {
    // Simulate: fingerprint 1920×1080, scale 1.5, explicit max 1280×720.
    // Host metrics (when available) may clamp further — never exceed screen_max.
    let (w, h) = clamp_window_size_to_host(1920, 1080, 1.5, Some(1280), Some(720));
    assert!(w <= 1280 && h <= 720, "exceeded screen_max: {w}x{h}");
    assert!(w >= 640 && h >= 480, "over-clamped: {w}x{h}");
  }

  #[test]
  fn high_scale_clamps_fingerprint_window_below_physical_host() {
    // Force scale 1.5; pass large fingerprint; explicit screen_max mimics host DIPs.
    std::env::set_var("WAYFERN_DEVICE_SCALE_FACTOR", "1.5");
    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path: "/tmp/profile",
      remote_debugging_port: None,
      headless: false,
      fingerprint_json: Some(
        r#"{"devicePixelRatio":1,"windowOuterWidth":2560,"windowOuterHeight":1440}"#,
      ),
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: None,
      webrtc_mode: "forward",
      block_images: false,
      block_webgl: false,
      url: None,
      // Host physical ~1920×1080 → DIPs max at 1.5 ≈ 1280×720
      screen_max_width: Some(1280),
      screen_max_height: Some(720),
      profile_name: None,
      profile_color: None,
    });
    std::env::remove_var("WAYFERN_DEVICE_SCALE_FACTOR");

    let size = args
      .iter()
      .find(|a| a.starts_with("--window-size="))
      .expect("expected --window-size");
    let dims = size.strip_prefix("--window-size=").unwrap();
    let mut parts = dims.split(',');
    let w: u32 = parts.next().unwrap().parse().unwrap();
    let h: u32 = parts.next().unwrap().parse().unwrap();
    // Must not exceed the simulated host DIP budget (host may clamp tighter).
    assert!(w <= 1280 && h <= 720, "window-size not clamped: {size}");
    assert!(args
      .iter()
      .any(|a| a.starts_with("--force-device-scale-factor=")));
  }

  #[test]
  fn effective_scale_prefers_host_when_fingerprint_is_1x() {
    // Without env override, host may be 1.0 in CI — still returns >= 1.0
    let scale = effective_device_scale_factor(Some(
      r#"{"devicePixelRatio":1,"windowOuterWidth":1920,"windowOuterHeight":1080}"#,
    ));
    assert!(scale >= 1.0);
  }

  #[test]
  fn effective_scale_keeps_high_fingerprint_dpr() {
    // Clear env so parallel tests that set WAYFERN_DEVICE_SCALE_FACTOR cannot flake this.
    std::env::remove_var("WAYFERN_DEVICE_SCALE_FACTOR");
    let scale = effective_device_scale_factor(Some(r#"{"devicePixelRatio":2}"#));
    assert!((scale - 2.0).abs() < 0.01);
  }

  #[test]
  fn forces_scale_from_fingerprint_dpr_1_5_without_env() {
    std::env::remove_var("WAYFERN_DEVICE_SCALE_FACTOR");
    let scale = effective_device_scale_factor(Some(
      r#"{"devicePixelRatio":1.5,"windowOuterWidth":1920,"windowOuterHeight":1080}"#,
    ));
    assert!(
      (scale - 1.5).abs() < 0.01,
      "expected 1.5 from fingerprint, got {scale}"
    );

    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path: "/tmp/profile",
      remote_debugging_port: None,
      headless: false,
      fingerprint_json: Some(
        r#"{"devicePixelRatio":1.5,"windowOuterWidth":1920,"windowOuterHeight":1080}"#,
      ),
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: None,
      webrtc_mode: "forward",
      block_images: false,
      block_webgl: false,
      url: None,
      screen_max_width: Some(1920),
      screen_max_height: Some(1080),
      profile_name: None,
      profile_color: None,
    });
    let flag = args
      .iter()
      .find(|a| a.starts_with("--force-device-scale-factor="))
      .expect("force-device-scale-factor required for DPR 1.5");
    assert!(flag.contains("1.5"), "flag={flag}");
    let size = args
      .iter()
      .find(|a| a.starts_with("--window-size="))
      .expect("window-size");
    let dims = size.strip_prefix("--window-size=").unwrap();
    let mut parts = dims.split(',');
    let w: u32 = parts.next().unwrap().parse().unwrap();
    let h: u32 = parts.next().unwrap().parse().unwrap();
    assert!(w <= 1920 && h <= 1080, "window-size not clamped: {size}");
  }

  #[test]
  fn non_headless_force_device_scale_when_host_or_fp_high() {
    // Force via env so CI (often 1x) still exercises the flag path.
    std::env::set_var("WAYFERN_DEVICE_SCALE_FACTOR", "1.5");
    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path: "/tmp/profile",
      remote_debugging_port: None,
      headless: false,
      fingerprint_json: Some(
        r#"{"devicePixelRatio":1,"windowOuterWidth":1920,"windowOuterHeight":1080}"#,
      ),
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: None,
      webrtc_mode: "forward",
      block_images: false,
      block_webgl: false,
      url: None,
      screen_max_width: None,
      screen_max_height: None,
      profile_name: None,
      profile_color: None,
    });
    std::env::remove_var("WAYFERN_DEVICE_SCALE_FACTOR");

    assert!(
      args
        .iter()
        .any(|a| a.starts_with("--force-device-scale-factor=")),
      "expected force-device-scale-factor in args: {args:?}"
    );
  }

  #[test]
  fn block_images_and_webgl_emit_flags() {
    let args = build_wayfern_launch_args(WayfernLaunchArgsOptions {
      profile_path: "/tmp/profile",
      remote_debugging_port: None,
      headless: true,
      fingerprint_json: None,
      ephemeral: false,
      extension_paths: &[],
      wayfern_token: None,
      proxy_url: None,
      webrtc_mode: "disable",
      block_images: true,
      block_webgl: true,
      url: None,
      screen_max_width: None,
      screen_max_height: None,
      profile_name: None,
      profile_color: None,
    });

    assert!(args.contains(&"--blink-settings=imagesEnabled=false".to_string()));
    assert!(args.contains(&"--disable-webgl".to_string()));
    assert!(args.contains(&"--disable-webgl2".to_string()));
  }

  #[test]
  fn unknown_webrtc_mode_defaults_to_forward() {
    assert_eq!(resolve_webrtc_mode(false, Some("bogus")), "forward");
  }
}
