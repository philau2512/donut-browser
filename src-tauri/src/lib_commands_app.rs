// App lifecycle and internal helper commands extracted from lib.rs

use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{Emitter, Manager, Runtime, WebviewWindow};

// Store pending URLs that need to be handled when the window is ready
static PENDING_URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());

// Set to true once the user has confirmed they want to quit, so the close
// interceptor lets the next CloseRequested through instead of looping back
// to the confirmation dialog.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

// Called internally for deep-link / startup URL handling — not invoked from the
// frontend, so it is intentionally not a `#[tauri::command]`.
pub async fn handle_url_open(app: tauri::AppHandle, url: String) -> Result<(), String> {
  log::info!("handle_url_open called with URL: {url}");

  // Check if the main window exists and is ready
  if let Some(window) = app.get_webview_window("main") {
    log::debug!("Main window exists");

    // Try to show and focus the window first
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.unminimize();

    crate::events::emit("show-profile-selector", url.clone())
      .map_err(|e| format!("Failed to emit URL open event: {e}"))?;
  } else {
    // Window doesn't exist yet - add to pending URLs
    log::debug!("Main window doesn't exist, adding URL to pending list");
    let mut pending = PENDING_URLS.lock().unwrap();
    pending.push(url);
  }

  Ok(())
}

pub fn get_pending_urls() -> Vec<String> {
  let mut pending = PENDING_URLS.lock().unwrap();
  std::mem::take(&mut *pending)
}

pub fn is_quit_confirmed() -> bool {
  QUIT_CONFIRMED.load(Ordering::SeqCst)
}

pub fn set_quit_confirmed(value: bool) {
  QUIT_CONFIRMED.store(value, Ordering::SeqCst);
}
