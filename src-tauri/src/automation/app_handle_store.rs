// Stores the main Tauri AppHandle for background HTTP tasks (automation engine host).

use std::sync::Mutex;
use tauri::AppHandle;

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

pub fn set_automation_app_handle(handle: AppHandle) {
  if let Ok(mut guard) = APP_HANDLE.lock() {
    *guard = Some(handle);
  }
}

pub fn get_automation_app_handle() -> Result<AppHandle, String> {
  APP_HANDLE
    .lock()
    .map_err(|e| format!("app handle lock poisoned: {e}"))?
    .clone()
    .ok_or_else(|| "App handle not initialized".to_string())
}
