//! SOCKS5 connection handling structures.
//!
//! Defines the Connection state machine and UdpAssoc for UDP ASSOCIATE relay.

use smoltcp::iface::SocketHandle;
use std::net::SocketAddr;
use tokio::net::TcpStream;

/// A live SOCKS5 UDP ASSOCIATE: the loopback relay socket the browser sends
/// datagrams to, and the browser's learned source address. The tunnel-side
/// smoltcp UDP socket lives in `sockets`, keyed by the connection's
/// (repurposed) `smol_handle`.
pub struct UdpAssoc {
  pub relay: std::net::UdpSocket,
  pub client_addr: Option<SocketAddr>,
}

/// Represents a single SOCKS5 client connection with its state machine.
///
/// State transitions:
/// - greeting_done: false → true after SOCKS5 greeting (version, methods)
/// - dest_addr: None → Some(addr) after CONNECT/UDP ASSOCIATE request parsed
/// - connecting: true → false when smoltcp TCP socket may_send()
/// - socks_done: false → true when handshake complete and ready for data relay
/// - udp: Some(UdpAssoc) for UDP ASSOCIATE mode (replaces TCP socket)
pub struct Connection {
  pub smol_handle: SocketHandle,
  pub tcp_stream: TcpStream,
  pub socks_done: bool,
  pub connecting: bool,
  pub greeting_done: bool,
  pub read_buf: Vec<u8>,
  pub dest_addr: Option<SocketAddr>,
  pub udp: Option<UdpAssoc>,
}
