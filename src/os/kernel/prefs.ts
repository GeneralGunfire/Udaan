import { useEffect, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getTaskbarPref, setTaskbarPref } from '@/integrations/taskbar-prefs/client'
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
  /** JSON array of app names whose banners are silenced (they still reach Notification Center). */
  'notifications.muted': string
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
  'notifications.muted': '[]',
}

export type PrefKey = keyof Prefs
export type PrefValue<K extends PrefKey> = Prefs[K]
export type BoolPrefKey = { [K in PrefKey]: Prefs[K] extends boolean ? K : never }[PrefKey]

const cache = new Map<PrefKey, unknown>()

export async function getPref<K extends PrefKey>(key: K): Promise<PrefValue<K>> {
  if (cache.has(key)) return cache.get(key) as PrefValue<K>
  const fallback = PREF_DEFAULTS[key]
  if (!inTauri) return fallback
  try {
    const raw = await getTaskbarPref(key)
    const value = raw === null ? fallback : (JSON.parse(raw) as PrefValue<K>)
    cache.set(key, value)
    return value
  } catch {
    return fallback
  }
}

export async function setPref<K extends PrefKey>(key: K, value: PrefValue<K>): Promise<void> {
  cache.set(key, value)
  await setTaskbarPref(key, JSON.stringify(value))
  await emit('shell://pref-changed', { key, value })
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
