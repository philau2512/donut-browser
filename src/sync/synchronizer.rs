use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::Mutex as AsyncMutex;

use crate::profile::manager::ProfileManager;
use crate::profile::types::BrowserProfile;

/// Maximum number of profiles to launch concurrently
const MAX_CONCURRENT_LAUNCHES: usize = 5;

/// Event captured from the leader browser via Wayfern.inputCaptured CDP events.
/// Fields match the Wayfern.inputCaptured event schema directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedEvent {
  #[serde(rename = "type")]
  pub event_type: String,
  #[serde(default)]
  pub url: Option<String>,
  #[serde(default)]
  pub x: Option<f64>,
  #[serde(default)]
  pub y: Option<f64>,
  #[serde(default)]
  pub button: Option<String>,
  #[serde(default, rename = "clickCount")]
  pub click_count: Option<i32>,
  #[serde(default)]
  pub key: Option<String>,
  #[serde(default)]
  pub code: Option<String>,
  #[serde(default, rename = "windowsVirtualKeyCode")]
  pub key_code: Option<i32>,
  #[serde(default)]
  pub modifiers: Option<i32>,
  #[serde(default)]
  pub text: Option<String>,
  #[serde(default, rename = "deltaX")]
  pub delta_x: Option<f64>,
  #[serde(default, rename = "deltaY")]
  pub delta_y: Option<f64>,
  #[serde(default)]
  pub timestamp: Option<f64>,
}

// No JavaScript injection needed — Wayfern.enableInputCapture handles everything natively.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncFollowerState {
  pub profile_id: String,
  pub profile_name: String,
  /// None = healthy, Some(url) = desynced at this URL
  pub failed_at_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSessionInfo {
  pub id: String,
  pub leader_profile_id: String,
  pub leader_profile_name: String,
  pub followers: Vec<SyncFollowerState>,
}

/// Internal session state
struct SyncSession {
  id: String,
  leader_profile_id: String,
  leader_profile_name: String,
  followers: HashMap<String, SyncFollowerState>,
  /// Cancellation token — drop sender to stop the listener task
  cancel_tx: tokio::sync::watch::Sender<bool>,
}

pub struct SynchronizerManager {
  inner: Arc<AsyncMutex<SynchronizerInner>>,
}

struct SynchronizerInner {
  sessions: HashMap<String, SyncSession>,
}

static SYNCHRONIZER: std::sync::OnceLock<SynchronizerManager> = std::sync::OnceLock::new();

impl SynchronizerManager {
  pub fn instance() -> &'static SynchronizerManager {
    SYNCHRONIZER.get_or_init(|| SynchronizerManager {
      inner: Arc::new(AsyncMutex::new(SynchronizerInner {
        sessions: HashMap::new(),
      })),
    })
  }

  include!("synchronizer_session.rs");
  include!("synchronizer_events.rs");
  include!("synchronizer_commands.rs");
}
