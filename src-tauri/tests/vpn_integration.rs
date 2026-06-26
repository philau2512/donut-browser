//! VPN integration tests
//!
//! These tests verify VPN config parsing, storage, and tunnel functionality.
//! Connection tests require Docker and are skipped if Docker is not available.

mod common;
mod test_harness;

use common::TestUtils;
use donutbrowser_lib::vpn::{
  detect_vpn_type, parse_wireguard_config, VpnConfig, VpnStorage, VpnType, WireGuardConfig,
};
use serde_json::Value;
use serial_test::serial;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::sleep;

// ============================================================================
// Config Parsing Tests
// ============================================================================

#[test]
fn test_wireguard_config_import() {
  let config = include_str!("fixtures/test.conf");
  let result = parse_wireguard_config(config);

  assert!(
    result.is_ok(),
    "Failed to parse WireGuard config: {:?}",
    result.err()
  );

  let wg = result.unwrap();
  assert!(!wg.private_key.is_empty());
  assert_eq!(wg.address, "10.0.0.2/24");
  assert_eq!(wg.dns, Some("1.1.1.1".to_string()));
  assert!(!wg.peer_public_key.is_empty());
  assert_eq!(wg.peer_endpoint, "vpn.example.com:51820");
  assert!(wg.allowed_ips.contains(&"0.0.0.0/0".to_string()));
  assert_eq!(wg.persistent_keepalive, Some(25));
}

#[test]
fn test_detect_vpn_type_wireguard_by_extension() {
  let content = "[Interface]\nPrivateKey = test\n[Peer]\nPublicKey = peer";
  let result = detect_vpn_type(content, "my-vpn.conf");

  assert!(result.is_ok());
  assert_eq!(result.unwrap(), VpnType::WireGuard);
}

#[test]
fn test_detect_vpn_type_wireguard_by_content() {
  let content = r#"
[Interface]
PrivateKey = somekey
Address = 10.0.0.2/24

[Peer]
PublicKey = peerkey
Endpoint = 1.2.3.4:51820
"#;
  let result = detect_vpn_type(content, "config.txt");

  assert!(result.is_ok());
  assert_eq!(result.unwrap(), VpnType::WireGuard);
}

#[test]
fn test_detect_vpn_type_unknown() {
  let content = "this is just some random text that is not a vpn config";
  let result = detect_vpn_type(content, "random.txt");

  assert!(result.is_err());
}

#[test]
fn test_reject_openvpn_content() {
  let content = "client\ndev tun\nproto udp\nremote vpn.example.com 1194";
  assert!(detect_vpn_type(content, "old.ovpn").is_err());
  assert!(detect_vpn_type(content, "config.txt").is_err());
}

#[test]
fn test_wireguard_config_missing_private_key() {
  let config = r#"
[Interface]
Address = 10.0.0.2/24

[Peer]
PublicKey = somekey
Endpoint = 1.2.3.4:51820
"#;
  let result = parse_wireguard_config(config);

  assert!(result.is_err());
  let err = result.unwrap_err().to_string();
  assert!(err.contains("PrivateKey"));
}

#[test]
fn test_wireguard_config_missing_peer() {
  let config = r#"
[Interface]
PrivateKey = YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=
Address = 10.0.0.2/24
"#;
  let result = parse_wireguard_config(config);

  assert!(result.is_err());
  let err = result.unwrap_err().to_string();
  assert!(err.contains("PublicKey") || err.contains("Peer"));
}

// ============================================================================
// Storage Tests
// ============================================================================

#[test]
#[serial]
fn test_vpn_storage_save_and_load() {
  let temp_dir = tempfile::TempDir::new().unwrap();
  let storage = create_test_storage(&temp_dir);

  let config = VpnConfig {
    id: "test-id-1".to_string(),
    name: "Test VPN".to_string(),
    vpn_type: VpnType::WireGuard,
    config_data: "[Interface]\nPrivateKey=key\n[Peer]\nPublicKey=peer".to_string(),
    created_at: 1234567890,
    last_used: None,
    sync_enabled: false,
    last_sync: None,
    updated_at: None,
  };

  let save_result = storage.save_config(&config);
  assert!(
    save_result.is_ok(),
    "Failed to save config: {:?}",
    save_result.err()
  );

  let load_result = storage.load_config("test-id-1");
  assert!(
    load_result.is_ok(),
    "Failed to load config: {:?}",
    load_result.err()
  );

  let loaded = load_result.unwrap();
  assert_eq!(loaded.id, config.id);
  assert_eq!(loaded.name, config.name);
  assert_eq!(loaded.vpn_type, config.vpn_type);
  assert_eq!(loaded.config_data, config.config_data);
}

#[test]
#[serial]
fn test_vpn_storage_list() {
  let temp_dir = tempfile::TempDir::new().unwrap();
  let storage = create_test_storage(&temp_dir);

  for i in 1..=2 {
    let config = VpnConfig {
      id: format!("list-test-{i}"),
      name: format!("VPN {i}"),
      vpn_type: VpnType::WireGuard,
      config_data: "secret data".to_string(),
      created_at: 1000 * i as i64,
      last_used: None,
      sync_enabled: false,
      last_sync: None,
      updated_at: None,
    };
    storage.save_config(&config).unwrap();
  }

  let list = storage.list_configs().unwrap();
  assert_eq!(list.len(), 2);

  for cfg in &list {
    assert!(cfg.config_data.is_empty());
  }
}

#[test]
#[serial]
fn test_vpn_storage_delete() {
  let temp_dir = tempfile::TempDir::new().unwrap();
  let storage = create_test_storage(&temp_dir);

  let config = VpnConfig {
    id: "delete-test".to_string(),
    name: "To Delete".to_string(),
    vpn_type: VpnType::WireGuard,
    config_data: "data".to_string(),
    created_at: 1000,
    last_used: None,
    sync_enabled: false,
    last_sync: None,
    updated_at: None,
  };

  storage.save_config(&config).unwrap();
  assert!(storage.load_config("delete-test").is_ok());

  storage.delete_config("delete-test").unwrap();
  assert!(storage.load_config("delete-test").is_err());
}

include!("helpers/__vpn_integration2.rs");
