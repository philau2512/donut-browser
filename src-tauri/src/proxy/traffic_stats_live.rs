/// Lightweight session snapshot for real-time updates (written frequently, separate from full stats)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionSnapshot {
  proxy_id: String,
  profile_id: Option<String>,
  timestamp: u64,
  bytes_sent: u64,
  bytes_received: u64,
  requests: u64,
}

/// Live bandwidth tracker for real-time stats collection in the proxy
/// This is designed to be used from within the proxy server
pub struct LiveTrafficTracker {
  pub proxy_id: String,
  pub profile_id: Option<String>,
  bytes_sent: AtomicU64,
  bytes_received: AtomicU64,
  requests: AtomicU64,
  domain_stats: RwLock<HashMap<String, (u64, u64, u64)>>, // domain -> (count, sent, recv)
  ips: RwLock<Vec<String>>,
  #[allow(dead_code)]
  session_start: u64,
  last_session_write: std::sync::atomic::AtomicU64,
}

impl LiveTrafficTracker {
  pub fn new(proxy_id: String, profile_id: Option<String>) -> Self {
    Self {
      proxy_id,
      profile_id,
      bytes_sent: AtomicU64::new(0),
      bytes_received: AtomicU64::new(0),
      requests: AtomicU64::new(0),
      domain_stats: RwLock::new(HashMap::new()),
      ips: RwLock::new(Vec::new()),
      session_start: current_timestamp(),
      last_session_write: std::sync::atomic::AtomicU64::new(0),
    }
  }

  /// Write a lightweight session snapshot for real-time updates
  /// This is much smaller than full stats and can be written frequently
  pub fn write_session_snapshot(&self) -> Result<(), Box<dyn std::error::Error>> {
    let now = current_timestamp();
    let last_write = self.last_session_write.load(Ordering::Relaxed);

    // Only write if at least 1 second has passed (avoid excessive writes)
    if now.saturating_sub(last_write) < 1 {
      return Ok(());
    }

    let snapshot = SessionSnapshot {
      proxy_id: self.proxy_id.clone(),
      profile_id: self.profile_id.clone(),
      timestamp: now,
      bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
      bytes_received: self.bytes_received.load(Ordering::Relaxed),
      requests: self.requests.load(Ordering::Relaxed),
    };

    let storage_key = self
      .profile_id
      .clone()
      .unwrap_or_else(|| self.proxy_id.clone());
    let storage_dir = get_traffic_stats_dir();
    fs::create_dir_all(&storage_dir)?;
    let session_file = storage_dir.join(format!("{}.session.json", storage_key));

    // Write atomically using a temp file
    let temp_file = session_file.with_extension("tmp");
    let content = serde_json::to_string(&snapshot)?;
    fs::write(&temp_file, content)?;
    fs::rename(&temp_file, &session_file)?;

    self.last_session_write.store(now, Ordering::Relaxed);
    Ok(())
  }

  pub fn add_bytes_sent(&self, bytes: u64) {
    self.bytes_sent.fetch_add(bytes, Ordering::Relaxed);
  }

  pub fn add_bytes_received(&self, bytes: u64) {
    self.bytes_received.fetch_add(bytes, Ordering::Relaxed);
  }

  pub fn record_request(&self, domain: &str, bytes_sent: u64, bytes_received: u64) {
    self.requests.fetch_add(1, Ordering::Relaxed);
    // Also update total byte counters for HTTP requests (not tunneled)
    self.bytes_sent.fetch_add(bytes_sent, Ordering::Relaxed);
    self
      .bytes_received
      .fetch_add(bytes_received, Ordering::Relaxed);
    if let Ok(mut stats) = self.domain_stats.write() {
      let entry = stats.entry(domain.to_string()).or_insert((0, 0, 0));
      entry.0 += 1;
      entry.1 += bytes_sent;
      entry.2 += bytes_received;
    }
  }

  pub fn record_ip(&self, ip: &str) {
    if let Ok(mut ips) = self.ips.write() {
      if !ips.contains(&ip.to_string()) {
        ips.push(ip.to_string());
      }
    }
  }

  /// Update domain-specific byte counts (called when CONNECT tunnel closes)
  pub fn update_domain_bytes(&self, domain: &str, bytes_sent: u64, bytes_received: u64) {
    if let Ok(mut stats) = self.domain_stats.write() {
      let entry = stats.entry(domain.to_string()).or_insert((0, 0, 0));
      entry.1 += bytes_sent;
      entry.2 += bytes_received;
    }
  }

  /// Get current stats snapshot
  pub fn get_snapshot(&self) -> (u64, u64, u64) {
    (
      self.bytes_sent.load(Ordering::Relaxed),
      self.bytes_received.load(Ordering::Relaxed),
      self.requests.load(Ordering::Relaxed),
    )
  }

  /// Create a real-time snapshot that merges in-memory data with disk-stored data
  /// This provides near real-time updates without waiting for disk flush
  pub fn to_realtime_snapshot(&self) -> TrafficSnapshot {
    let now = current_timestamp();
    let cutoff = now.saturating_sub(60); // Last 60 seconds for mini chart

    // Get in-memory counters (not yet flushed to disk)
    let in_memory_sent = self.bytes_sent.load(Ordering::Relaxed);
    let in_memory_recv = self.bytes_received.load(Ordering::Relaxed);
    let in_memory_requests = self.requests.load(Ordering::Relaxed);

    // Load disk-stored stats
    let storage_key = self
      .profile_id
      .clone()
      .unwrap_or_else(|| self.proxy_id.clone());
    let disk_stats = load_traffic_stats(&storage_key);

    if let Some(stats) = disk_stats {
      // Merge in-memory data with disk data
      let total_sent = stats.total_bytes_sent + in_memory_sent;
      let total_recv = stats.total_bytes_received + in_memory_recv;
      let total_requests = stats.total_requests + in_memory_requests;

      // Get current bandwidth from in-memory counters (most recent)
      // For the chart, we'll use disk data + current in-memory data point
      let mut recent_bandwidth = stats
        .bandwidth_history
        .iter()
        .filter(|dp| dp.timestamp >= cutoff)
        .cloned()
        .collect::<Vec<_>>();

      // Add current second's data if we have in-memory traffic
      if in_memory_sent > 0 || in_memory_recv > 0 {
        // Check if we already have a data point for this second
        if let Some(last) = recent_bandwidth.last_mut() {
          if last.timestamp == now {
            last.bytes_sent += in_memory_sent;
            last.bytes_received += in_memory_recv;
          } else {
            recent_bandwidth.push(BandwidthDataPoint {
              timestamp: now,
              bytes_sent: in_memory_sent,
              bytes_received: in_memory_recv,
            });
          }
        } else {
          recent_bandwidth.push(BandwidthDataPoint {
            timestamp: now,
            bytes_sent: in_memory_sent,
            bytes_received: in_memory_recv,
          });
        }
      }

      TrafficSnapshot {
        profile_id: self.profile_id.clone(),
        session_start: stats.session_start,
        last_update: now,
        total_bytes_sent: total_sent,
        total_bytes_received: total_recv,
        total_requests,
        current_bytes_sent: in_memory_sent,
        current_bytes_received: in_memory_recv,
        recent_bandwidth,
      }
    } else {
      // No disk data yet, use only in-memory data
      let recent_bandwidth = if in_memory_sent > 0 || in_memory_recv > 0 {
        vec![BandwidthDataPoint {
          timestamp: now,
          bytes_sent: in_memory_sent,
          bytes_received: in_memory_recv,
        }]
      } else {
        Vec::new()
      };

      TrafficSnapshot {
        profile_id: self.profile_id.clone(),
        session_start: self.session_start,
        last_update: now,
        total_bytes_sent: in_memory_sent,
        total_bytes_received: in_memory_recv,
        total_requests: in_memory_requests,
        current_bytes_sent: in_memory_sent,
        current_bytes_received: in_memory_recv,
        recent_bandwidth,
      }
    }
  }

  /// Flush current stats to disk and return the delta
  /// Returns None if there's no new data to flush
  pub fn flush_to_disk(&self) -> Result<Option<(u64, u64)>, Box<dyn std::error::Error>> {
    let bytes_sent = self.bytes_sent.load(Ordering::Relaxed);
    let bytes_received = self.bytes_received.load(Ordering::Relaxed);

    // Check if there's any new data to flush
    let has_domain_updates = {
      let domain_map = self.domain_stats.read().ok();
      domain_map.is_some_and(|dm| !dm.is_empty())
    };

    let has_ip_updates = {
      let ips = self.ips.read().ok();
      ips.is_some_and(|i| !i.is_empty())
    };

    // Only flush if there's meaningful new data (bytes or domain/IP updates)
    if bytes_sent == 0 && bytes_received == 0 && !has_domain_updates && !has_ip_updates {
      return Ok(None);
    }

    // Use profile_id as storage key if available, otherwise fall back to proxy_id
    let storage_key = self
      .profile_id
      .clone()
      .unwrap_or_else(|| self.proxy_id.clone());
    let storage_dir = get_traffic_stats_dir();
    fs::create_dir_all(&storage_dir)?;

    // Use file locking to prevent concurrent writes from multiple proxy processes
    let lock_path = storage_dir.join(format!("{}.lock", storage_key));
    let _lock = match acquire_file_lock(&lock_path) {
      Ok(lock) => lock,
      Err(e) => {
        // If lock acquisition fails, reset counters to prevent indefinite accumulation
        // The data will be lost, but this prevents memory growth
        let _ = self.bytes_sent.swap(0, Ordering::Relaxed);
        let _ = self.bytes_received.swap(0, Ordering::Relaxed);
        return Err(e);
      }
    };

    // Load or create stats using the storage key
    let mut stats = load_traffic_stats(&storage_key)
      .unwrap_or_else(|| TrafficStats::new(self.proxy_id.clone(), self.profile_id.clone()));

    // Ensure profile_id is set (in case stats were loaded from disk without it)
    if stats.profile_id.is_none() && self.profile_id.is_some() {
      stats.profile_id = self.profile_id.clone();
    }

    // Update the proxy_id to current session (for debugging/tracking)
    stats.proxy_id = self.proxy_id.clone();

    // Prune old data before adding new data to keep file size manageable
    stats.prune_old_data();

    // Update flush timestamp BEFORE reading/resetting counters
    // This prevents double-counting session snapshots written after this timestamp
    // If we set it after reading counters, a session snapshot written just before
    // the flush completes could have a timestamp newer than last_flush_timestamp,
    // causing its data to be added even though it was already included in the flush
    let now = current_timestamp();
    stats.last_flush_timestamp = now;
    stats.last_update = now;

    // Reset counters after reading (lock is held, so flush will proceed)
    let sent = self.bytes_sent.swap(0, Ordering::Relaxed);
    let received = self.bytes_received.swap(0, Ordering::Relaxed);
    let _requests = self.requests.swap(0, Ordering::Relaxed);

    // Update bandwidth history
    stats.record_bandwidth(sent, received);

    // Update domain stats
    if let Ok(mut domain_map) = self.domain_stats.write() {
      for (domain, (count, sent, recv)) in domain_map.drain() {
        stats.record_request(&domain, sent, recv);
        // Adjust request count (record_request increments total_requests)
        stats.total_requests = stats.total_requests.saturating_sub(1) + count;
      }
    }

    // Update IPs and clear them after flushing (like domain_stats)
    if let Ok(mut ips) = self.ips.write() {
      for ip in ips.drain(..) {
        stats.record_ip(&ip);
      }
    }

    // Save to disk (lock is still held)
    save_traffic_stats(&stats)?;

    Ok(Some((sent, received)))
  }
}

/// Global traffic tracker that can be accessed from connection handlers
/// Using RwLock to allow reinitialization when proxy config changes
static TRAFFIC_TRACKER: std::sync::RwLock<Option<Arc<LiveTrafficTracker>>> =
  std::sync::RwLock::new(None);

/// Initialize the global traffic tracker
/// This can be called multiple times to update the tracker when proxy config changes
pub fn init_traffic_tracker(proxy_id: String, profile_id: Option<String>) {
  let tracker = Arc::new(LiveTrafficTracker::new(proxy_id, profile_id));
  if let Ok(mut guard) = TRAFFIC_TRACKER.write() {
    *guard = Some(tracker);
  }
}

/// Get the global traffic tracker
pub fn get_traffic_tracker() -> Option<Arc<LiveTrafficTracker>> {
  TRAFFIC_TRACKER.read().ok().and_then(|guard| guard.clone())
}

/// Filtered traffic stats for client display (only contains data for requested period)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilteredTrafficStats {
  pub profile_id: Option<String>,
  pub session_start: u64,
  pub last_update: u64,
  pub total_bytes_sent: u64,
  pub total_bytes_received: u64,
  pub total_requests: u64,
  /// Bandwidth history filtered to requested time period
  pub bandwidth_history: Vec<BandwidthDataPoint>,
  /// Period stats: bytes sent/received within the requested period
  pub period_bytes_sent: u64,
  pub period_bytes_received: u64,
  /// Period requests within the requested period
  pub period_requests: u64,
  /// Domain access statistics filtered to requested time period
  pub domains: HashMap<String, DomainAccess>,
  /// Unique IPs accessed
  pub unique_ips: Vec<String>,
}

/// Get traffic stats for a profile, filtered to a specific time period
/// seconds: number of seconds to include (0 = all time)
/// Merges in-memory data with disk data for real-time updates
pub fn get_traffic_stats_for_period(
  profile_id: &str,
  seconds: u64,
) -> Option<FilteredTrafficStats> {
  // Get in-memory data if available
  let in_memory_sent = get_traffic_tracker()
    .and_then(|t| {
      if t.profile_id.as_deref() == Some(profile_id) {
        Some(t.bytes_sent.load(Ordering::Relaxed))
      } else {
        None
      }
    })
    .unwrap_or(0);
  let in_memory_recv = get_traffic_tracker()
    .and_then(|t| {
      if t.profile_id.as_deref() == Some(profile_id) {
        Some(t.bytes_received.load(Ordering::Relaxed))
      } else {
        None
      }
    })
    .unwrap_or(0);

  let mut stats = load_traffic_stats(profile_id)?;

  // Merge in-memory counters with disk data for real-time totals
  stats.total_bytes_sent += in_memory_sent;
  stats.total_bytes_received += in_memory_recv;

  let now = current_timestamp();
  let cutoff = if seconds == 0 {
    0 // All time
  } else {
    now.saturating_sub(seconds)
  };

  // Filter bandwidth history to requested period
  let mut filtered_history: Vec<BandwidthDataPoint> = stats
    .bandwidth_history
    .iter()
    .filter(|dp| dp.timestamp >= cutoff)
    .cloned()
    .collect();

  // Add current in-memory data point for real-time display
  if (seconds == 0 || now.saturating_sub(seconds) <= now)
    && (in_memory_sent > 0 || in_memory_recv > 0)
  {
    // Check if we already have a data point for this second
    if let Some(last) = filtered_history.last_mut() {
      if last.timestamp == now {
        last.bytes_sent += in_memory_sent;
        last.bytes_received += in_memory_recv;
      } else {
        filtered_history.push(BandwidthDataPoint {
          timestamp: now,
          bytes_sent: in_memory_sent,
          bytes_received: in_memory_recv,
        });
      }
    } else {
      filtered_history.push(BandwidthDataPoint {
        timestamp: now,
        bytes_sent: in_memory_sent,
        bytes_received: in_memory_recv,
      });
    }
  }

  // Calculate period totals for bandwidth (includes in-memory data)
  let period_bytes_sent: u64 = filtered_history.iter().map(|dp| dp.bytes_sent).sum();
  let period_bytes_received: u64 = filtered_history.iter().map(|dp| dp.bytes_received).sum();

  // Filter and aggregate domain stats for the period
  let mut filtered_domains: HashMap<String, DomainAccess> = HashMap::new();
  let mut period_requests: u64 = 0;

  for access in stats
    .domain_access_history
    .iter()
    .filter(|a| a.timestamp >= cutoff)
  {
    period_requests += 1;
    let entry = filtered_domains
      .entry(access.domain.clone())
      .or_insert(DomainAccess {
        domain: access.domain.clone(),
        request_count: 0,
        bytes_sent: 0,
        bytes_received: 0,
        first_access: access.timestamp,
        last_access: access.timestamp,
      });

    entry.request_count += 1;
    entry.bytes_sent += access.bytes_sent;
    entry.bytes_received += access.bytes_received;
    entry.first_access = entry.first_access.min(access.timestamp);
    entry.last_access = entry.last_access.max(access.timestamp);
  }

  // If no domain_access_history exists (old data), fall back to all-time domains
  let domains = if stats.domain_access_history.is_empty() {
    stats.domains
  } else {
    filtered_domains
  };

  Some(FilteredTrafficStats {
    profile_id: stats.profile_id,
    session_start: stats.session_start,
    last_update: now, // Use current time for real-time updates
    total_bytes_sent: stats.total_bytes_sent,
    total_bytes_received: stats.total_bytes_received,
    total_requests: stats.total_requests,
    bandwidth_history: filtered_history,
    period_bytes_sent,
    period_bytes_received,
    period_requests,
    domains,
    unique_ips: stats.unique_ips,
  })
}

/// Get lightweight traffic snapshot for a profile (for mini charts, only recent 60 seconds)
/// Merges in-memory data with disk data for real-time updates
pub fn get_traffic_snapshot_for_profile(profile_id: &str) -> Option<TrafficSnapshot> {
  // First try to get real-time data from active tracker
  if let Some(tracker) = get_traffic_tracker() {
    let tracker_profile_id = tracker.profile_id.as_deref();
    if tracker_profile_id == Some(profile_id) {
      return Some(tracker.to_realtime_snapshot());
    }
  }

  // Fall back to disk data
  let stats = load_traffic_stats(profile_id)?;
  Some(stats.to_snapshot())
}

/// Load session snapshot from disk (written by proxy worker processes)
fn load_session_snapshot(profile_id: &str) -> Option<SessionSnapshot> {
  let session_file = get_traffic_stats_dir().join(format!("{}.session.json", profile_id));
  if !session_file.exists() {
    return None;
  }

  let content = fs::read_to_string(&session_file).ok()?;
  serde_json::from_str::<SessionSnapshot>(&content).ok()
}

/// Get all traffic snapshots with real-time data merged
/// This provides near real-time updates by merging session snapshots with disk data
pub fn get_all_traffic_snapshots_realtime() -> Vec<TrafficSnapshot> {
  use std::collections::HashMap;

  // Start with disk-stored stats
  let mut snapshots: HashMap<String, TrafficSnapshot> = list_traffic_stats()
    .into_iter()
    .map(|s| {
      let key = s.profile_id.clone().unwrap_or_else(|| s.proxy_id.clone());
      (key, s.to_snapshot())
    })
    .collect();

  // Try to merge in real-time data from active tracker (if in same process)
  if let Some(tracker) = get_traffic_tracker() {
    let key = tracker
      .profile_id
      .clone()
      .unwrap_or_else(|| tracker.proxy_id.clone());
    let realtime_snapshot = tracker.to_realtime_snapshot();
    snapshots.insert(key, realtime_snapshot);
  }

  // Also merge session snapshots from proxy worker processes
  let storage_dir = get_traffic_stats_dir();
  if let Ok(entries) = fs::read_dir(&storage_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
        if file_name.ends_with(".session.json") {
          if let Some(profile_id) = file_name.strip_suffix(".session.json") {
            if let Some(session) = load_session_snapshot(profile_id) {
              // Merge session data with disk snapshot
              if let Some(snapshot) = snapshots.get_mut(profile_id) {
                // Only merge session data if it's newer than the last flush
                // Session snapshots written before the last flush contain bytes already
                // included in disk totals, so merging them would cause double-counting
                let disk_stats = load_traffic_stats(profile_id);
                let last_flush = disk_stats
                  .as_ref()
                  .map(|s| s.last_flush_timestamp)
                  .unwrap_or(0);

                if session.timestamp > last_flush {
                  // Session data contains in-memory counters not yet flushed to disk
                  // Disk snapshot contains cumulative totals already flushed
                  // We need to ADD them, not take the max, to get the true total
                  snapshot.total_bytes_sent =
                    snapshot.total_bytes_sent.saturating_add(session.bytes_sent);
                  snapshot.total_bytes_received = snapshot
                    .total_bytes_received
                    .saturating_add(session.bytes_received);
                  snapshot.total_requests =
                    snapshot.total_requests.saturating_add(session.requests);
                  snapshot.current_bytes_sent = session.bytes_sent;
                  snapshot.current_bytes_received = session.bytes_received;
                  snapshot.last_update = session.timestamp;
                } else {
                  // Session snapshot is stale (written before last flush)
                  // Use current values from disk snapshot, but update timestamp if session is newer
                  if session.timestamp > snapshot.last_update {
                    snapshot.last_update = session.timestamp;
                  }
                }
              } else {
                // Create new snapshot from session data
                snapshots.insert(
                  profile_id.to_string(),
                  TrafficSnapshot {
                    profile_id: session.profile_id,
                    session_start: current_timestamp().saturating_sub(60),
                    last_update: session.timestamp,
                    total_bytes_sent: session.bytes_sent,
                    total_bytes_received: session.bytes_received,
                    total_requests: session.requests,
                    current_bytes_sent: session.bytes_sent,
                    current_bytes_received: session.bytes_received,
                    recent_bandwidth: vec![],
                  },
                );
              }
            }
          }
        }
      }
    }
  }

  snapshots.into_values().collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_traffic_stats_creation() {
    let stats = TrafficStats::new(
      "test_proxy".to_string(),
      Some("test-profile-id".to_string()),
    );
    assert_eq!(stats.proxy_id, "test_proxy");
    assert_eq!(stats.profile_id, Some("test-profile-id".to_string()));
    assert_eq!(stats.total_bytes_sent, 0);
    assert_eq!(stats.total_bytes_received, 0);
  }

  #[test]
  fn test_bandwidth_recording() {
    let mut stats = TrafficStats::new("test_proxy".to_string(), None);

    stats.record_bandwidth(1000, 2000);
    assert_eq!(stats.total_bytes_sent, 1000);
    assert_eq!(stats.total_bytes_received, 2000);
    assert_eq!(stats.bandwidth_history.len(), 1);

    stats.record_bandwidth(500, 1000);
    assert_eq!(stats.total_bytes_sent, 1500);
    assert_eq!(stats.total_bytes_received, 3000);
  }

  #[test]
  fn test_domain_recording() {
    let mut stats = TrafficStats::new("test_proxy".to_string(), None);

    stats.record_request("example.com", 100, 500);
    stats.record_request("example.com", 200, 1000);
    stats.record_request("google.com", 50, 200);

    assert_eq!(stats.domains.len(), 2);
    assert_eq!(stats.domains["example.com"].request_count, 2);
    assert_eq!(stats.domains["example.com"].bytes_sent, 300);
    assert_eq!(stats.domains["google.com"].request_count, 1);
  }

  #[test]
  fn test_ip_recording() {
    let mut stats = TrafficStats::new("test_proxy".to_string(), None);

    stats.record_ip("192.168.1.1");
    stats.record_ip("192.168.1.1"); // Duplicate
    stats.record_ip("10.0.0.1");

    assert_eq!(stats.unique_ips.len(), 2);
  }
}
