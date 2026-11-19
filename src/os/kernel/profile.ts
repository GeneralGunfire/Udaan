import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { localDataDir, join } from '@tauri-apps/api/path'
import { getPref, onPrefChanged, setPref, usePref } from './prefs'
import { inTauri } from './shell'
import { checkSecret, hashSecret } from './lockPin'

/**
 * PROFILES. One Udaan, two profiles. Work changes the layout, the launchers and what is kept apart; it
 * locks nothing down and stores no company data, only pins, wallpaper, widgets, notes, clipboard history
 * and the lock.
 *
 * Kept apart per profile:
 *   dock pins, Start pins, widgets  -> separate stored lists (`work.*` prefs)
 *   wallpaper                       -> remembered per profile and swapped on switch
 *   Notes and Clipboard history     -> separate stores in Rust (`notes_set_profile`, `clip_set_profile`)
 *   Calendar                        -> Work shows only events tagged "work" (storage is untouched)
 *
 * Work has its own lock: a password, asked every time Work is entered, again after 3 idle minutes, and
 * again after Udaan restarts. Only a hash of the password lives here.
 */
export type Profile = 'personal' | 'work'

/** Work locks itself after this much time with no input anywhere in Windows. */
export const WORK_IDLE_LOCK_MS = 3 * 60_000

const DEFAULT_WORK_WALLPAPER = 'color:#eef0f3'

/** Work has ONE wallpaper: the white studio with the DEXA logo and its reflection. No picker, no choice. */
async function workWallpaper(): Promise<string> {
  try {
    return `file:${await join(await localDataDir(), 'dev.udaan.workstation', 'work-wallpapers', 'silver-studio.png')}`
  } catch {
    return DEFAULT_WORK_WALLPAPER
  }
}

/** Whether this PC has a Work password yet. A fresh install has none, and the Work lock asks for one. */
export async function hasWorkPassword(): Promise<boolean> {
  return Boolean(await getPref('work.passwordHash'))
}

export async function verifyWorkPassword(text: string): Promise<boolean> {
  return checkSecret(text, await getPref('work.passwordHash'))
}

/** Saves a new Work password (salted and slow-hashed; the password itself is never stored). */
export async function setWorkPassword(text: string): Promise<void> {
  await setPref('work.passwordHash', await hashSecret(text))
}

let current: Profile = 'personal'
const asProfile = (v: unknown): Profile => (v === 'work' ? 'work' : 'personal')

/** The active profile for code that is not a component (a pin loader, say). Read it after `loadProfile()`. */
export const currentProfile = (): Profile => current

export async function loadProfile(): Promise<Profile> {
  current = asProfile(await getPref('profile.active'))
  return current
}

if (inTauri) {
  void loadProfile()
  void onPrefChanged((k, v) => {
    if (k === 'profile.active') current = asProfile(v)
  })
}

export function useProfile(): Profile {
  const [raw] = usePref('profile.active')
  const p = asProfile(raw)
  current = p
  return p
}

/**
 * Switches the whole desktop. Callers cover the screen first (the lock screen does), so nothing here
 * is seen half-done. The wallpaper needs nothing here: the wallpaper provider shows Work's fixed picture
 * while Work is active and Personal's own is never touched.
 */
export async function switchProfile(to: Profile): Promise<void> {
  const from = await loadProfile()
  // Open Notes windows save what they hold before the stores are swapped underneath them.
  if (from !== to) {
    await emit('profile://changing', to)
    await new Promise((r) => setTimeout(r, 120))
  }
  current = to
  // The stores swap first, so anything that reloads on the profile change reads the new set.
  await applyProfile(to)
  await setPref('profile.active', to)
  await emit('dock://pins-changed')
  // The cover (lock screen or veil) stays up until the desktop says the new profile's wallpaper is on screen,
  // so the old one is never seen. A safety limit keeps a missing answer from holding the screen.
  let shown: () => void = () => {}
  const wallpaperShown = new Promise<void>((resolve) => {
    shown = resolve
    setTimeout(resolve, 1500)
  })
  const off = listen('wallpaper://shown', () => shown())
  await emit('profile://changed', to)
  if (from !== to) await wallpaperShown
  void off.then((fn) => fn())
}

/** Points the Rust-side stores at a profile. Also run once at start so they match the saved choice. */
export async function applyProfile(p: Profile): Promise<void> {
  if (!inTauri) return
  await Promise.all([invoke('notes_set_profile', { profile: p }).catch(() => {}), invoke('clip_set_profile', { profile: p }).catch(() => {})])
}

/** The Work lock screen and the Work desktop show the same fixed wallpaper. */
export const workLockWallpaperId = workWallpaper
export const workWallpaperId = workWallpaper

/** What Work puts on the dock: only these (File Explorer, VS Code and Chrome here, Notes is an Udaan app). */
export const WORK_DOCK_PROGRAMS = [
  { match: 'explorer.exe', launch: 'explorer.exe', name: 'File Explorer' },
  { match: 'Code.exe', launch: 'Code.exe', name: 'Visual Studio Code' },
  { match: 'chrome.exe', launch: 'chrome.exe', name: 'Google Chrome' },
] as const

/** Work's section at the top of Start, matched against the installed programs by name. */
export const WORK_START_TOOLS = [/visual studio code/i, /sql server management/i, /pgadmin/i, /chrome/i, /^(microsoft )?excel/i]
