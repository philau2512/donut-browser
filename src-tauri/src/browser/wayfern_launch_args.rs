//! Shared Chromium launch arguments for Wayfern.
//!
//! Both `WayfernManager::launch_wayfern` (production path) and
//! `WayfernBrowser::create_launch_args` (trait fallback + unit tests) must use
//! this module so antidetect hardening cannot drift between paths.

/// Chromium features disabled to prevent DNS/prefetch leaks past the profile proxy.
pub const WAYFERN_DISABLE_FEATURES: &str =
  "DialMediaRouteProvider,DnsOverHttps,AsyncDns,Prefetch,PrefetchProxy,SpeculationRulesPrefetchFuture,NoStatePrefetch";

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
  } else if let Some((w, h)) = opts
    .fingerprint_json
    .and_then(window_size_from_fingerprint_json)
  {
    args.push(format!("--window-size={w},{h}"));
    args.push("--window-position=0,0".to_string());
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
    });

    assert!(args.iter().any(|a| a.contains("--no-first-run")));
    assert!(args.iter().any(|a| a.contains(WAYFERN_DISABLE_FEATURES)));
    assert!(args.iter().any(|a| a == "--remote-debugging-port=9222"));
    assert!(!args.iter().any(|a| a == "--start-maximized"));
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
