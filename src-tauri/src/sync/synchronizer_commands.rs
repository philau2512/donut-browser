#[tauri::command]
pub async fn start_sync_session(
  app_handle: tauri::AppHandle,
  leader_profile_id: String,
  follower_profile_ids: Vec<String>,
) -> Result<SyncSessionInfo, String> {
  SynchronizerManager::instance()
    .start_session(app_handle, leader_profile_id, follower_profile_ids)
    .await
}

#[tauri::command]
pub async fn stop_sync_session(
  app_handle: tauri::AppHandle,
  session_id: String,
) -> Result<(), String> {
  SynchronizerManager::instance()
    .stop_session(app_handle, &session_id)
    .await
}

#[tauri::command]
pub async fn remove_sync_follower(
  app_handle: tauri::AppHandle,
  session_id: String,
  follower_profile_id: String,
) -> Result<(), String> {
  SynchronizerManager::instance()
    .remove_follower(app_handle, &session_id, &follower_profile_id)
    .await
}

#[tauri::command]
pub async fn get_sync_sessions() -> Result<Vec<SyncSessionInfo>, String> {
  Ok(SynchronizerManager::instance().get_sessions().await)
}
