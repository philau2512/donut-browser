//! UDP datagram header parsing and building for SOCKS5 UDP ASSOCIATE.
//!
//! Implements RFC 1928 §7 UDP request/reply header format for tunneling UDP
//! traffic through the WireGuard tunnel via smoltcp.

use smoltcp::wire::{IpAddress, IpEndpoint, Ipv4Address};

/// Parse an RFC 1928 §7 UDP request header. Returns the destination endpoint
/// and the payload offset, or None if malformed, fragmented, or domain-typed.
/// Only literal IPs are routed through the tunnel: resolving a domain on the
/// host would leak DNS, and QUIC/WebRTC datagrams always carry literal IPs.
pub fn parse_udp_datagram(buf: &[u8]) -> Option<(IpEndpoint, usize)> {
  if buf.len() < 4 || buf[2] != 0 {
    // too short, or FRAG != 0 (fragmentation unsupported)
    return None;
  }
  match buf[3] {
    0x01 => {
      if buf.len() < 10 {
        return None;
      }
      let ip = Ipv4Address::new(buf[4], buf[5], buf[6], buf[7]);
      let port = u16::from_be_bytes([buf[8], buf[9]]);
      Some((IpEndpoint::new(IpAddress::Ipv4(ip), port), 10))
    }
    0x04 => {
      if buf.len() < 22 {
        return None;
      }
      let mut o = [0u8; 16];
      o.copy_from_slice(&buf[4..20]);
      let ip = smoltcp::wire::Ipv6Address::from(o);
      let port = u16::from_be_bytes([buf[20], buf[21]]);
      Some((IpEndpoint::new(IpAddress::Ipv6(ip), port), 22))
    }
    _ => None,
  }
}

/// Wrap a tunnel-received datagram in an RFC 1928 §7 UDP reply header naming
/// `src` as the origin, for delivery back to the browser's relay socket.
pub fn build_udp_datagram(src: IpEndpoint, payload: &[u8]) -> Vec<u8> {
  let mut out = vec![0x00, 0x00, 0x00]; // RSV(2) + FRAG(0)
  match src.addr {
    IpAddress::Ipv4(v4) => {
      out.push(0x01);
      out.extend_from_slice(&v4.octets());
    }
    IpAddress::Ipv6(v6) => {
      out.push(0x04);
      out.extend_from_slice(&v6.octets());
    }
  }
  out.extend_from_slice(&src.port.to_be_bytes());
  out.extend_from_slice(payload);
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use smoltcp::wire::Ipv4Address;

  #[test]
  fn test_parse_udp_ipv4() {
    let mut buf = vec![0x00, 0x00, 0x00, 0x01];
    buf.extend_from_slice(&[10, 0, 0, 1]); // IP
    buf.extend_from_slice(&[0x1F, 0x90]); // port 8080
    buf.extend_from_slice(b"payload");

    let (endpoint, offset) = parse_udp_datagram(&buf).unwrap();
    assert_eq!(
      endpoint.addr,
      IpAddress::Ipv4(Ipv4Address::new(10, 0, 0, 1))
    );
    assert_eq!(endpoint.port, 8080);
    assert_eq!(offset, 10);
  }

  #[test]
  fn test_parse_udp_too_short() {
    let buf = vec![0x00, 0x00, 0x00, 0x01, 10, 0, 0];
    assert!(parse_udp_datagram(&buf).is_none());
  }

  #[test]
  fn test_parse_udp_fragmented() {
    let mut buf = vec![0x00, 0x00, 0x01, 0x01]; // FRAG != 0
    buf.extend_from_slice(&[10, 0, 0, 1, 0x1F, 0x90]);
    assert!(parse_udp_datagram(&buf).is_none());
  }

  #[test]
  fn test_build_udp_datagram_ipv4() {
    let endpoint = IpEndpoint::new(IpAddress::Ipv4(Ipv4Address::new(192, 168, 1, 1)), 1234);
    let payload = b"test";
    let result = build_udp_datagram(endpoint, payload);

    assert_eq!(result[0], 0x00);
    assert_eq!(result[1], 0x00);
    assert_eq!(result[2], 0x00);
    assert_eq!(result[3], 0x01); // IPv4
    assert_eq!(&result[4..8], &[192, 168, 1, 1]);
    assert_eq!(&result[8..10], &[0x04, 0xD2]); // port 1234
    assert_eq!(&result[10..], b"test");
  }
}
