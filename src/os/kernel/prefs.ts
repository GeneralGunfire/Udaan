import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getAllTaskbarPrefs, setTaskbarPref } from '@/integrations/taskbar-prefs/client'
import { inTauri } from './shell'

/** Every shell preference, its type and default. Stored in SQLite, broadcast to all windows on change. */
export interface Prefs {
  'dock.autoHide': boolean
  'dock.enabled': boolean
  'shell.winKey': boolean
  'windows.autoMaximize': boolean
  'notifications.dnd': boolean
  'sounds.enabled': boolean
  /** Play an inaudible signal so speakers never fall asleep on quiet passages. */
  'sound.keepAwake': boolean
  /** 1 (lowest) to 3. */
  'sound.keepAwakeLevel': number
  /** System-wide EQ preset id (see SoundPanel). */
  'sound.preset': string
  /** How strongly the preset is applied, 0.5 to 1.5. */
  'sound.strength': number
  /** JSON: the manual bass / voice / treble settings (dB). */
  'sound.custom': string
  'lock.active': boolean
  'tips.seen': boolean
  'motion.off': boolean
  /** 0 = automatic for the screen, else a fixed size factor. */
  'ui.scale': number
  'lock.afterScreensaver': boolean
  /** Seconds of no input (anywhere in Windows) before the screensaver starts. Chosen in Settings. */
  'screensaver.idleSeconds': number
  /** JSON: the desktop widgets and where they sit. */
  'desktop.widgets': string
  'corners.tl': CornerAction
  'corners.tr': CornerAction
  'corners.bl': CornerAction
  'corners.br': CornerAction
  /** The motivation video in the menu bar is paused by the user. */
  'focus.paused': boolean
  /** Show the motivation video pill in the menu bar. */
  'focus.enabled': boolean
  /** Icons in the dock swell under the pointer. */
  /** Menu bar clock: 24-hour time, and seconds. */
  'menubar.clock24': boolean
  'menubar.seconds': boolean
  /** Banners show the message text (off: only who it's from). */
  'notifications.previews': boolean
  /** Seconds a banner stays up. */
  'notifications.duration': number
  /** How the Notification Center opens: 'sheet' is the full height of the screen, 'popup' is a regular panel under the bell. */
  'notifications.center': 'sheet' | 'popup'
  /** JSON array of app names whose banners are silenced (they still reach Notification Center). */
  'notifications.muted': string
  /** Accent colour for active and live states (hex). */
  'ui.accent': string
  /** Solid surfaces instead of translucent glass. */
  'ui.opaque': boolean
  /** The live liquid-glass fill behind the dock and top bar (off: the plain material). */
  'bars.liquid': boolean
  /** JSON: the look and numbers for each bar (see os/ui/liquid/config). Empty = defaults. */
  'bars.liquid.config': string
  /** JSON: per-part animation style, speed and bounce (see os/motion/config). Empty = defaults. */
  'motion.config': string
  /** The name shown on Start and the lock screen. Empty = the Windows user name. */
  'profile.name': string
  /** Drag up from the bottom edge to open the window switcher. */
  'switcher.drag': boolean
  /** How far up the screen the drag must reach, as a percent of its height (25 to 70). */
  'switcher.dragPercent': number
  /** Double-tap Ctrl opens the window switcher. */
  'switcher.ctrl': boolean
  /** Longest pause between the two taps, in milliseconds (200 to 600). */
  'switcher.ctrlGapMs': number
  /** Card size in the switcher. */
  'switcher.size': 'small' | 'medium' | 'large'
  /** The profile picture as a small data URL. Empty = the initial letter. */
  'profile.avatar': string
  /** The look of every shell surface: 'matte' (charcoal) or 'win11' (slate, Windows 11 style). */
  'ui.materialStyle': 'matte' | 'win11'
  /** Salted hash of the Udaan Lock PIN; empty until the person creates one. */
  'lock.pinHash': string
  'lock.pinLength': number
  /** Salted hash of the Work password; empty until the person sets one. */
  'work.passwordHash': string
  /** The Work profile is switched on. Off by default: Start shows no Work switch until it is turned on in Settings. */
  'work.enabled': boolean
  /** Which screensaver: clock, aurora, warp, flow, drift or shuffle. */
  'screensaver.scene': string
  /** Udaan apps kept loaded in the background for instant opening (JSON list of app ids). */
  'apps.warm': string
  /** Udaan apps opened automatically when Udaan starts (JSON list of app ids). */
  'apps.startup': string
  /** eco, balanced or performance. */
  'power.profile': string
  /** Which profile the desktop is in: 'personal' or 'work'. Survives restarts (Work relocks on start). */
  'profile.active': string
  /** What each profile's wallpaper was when it was last left (a wallpaper id). */
  'profile.wallpaper.personal': string
  'profile.wallpaper.work': string
  /** Work's own dock pins and widgets (JSON). Empty until Work is first entered. */
  'work.dock.pins.v2': string
  'work.desktop.widgets': string
}

export type CornerAction = 'none' | 'task-view' | 'start' | 'show-desktop' | 'notifications' | 'screensaver'
export const CORNER_KEYS = ['corners.tl', 'corners.tr', 'corners.bl', 'corners.br'] as const

export const PREF_DEFAULTS: Prefs = {
  'dock.autoHide': true,
  'dock.enabled': true,
  'shell.winKey': true,
  'windows.autoMaximize': false,
  'notifications.dnd': false,
  'sounds.enabled': true,
  'sound.keepAwake': true,
  'sound.keepAwakeLevel': 2,
  'sound.preset': 'flat',
  'sound.strength': 1,
  'sound.custom': '{"bass":0,"voice":0,"treble":0}',
  'lock.active': false,
  'tips.seen': false,
  'motion.off': false,
  'ui.scale': 0,
  'lock.afterScreensaver': false,
  'screensaver.idleSeconds': 60,
  'desktop.widgets': '[]',
  'corners.tl': 'task-view',
  'corners.tr': 'none',
  'corners.bl': 'none',
  'corners.br': 'show-desktop',
  'focus.paused': false,
  'focus.enabled': true,
  'menubar.clock24': false,
  'menubar.seconds': false,
  'notifications.previews': true,
  'notifications.duration': 6,
  'notifications.center': 'sheet',
  'notifications.muted': '[]',
  'ui.accent': '#3072f0',
  'ui.opaque': false,
  'bars.liquid': true,
  'bars.liquid.config': '',
  'motion.config': '',
  'profile.name': '',
  'switcher.drag': true,
  'switcher.dragPercent': 50,
  'switcher.ctrl': true,
  'switcher.ctrlGapMs': 350,
  'switcher.size': 'medium',
  'profile.avatar': '',
  'ui.materialStyle': 'matte',
  'lock.pinHash': '',
  'lock.pinLength': 4,
  'work.passwordHash': '',
  'work.enabled': false,
  'screensaver.scene': 'clock',
  'apps.warm': '["settings","file-explorer"]',
  'apps.startup': '[]',
  'power.profile': 'balanced',
  'profile.active': 'personal',
  'profile.wallpaper.personal': '',
  'profile.wallpaper.work': '',
  'work.dock.pins.v2': '',
  'work.desktop.widgets': '[]',
}

export type PrefKey = keyof Prefs
export type PrefValue<K extends PrefKey> = Prefs[K]
export type BoolPrefKey = { [K in PrefKey]: Prefs[K] extends boolean ? K : never }[PrefKey]

const cache = new Map<PrefKey, unknown>()

// All stored preferences are loaded in ONE call the first time any is read, instead of one
// round-trip per key from every window. Everything not stored falls back to its default.
let loading: Promise<void> | null = null
function loadAll(): Promise<void> {
  loading ??= getAllTaskbarPrefs().then(
    (all) => {
      for (const [key, raw] of Object.entries(all)) {
        if (cache.has(key as PrefKey)) continue // a newer change already arrived
        try {
          cache.set(key as PrefKey, JSON.parse(raw))
        } catch {
          // an unreadable stored value just falls back to its default
        }
      }
    },
    () => {
      loading = null // try again on the next read
    },
  )
  return loading
}

export async function getPref<K extends PrefKey>(key: K): Promise<PrefValue<K>> {
  if (cache.has(key)) return cache.get(key) as PrefValue<K>
  const fallback = PREF_DEFAULTS[key]
  if (!inTauri) return fallback
  await loadAll()
  return cache.has(key) ? (cache.get(key) as PrefValue<K>) : fallback
}

/** Saves a preference. The engine announces the change to every window (including this
 *  one), so nothing is emitted here. */
export async function setPref<K extends PrefKey>(key: K, value: PrefValue<K>): Promise<void> {
  cache.set(key, value)
  await setTaskbarPref(key, JSON.stringify(value))
}

export function onPrefChanged(handler: (key: PrefKey, value: unknown) => void) {
  return listen<{ key: PrefKey; value: unknown }>('shell://pref-changed', (e) => {
    cache.set(e.payload.key, e.payload.value)
    handler(e.payload.key, e.payload.value)
  })
}

export function usePref<K extends PrefKey>(key: K): [PrefValue<K>, (v: PrefValue<K>) => Promise<void>] {
  const [value, setValue] = useState<PrefValue<K>>(() => (cache.get(key) as PrefValue<K>) ?? (PREF_DEFAULTS[key]))
  useEffect(() => {
    let cancelled = false
    void getPref(key).then((v) => !cancelled && setValue(v))
    if (!inTauri) return
    const un = onPrefChanged((k, v) => {
      if (k === key && !cancelled) setValue(v as PrefValue<K>)
    })
    return () => {
      cancelled = true
      void un.then((fn) => fn())
    }
  }, [key])
  return [value, (v) => setPref(key, v)]
}
