use super::engine::SyncEngine;
use super::subscription::SyncWorkItem;
use crate::events;
use crate::profile::ProfileManager;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio::time::sleep;

static GLOBAL_SCHEDULER: std::sync::Mutex<Option<Arc<SyncScheduler>>> = std::sync::Mutex::new(None);

pub fn get_global_scheduler() -> Option<Arc<SyncScheduler>> {
  GLOBAL_SCHEDULER.lock().ok().and_then(|g| g.clone())
}

pub fn set_global_scheduler(scheduler: Arc<SyncScheduler>) {
  if let Ok(mut g) = GLOBAL_SCHEDULER.lock() {
    *g = Some(scheduler);
  }
}

#[derive(Debug, Clone)]
pub(crate) struct ProfileStopTime {
  #[allow(dead_code)]
  stopped_at: Instant,
  queued: bool,
}

pub struct SyncScheduler {
  pub(crate) running: Arc<AtomicBool>,
  pub(crate) pending_profiles: Arc<Mutex<HashMap<String, ProfileStopTime>>>,
  pub(crate) pending_proxies: Arc<Mutex<HashSet<String>>>,
  pub(crate) pending_groups: Arc<Mutex<HashSet<String>>>,
  pub(crate) pending_vpns: Arc<Mutex<HashSet<String>>>,
  pub(crate) pending_extensions: Arc<Mutex<HashSet<String>>>,
  pub(crate) pending_extension_groups: Arc<Mutex<HashSet<String>>>,
  pub(crate) pending_tombstones: Arc<Mutex<Vec<(String, String)>>>,
  pub(crate) running_profiles: Arc<Mutex<HashSet<String>>>,
  pub(crate) in_flight_profiles: Arc<Mutex<HashSet<String>>>,
}

impl Default for SyncScheduler {
  fn default() -> Self {
    Self::new()
  }
}

impl SyncScheduler {
  pub fn new() -> Self {
    Self {
      running: Arc::new(AtomicBool::new(false)),
      pending_profiles: Arc::new(Mutex::new(HashMap::new())),
      pending_proxies: Arc::new(Mutex::new(HashSet::new())),
      pending_groups: Arc::new(Mutex::new(HashSet::new())),
      pending_vpns: Arc::new(Mutex::new(HashSet::new())),
      pending_extensions: Arc::new(Mutex::new(HashSet::new())),
      pending_extension_groups: Arc::new(Mutex::new(HashSet::new())),
      pending_tombstones: Arc::new(Mutex::new(Vec::new())),
      running_profiles: Arc::new(Mutex::new(HashSet::new())),
      in_flight_profiles: Arc::new(Mutex::new(HashSet::new())),
    }
  }

  pub fn is_running(&self) -> bool {
    self.running.load(Ordering::SeqCst)
  }

  pub fn stop(&self) {
    self.running.store(false, Ordering::SeqCst);
  }

  /// Check if any sync operation is currently in progress
  pub async fn is_sync_in_progress(&self) -> bool {
    let in_flight = self.in_flight_profiles.lock().await;
    if !in_flight.is_empty() {
      return true;
    }
    drop(in_flight);

    let pending_profiles = self.pending_profiles.lock().await;
    if !pending_profiles.is_empty() {
      return true;
    }
    drop(pending_profiles);

    let pending_proxies = self.pending_proxies.lock().await;
    if !pending_proxies.is_empty() {
      return true;
    }
    drop(pending_proxies);

    let pending_groups = self.pending_groups.lock().await;
    if !pending_groups.is_empty() {
      return true;
    }
    drop(pending_groups);

    let pending_vpns = self.pending_vpns.lock().await;
    if !pending_vpns.is_empty() {
      return true;
    }
    drop(pending_vpns);

    let pending_extensions = self.pending_extensions.lock().await;
    if !pending_extensions.is_empty() {
      return true;
    }
    drop(pending_extensions);

    let pending_extension_groups = self.pending_extension_groups.lock().await;
    if !pending_extension_groups.is_empty() {
      return true;
    }
    drop(pending_extension_groups);

    let pending_tombstones = self.pending_tombstones.lock().await;
    if !pending_tombstones.is_empty() {
      return true;
    }

    false
  }

  pub async fn mark_profile_running(&self, profile_id: &str) {
    let mut running = self.running_profiles.lock().await;
    running.insert(profile_id.to_string());
    log::debug!("Marked profile {} as running", profile_id);
  }

  pub async fn mark_profile_stopped(&self, profile_id: &str) {
    let mut running = self.running_profiles.lock().await;
    running.remove(profile_id);
    log::debug!("Marked profile {} as stopped", profile_id);

    let mut pending = self.pending_profiles.lock().await;
    if pending.contains_key(profile_id) {
      // Set stopped_at to past so it syncs immediately
      pending.insert(
        profile_id.to_string(),
        ProfileStopTime {
          stopped_at: Instant::now() - Duration::from_secs(3),
          queued: true,
        },
      );
      log::debug!(
        "Profile {} has pending sync, will execute immediately",
        profile_id
      );
    }
  }

  pub async fn is_profile_running(&self, profile_id: &str) -> bool {
    // Check our internal tracking (authoritative — immediately updated by mark_profile_stopped)
    let running = self.running_profiles.lock().await;
    if running.contains(profile_id) {
      return true;
    }
    drop(running);

    // Check if locked by another device (profile in use remotely)
    if crate::profile::team_lock::PROFILE_LOCK
      .is_locked_by_another(profile_id)
      .await
    {
      log::debug!(
        "Profile {} is locked on another device, treating as running",
        profile_id
      );
      return true;
    }

    false
  }

  pub async fn queue_profile_sync(&self, profile_id: String) {
    self.queue_profile_sync_internal(profile_id).await;
  }

  pub async fn queue_profile_sync_immediate(&self, profile_id: String) {
    self.queue_profile_sync_internal(profile_id).await;
  }

  pub(crate) async fn queue_profile_sync_internal(&self, profile_id: String) {
    let is_running = self.is_profile_running(&profile_id).await;
    let mut pending = self.pending_profiles.lock().await;

    if is_running {
      // Profile is running - queue for after it stops
      pending.insert(
        profile_id.clone(),
        ProfileStopTime {
          stopped_at: Instant::now(),
          queued: true,
        },
      );
      log::debug!(
        "Profile {} is running, queued sync for after stop",
        profile_id
      );
    } else {
      // Profile is not running - sync immediately (set stopped_at to past)
      pending.insert(
        profile_id.clone(),
        ProfileStopTime {
          stopped_at: Instant::now() - Duration::from_secs(3),
          queued: true,
        },
      );
      log::debug!("Profile {} queued for immediate sync", profile_id);
    }
  }

  pub async fn queue_proxy_sync(&self, proxy_id: String) {
    let mut pending = self.pending_proxies.lock().await;
    pending.insert(proxy_id);
  }

  pub async fn queue_vpn_sync(&self, vpn_id: String) {
    let mut pending = self.pending_vpns.lock().await;
    pending.insert(vpn_id);
  }

  pub async fn queue_group_sync(&self, group_id: String) {
    let mut pending = self.pending_groups.lock().await;
    pending.insert(group_id);
  }

  pub async fn queue_extension_sync(&self, extension_id: String) {
    let mut pending = self.pending_extensions.lock().await;
    pending.insert(extension_id);
  }

  pub async fn queue_extension_group_sync(&self, extension_group_id: String) {
    let mut pending = self.pending_extension_groups.lock().await;
    pending.insert(extension_group_id);
  }

  pub async fn queue_tombstone(&self, entity_type: String, entity_id: String) {
    let mut pending = self.pending_tombstones.lock().await;
    if !pending
      .iter()
      .any(|(t, i)| t == &entity_type && i == &entity_id)
    {
      pending.push((entity_type, entity_id));
    }
  }

  pub async fn sync_all_enabled_profiles(&self, _app_handle: &tauri::AppHandle) {
    log::info!("Starting initial sync for all enabled profiles...");

    let profiles = {
      let profile_manager = ProfileManager::instance();
      match profile_manager.list_profiles() {
        Ok(p) => p,
        Err(e) => {
          log::error!("Failed to list profiles for initial sync: {e}");
          return;
        }
      }
    };

    let sync_enabled_profiles: Vec<_> = profiles
      .into_iter()
      .filter(|p| p.is_sync_enabled())
      .collect();

    if sync_enabled_profiles.is_empty() {
      log::debug!("No sync-enabled profiles found");
      return;
    }

    log::info!(
      "Found {} sync-enabled profiles, queueing for sync",
      sync_enabled_profiles.len()
    );

    for profile in sync_enabled_profiles {
      let profile_id = profile.id.to_string();
      let is_running = profile.process_id.is_some();
      let is_team_locked = crate::profile::team_lock::TEAM_LOCK
        .is_locked_by_another(&profile_id)
        .await;
      let should_wait = is_running || is_team_locked;

      // Track running state in the scheduler
      if is_running {
        self.mark_profile_running(&profile_id).await;
      }

      if should_wait {
        log::info!(
          "Profile '{}' is {} — will sync after it becomes available",
          profile.name,
          if is_running {
            "running locally"
          } else {
            "locked by a team member"
          }
        );
      }

      // Emit initial status
      let _ = events::emit(
        "profile-sync-status",
        serde_json::json!({
          "profile_id": profile_id,
          "status": if should_wait { "waiting" } else { "syncing" }
        }),
      );

      // Queue for sync — running profiles will be deferred by the scheduler
      self.queue_profile_sync_immediate(profile_id).await;
    }
  }

  pub async fn start(
    self: Arc<Self>,
    app_handle: tauri::AppHandle,
    mut work_rx: mpsc::UnboundedReceiver<SyncWorkItem>,
  ) {
    if self.running.swap(true, Ordering::SeqCst) {
      return;
    }

    let scheduler = self.clone();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
      while scheduler.running.load(Ordering::SeqCst) {
        tokio::select! {
          Some(work_item) = work_rx.recv() => {
            match work_item {
              SyncWorkItem::Profile(id) => scheduler.queue_profile_sync(id).await,
              SyncWorkItem::Proxy(id) => scheduler.queue_proxy_sync(id).await,
              SyncWorkItem::Group(id) => scheduler.queue_group_sync(id).await,
              SyncWorkItem::Vpn(id) => scheduler.queue_vpn_sync(id).await,
              SyncWorkItem::Extension(id) => scheduler.queue_extension_sync(id).await,
              SyncWorkItem::ExtensionGroup(id) => scheduler.queue_extension_group_sync(id).await,
              SyncWorkItem::Tombstone(entity_type, entity_id) => {
                scheduler.queue_tombstone(entity_type, entity_id).await
              }
            }
          }
          _ = sleep(Duration::from_millis(2000)) => {
            scheduler.process_pending(&app_handle_clone).await;
          }
        }
      }

      log::info!("Sync scheduler stopped");
    });
  }
}

include!("scheduler_worker.rs");
