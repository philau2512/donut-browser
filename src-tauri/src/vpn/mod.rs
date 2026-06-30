//! VPN support module for WireGuard configurations.
//!
//! This module provides:
//! - WireGuard config parsing (`.conf` files)
//! - Encrypted storage for VPN configurations
//! - Tunnel management with userspace WireGuard (boringtun) routed through smoltcp

mod config;
mod connection;
pub mod socks5_server;
mod storage;
mod tunnel;
mod udp_datagram;
pub mod vpn_worker_runner;
pub mod vpn_worker_storage;
mod wg_device;
mod wireguard;
mod wireguard_tunnel;

pub use config::{
  detect_vpn_type, parse_wireguard_config, VpnConfig, VpnError, VpnImportResult, VpnStatus,
  VpnType, WireGuardConfig,
};
pub use storage::VpnStorage;
pub use tunnel::{TunnelManager, VpnTunnel};
pub use wireguard::WireGuardTunnel;

use once_cell::sync::Lazy;
use std::sync::Mutex;

/// Global VPN storage instance
pub static VPN_STORAGE: Lazy<Mutex<VpnStorage>> = Lazy::new(|| Mutex::new(VpnStorage::new()));
