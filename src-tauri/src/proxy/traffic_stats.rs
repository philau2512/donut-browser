use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

/// Individual bandwidth data point for time-series tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthDataPoint {
  /// Unix timestamp in seconds
  pub timestamp: u64,
  /// Bytes sent in this interval
  pub bytes_sent: u64,
  /// Bytes received in this interval
  pub bytes_received: u64,
}

/// Individual domain access data point for time-series tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainAccessPoint {
  /// Unix timestamp in seconds
  pub timestamp: u64,
  /// Domain name
  pub domain: String,
  /// Bytes sent in this request
  pub bytes_sent: u64,
  /// Bytes received in this request
  pub bytes_received: u64,
}

/// Domain access information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainAccess {
  /// Domain name
  pub domain: String,
  /// Number of requests to this domain
  pub request_count: u64,
  /// Total bytes sent to this domain
  pub bytes_sent: u64,
  /// Total bytes received from this domain
  pub bytes_received: u64,
  /// First access timestamp
  pub first_access: u64,
  /// Last access timestamp
  pub last_access: u64,
}

/// Lightweight snapshot for real-time updates (sent via events)
/// Contains only the data needed for the mini chart and summary display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficSnapshot {
  /// Profile ID (for matching)
  pub profile_id: Option<String>,
  /// Session start timestamp
  pub session_start: u64,
  /// Last update timestamp
  pub last_update: u64,
  /// Total bytes sent across all time
  pub total_bytes_sent: u64,
  /// Total bytes received across all time
  pub total_bytes_received: u64,
  /// Total requests made
  pub total_requests: u64,
  /// Current bandwidth (bytes per second) sent
  pub current_bytes_sent: u64,
  /// Current bandwidth (bytes per second) received
  pub current_bytes_received: u64,
  /// Recent bandwidth history (last 60 seconds only, for mini chart)
  pub recent_bandwidth: Vec<BandwidthDataPoint>,
}

/// Traffic statistics for a profile/proxy session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficStats {
  /// Proxy ID this stats belong to (for backwards compatibility)
  pub proxy_id: String,
  /// Profile ID (if associated) - this is now the primary key for storage
  pub profile_id: Option<String>,
  /// Session start timestamp
  pub session_start: u64,
  /// Last update timestamp
  pub last_update: u64,
  /// Timestamp of the last flush to disk (used to avoid double-counting session snapshots)
  #[serde(default)]
  pub last_flush_timestamp: u64,
  /// Total bytes sent across all time
  pub total_bytes_sent: u64,
  /// Total bytes received across all time
  pub total_bytes_received: u64,
  /// Total requests made
  pub total_requests: u64,
  /// Bandwidth data points (time-series, 1 point per second, stored indefinitely)
  #[serde(default)]
  pub bandwidth_history: Vec<BandwidthDataPoint>,
  /// Domain access statistics (aggregated all-time)
  #[serde(default)]
  pub domains: HashMap<String, DomainAccess>,
  /// Domain access history (time-series for filtering by period)
  #[serde(default)]
  pub domain_access_history: Vec<DomainAccessPoint>,
  /// Unique IPs accessed
  #[serde(default)]
  pub unique_ips: Vec<String>,
}

impl TrafficStats {
  pub fn new(proxy_id: String, profile_id: Option<String>) -> Self {
    let now = current_timestamp();
    Self {
      proxy_id,
      profile_id,
      session_start: now,
      last_update: now,
      last_flush_timestamp: 0,
      total_bytes_sent: 0,
      total_bytes_received: 0,
      total_requests: 0,
      bandwidth_history: Vec::new(),
      domains: HashMap::new(),
      domain_access_history: Vec::new(),
      unique_ips: Vec::new(),
    }
  }

  /// Create a lightweight snapshot for real-time UI updates
  pub fn to_snapshot(&self) -> TrafficSnapshot {
    let now = current_timestamp();
    let cutoff = now.saturating_sub(60); // Last 60 seconds for mini chart

    // Get current bandwidth from last data point
    let (current_sent, current_recv) = self
      .bandwidth_history
      .last()
      .filter(|dp| dp.timestamp >= now.saturating_sub(2)) // Within last 2 seconds
      .map(|dp| (dp.bytes_sent, dp.bytes_received))
      .unwrap_or((0, 0));

    TrafficSnapshot {
      profile_id: self.profile_id.clone(),
      session_start: self.session_start,
      last_update: self.last_update,
      total_bytes_sent: self.total_bytes_sent,
      total_bytes_received: self.total_bytes_received,
      total_requests: self.total_requests,
      current_bytes_sent: current_sent,
      current_bytes_received: current_recv,
      recent_bandwidth: self
        .bandwidth_history
        .iter()
        .filter(|dp| dp.timestamp >= cutoff)
        .cloned()
        .collect(),
    }
  }

  /// Record bandwidth for current second (data is stored indefinitely)
  pub fn record_bandwidth(&mut self, bytes_sent: u64, bytes_received: u64) {
    let now = current_timestamp();
    self.last_update = now;
    self.total_bytes_sent += bytes_sent;
    self.total_bytes_received += bytes_received;

    // Find or create data point for this second
    if let Some(last) = self.bandwidth_history.last_mut() {
      if last.timestamp == now {
        last.bytes_sent += bytes_sent;
        last.bytes_received += bytes_received;
        return;
      }
    }

    // Add new data point (even if bytes are zero, to ensure chart has continuous data)
    self.bandwidth_history.push(BandwidthDataPoint {
      timestamp: now,
      bytes_sent,
      bytes_received,
    });
  }

  /// Prune old data to prevent unbounded growth
  /// Keeps only the last 7 days of bandwidth history and domain access history
  pub fn prune_old_data(&mut self) {
    const RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60; // 7 days
    let now = current_timestamp();
    let cutoff = now.saturating_sub(RETENTION_SECONDS);

    // Prune bandwidth history
    self.bandwidth_history.retain(|dp| dp.timestamp >= cutoff);

    // Prune domain access history
    self
      .domain_access_history
      .retain(|dp| dp.timestamp >= cutoff);

    // Remove domains that haven't been accessed recently and have no recent history
    let recent_domains: std::collections::HashSet<String> = self
      .domain_access_history
      .iter()
      .filter(|dp| dp.timestamp >= cutoff)
      .map(|dp| dp.domain.clone())
      .collect();

    // Keep domains that were accessed recently OR have high total traffic
    self.domains.retain(|domain, access| {
      recent_domains.contains(domain)
        || access.last_access >= cutoff
        || (access.bytes_sent + access.bytes_received) > 1_000_000 // Keep domains with >1MB traffic
    });
  }

  /// Record a request to a domain
  pub fn record_request(&mut self, domain: &str, bytes_sent: u64, bytes_received: u64) {
    let now = current_timestamp();
    self.total_requests += 1;

    // Update aggregated domain stats
    let entry = self
      .domains
      .entry(domain.to_string())
      .or_insert(DomainAccess {
        domain: domain.to_string(),
        request_count: 0,
        bytes_sent: 0,
        bytes_received: 0,
        first_access: now,
        last_access: now,
      });

    entry.request_count += 1;
    entry.bytes_sent += bytes_sent;
    entry.bytes_received += bytes_received;
    entry.last_access = now;

    // Add to domain access history for time-period filtering
    self.domain_access_history.push(DomainAccessPoint {
      timestamp: now,
      domain: domain.to_string(),
      bytes_sent,
      bytes_received,
    });
  }

  /// Record an IP address access
  pub fn record_ip(&mut self, ip: &str) {
    if !self.unique_ips.contains(&ip.to_string()) {
      self.unique_ips.push(ip.to_string());
    }
  }

  /// Get bandwidth data for the last N seconds
  pub fn get_recent_bandwidth(&self, seconds: u64) -> Vec<BandwidthDataPoint> {
    let now = current_timestamp();
    let cutoff = now.saturating_sub(seconds);
    self
      .bandwidth_history
      .iter()
      .filter(|dp| dp.timestamp >= cutoff)
      .cloned()
      .collect()
  }
}

/// Get current Unix timestamp in seconds
fn current_timestamp() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

/// File lock guard for preventing concurrent writes
struct FileLockGuard {
  _file: std::fs::File,
}

/// Acquire a file lock for exclusive access
/// On Unix, uses flock; on Windows, uses file handles
fn acquire_file_lock(lock_path: &PathBuf) -> Result<FileLockGuard, Box<dyn std::error::Error>> {
  use std::fs::OpenOptions;

  let file = OpenOptions::new()
    .create(true)
    .write(true)
    .truncate(false)
    .open(lock_path)?;

  #[cfg(unix)]
  {
    use std::os::unix::io::AsRawFd;
    let fd = file.as_raw_fd();
    unsafe {
      if libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) != 0 {
        return Err("Failed to acquire file lock".into());
      }
    }
  }

  #[cfg(windows)]
  {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::LockFileEx;
    use windows::Win32::Storage::FileSystem::LOCKFILE_EXCLUSIVE_LOCK;
    use windows::Win32::Storage::FileSystem::LOCKFILE_FAIL_IMMEDIATELY;
    use windows::Win32::System::IO::OVERLAPPED;

    let raw_handle = file.as_raw_handle();
    let handle = HANDLE(raw_handle);
    unsafe {
      let mut overlapped: OVERLAPPED = std::mem::zeroed();
      if LockFileEx(
        handle,
        LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
        Some(0),
        u32::MAX,
        u32::MAX,
        &mut overlapped,
      )
      .is_err()
      {
        return Err("Failed to acquire file lock".into());
      }
    }
  }

  Ok(FileLockGuard { _file: file })
}

pub fn get_traffic_stats_dir() -> PathBuf {
  crate::settings::app_dirs::cache_dir().join("traffic_stats")
}

/// Get the storage key for traffic stats (profile_id if available, otherwise proxy_id)
fn get_stats_storage_key(stats: &TrafficStats) -> String {
  stats
    .profile_id
    .clone()
    .unwrap_or_else(|| stats.proxy_id.clone())
}

/// Save traffic stats to disk using profile_id as the key
pub fn save_traffic_stats(stats: &TrafficStats) -> Result<(), Box<dyn std::error::Error>> {
  let storage_dir = get_traffic_stats_dir();
  fs::create_dir_all(&storage_dir)?;

  let key = get_stats_storage_key(stats);
  let file_path = storage_dir.join(format!("{key}.json"));
  let content = serde_json::to_string(stats)?;
  fs::write(&file_path, content)?;

  Ok(())
}

/// Load traffic stats from disk by profile_id or proxy_id
pub fn load_traffic_stats(id: &str) -> Option<TrafficStats> {
  let storage_dir = get_traffic_stats_dir();
  let file_path = storage_dir.join(format!("{id}.json"));

  if !file_path.exists() {
    return None;
  }

  let content = fs::read_to_string(&file_path).ok()?;
  serde_json::from_str(&content).ok()
}

/// Load traffic stats by profile_id
pub fn load_traffic_stats_by_profile(profile_id: &str) -> Option<TrafficStats> {
  load_traffic_stats(profile_id)
}

/// List all traffic stats files and migrate old proxy-id based files to profile-id based
pub fn list_traffic_stats() -> Vec<TrafficStats> {
  let storage_dir = get_traffic_stats_dir();

  if !storage_dir.exists() {
    return Vec::new();
  }

  let mut stats_map: HashMap<String, TrafficStats> = HashMap::new();
  let mut files_to_delete: Vec<std::path::PathBuf> = Vec::new();

  if let Ok(entries) = fs::read_dir(&storage_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().is_some_and(|ext| ext == "json") {
        if let Ok(content) = fs::read_to_string(&path) {
          if let Ok(s) = serde_json::from_str::<TrafficStats>(&content) {
            // Determine the key for this stats entry
            let key = s.profile_id.clone().unwrap_or_else(|| s.proxy_id.clone());

            // Check if this is an old proxy-id based file that should be migrated
            let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let is_old_proxy_file = file_stem.starts_with("proxy_")
              && s.profile_id.is_some()
              && file_stem != s.profile_id.as_ref().unwrap();

            if let Some(existing) = stats_map.get_mut(&key) {
              // Merge stats from this file into existing
              merge_traffic_stats(existing, &s);
              if is_old_proxy_file {
                files_to_delete.push(path.clone());
              }
            } else {
              stats_map.insert(key.clone(), s);
              if is_old_proxy_file {
                files_to_delete.push(path.clone());
              }
            }
          }
        }
      }
    }
  }

  // Save merged stats and delete old files
  for stats in stats_map.values() {
    if let Err(e) = save_traffic_stats(stats) {
      log::warn!("Failed to save merged traffic stats: {}", e);
    }
  }

  for path in files_to_delete {
    if let Err(e) = fs::remove_file(&path) {
      log::warn!("Failed to delete old traffic stats file {:?}: {}", path, e);
    }
  }

  stats_map.into_values().collect()
}

/// Merge traffic stats from source into destination
fn merge_traffic_stats(dest: &mut TrafficStats, src: &TrafficStats) {
  // Update totals
  dest.total_bytes_sent += src.total_bytes_sent;
  dest.total_bytes_received += src.total_bytes_received;
  dest.total_requests += src.total_requests;

  // Update timestamps
  dest.session_start = dest.session_start.min(src.session_start);
  dest.last_update = dest.last_update.max(src.last_update);

  // Merge bandwidth history (keep all data, sorted by timestamp)
  let mut combined_history: Vec<BandwidthDataPoint> = dest.bandwidth_history.clone();
  for point in &src.bandwidth_history {
    if !combined_history
      .iter()
      .any(|p| p.timestamp == point.timestamp)
    {
      combined_history.push(point.clone());
    }
  }
  combined_history.sort_by_key(|p| p.timestamp);
  dest.bandwidth_history = combined_history;

  // Merge domains
  for (domain, access) in &src.domains {
    let entry = dest.domains.entry(domain.clone()).or_insert(DomainAccess {
      domain: domain.clone(),
      request_count: 0,
      bytes_sent: 0,
      bytes_received: 0,
      first_access: access.first_access,
      last_access: access.last_access,
    });
    entry.request_count += access.request_count;
    entry.bytes_sent += access.bytes_sent;
    entry.bytes_received += access.bytes_received;
    entry.first_access = entry.first_access.min(access.first_access);
    entry.last_access = entry.last_access.max(access.last_access);
  }

  // Merge domain access history
  let mut combined_domain_history: Vec<DomainAccessPoint> = dest.domain_access_history.clone();
  for point in &src.domain_access_history {
    combined_domain_history.push(point.clone());
  }
  combined_domain_history.sort_by_key(|p| p.timestamp);
  dest.domain_access_history = combined_domain_history;

  // Merge unique IPs
  for ip in &src.unique_ips {
    if !dest.unique_ips.contains(ip) {
      dest.unique_ips.push(ip.clone());
    }
  }
}

/// Delete traffic stats by id (profile_id or proxy_id)
pub fn delete_traffic_stats(id: &str) -> bool {
  let storage_dir = get_traffic_stats_dir();
  let file_path = storage_dir.join(format!("{id}.json"));

  if file_path.exists() {
    fs::remove_file(&file_path).is_ok()
  } else {
    false
  }
}

/// Clear all traffic stats (used when clearing cache)
pub fn clear_all_traffic_stats() -> Result<(), Box<dyn std::error::Error>> {
  let storage_dir = get_traffic_stats_dir();

  if storage_dir.exists() {
    for entry in fs::read_dir(&storage_dir)?.flatten() {
      let path = entry.path();
      if path.extension().is_some_and(|ext| ext == "json") {
        let _ = fs::remove_file(&path);
      }
    }
  }

  Ok(())
}

include!("traffic_stats_live.rs");
