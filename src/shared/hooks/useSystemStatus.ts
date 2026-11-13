import { useEffect, useState } from 'react'
import {
  batteryStatus,
  networkOnline,
  wifiDetails,
  type BatteryStatus,
  type WifiDetails,
} from '@/integrations/quick-settings/client'

export interface SystemStatus {
  battery: BatteryStatus | null
  wifi: WifiDetails | null
  online: boolean
  /** True until the first poll resolves, so callers can render nothing
   * rather than flashing a wrong state (an "offline" icon for a moment on
   * every launch reads as a real outage). */
  loading: boolean
}

/**
 * Live system status — battery, Wi-Fi and connectivity — polled once and
 * shared by every surface that shows it.
 *
 * A single hook rather than per-component polling, because the taskbar
 * tray and the title bar both want the same three facts. Two components
 * polling independently would double the IPC traffic and, worse, let them
 * disagree: the connectivity check has a real timeout, so two callers on
 * different schedules can genuinely show different answers at the same
 * moment, which looks like a bug in the app rather than a slow network.
 *
 * Poll intervals differ per signal because the underlying calls differ in
 * cost and in how fast the thing they measure actually changes.
 */

/** Battery is a cheap local syscall and moves slowly. */
const BATTERY_INTERVAL_MS = 30_000
/** Wi-Fi signal quality genuinely fluctuates as you move around. */
const WIFI_INTERVAL_MS = 15_000
/** Connectivity does a real TCP connect with a timeout — the most
 * expensive of the three, and "am I online" rarely flips second to
 * second, so it is checked least often. */
const NETWORK_INTERVAL_MS = 20_000

export function useSystemStatus(): SystemStatus {
  const [battery, setBattery] = useState<BatteryStatus | null>(null)
  const [wifi, setWifi] = useState<WifiDetails | null>(null)
  const [online, setOnline] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Outside Tauri (a plain browser dev server) none of these commands
    // exist; polling would throw on every tick and fill the console.
    if (!('__TAURI_INTERNALS__' in window)) {
      setLoading(false)
      return
    }

    let cancelled = false

    // Each poller swallows its own errors rather than sharing one
    // try/catch: a machine with no Wi-Fi adapter makes `wifiDetails`
    // fail every time, and one failing signal must not stop battery and
    // connectivity from updating.
    async function pollBattery() {
      try {
        const b = await batteryStatus()
        if (!cancelled) setBattery(b)
      } catch {
        if (!cancelled) setBattery(null)
      }
    }

    async function pollWifi() {
      try {
        const w = await wifiDetails()
        if (!cancelled) setWifi(w)
      } catch {
        if (!cancelled) setWifi(null)
      }
    }

    async function pollNetwork() {
      try {
        const o = await networkOnline()
        if (!cancelled) setOnline(o)
      } catch {
        // A failed check is not proof of being offline — it could be the
        // IPC call itself failing — so the last known value is kept
        // rather than flipping the UI to "offline" on a transient error.
      }
    }

    void Promise.allSettled([pollBattery(), pollWifi(), pollNetwork()]).then(() => {
      if (!cancelled) setLoading(false)
    })

    const batteryTimer = window.setInterval(pollBattery, BATTERY_INTERVAL_MS)
    const wifiTimer = window.setInterval(pollWifi, WIFI_INTERVAL_MS)
    const networkTimer = window.setInterval(pollNetwork, NETWORK_INTERVAL_MS)

    // The browser's own online/offline events are far faster than any
    // poll interval — they fire the moment the adapter changes state, so
    // pulling the cable updates immediately instead of up to 20s later.
    // They are a hint about the adapter, not proof of internet access, so
    // a coming-online event triggers a real check rather than being
    // trusted outright; a going-offline event is trusted, since no
    // adapter genuinely does mean no route.
    const handleOnline = () => void pollNetwork()
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      cancelled = true
      window.clearInterval(batteryTimer)
      window.clearInterval(wifiTimer)
      window.clearInterval(networkTimer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { battery, wifi, online, loading }
}

/** Signal quality bucketed to the four bars a Wi-Fi glyph can show.
 * Returns 0 when disconnected, so the caller draws an empty/slashed
 * icon rather than guessing. */
export function wifiBars(wifi: WifiDetails | null): 0 | 1 | 2 | 3 | 4 {
  if (!wifi || !wifi.connected || wifi.signalQuality === null) return 0
  const q = wifi.signalQuality
  if (q >= 75) return 4
  if (q >= 50) return 3
  if (q >= 25) return 2
  return 1
}

/** One-line human description for a tooltip. Says what is actually true
 * rather than a generic "Connected" — an adapter that is on but not
 * associated, and one that is associated but has no route, are different
 * problems and the user can act on the difference. */
export function describeNetwork(wifi: WifiDetails | null, online: boolean): string {
  if (wifi?.connected && wifi.ssid) {
    const strength = wifi.signalQuality !== null ? ` · ${wifi.signalQuality}%` : ''
    return online ? `${wifi.ssid}${strength}` : `${wifi.ssid}${strength} · no internet`
  }
  if (wifi && wifi.hasAdapter && !wifi.radioOn) return 'Wi-Fi is off'
  if (wifi && wifi.hasAdapter && !wifi.connected) return online ? 'Wired connection' : 'Not connected'
  return online ? 'Connected' : 'No connection'
}
