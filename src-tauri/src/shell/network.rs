//! What the PC is actually connected through, for the menu bar's network
//! popup: the adapter carrying the default route (Ethernet or Wi-Fi).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatus {
  pub connected: bool,
  /// "ethernet" | "wifi" | "other" | "none"
  pub kind: String,
  /// Wi-Fi network name, or the adapter's friendly name for Ethernet.
  pub name: Option<String>,
  pub adapter: Option<String>,
  pub speed_mbps: Option<u64>,
  pub ipv4: Option<String>,
  pub signal: Option<u8>,
}

#[cfg(target_os = "windows")]
mod imp {
  use super::NetworkStatus;
  use windows::Win32::NetworkManagement::IpHelper::{GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, IP_ADAPTER_ADDRESSES_LH};
  use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
  use windows::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC, SOCKADDR_IN};

  const IF_TYPE_ETHERNET: u32 = 6;
  const IF_TYPE_WIFI: u32 = 71;

  pub fn status() -> NetworkStatus {
    let mut none = NetworkStatus { connected: false, kind: "none".into(), name: None, adapter: None, speed_mbps: None, ipv4: None, signal: None };
    unsafe {
      let mut size: u32 = 16 * 1024;
      let mut buf: Vec<u8> = vec![0; size as usize];
      let mut rc = GetAdaptersAddresses(AF_UNSPEC.0 as u32, GAA_FLAG_INCLUDE_GATEWAYS, None, Some(buf.as_mut_ptr() as *mut _), &mut size);
      if rc == 111 {
        // ERROR_BUFFER_OVERFLOW: retry with the size Windows asked for.
        buf = vec![0; size as usize];
        rc = GetAdaptersAddresses(AF_UNSPEC.0 as u32, GAA_FLAG_INCLUDE_GATEWAYS, None, Some(buf.as_mut_ptr() as *mut _), &mut size);
      }
      if rc != 0 {
        return none;
      }
      // Prefer the up adapter that has a default gateway, Ethernet first.
      let mut best: Option<(*const IP_ADAPTER_ADDRESSES_LH, u32)> = None;
      let mut p = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
      while !p.is_null() {
        let a = &*p;
        let has_gateway = !a.FirstGatewayAddress.is_null();
        if a.OperStatus == IfOperStatusUp && has_gateway && (a.IfType == IF_TYPE_ETHERNET || a.IfType == IF_TYPE_WIFI || best.is_none()) {
          let rank = match a.IfType {
            IF_TYPE_ETHERNET => 0,
            IF_TYPE_WIFI => 1,
            _ => 2,
          };
          if best.map(|(_, r)| rank < r).unwrap_or(true) {
            best = Some((p, rank));
          }
        }
        p = a.Next;
      }
      let Some((p, _)) = best else { return none };
      let a = &*p;
      let adapter = a.FriendlyName.to_string().ok();
      let mut ipv4 = None;
      let mut u = a.FirstUnicastAddress;
      while !u.is_null() {
        let sa = (*u).Address.lpSockaddr;
        if !sa.is_null() && (*sa).sa_family == AF_INET {
          let v4 = &*(sa as *const SOCKADDR_IN);
          let b = v4.sin_addr.S_un.S_un_b;
          ipv4 = Some(format!("{}.{}.{}.{}", b.s_b1, b.s_b2, b.s_b3, b.s_b4));
          break;
        }
        u = (*u).Next;
      }
      none.connected = true;
      none.adapter = adapter.clone();
      none.ipv4 = ipv4;
      none.speed_mbps = Some(a.TransmitLinkSpeed / 1_000_000).filter(|s| *s > 0 && *s < 1_000_000);
      match a.IfType {
        IF_TYPE_ETHERNET => {
          none.kind = "ethernet".into();
          none.name = Some("Ethernet".into());
        }
        IF_TYPE_WIFI => {
          let wifi = crate::quick_settings::quick_settings_wifi_details();
          none.kind = "wifi".into();
          none.name = wifi.ssid.or(adapter);
          none.signal = wifi.signal_quality;
        }
        _ => {
          none.kind = "other".into();
          none.name = adapter;
        }
      }
      none
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  use super::NetworkStatus;
  pub fn status() -> NetworkStatus {
    NetworkStatus { connected: false, kind: "none".into(), name: None, adapter: None, speed_mbps: None, ipv4: None, signal: None }
  }
}

#[tauri::command]
pub async fn shell_network_status() -> NetworkStatus {
  tauri::async_runtime::spawn_blocking(imp::status).await.unwrap_or_else(|_| imp::status())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  #[test]
  fn reports_the_real_connection() {
    let s = super::imp::status();
    println!("{s:?}");
  }
}
