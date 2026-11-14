//! Taskbar "quick settings" — Part 4 of the shell-replacement feature.
//! Scoped to what's cleanly achievable without a fragile system-tray-icon
//! host (see the module doc on why real 3rd-party tray icon hosting is
//! out of scope for this pass — it needs undocumented Shell_NotifyIcon
//! interception that fights with Explorer for ownership):
//!
//!   - Battery status: native `GetSystemPowerStatus` — simple, no COM.
//!   - Volume up/down/mute: broadcast `WM_APPCOMMAND` to the foreground
//!     window, the same standard mechanism hardware media keys use — no
//!     COM `IAudioEndpointVolume` interface needed for basic control.
//!   - Network status: read-only reachability heuristic (a fast local
//!     connectivity check) for the quick "online/offline" glance, PLUS
//!     real WLAN details (SSID, signal quality, radio on/off) via the
//!     Native Wifi API (`WlanOpenHandle`/`WlanEnumInterfaces`/
//!     `WlanQueryInterface`/`WlanSetInterfaceState` — wlanapi.h), for the
//!     quick-settings popup's fuller network panel.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryStatus {
  pub has_battery: bool,
  pub percent: u8,
  pub is_charging: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WifiDetails {
  pub has_adapter: bool,
  pub radio_on: bool,
  pub connected: bool,
  /// None when not connected, or the adapter has no radio.
  pub ssid: Option<String>,
  /// 0-100, WLAN_ASSOCIATION_ATTRIBUTES's own signal quality metric — None when not connected.
  pub signal_quality: Option<u8>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VolumeAction {
  Up,
  Down,
  Mute,
}

#[cfg(target_os = "windows")]
mod win {
  use super::*;
  use windows_sys::Win32::Foundation::{HWND, LPARAM, WPARAM};
  use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
  use windows_sys::Win32::System::SystemServices::{
    APPCOMMAND_VOLUME_DOWN, APPCOMMAND_VOLUME_MUTE, APPCOMMAND_VOLUME_UP,
  };
  use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SendMessageW, WM_APPCOMMAND};

  pub fn battery_status() -> BatteryStatus {
    unsafe {
      let mut status: SYSTEM_POWER_STATUS = std::mem::zeroed();
      if GetSystemPowerStatus(&mut status) == 0 {
        return BatteryStatus { has_battery: false, percent: 0, is_charging: false };
      }
      // BatteryFlag 128 = no system battery; BatteryLifePercent 255 = unknown.
      let has_battery = status.BatteryFlag != 128 && status.BatteryLifePercent != 255;
      BatteryStatus {
        has_battery,
        percent: if has_battery { status.BatteryLifePercent } else { 0 },
        // ACLineStatus: 1 = online (plugged in/charging), 0 = offline, 255 = unknown.
        is_charging: status.ACLineStatus == 1,
      }
    }
  }

  /// Broadcasts a standard multimedia app-command to the foreground
  /// window — the same message hardware volume keys send, so it affects
  /// whatever the system's normal volume-key target would be, without
  /// needing a COM audio-endpoint interface.
  pub fn send_volume_command(action: VolumeAction) {
    let command = match action {
      VolumeAction::Up => APPCOMMAND_VOLUME_UP,
      VolumeAction::Down => APPCOMMAND_VOLUME_DOWN,
      VolumeAction::Mute => APPCOMMAND_VOLUME_MUTE,
    };
    unsafe {
      let hwnd: HWND = GetForegroundWindow();
      if !hwnd.is_null() {
        // High word of lParam carries the command id per WM_APPCOMMAND's
        // documented contract; low word (device/reserved bits) stays 0.
        SendMessageW(hwnd, WM_APPCOMMAND, 0 as WPARAM, ((command as isize) << 16) as LPARAM);
      }
    }
  }

  use windows_sys::Win32::NetworkManagement::WiFi::{
    WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle, WlanQueryInterface,
    WlanSetInterface, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST, WLAN_PHY_RADIO_STATE,
    dot11_radio_state_off, dot11_radio_state_on, wlan_intf_opcode_current_connection,
    wlan_intf_opcode_radio_state, wlan_interface_state_connected,
  };

  /// RAII guard for the WlanOpenHandle client handle — every WLAN query
  /// needs one, and it must always be closed even on an early error
  /// return, which `Drop` guarantees without needing a manual cleanup
  /// path at every `?`/early-return site below.
  struct WlanClient {
    handle: windows_sys::Win32::Foundation::HANDLE,
  }

  impl WlanClient {
    fn open() -> Result<Self, String> {
      unsafe {
        let mut negotiated_version: u32 = 0;
        let mut handle: windows_sys::Win32::Foundation::HANDLE = std::ptr::null_mut();
        // Client version 2 = Vista+ API surface, the documented value to
        // request when targeting anything from Vista through current
        // Windows — the API negotiates down if the OS is older.
        let result = WlanOpenHandle(2, std::ptr::null(), &mut negotiated_version, &mut handle);
        if result != 0 {
          return Err(format!("WlanOpenHandle failed (error {result})"));
        }
        Ok(Self { handle })
      }
    }
  }

  impl Drop for WlanClient {
    fn drop(&mut self) {
      unsafe {
        WlanCloseHandle(self.handle, std::ptr::null());
      }
    }
  }

  /// A DOT11_SSID is a length-prefixed byte buffer, not a null-terminated
  /// string — SSIDs are technically allowed to contain arbitrary bytes
  /// (including embedded nulls), so this only reads exactly uSSIDLength
  /// bytes and lossily decodes as UTF-8 (the overwhelming majority of
  /// real-world SSIDs are plain ASCII/UTF-8; a lossy decode is a
  /// reasonable display fallback for the rare exception rather than
  /// failing the whole lookup over one malformed network name).
  fn ssid_to_string(ssid: &windows_sys::Win32::NetworkManagement::WiFi::DOT11_SSID) -> String {
    let len = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
    String::from_utf8_lossy(&ssid.ucSSID[..len]).to_string()
  }

  /// Queries the first WLAN interface's current connection + radio state.
  /// Returns "no adapter" (not an error) if the machine has no WLAN
  /// interface at all (common on desktops), since that's a legitimate,
  /// expected state for the quick-settings panel to render around, not a
  /// failure.
  pub fn wifi_details() -> WifiDetails {
    let client = match WlanClient::open() {
      Ok(c) => c,
      Err(_) => return WifiDetails { has_adapter: false, radio_on: false, connected: false, ssid: None, signal_quality: None },
    };

    unsafe {
      let mut interface_list_ptr: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
      let enum_result = WlanEnumInterfaces(client.handle, std::ptr::null(), &mut interface_list_ptr);
      if enum_result != 0 || interface_list_ptr.is_null() {
        return WifiDetails { has_adapter: false, radio_on: false, connected: false, ssid: None, signal_quality: None };
      }
      let interface_list = &*interface_list_ptr;
      if interface_list.dwNumberOfItems == 0 {
        WlanFreeMemory(interface_list_ptr as *const _);
        return WifiDetails { has_adapter: false, radio_on: false, connected: false, ssid: None, signal_quality: None };
      }

      // InterfaceInfo is declared as a 1-element array but the real
      // allocation holds dwNumberOfItems entries contiguously after the
      // struct's two u32 header fields — the documented Win32 pattern for
      // this API. Only the first interface is used here (the common case
      // of one WLAN adapter); a machine with multiple WLAN adapters would
      // need to iterate, out of scope for a quick-settings glance.
      let first_interface = &interface_list.InterfaceInfo[0];
      let interface_guid = first_interface.InterfaceGuid;

      let radio_on = query_radio_state(client.handle, &interface_guid);

      if first_interface.isState != wlan_interface_state_connected {
        WlanFreeMemory(interface_list_ptr as *const _);
        return WifiDetails { has_adapter: true, radio_on, connected: false, ssid: None, signal_quality: None };
      }

      let mut data_size: u32 = 0;
      let mut data_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
      let mut opcode_value_type = 0;
      let query_result = WlanQueryInterface(
        client.handle,
        &interface_guid,
        wlan_intf_opcode_current_connection,
        std::ptr::null(),
        &mut data_size,
        &mut data_ptr,
        &mut opcode_value_type,
      );
      WlanFreeMemory(interface_list_ptr as *const _);

      if query_result != 0 || data_ptr.is_null() {
        return WifiDetails { has_adapter: true, radio_on, connected: false, ssid: None, signal_quality: None };
      }

      let connection = &*(data_ptr as *const WLAN_CONNECTION_ATTRIBUTES);
      let ssid = ssid_to_string(&connection.wlanAssociationAttributes.dot11Ssid);
      // wlanSignalQuality is already documented as a 0-100 percentage, not
      // a raw RSSI value that would need conversion.
      let signal_quality = connection.wlanAssociationAttributes.wlanSignalQuality.min(100) as u8;

      WlanFreeMemory(data_ptr as *const _);

      WifiDetails {
        has_adapter: true,
        radio_on,
        connected: true,
        ssid: if ssid.is_empty() { None } else { Some(ssid) },
        signal_quality: Some(signal_quality),
      }
    }
  }

  unsafe fn query_radio_state(
    client_handle: windows_sys::Win32::Foundation::HANDLE,
    interface_guid: &windows_sys::core::GUID,
  ) -> bool {
    let mut data_size: u32 = 0;
    let mut data_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut opcode_value_type = 0;
    let result = WlanQueryInterface(
      client_handle,
      interface_guid,
      wlan_intf_opcode_radio_state,
      std::ptr::null(),
      &mut data_size,
      &mut data_ptr,
      &mut opcode_value_type,
    );
    if result != 0 || data_ptr.is_null() {
      // Assume on if the query itself fails — a false "radio off" reading
      // would be more misleading in the common case (radio is actually on,
      // query just failed) than a false "on" reading, and either way the
      // real connection state (wifi_details' `connected` field) is the
      // more trustworthy signal for the UI regardless.
      return true;
    }
    let state = &*(data_ptr as *const WLAN_PHY_RADIO_STATE);
    // Software radio state reflects what the OS/driver has actually been
    // told (on/off via Airplane Mode, a hardware switch's driver-reported
    // mirror, or a previous WlanSetInterface call) — the more relevant
    // signal for "did the user turn WiFi off" than hardware state, which
    // can lag or differ on some adapters.
    let on = state.dot11SoftwareRadioState != dot11_radio_state_off;
    WlanFreeMemory(data_ptr as *const _);
    on
  }

  /// Sets the WLAN radio on/off via the Native Wifi API. NOTE: driver
  /// support for software-controlled radio toggling is inconsistent
  /// across real-world WiFi adapters — some genuinely support it, others
  /// silently ignore the request or only allow turning it back ON (not
  /// off) once Airplane Mode / a hardware switch already turned it off.
  /// This surfaces the real WlanSetInterface error code rather than
  /// pretending the toggle always works, so the frontend can show an
  /// honest "couldn't turn off WiFi on this adapter" message instead of a
  /// toggle that silently does nothing.
  pub fn set_wifi_radio_enabled(enabled: bool) -> Result<(), String> {
    let client = WlanClient::open()?;
    unsafe {
      let mut interface_list_ptr: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
      let enum_result = WlanEnumInterfaces(client.handle, std::ptr::null(), &mut interface_list_ptr);
      if enum_result != 0 || interface_list_ptr.is_null() {
        return Err("No WLAN interface found on this machine.".to_string());
      }
      let interface_list = &*interface_list_ptr;
      if interface_list.dwNumberOfItems == 0 {
        WlanFreeMemory(interface_list_ptr as *const _);
        return Err("No WLAN interface found on this machine.".to_string());
      }
      let interface_guid = interface_list.InterfaceInfo[0].InterfaceGuid;
      WlanFreeMemory(interface_list_ptr as *const _);

      let radio_state = WLAN_PHY_RADIO_STATE {
        dwPhyIndex: 0,
        dot11SoftwareRadioState: if enabled { dot11_radio_state_on } else { dot11_radio_state_off },
        dot11HardwareRadioState: 0,
      };
      let result = WlanSetInterface(
        client.handle,
        &interface_guid,
        wlan_intf_opcode_radio_state,
        std::mem::size_of::<WLAN_PHY_RADIO_STATE>() as u32,
        &radio_state as *const _ as *const core::ffi::c_void,
        std::ptr::null(),
      );
      if result != 0 {
        return Err(format!(
          "This WiFi adapter's driver did not accept the request (error {result}) — some adapters don't support software radio control."
        ));
      }
    }
    Ok(())
  }
}

#[cfg(not(target_os = "windows"))]
mod win {
  use super::*;
  pub fn battery_status() -> BatteryStatus {
    BatteryStatus { has_battery: false, percent: 0, is_charging: false }
  }
  pub fn send_volume_command(_action: VolumeAction) {}
  pub fn wifi_details() -> WifiDetails {
    WifiDetails { has_adapter: false, radio_on: false, connected: false, ssid: None, signal_quality: None }
  }
  pub fn set_wifi_radio_enabled(_enabled: bool) -> Result<(), String> {
    Err("WiFi control is only supported on Windows.".to_string())
  }
}

#[tauri::command(async)]
pub fn quick_settings_battery_status() -> BatteryStatus {
  win::battery_status()
}

#[tauri::command(async)]
pub fn quick_settings_send_volume_command(action: VolumeAction) {
  win::send_volume_command(action)
}

/// Read-only, fast local-network reachability check — pings the default
/// gateway indirectly by attempting a short-timeout TCP connect to a
/// well-known local resolver rather than a real adapter/SSID enumeration,
/// which needs WLAN COM APIs out of scope for this pass. Good enough for
/// "online vs offline" quick-settings display, not a full network panel.
#[tauri::command(async)]
pub fn quick_settings_network_online() -> bool {
  use std::net::{SocketAddr, TcpStream};
  use std::time::Duration;
  // 1.1.1.1:53 (Cloudflare DNS) — picked over an unstated arbitrary host
  // for a stable, always-listening, low-latency target; connect success
  // alone is a reasonable proxy for "has real internet route" without
  // needing to actually resolve or transfer anything.
  let addr: SocketAddr = ([1, 1, 1, 1], 53).into();
  TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_ok()
}

/// Real WLAN details (SSID, signal quality, radio on/off) for the
/// quick-settings network panel — see win::wifi_details for the Native
/// Wifi API implementation. `has_adapter: false` (not an error) is the
/// expected result on a machine with no WLAN hardware (e.g. wired-only
/// desktops), which the frontend renders around rather than treating as
/// a failure.
#[tauri::command(async)]
pub fn quick_settings_wifi_details() -> WifiDetails {
  win::wifi_details()
}

/// Turns the WiFi radio on/off. See win::set_wifi_radio_enabled's doc
/// comment — driver support for this varies, and a failure here is a
/// real, surfaceable error (not every adapter honors software radio
/// control), not a bug to silently swallow.
#[tauri::command(async)]
pub fn quick_settings_set_wifi_radio_enabled(enabled: bool) -> Result<(), String> {
  win::set_wifi_radio_enabled(enabled)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn battery_status_reads_real_machine() {
    let status = quick_settings_battery_status();
    println!("battery: {status:?}");
    // No hard assertion on has_battery (this machine may or may not have
    // one) — just confirm it doesn't panic and percent is in valid range.
    assert!(status.percent <= 100);
  }

  #[test]
  fn network_check_resolves() {
    let online = quick_settings_network_online();
    println!("network online: {online}");
  }
}

/// System utilities a taskbar context menu is expected to be able to
/// open. Deliberately a fixed enum rather than an arbitrary command
/// string: this is invoked straight from a right-click menu in the
/// frontend, and accepting a free-form path here would turn one XSS or a
/// malformed IPC payload into arbitrary process execution. A closed set
/// cannot be pointed at anything the app did not already intend to launch.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemUtility {
  TaskManager,
  /// Windows Settings, on the Taskbar personalisation page.
  TaskbarSettings,
  NetworkSettings,
  SoundSettings,
}

#[cfg(target_os = "windows")]
fn launch_utility(utility: SystemUtility) -> Result<(), String> {
  use std::process::Command;
  // `ms-settings:` URIs are opened via the shell rather than executed, so
  // they go through `cmd /c start`; taskmgr is a real executable.
  let result = match utility {
    SystemUtility::TaskManager => Command::new("taskmgr.exe").spawn().map(|_| ()),
    SystemUtility::TaskbarSettings => shell_open("ms-settings:taskbar"),
    SystemUtility::NetworkSettings => shell_open("ms-settings:network-status"),
    SystemUtility::SoundSettings => shell_open("ms-settings:sound"),
  };
  result.map_err(|e| format!("Could not open that system utility: {e}"))
}

#[cfg(target_os = "windows")]
fn shell_open(uri: &str) -> std::io::Result<()> {
  use std::os::windows::process::CommandExt;
  use std::process::Command;
  // CREATE_NO_WINDOW: without it, `cmd` flashes a visible console frame
  // on screen for the moment it takes to hand the URI to the shell.
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  Command::new("cmd")
    .args(["/c", "start", "", uri])
    .creation_flags(CREATE_NO_WINDOW)
    .spawn()
    .map(|_| ())
}

#[cfg(not(target_os = "windows"))]
fn launch_utility(_utility: SystemUtility) -> Result<(), String> {
  Err("System utilities are only available on Windows.".to_string())
}

/// Opens Task Manager or a Windows Settings page from the taskbar's
/// right-click menu.
#[tauri::command(async)]
pub fn quick_settings_open_system_utility(utility: SystemUtility) -> Result<(), String> {
  launch_utility(utility)
}
