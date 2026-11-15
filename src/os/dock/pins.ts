import { emit, listen } from '@tauri-apps/api/event'
import { getTaskbarPref, listPinnedApps, setPinnedApps, setTaskbarPref, type PinnedApp } from '@/integrations/taskbar-prefs/client'
import { APP_DEFS, isAppId, type AppId } from '@/os/kernel/registry'
import { getPref, setPref } from '@/os/kernel/prefs'
import { currentProfile, loadProfile, WORK_DOCK_PROGRAMS } from '@/os/kernel/profile'

/**
 * A dock pin: one of Udaan's apps, or a program. Programs are matched to
 * their running windows by executable file name (`match`), and launched
 * via `launch`: an exe name the installed-apps resolver understands, or a
 * full path. They differ for some apps (Norton Private Browser is launched
 * as "NortonPrivateBrowser.exe" but runs as NortonBrowser.exe).
 */
export type Pin =
  | { key: string; kind: 'app'; appId: AppId; name: string }
  | { key: string; kind: 'exe'; match: string; launch: string; name: string }

export const appKey = (id: AppId) => `app:${id}`
export const exeKey = (exeFileName: string) => `exe:${exeFileName.toLowerCase()}`
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

const exePin = (match: string, launch: string, name: string): Pin => ({ key: exeKey(match), kind: 'exe', match, launch, name })

// Bump the version to re-seed everyone's dock once when the defaults change.
const INIT_KEY = 'dock.pinsInitialized.v3'
const DEFAULT_PINS: Pin[] = [
  exePin('explorer.exe', 'explorer.exe', 'File Explorer'),
  exePin('Code.exe', 'Code.exe', 'Visual Studio Code'),
]
/** Uninstalled programs that were once permanent pins and must not linger. */
const RETIRED_KEYS = new Set([exeKey('NortonBrowser.exe'), exeKey('claude.exe')])

/** The programs that can't be unpinned. */
export const isPermanent = (key: string) => currentProfile() === 'personal' && DEFAULT_PINS.some((d) => d.key === key)

/** Work's dock: its own list, kept in a pref so it never touches the Personal pins. Nothing is permanent there. */
const WORK_PINS: Pin[] = [
  ...WORK_DOCK_PROGRAMS.map((p) => exePin(p.match, p.launch, p.name)),
  { key: appKey('notes'), kind: 'app', appId: 'notes', name: APP_DEFS.notes.name },
]

async function loadWorkPins(): Promise<Pin[]> {
  try {
    const list = JSON.parse(await getPref('work.dock.pins.v2')) as Pin[]
    if (Array.isArray(list) && list.length) return list.filter((p) => p && (p.kind === 'exe' || (p.kind === 'app' && isAppId(p.appId))))
  } catch {
    /* first time in Work, or unreadable: start from the defaults */
  }
  await setPref('work.dock.pins.v2', JSON.stringify(WORK_PINS))
  return WORK_PINS
}

function fromRow(row: PinnedApp): Pin | null {
  if (row.kind === 'builtin') {
    return isAppId(row.launchRef) ? { key: appKey(row.launchRef), kind: 'app', appId: row.launchRef, name: APP_DEFS[row.launchRef].name } : null
  }
  try {
    const ref = JSON.parse(row.launchRef) as { match: string; launch: string }
    return exePin(ref.match, ref.launch, row.name)
  } catch {
    // Rows saved before `match`/`launch` existed stored a bare path.
    return exePin(baseName(row.launchRef), row.launchRef, row.name)
  }
}

function toRow(pin: Pin, sortOrder: number): PinnedApp {
  return pin.kind === 'app'
    ? { id: pin.key, kind: 'builtin', sortOrder, launchRef: pin.appId, name: pin.name }
    : { id: pin.key, kind: 'external', sortOrder, launchRef: JSON.stringify({ match: pin.match, launch: pin.launch }), name: pin.name }
}

export async function loadPins(): Promise<Pin[]> {
  if ((await loadProfile()) === 'work') return loadWorkPins()
  const initialized = (await getTaskbarPref(INIT_KEY).catch(() => null)) === 'true'
  if (!initialized) {
    await savePins(DEFAULT_PINS)
    await setTaskbarPref(INIT_KEY, 'true')
    return DEFAULT_PINS
  }
  const rows = await listPinnedApps()
  let pins = rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(fromRow)
    .filter((p): p is Pin => p !== null)
  const retired = pins.some((p) => RETIRED_KEYS.has(p.key))
  if (retired) pins = pins.filter((p) => !RETIRED_KEYS.has(p.key))
  // File Explorer and VS Code are always pinned: any that went
  // missing come back in their usual place.
  const missing = DEFAULT_PINS.filter((d) => !pins.some((p) => p.key === d.key))
  if (!missing.length) {
    if (retired) await setPinnedApps(pins.map(toRow))
    return pins
  }
  const fixed = [...DEFAULT_PINS.map((d) => pins.find((p) => p.key === d.key) ?? d), ...pins.filter((p) => !isPermanent(p.key))]
  await setPinnedApps(fixed.map(toRow))
  return fixed
}

export async function savePins(pins: Pin[]): Promise<void> {
  if ((await loadProfile()) === 'work') {
    await setPref('work.dock.pins.v2', JSON.stringify(pins))
    await emit('dock://pins-changed')
    return
  }
  await setPinnedApps(pins.map(toRow))
  await emit('dock://pins-changed')
}

export async function togglePin(pin: Pin): Promise<void> {
  const pins = await loadPins()
  const exists = pins.some((p) => p.key === pin.key)
  if (exists && isPermanent(pin.key)) return
  await savePins(exists ? pins.filter((p) => p.key !== pin.key) : [...pins, pin])
}

export function onPinsChanged(handler: () => void) {
  return listen('dock://pins-changed', handler)
}
