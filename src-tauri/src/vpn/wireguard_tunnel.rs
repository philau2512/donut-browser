//! WireGuard tunnel setup and handshake logic.
//!
//! Handles tunnel creation, key parsing, CIDR address parsing, and
//! the WireGuard handshake protocol with retry logic.

use super::config::{VpnError, WireGuardConfig};
use boringtun::noise::{Tunn, TunnResult};
use boringtun::x25519::{PublicKey, StaticSecret};
use smoltcp::wire::{IpAddress, IpCidr, Ipv4Address};
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};

const HANDSHAKE_TIMEOUT_SECS: u64 = 5;
const MAX_HANDSHAKE_ATTEMPTS: u32 = 5;

/// Parse a base64-encoded WireGuard key (32 bytes after decoding).
pub fn parse_key(key: &str) -> Result<[u8; 32], VpnError> {
  let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, key)
    .map_err(|e| VpnError::InvalidWireGuard(format!("Invalid key encoding: {e}")))?;
  if decoded.len() != 32 {
    return Err(VpnError::InvalidWireGuard(format!(
      "Invalid key length: {} (expected 32)",
      decoded.len()
    )));
  }
  let mut key_bytes = [0u8; 32];
  key_bytes.copy_from_slice(&decoded);
  Ok(key_bytes)
}

/// Parse a single CIDR entry (no commas) into smoltcp types.
pub fn parse_one_cidr(entry: &str) -> Result<(IpCidr, IpAddress), VpnError> {
  let parts: Vec<&str> = entry.split('/').collect();
  let ip_str = parts[0].trim();

  let ip: std::net::IpAddr = ip_str
    .parse()
    .map_err(|_| VpnError::InvalidWireGuard(format!("Invalid IP address: {ip_str}")))?;

  let prefix = if parts.len() > 1 {
    parts[1]
      .trim()
      .parse::<u8>()
      .map_err(|_| VpnError::InvalidWireGuard(format!("Invalid prefix length: {}", parts[1])))?
  } else if ip.is_ipv6() {
    128
  } else {
    32
  };

  match ip {
    std::net::IpAddr::V4(v4) => {
      let smol_ip = Ipv4Address::new(
        v4.octets()[0],
        v4.octets()[1],
        v4.octets()[2],
        v4.octets()[3],
      );
      Ok((
        IpCidr::new(IpAddress::Ipv4(smol_ip), prefix),
        IpAddress::Ipv4(smol_ip),
      ))
    }
    std::net::IpAddr::V6(v6) => {
      let smol_ip = smoltcp::wire::Ipv6Address::from(v6.octets());
      Ok((
        IpCidr::new(IpAddress::Ipv6(smol_ip), prefix),
        IpAddress::Ipv6(smol_ip),
      ))
    }
  }
}

/// Parse every address in a (comma-separated) WireGuard `Address` line. A
/// dual-stack config yields both the IPv4 and IPv6 entries so the tunnel
/// interface is addressed for each family it carries.
pub fn parse_cidr_addresses(addr: &str) -> Result<Vec<(IpCidr, IpAddress)>, VpnError> {
  let mut out = Vec::new();
  for entry in addr.split(',') {
    let entry = entry.trim();
    if entry.is_empty() {
      continue;
    }
    out.push(parse_one_cidr(entry)?);
  }
  if out.is_empty() {
    return Err(VpnError::InvalidWireGuard(format!(
      "No interface address in: {addr}"
    )));
  }
  Ok(out)
}

/// Backward-compat wrapper: parse only the first address (IPv4-preferred).
/// Used by code that hasn't been updated for dual-stack yet.
#[allow(dead_code)]
pub fn parse_cidr_address(addr: &str) -> Result<(IpCidr, IpAddress), VpnError> {
  let first = addr.split(',').next().unwrap_or(addr).trim();
  parse_one_cidr(first)
}

/// Convert a smoltcp `IpAddress` to a std `IpAddr`. Both smoltcp address types
/// are re-exports of `core::net`, so this is a straight variant map.
pub fn smol_to_std_ip(ip: IpAddress) -> std::net::IpAddr {
  match ip {
    IpAddress::Ipv4(v4) => std::net::IpAddr::V4(v4),
    IpAddress::Ipv6(v6) => std::net::IpAddr::V6(v6),
  }
}

/// Create a WireGuard tunnel from configuration.
pub fn create_tunnel(config: &WireGuardConfig) -> Result<Box<Tunn>, VpnError> {
  let private_key_bytes = parse_key(&config.private_key)?;
  let static_private = StaticSecret::from(private_key_bytes);

  let peer_public_bytes = parse_key(&config.peer_public_key)?;
  let peer_public = PublicKey::from(peer_public_bytes);

  let preshared_key = if let Some(ref psk) = config.preshared_key {
    Some(parse_key(psk)?)
  } else {
    None
  };

  Ok(Box::new(Tunn::new(
    static_private,
    peer_public,
    preshared_key,
    config.persistent_keepalive,
    0,
    None,
  )))
}

/// Resolve the peer endpoint to a SocketAddr.
pub fn resolve_endpoint(config: &WireGuardConfig) -> Result<SocketAddr, VpnError> {
  config
    .peer_endpoint
    .to_socket_addrs()
    .map_err(|e| {
      VpnError::Connection(format!(
        "Failed to resolve endpoint '{}': {e}",
        config.peer_endpoint
      ))
    })?
    .next()
    .ok_or_else(|| {
      VpnError::Connection(format!(
        "No addresses found for endpoint: {}",
        config.peer_endpoint
      ))
    })
}

/// Perform WireGuard handshake with retry logic.
/// Retries up to MAX_HANDSHAKE_ATTEMPTS (5 attempts, 25s total) to handle
/// packet loss through Docker port-forwarding layers.
pub fn do_handshake(
  tunn: &mut Tunn,
  socket: &UdpSocket,
  peer_addr: SocketAddr,
) -> Result<(), VpnError> {
  socket
    .set_read_timeout(Some(std::time::Duration::from_secs(HANDSHAKE_TIMEOUT_SECS)))
    .map_err(|e| VpnError::Connection(format!("Failed to set timeout: {e}")))?;

  let mut last_error = String::from("no handshake attempt completed");

  for attempt in 1..=MAX_HANDSHAKE_ATTEMPTS {
    let mut dst = vec![0u8; 2048];
    let result = tunn.format_handshake_initiation(&mut dst, false);

    match result {
      TunnResult::WriteToNetwork(packet) => {
        socket
          .send_to(packet, peer_addr)
          .map_err(|e| VpnError::Connection(format!("Failed to send handshake: {e}")))?;
      }
      TunnResult::Err(e) => {
        return Err(VpnError::Tunnel(format!(
          "Handshake initiation failed: {e:?}"
        )));
      }
      _ => {}
    }

    let mut recv_buf = vec![0u8; 2048];
    match socket.recv_from(&mut recv_buf) {
      Ok((len, _)) => {
        let result = tunn.decapsulate(None, &recv_buf[..len], &mut dst);
        match result {
          TunnResult::WriteToNetwork(response) => {
            socket
              .send_to(response, peer_addr)
              .map_err(|e| VpnError::Connection(format!("Failed to send response: {e}")))?;
          }
          TunnResult::Done => {}
          TunnResult::Err(e) => {
            last_error = format!("handshake response error: {e:?}");
            log::warn!(
              "[vpn-worker] Handshake attempt {attempt}/{MAX_HANDSHAKE_ATTEMPTS} failed: {last_error}"
            );
            continue;
          }
          _ => {}
        }

        socket
          .set_read_timeout(None)
          .map_err(|e| VpnError::Connection(format!("Failed to clear timeout: {e}")))?;
        return Ok(());
      }
      Err(e) if attempt < MAX_HANDSHAKE_ATTEMPTS => {
        log::warn!(
          "[vpn-worker] Handshake attempt {attempt}/{MAX_HANDSHAKE_ATTEMPTS} timed out: {e}, retrying"
        );
        last_error = format!("timeout: {e}");
        continue;
      }
      Err(e) => {
        last_error = format!("timeout: {e}");
      }
    }
  }

  Err(VpnError::Connection(format!(
    "Handshake failed after {MAX_HANDSHAKE_ATTEMPTS} attempts: {last_error}"
  )))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_parse_cidr_ipv4() {
    let (cidr, ip) = parse_one_cidr("10.0.0.2/24").unwrap();
    assert_eq!(cidr.prefix_len(), 24);
    assert_eq!(ip, IpAddress::Ipv4(Ipv4Address::new(10, 0, 0, 2)));
  }

  #[test]
  fn test_parse_cidr_no_prefix() {
    let (cidr, _) = parse_one_cidr("10.0.0.2").unwrap();
    assert_eq!(cidr.prefix_len(), 32);
  }

  #[test]
  fn test_parse_cidr_ipv6_default_prefix() {
    let (cidr, ip) = parse_one_cidr("fd00::2").unwrap();
    assert_eq!(cidr.prefix_len(), 128);
    assert!(matches!(ip, IpAddress::Ipv6(_)));
  }

  #[test]
  fn test_parse_cidr_addresses_dual_stack() {
    let addrs = parse_cidr_addresses("10.0.0.2/24, fd00::2/128").unwrap();
    assert_eq!(addrs.len(), 2);
    assert_eq!(addrs[0].1, IpAddress::Ipv4(Ipv4Address::new(10, 0, 0, 2)));
    assert!(matches!(addrs[1].1, IpAddress::Ipv6(_)));
    assert!(addrs.iter().any(|(_, ip)| matches!(ip, IpAddress::Ipv4(_))));
    assert!(addrs.iter().any(|(_, ip)| matches!(ip, IpAddress::Ipv6(_))));
  }

  #[test]
  fn test_parse_key_valid() {
    let key = "YEocP0e2o1WT5GlvBvQzVF7EeR6z9aCk+ZdZ5NKEuXA=";
    assert!(parse_key(key).is_ok());
  }

  #[test]
  fn test_parse_key_invalid() {
    assert!(parse_key("not-valid").is_err());
  }

  #[test]
  fn test_parse_key_wrong_length() {
    // Valid base64 but wrong decoded length (not 32 bytes)
    let key = "dGVzdA=="; // "test" decoded = 4 bytes
    assert!(parse_key(key).is_err());
  }
}
