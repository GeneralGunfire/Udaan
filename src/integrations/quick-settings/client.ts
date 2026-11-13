/**
 * Taskbar quick-settings — thin wrapper over the Rust `quick_settings`
 * module (src-tauri/src/quick_settings/mod.rs).
 */
import { invoke } from '@tauri-apps/api/core'

export interface BatteryStatus {
  hasBattery: boolean
  percent: number
  isCharging: boolean
}

interface RawBatteryStatus {
  has_battery: boolean
  percent: number
  is_charging: boolean
}

export type VolumeAction = 'up' | 'down' | 'mute'

export async function batteryStatus(): Promise<BatteryStatus> {
  const raw = await invoke<RawBatteryStatus>('quick_settings_battery_status')
  return { hasBattery: raw.has_battery, percent: raw.percent, isCharging: raw.is_charging }
}

/** Sends a standard multimedia volume command (up/down/mute) to the foreground window — the same mechanism hardware media keys use. */
export async function sendVolumeCommand(action: VolumeAction): Promise<void> {
  await invoke('quick_settings_send_volume_command', { action })
}

/** Fast local-network reachability check — a simple online/offline signal, not a full adapter/SSID browser. */
export async function networkOnline(): Promise<boolean> {
  return invoke<boolean>('quick_settings_network_online')
}

export interface WifiDetails {
  hasAdapter: boolean
  radioOn: boolean
  connected: boolean
  ssid: string | null
  /** 0-100. */
  signalQuality: number | null
}

interface RawWifiDetails {
  has_adapter: boolean
  radio_on: boolean
  connected: boolean
  ssid: string | null
  signal_quality: number | null
}

/** Real WLAN details (SSID, signal quality, radio state) via the Native Wifi API. `hasAdapter: false` is a legitimate result on a wired-only machine, not an error. */
export async function wifiDetails(): Promise<WifiDetails> {
  const raw = await invoke<RawWifiDetails>('quick_settings_wifi_details')
  return {
    hasAdapter: raw.has_adapter,
    radioOn: raw.radio_on,
    connected: raw.connected,
    ssid: raw.ssid,
    signalQuality: raw.signal_quality,
  }
}

/** Turns the WiFi radio on/off. Rejects with a real error message if the adapter's driver doesn't support software radio control — not every adapter does, and that's surfaced honestly rather than silently no-op'd. */
export async function setWifiRadioEnabled(enabled: boolean): Promise<void> {
  await invoke('quick_settings_set_wifi_radio_enabled', { enabled })
}

/** System utilities the taskbar's right-click menus can open. A fixed
 * set rather than an arbitrary command — the backend deliberately does
 * not accept a free-form path (see quick_settings/mod.rs). */
export type SystemUtility = 'taskManager' | 'taskbarSettings' | 'networkSettings' | 'soundSettings'

export async function openSystemUtility(utility: SystemUtility): Promise<void> {
  await invoke('quick_settings_open_system_utility', { utility })
}
