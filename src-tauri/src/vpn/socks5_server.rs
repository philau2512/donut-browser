//! SOCKS5 proxy server over WireGuard tunnel.
//!
//! This module provides a SOCKS5 server that routes traffic through a WireGuard
//! tunnel using boringtun (userspace WireGuard) and smoltcp (userspace TCP/IP).
//!
//! ## Architecture
//!
//! - `udp_datagram`: RFC 1928 §7 UDP header parsing/building
//! - `wg_device`: smoltcp Device implementation over WireGuard
//! - `wireguard_tunnel`: Tunnel creation, key parsing, handshake logic
//! - `connection`: SOCKS5 connection state machine (Connection, UdpAssoc)
//! - `socks5_server` (this file): Main server loop and orchestration
//!
//! ## Buffer Sizes
//!
//! All buffer sizes are set to 64KB to match typical SOCKS5/WireGuard MTU needs.

// Submodules are declared in mod.rs and accessed via super::

use super::config::{VpnError, WireGuardConfig};
use super::connection::{Connection, UdpAssoc};
use super::udp_datagram::{build_udp_datagram, parse_udp_datagram};
use super::wg_device::WgDevice;
use super::wireguard_tunnel::{
  create_tunnel, do_handshake, parse_cidr_addresses, resolve_endpoint, smol_to_std_ip,
};
use smoltcp::iface::{Config as IfaceConfig, Interface, SocketSet};
use smoltcp::socket::dns;
use smoltcp::socket::tcp::{Socket as TcpSocket, SocketBuffer};
use smoltcp::socket::udp;
use smoltcp::time::Instant as SmolInstant;
use smoltcp::wire::{HardwareAddress, IpAddress, Ipv4Address};
use std::collections::VecDeque;
use std::net::{SocketAddr, UdpSocket as StdUdpSocket};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

const SMOLTCP_TCP_RX_BUF: usize = 65536;
const SMOLTCP_TCP_TX_BUF: usize = 65536;
const SMOLTCP_UDP_BUF: usize = 65536;

/// Main SOCKS5 server that accepts connections and routes them through WireGuard.
pub struct WireGuardSocks5Server {
  config: WireGuardConfig,
  port: u16,
}

impl WireGuardSocks5Server {
  pub fn new(config: WireGuardConfig, port: u16) -> Self {
    Self { config, port }
  }

  pub async fn run(
    self,
    config_id: String,
    config_path: Option<std::path::PathBuf>,
  ) -> Result<(), VpnError> {
    let peer_addr = resolve_endpoint(&self.config)?;
    let mut tunn = create_tunnel(&self.config)?;

    let udp_socket = StdUdpSocket::bind("0.0.0.0:0")
      .map_err(|e| VpnError::Connection(format!("Failed to create UDP socket: {e}")))?;

    do_handshake(&mut tunn, &udp_socket, peer_addr)?;

    udp_socket
      .set_nonblocking(true)
      .map_err(|e| VpnError::Connection(format!("Failed to set non-blocking: {e}")))?;

    log::info!("[vpn-worker] WireGuard handshake completed");

    let local_addrs = parse_cidr_addresses(&self.config.address)?;

    let tunn_arc = Arc::new(Mutex::new(tunn));
    let udp_arc = Arc::new(udp_socket);

    let mut device = WgDevice {
      tunn: tunn_arc.clone(),
      udp_socket: udp_arc.clone(),
      peer_addr,
      rx_queue: VecDeque::new(),
      tx_queue: VecDeque::new(),
    };

    let iface_config = IfaceConfig::new(HardwareAddress::Ip);
    let mut iface = Interface::new(iface_config, &mut device, SmolInstant::now());
    iface.update_ip_addrs(|addrs| {
      for (cidr, _) in &local_addrs {
        let _ = addrs.push(*cidr);
      }
    });

    // Install a default route for every address family the tunnel carries.
    // WireGuard is a routed (Medium::Ip) link, so the gateway is nominal — there
    // is no L2/neighbor resolution; smoltcp only uses it to select the default
    // route and then hands the packet straight to the WgDevice. The gateway is
    // derived from the interface address (x.x.x.1 / …::1) purely for form.
    let has_ipv4 = local_addrs
      .iter()
      .any(|(_, ip)| matches!(ip, IpAddress::Ipv4(_)));
    let has_ipv6 = local_addrs
      .iter()
      .any(|(_, ip)| matches!(ip, IpAddress::Ipv6(_)))
      && crate::settings::settings_manager::SettingsManager::instance()
        .load_settings()
        .map(|s| s.feature_flags.ipv6_vpn)
        .unwrap_or(false);
    for (_, ip) in &local_addrs {
      match ip {
        IpAddress::Ipv4(v4) => {
          let o = v4.octets();
          let gw = Ipv4Address::new(o[0], o[1], o[2], 1);
          iface
            .routes_mut()
            .add_default_ipv4_route(gw)
            .map_err(|e| VpnError::Tunnel(format!("Failed to add default IPv4 route: {e}")))?;
        }
        IpAddress::Ipv6(v6) => {
          if has_ipv6 {
            let mut o = v6.octets();
            o[14] = 0;
            o[15] = 1;
            let gw = smoltcp::wire::Ipv6Address::from(o);
            iface
              .routes_mut()
              .add_default_ipv6_route(gw)
              .map_err(|e| VpnError::Tunnel(format!("Failed to add default IPv6 route: {e}")))?;
          }
        }
      }
    }

    let listener = TcpListener::bind(format!("127.0.0.1:{}", self.port))
      .await
      .map_err(|e| VpnError::Connection(format!("Failed to bind SOCKS5 listener: {e}")))?;

    let actual_port = listener
      .local_addr()
      .map_err(|e| VpnError::Connection(format!("Failed to get local addr: {e}")))?
      .port();

    // Update config with actual port and local_url. Prefer the explicit
    // config path the worker was started with — see issue #287, where
    // get_storage_dir() in the worker process resolved to a different
    // directory than in the parent (Qubes/sandboxed Linux), causing the
    // write-back to land in the wrong place and the parent to time out.
    let updated = match &config_path {
      Some(path) => crate::vpn::vpn_worker_storage::get_vpn_worker_config_from_path(path)
        .or_else(|| crate::vpn::vpn_worker_storage::get_vpn_worker_config(&config_id)),
      None => crate::vpn::vpn_worker_storage::get_vpn_worker_config(&config_id),
    };
    if let Some(mut wc) = updated {
      wc.local_port = Some(actual_port);
      wc.local_url = Some(format!("socks5://127.0.0.1:{}", actual_port));
      let result = match &config_path {
        Some(path) => crate::vpn::vpn_worker_storage::save_vpn_worker_config_to_path(&wc, path)
          .map_err(|e| e.to_string()),
        None => {
          crate::vpn::vpn_worker_storage::save_vpn_worker_config(&wc).map_err(|e| e.to_string())
        }
      };
      if let Err(e) = result {
        log::error!(
          "[vpn-worker] Failed to write back local_url to config: {} (path={:?})",
          e,
          config_path
        );
      }
    } else {
      log::error!(
        "[vpn-worker] Could not load worker config for write-back (id={}, path={:?})",
        config_id,
        config_path
      );
    }

    log::info!(
      "[vpn-worker] SOCKS5 server listening on 127.0.0.1:{}",
      actual_port
    );

    let mut sockets = SocketSet::new(vec![]);

    // DNS resolution for domain-name CONNECT requests must go THROUGH the tunnel, never
    // the host resolver (which would leak the query to the local network — the
    // whole point of the VPN). Resolve via the WireGuard config's DNS server
    // (default 1.1.1.1, still routed through the tunnel). `dns_servers` must
    // outlive `sockets` since the socket borrows it, so declare it first.
    let dns_servers = [self
      .config
      .dns
      .as_deref()
      .and_then(|s| s.trim().parse::<std::net::Ipv4Addr>().ok())
      .map(|v4| {
        let o = v4.octets();
        IpAddress::Ipv4(Ipv4Address::new(o[0], o[1], o[2], o[3]))
      })
      .unwrap_or_else(|| IpAddress::Ipv4(Ipv4Address::new(1, 1, 1, 1)))];

    // Single DNS socket shared by all connections; queries are driven through
    // the tunnel by iface.poll like every other socket. Build the query storage
    // without vec![None; N] since DnsQuery isn't Clone.
    let dns_queries: Vec<Option<dns::DnsQuery>> = (0..64).map(|_| None).collect();
    let dns_socket = dns::Socket::new(&dns_servers, dns_queries);
    let dns_handle = sockets.add(dns_socket);

    let mut connections: Vec<Connection> = Vec::new();
    let mut timer_counter: u64 = 0;

    loop {
      // Accept new SOCKS5 connections (non-blocking via short timeout)
      if let Ok(Ok((stream, _addr))) =
        tokio::time::timeout(tokio::time::Duration::from_millis(1), listener.accept()).await
      {
        let tcp_rx = SocketBuffer::new(vec![0u8; SMOLTCP_TCP_RX_BUF]);
        let tcp_tx = SocketBuffer::new(vec![0u8; SMOLTCP_TCP_TX_BUF]);
        let tcp_socket = TcpSocket::new(tcp_rx, tcp_tx);
        let handle = sockets.add(tcp_socket);

        connections.push(Connection {
          smol_handle: handle,
          tcp_stream: stream,
          socks_done: false,
          connecting: false,
          greeting_done: false,
          read_buf: Vec::new(),
          dest_addr: None,
          udp: None,
          pending_dns: None,
        });
      }

      // Pump WireGuard packets into smoltcp rx queue
      device.pump_wg_to_rx();

      // Poll the smoltcp interface
      let timestamp = SmolInstant::now();
      let _changed = iface.poll(timestamp, &mut device, &mut sockets);

      // Flush encrypted packets out through WireGuard
      device.flush_tx_queue();

      // Process each connection
      let mut completed = Vec::new();
      for (idx, conn) in connections.iter_mut().enumerate() {
        if let Some(pending) = conn.pending_dns.take() {
          // A through-tunnel DNS resolution is in flight for this connection.
          let result = {
            let dns_sock = sockets.get_mut::<dns::Socket>(dns_handle);
            dns_sock.get_query_result(pending.query)
          };

          // Classify: a usable address of the queried family, a clean "no such
          // record", still-pending, or a hard failure.
          enum DnsOutcome {
            Resolved(IpAddress),
            NoRecord,
            Pending,
            Failed,
          }
          let outcome = match result {
            Ok(addrs) => {
              let want_ipv6 = pending.want_ipv6;
              match addrs.iter().copied().find(|a| {
                matches!(
                  (a, want_ipv6),
                  (IpAddress::Ipv4(_), false) | (IpAddress::Ipv6(_), true)
                )
              }) {
                Some(ip) => DnsOutcome::Resolved(ip),
                None => DnsOutcome::NoRecord,
              }
            }
            Err(dns::GetQueryResultError::Pending) => DnsOutcome::Pending,
            Err(_) => DnsOutcome::Failed,
          };

          match outcome {
            DnsOutcome::Pending => {
              // Still resolving; put it back and check again next poll.
              conn.pending_dns = Some(pending);
            }
            DnsOutcome::Resolved(ip) => {
              conn.dest_addr = Some(SocketAddr::new(smol_to_std_ip(ip), pending.port));
              let socket = sockets.get_mut::<TcpSocket>(conn.smol_handle);
              let local_port = 10000 + (rand::random::<u16>() % 50000);
              if socket
                .connect(iface.context(), (ip, pending.port), local_port)
                .is_err()
              {
                let _ = conn
                  .tcp_stream
                  .try_write(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                completed.push(idx);
                continue;
              }
              conn.connecting = true;
            }
            DnsOutcome::NoRecord | DnsOutcome::Failed => {
              // No record for this family (or the query failed). Retry once with
              // the other family if the tunnel carries it — a dual-stack name
              // that only had the other record, or an IPv4-preferred query for
              // an IPv6-only name.
              let other_ipv6 = !pending.want_ipv6;
              let other_supported = if other_ipv6 { has_ipv6 } else { has_ipv4 };
              let mut requeued = false;
              if !pending.fell_back && other_supported {
                let qtype = if other_ipv6 {
                  smoltcp::wire::DnsQueryType::Aaaa
                } else {
                  smoltcp::wire::DnsQueryType::A
                };
                let dns_sock = sockets.get_mut::<dns::Socket>(dns_handle);
                if let Ok(query) = dns_sock.start_query(iface.context(), &pending.domain, qtype) {
                  conn.pending_dns = Some(super::connection::PendingDns {
                    query,
                    port: pending.port,
                    domain: pending.domain,
                    want_ipv6: other_ipv6,
                    fell_back: true,
                  });
                  requeued = true;
                }
              }
              if !requeued {
                let _ = conn
                  .tcp_stream
                  .try_write(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                completed.push(idx);
                continue;
              }
            }
          }
        } else if conn.connecting {
          let socket = sockets.get_mut::<TcpSocket>(conn.smol_handle);
          if socket.may_send() {
            let _ = conn.tcp_stream.try_write(&[
              0x05,
              0x00,
              0x00,
              0x01,
              127,
              0,
              0,
              1,
              (actual_port >> 8) as u8,
              (actual_port & 0xff) as u8,
            ]);
            conn.connecting = false;
            conn.socks_done = true;
          } else if !socket.is_open() {
            let _ = conn
              .tcp_stream
              .try_write(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
            completed.push(idx);
          }
        } else if !conn.socks_done {
          // Handle SOCKS5 handshake
          let mut buf = [0u8; 512];
          match conn.tcp_stream.try_read(&mut buf) {
            Ok(0) => {
              completed.push(idx);
              continue;
            }
            Ok(n) => {
              conn.read_buf.extend_from_slice(&buf[..n]);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
              completed.push(idx);
              continue;
            }
          }

          if !conn.greeting_done && conn.read_buf.len() >= 3 {
            // SOCKS5 greeting: version, nmethods, methods
            if conn.read_buf[0] != 0x05 {
              completed.push(idx);
              continue;
            }
            let nmethods = conn.read_buf[1] as usize;
            if conn.read_buf.len() < 2 + nmethods {
              continue;
            }
            // Reply: no auth required
            if conn.tcp_stream.try_write(&[0x05, 0x00]).is_err() {
              completed.push(idx);
              continue;
            }
            conn.read_buf.drain(..2 + nmethods);
            conn.greeting_done = true;
          }

          if conn.greeting_done && conn.dest_addr.is_none() && conn.read_buf.len() >= 10 {
            // SOCKS5 request: CONNECT (0x01) or UDP ASSOCIATE (0x03)
            if conn.read_buf[0] != 0x05 {
              completed.push(idx);
              continue;
            }
            let cmd = conn.read_buf[1];
            if cmd != 0x01 && cmd != 0x03 {
              // command not supported
              let _ = conn
                .tcp_stream
                .try_write(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
              completed.push(idx);
              continue;
            }

            let (addr, addr_len) = match conn.read_buf[3] {
              0x01 => {
                // IPv4
                if conn.read_buf.len() < 10 {
                  continue;
                }
                let ip = std::net::Ipv4Addr::new(
                  conn.read_buf[4],
                  conn.read_buf[5],
                  conn.read_buf[6],
                  conn.read_buf[7],
                );
                let port = u16::from_be_bytes([conn.read_buf[8], conn.read_buf[9]]);
                (SocketAddr::new(std::net::IpAddr::V4(ip), port), 10)
              }
              0x03 => {
                // Domain name
                let domain_len = conn.read_buf[4] as usize;
                let needed = 4 + 1 + domain_len + 2;
                if conn.read_buf.len() < needed {
                  continue;
                }
                let domain = String::from_utf8_lossy(&conn.read_buf[5..5 + domain_len]).to_string();
                let port_start = 5 + domain_len;
                let port =
                  u16::from_be_bytes([conn.read_buf[port_start], conn.read_buf[port_start + 1]]);
                if cmd == 0x03 {
                  // UDP ASSOCIATE ignores the DST address (the relay learns the
                  // client's source from its first datagram), so no resolution
                  // is needed — never resolve it on the host.
                  (
                    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), port),
                    needed,
                  )
                } else {
                  // TCP CONNECT: resolve the domain THROUGH THE TUNNEL via the
                  // config DNS server, never the host resolver (which would leak
                  // the query onto the local network). Prefer IPv4 when the
                  // tunnel carries it (the well-tested path) and fall back to
                  // AAAA only for names with no A record; an IPv6-only tunnel
                  // resolves AAAA directly. Start an async query and defer the
                  // connection until it resolves.
                  conn.read_buf.drain(..needed);
                  let want_ipv6 = !has_ipv4;
                  let qtype = if want_ipv6 {
                    smoltcp::wire::DnsQueryType::Aaaa
                  } else {
                    smoltcp::wire::DnsQueryType::A
                  };
                  let dns_sock = sockets.get_mut::<dns::Socket>(dns_handle);
                  match dns_sock.start_query(iface.context(), &domain, qtype) {
                    Ok(query) => {
                      conn.pending_dns = Some(super::connection::PendingDns {
                        query,
                        port,
                        domain,
                        want_ipv6,
                        fell_back: false,
                      });
                    }
                    Err(e) => {
                      log::warn!(
                        "[vpn-worker] Failed to start DNS query for {}: {:?}",
                        domain,
                        e
                      );
                      let _ = conn
                        .tcp_stream
                        .try_write(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                      completed.push(idx);
                    }
                  }
                  continue;
                }
              }
              0x04 => {
                // IPv6-literal CONNECT. Route it through the tunnel when the
                // tunnel carries IPv6; otherwise it can never be reached (no
                // IPv6 address/route), so fail fast with "host unreachable"
                // rather than letting the smoltcp socket sit in SynSent until it
                // times out (a visible hang).
                if conn.read_buf.len() < 22 {
                  continue;
                }
                if !has_ipv6 {
                  let _ = conn
                    .tcp_stream
                    .try_write(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                  completed.push(idx);
                  continue;
                }
                let mut octets = [0u8; 16];
                octets.copy_from_slice(&conn.read_buf[4..20]);
                let ip = std::net::Ipv6Addr::from(octets);
                let port = u16::from_be_bytes([conn.read_buf[20], conn.read_buf[21]]);
                (SocketAddr::new(std::net::IpAddr::V6(ip), port), 22)
              }
              _ => {
                completed.push(idx);
                continue;
              }
            };

            conn.read_buf.drain(..addr_len);

            if cmd == 0x03 {
              // === SOCKS5 UDP ASSOCIATE ===
              // The request's DST is the client's intended source (typically
              // 0.0.0.0:0) and is ignored — the browser's relay source is
              // learned from its first datagram. Bind a loopback relay socket
              // the browser sends to, plus a smoltcp UDP socket that egresses
              // through the WireGuard tunnel on the interface IP.
              let relay = match StdUdpSocket::bind("127.0.0.1:0") {
                Ok(s) => s,
                Err(_) => {
                  let _ = conn
                    .tcp_stream
                    .try_write(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                  completed.push(idx);
                  continue;
                }
              };
              let _ = relay.set_nonblocking(true);
              let relay_port = relay.local_addr().map(|a| a.port()).unwrap_or(0);

              // Reply with the relay endpoint (127.0.0.1:relay_port).
              if conn
                .tcp_stream
                .try_write(&[
                  0x05,
                  0x00,
                  0x00,
                  0x01,
                  127,
                  0,
                  0,
                  1,
                  (relay_port >> 8) as u8,
                  (relay_port & 0xff) as u8,
                ])
                .is_err()
              {
                completed.push(idx);
                continue;
              }

              let udp_rx = udp::PacketBuffer::new(
                vec![udp::PacketMetadata::EMPTY; 32],
                vec![0u8; SMOLTCP_UDP_BUF],
              );
              let udp_tx = udp::PacketBuffer::new(
                vec![udp::PacketMetadata::EMPTY; 32],
                vec![0u8; SMOLTCP_UDP_BUF],
              );
              let mut udp_socket = udp::Socket::new(udp_rx, udp_tx);
              let local_port = 20000 + (rand::random::<u16>() % 40000);
              if udp_socket.bind(local_port).is_err() {
                completed.push(idx);
                continue;
              }

              // Swap this connection's unused TCP socket for the UDP socket;
              // `smol_handle` now keys the UDP socket, so teardown is unchanged.
              sockets.remove(conn.smol_handle);
              conn.smol_handle = sockets.add(udp_socket);
              conn.udp = Some(UdpAssoc {
                relay,
                client_addr: None,
              });
              conn.socks_done = true;
              continue;
            }

            conn.dest_addr = Some(addr);

            // Open smoltcp TCP socket to the destination
            let socket = sockets.get_mut::<TcpSocket>(conn.smol_handle);
            let smol_addr = match addr.ip() {
              std::net::IpAddr::V4(v4) => {
                let o = v4.octets();
                IpAddress::Ipv4(Ipv4Address::new(o[0], o[1], o[2], o[3]))
              }
              std::net::IpAddr::V6(v6) => {
                IpAddress::Ipv6(smoltcp::wire::Ipv6Address::from(v6.octets()))
              }
            };

            let local_port = 10000 + (rand::random::<u16>() % 50000);
            if socket
              .connect(iface.context(), (smol_addr, addr.port()), local_port)
              .is_err()
            {
              let _ = conn
                .tcp_stream
                .try_write(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
              completed.push(idx);
              continue;
            }

            conn.connecting = true;
          }
        } else if conn.udp.is_some() {
          // === UDP ASSOCIATE relay ===
          // The association lives only while the TCP control connection is
          // open (RFC 1928 §6); tear down when the browser closes it.
          let mut probe = [0u8; 1];
          match conn.tcp_stream.try_read(&mut probe) {
            Ok(0) => {
              completed.push(idx);
              continue;
            }
            Ok(_) => {} // ignore any data on the control channel
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
              completed.push(idx);
              continue;
            }
          }

          let handle = conn.smol_handle;
          let Some(udp) = conn.udp.as_mut() else {
            continue;
          };

          // Browser → tunnel: strip the §7 header and forward the payload.
          let mut dbuf = [0u8; SMOLTCP_UDP_BUF];
          loop {
            match udp.relay.recv_from(&mut dbuf) {
              Ok((n, src)) => {
                udp.client_addr = Some(src);
                if let Some((dst, off)) = parse_udp_datagram(&dbuf[..n]) {
                  let socket = sockets.get_mut::<udp::Socket>(handle);
                  if socket.can_send() {
                    let _ = socket.send_slice(&dbuf[off..n], dst);
                  }
                }
              }
              Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
              Err(_) => break,
            }
          }

          // Tunnel → browser: wrap each datagram in a §7 header and relay back.
          loop {
            let socket = sockets.get_mut::<udp::Socket>(handle);
            if !socket.can_recv() {
              break;
            }
            let (payload, src) = match socket.recv() {
              Ok((data, meta)) => (data.to_vec(), meta.endpoint),
              Err(_) => break,
            };
            if let Some(client) = udp.client_addr {
              let resp = build_udp_datagram(src, &payload);
              let _ = udp.relay.send_to(&resp, client);
            }
          }
        } else {
          // Data relay between SOCKS5 client and smoltcp socket
          let socket = sockets.get_mut::<TcpSocket>(conn.smol_handle);

          // Client → smoltcp
          let mut buf = [0u8; 4096];
          match conn.tcp_stream.try_read(&mut buf) {
            Ok(0) => {
              socket.close();
              completed.push(idx);
              continue;
            }
            Ok(n) => {
              if socket.can_send() {
                let _ = socket.send_slice(&buf[..n]);
              }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
              socket.close();
              completed.push(idx);
              continue;
            }
          }

          // smoltcp → Client
          if socket.can_recv() {
            match socket.recv(|data| (data.len(), data.to_vec())) {
              Ok(data) if !data.is_empty() && conn.tcp_stream.try_write(&data).is_err() => {
                socket.close();
                completed.push(idx);
                continue;
              }
              _ => {}
            }
          }

          // Check if smoltcp socket closed
          if !socket.is_open() && !socket.is_active() {
            completed.push(idx);
          }
        }
      }

      // Remove completed connections (in reverse order)
      completed.sort_unstable();
      completed.dedup();
      for idx in completed.into_iter().rev() {
        let conn = connections.remove(idx);
        if let Some(pending) = conn.pending_dns {
          sockets
            .get_mut::<dns::Socket>(dns_handle)
            .cancel_query(pending.query);
        }
        sockets.remove(conn.smol_handle);
      }

      // Timer ticks for WireGuard keepalives
      timer_counter += 1;
      if timer_counter.is_multiple_of(500) {
        device.tick_timers();
      }

      // Small sleep to avoid busy-spinning
      tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
    }
  }
}

#[cfg(test)]
mod tests {
  use super::super::wireguard_tunnel::{parse_cidr_addresses, parse_one_cidr};
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

  // Note: parse_key tests are in wireguard_tunnel module
}
