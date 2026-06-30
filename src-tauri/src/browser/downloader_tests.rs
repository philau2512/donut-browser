/// Check if a specific browser-version pair is currently being downloaded
pub fn is_downloading(browser: &str, version: &str) -> bool {
  let download_key = format!("{browser}-{version}");
  let downloading = DOWNLOADING_BROWSERS.lock().unwrap();
  downloading.contains(&download_key)
}

/// Clear all in-progress download bookkeeping for a browser.
///
/// Used as a last-resort cleanup when a download future is abandoned (e.g. dropped
/// by an outer timeout) before its own error path could run. Because
/// `download_browser_full` may re-resolve to a different version than requested, this
/// matches by the `"{browser}-"` key prefix rather than an exact version so no stuck
/// key is left behind regardless of which version was actually in flight.
pub fn clear_download_state_for_browser(browser: &str) {
  let prefix = format!("{browser}-");
  {
    let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
    downloading.retain(|key| !key.starts_with(&prefix));
  }
  {
    let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
    tokens.retain(|key, _| !key.starts_with(&prefix));
  }
}

#[tauri::command]
pub async fn download_browser(
  app_handle: tauri::AppHandle,
  browser_str: String,
  version: String,
) -> Result<String, String> {
  let downloader = Downloader::instance();
  downloader
    .download_browser_full(&app_handle, browser_str, version)
    .await
    .map_err(|e| format!("Failed to download browser: {e}"))
}

#[tauri::command]
pub async fn cancel_download(browser_str: String, version: String) -> Result<(), String> {
  let download_key = format!("{browser_str}-{version}");
  let token = {
    let tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
    tokens.get(&download_key).cloned()
  };

  if let Some(token) = token {
    token.cancel();
    Ok(())
  } else {
    Err(format!(
      "No active download found for {browser_str} {version}"
    ))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  use tempfile::TempDir;
  use wiremock::matchers::{method, path};
  use wiremock::{Mock, MockServer, ResponseTemplate};

  #[tokio::test]
  async fn test_download_file_with_progress() {
    let server = MockServer::start().await;
    let downloader = Downloader::new_for_test();

    let temp_dir = TempDir::new().unwrap();
    let dest_path = temp_dir.path();

    let test_content = b"This is a test file content for download simulation";

    Mock::given(method("GET"))
      .and(path("/test-download"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_bytes(test_content)
          .insert_header("content-length", test_content.len().to_string())
          .insert_header("content-type", "application/octet-stream"),
      )
      .mount(&server)
      .await;

    let download_url = format!("{}/test-download", server.uri());

    let result = downloader
      .download_file(&download_url, dest_path, "test-file.dmg")
      .await;

    assert!(result.is_ok());
    let downloaded_file = result.unwrap();
    assert!(downloaded_file.exists());

    let downloaded_content = std::fs::read(&downloaded_file).unwrap();
    assert_eq!(downloaded_content, test_content);
  }

  #[tokio::test]
  async fn test_download_file_network_error() {
    let server = MockServer::start().await;
    let downloader = Downloader::new_for_test();

    let temp_dir = TempDir::new().unwrap();
    let dest_path = temp_dir.path();

    Mock::given(method("GET"))
      .and(path("/missing-file"))
      .respond_with(ResponseTemplate::new(404))
      .mount(&server)
      .await;

    let download_url = format!("{}/missing-file", server.uri());

    let result = downloader
      .download_file(&download_url, dest_path, "missing-file.dmg")
      .await;

    assert!(result.is_err());
  }

  #[tokio::test]
  async fn test_download_file_chunked_response() {
    let server = MockServer::start().await;
    let downloader = Downloader::new_for_test();

    let temp_dir = TempDir::new().unwrap();
    let dest_path = temp_dir.path();

    let test_content = vec![42u8; 1024]; // 1KB of data

    Mock::given(method("GET"))
      .and(path("/chunked-download"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_bytes(test_content.clone())
          .insert_header("content-length", test_content.len().to_string())
          .insert_header("content-type", "application/octet-stream"),
      )
      .mount(&server)
      .await;

    let download_url = format!("{}/chunked-download", server.uri());

    let result = downloader
      .download_file(&download_url, dest_path, "chunked-file.dmg")
      .await;

    assert!(result.is_ok());
    let downloaded_file = result.unwrap();
    assert!(downloaded_file.exists());

    let downloaded_content = std::fs::read(&downloaded_file).unwrap();
    assert_eq!(downloaded_content.len(), test_content.len());
  }

  #[test]
  fn test_clear_download_state_for_browser_removes_stuck_keys() {
    // Simulate a download future that was abandoned without running its own cleanup,
    // leaving stuck bookkeeping for a version that differs from the requested one.
    let key = "wayfern-1.2.3-resolved".to_string();
    {
      let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
      downloading.insert(key.clone());
    }
    {
      let mut tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
      tokens.insert(key.clone(), CancellationToken::new());
    }

    // A different browser's in-progress state must be left untouched.
    let other = "camoufox-9.9.9".to_string();
    {
      let mut downloading = DOWNLOADING_BROWSERS.lock().unwrap();
      downloading.insert(other.clone());
    }

    clear_download_state_for_browser("wayfern");

    assert!(
      !is_downloading("wayfern", "1.2.3-resolved"),
      "stuck wayfern key should be cleared even when version differs from request"
    );
    {
      let tokens = DOWNLOAD_CANCELLATION_TOKENS.lock().unwrap();
      assert!(
        !tokens.contains_key(&key),
        "stuck wayfern cancellation token should be cleared"
      );
    }
    assert!(
      is_downloading("camoufox", "9.9.9"),
      "unrelated browser's download state must be preserved"
    );

    // Cleanup so we don't leak global state into other tests.
    clear_download_state_for_browser("camoufox");
  }
}

// Global singleton instance
lazy_static::lazy_static! {
  static ref DOWNLOADER: Downloader = Downloader::new();
}
