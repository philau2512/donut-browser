//! WireGuard virtual device implementation for smoltcp.
//!
//! Provides a `smoltcp::phy::Device` implementation that routes IP packets
//! through a WireGuard tunnel (boringtun) over UDP.

use boringtun::noise::{Tunn, TunnResult};
use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::time::Instant as SmolInstant;
use std::collections::VecDeque;
use std::net::{SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};

pub struct WgDevice {
  pub tunn: Arc<Mutex<Box<Tunn>>>,
  pub udp_socket: Arc<UdpSocket>,
  pub peer_addr: SocketAddr,
  pub rx_queue: VecDeque<Vec<u8>>,
  pub tx_queue: VecDeque<Vec<u8>>,
}

impl WgDevice {
  pub fn pump_wg_to_rx(&mut self) {
    let mut recv_buf = vec![0u8; 2048];
    loop {
      match self.udp_socket.recv_from(&mut recv_buf) {
        Ok((len, _)) => {
          let mut dst = vec![0u8; 2048];
          let mut tunn = self.tunn.lock().unwrap();
          let result = tunn.decapsulate(None, &recv_buf[..len], &mut dst);
          match result {
            TunnResult::WriteToTunnelV4(data, _) | TunnResult::WriteToTunnelV6(data, _) => {
              self.rx_queue.push_back(data.to_vec());
            }
            TunnResult::WriteToNetwork(response) => {
              let _ = self.udp_socket.send_to(response, self.peer_addr);
            }
            _ => {}
          }
        }
        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
        Err(_) => break,
      }
    }
  }

  pub fn flush_tx_queue(&mut self) {
    while let Some(ip_packet) = self.tx_queue.pop_front() {
      let mut dst = vec![0u8; ip_packet.len() + 256];
      let mut tunn = self.tunn.lock().unwrap();
      let result = tunn.encapsulate(&ip_packet, &mut dst);
      match result {
        TunnResult::WriteToNetwork(packet) => {
          if let Err(e) = self.udp_socket.send_to(packet, self.peer_addr) {
            log::error!("[wg] udp send_to failed: {e}");
          }
        }
        TunnResult::Done => {
          // boringtun has nothing to send right now (e.g. handshake not yet
          // complete); silently drop. smoltcp will retransmit.
        }
        TunnResult::Err(e) => {
          log::error!(
            "[wg] encapsulate error for {}B IP packet: {e:?}",
            ip_packet.len()
          );
        }
        TunnResult::WriteToTunnelV4(_, _) | TunnResult::WriteToTunnelV6(_, _) => {
          log::error!("[wg] encapsulate returned unexpected WriteToTunnel — bug?");
        }
      }
    }
  }

  pub fn tick_timers(&mut self) {
    let mut dst = vec![0u8; 2048];
    let mut tunn = self.tunn.lock().unwrap();
    let result = tunn.update_timers(&mut dst);
    if let TunnResult::WriteToNetwork(packet) = result {
      let _ = self.udp_socket.send_to(packet, self.peer_addr);
    }
  }
}

pub struct WgRxToken {
  pub data: Vec<u8>,
}

impl RxToken for WgRxToken {
  fn consume<R, F>(self, f: F) -> R
  where
    F: FnOnce(&[u8]) -> R,
  {
    f(&self.data)
  }
}

pub struct WgTxToken<'a> {
  pub tx_queue: &'a mut VecDeque<Vec<u8>>,
}

impl<'a> TxToken for WgTxToken<'a> {
  fn consume<R, F>(self, len: usize, f: F) -> R
  where
    F: FnOnce(&mut [u8]) -> R,
  {
    let mut buf = vec![0u8; len];
    let result = f(&mut buf);
    self.tx_queue.push_back(buf);
    result
  }
}

impl Device for WgDevice {
  type RxToken<'a> = WgRxToken;
  type TxToken<'a> = WgTxToken<'a>;

  fn receive(&mut self, _timestamp: SmolInstant) -> Option<(Self::RxToken<'_>, Self::TxToken<'_>)> {
    if let Some(data) = self.rx_queue.pop_front() {
      Some((
        WgRxToken { data },
        WgTxToken {
          tx_queue: &mut self.tx_queue,
        },
      ))
    } else {
      None
    }
  }

  fn transmit(&mut self, _timestamp: SmolInstant) -> Option<Self::TxToken<'_>> {
    Some(WgTxToken {
      tx_queue: &mut self.tx_queue,
    })
  }

  fn capabilities(&self) -> DeviceCapabilities {
    let mut caps = DeviceCapabilities::default();
    caps.medium = Medium::Ip;
    caps.max_transmission_unit = 1420;
    caps
  }
}
