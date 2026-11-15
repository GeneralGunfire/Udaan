import { currentProfile, WORK_START_TOOLS } from '@/os/kernel/profile'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { launchApp } from '@/integrations/installed-apps/client'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { APP_DEFS, APP_IDS, isAppId, type AppId } from '@/os/kernel/registry'
import { openApp } from '@/os/kernel/shell'

/**
 * The Start menu's data layer: what can be found, what is pinned, how things open.
 * No React in here, so it stays testable and the view stays small.
 */

/* ── Types ───────────────────────────────────────────────────────── */

export interface InstalledApp {
  name: string
  id: string
}

/** One of the engine's search hits (`search_query`). */
export interface Hit {
  id: string
  kind: 'app' | 'setting' | 'action' | 'folder' | 'file'
  title: string
  subtitle: string
  target: string
  score: number
}

/** What a pinned tile points at. */
export type Pin = { kind: 'udaan'; appId: AppId } | { kind: 'installed'; app: InstalledApp }

export const pinKey = (p: Pin) => (p.kind === 'udaan' ? `u:${p.appId}` : `i:${p.app.id}`)
export const pinName = (p: Pin) => (p.kind === 'udaan' ? APP_DEFS[p.appId].name : p.app.name)

/* ── Pinned apps ─────────────────────────────────────────────────── */

const KEY = 'udaan-start-pins-v3'
const OLD_KEY = 'udaan-start-pinned-v2'
const WORK_KEY = 'udaan-start-pins-work'

const DEFAULT_PINS: Pin[] = (
  ['file-explorer', 'chat', 'calendar', 'notes', 'private-player', 'news-brief', 'omni-find', 'studio', 'tv', 'clipboard', 'photos', 'settings'] as AppId[]
).map((appId) => ({ kind: 'udaan', appId }))

/** Work's section at the top of Start: its tools (whichever are installed), then Files and Notes. */
export async function workStartPins(): Promise<Pin[]> {
  const apps = await installedApps()
  const tools = WORK_START_TOOLS.flatMap((re): Pin[] => {
    const app = apps.find((x) => re.test(x.name))
    return app ? [{ kind: 'installed', app }] : []
  })
  return [{ kind: 'udaan', appId: 'file-explorer' }, { kind: 'udaan', appId: 'notes' }, ...tools, { kind: 'udaan', appId: 'anvil' }]
}

function valid(p: unknown): p is Pin {
  const x = p as Pin | null
  if (!x) return false
  return x.kind === 'udaan' ? isAppId(x.appId) : x.kind === 'installed' && !!x.app?.id
}

/** Saved pins outlive the apps in them, so anything that no longer exists is dropped on load. */
export function loadPins(): Pin[] {
  // Work keeps its own Start pins (empty to begin with: its tools sit in the Work section above them).
  if (currentProfile() === 'work') {
    try {
      const raw = localStorage.getItem(WORK_KEY)
      return raw ? (JSON.parse(raw) as unknown[]).filter(valid) : []
    } catch {
      return []
    }
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const list = (JSON.parse(raw) as unknown[]).filter(valid)
      if (list.length) return list
    }
    // First run of the new Start: carry the old pins over (folders are flattened).
    const old = localStorage.getItem(OLD_KEY)
    if (old) {
      const flat = (JSON.parse(old) as { folder?: boolean; items?: unknown[] }[]).flatMap((it) => (it && it.folder ? (it.items ?? []) : [it]))
      const list = flat.filter(valid)
      if (list.length) return list
    }
  } catch {
    /* fall through to the defaults */
  }
  return DEFAULT_PINS
}

export function savePins(pins: Pin[]) {
  try {
    localStorage.setItem(currentProfile() === 'work' ? WORK_KEY : KEY, JSON.stringify(pins))
  } catch {
    /* best effort */
  }
}

/* ── Installed apps (Windows Start's list) ───────────────────────── */

let appsCache: InstalledApp[] | null = null
let appsAt = 0

export async function installedApps(): Promise<InstalledApp[]> {
  if (appsCache && Date.now() - appsAt < 10 * 60_000) return appsCache
  appsAt = Date.now()
  try {
    appsCache = await invoke<InstalledApp[]>('shell_installed_apps')
  } catch {
    appsCache = appsCache ?? []
  }
  return appsCache
}

/* ── What the search index knows about ───────────────────────────── */

interface Action {
  title: string
  subtitle: string
  keywords: string
  run: () => void
}

const power = (action: string) => () => void invoke('shell_power', { action })
const win = (uri: string) => () => void launchApp(uri)
type Section = NonNullable<Parameters<typeof openApp<'settings'>>[1]>['section']
const udaanSettings = (section: Section) => () => void openApp('settings', { section })

/** Settings pages and actions, keyed by the entry id the index hands back. */
const ACTIONS: Record<string, Action> = {
  'setting:wallpaper': { title: 'Change wallpaper', subtitle: 'Udaan Settings', keywords: 'background picture desktop theme', run: () => void emit('launcher:wallpaper') },
  'setting:appearance': { title: 'Wallpaper & appearance', subtitle: 'Udaan Settings', keywords: 'dark light theme colour', run: udaanSettings('personalization') },
  'setting:dock': { title: 'Dock', subtitle: 'Udaan Settings', keywords: 'taskbar bar autohide', run: udaanSettings('dock') },
  'setting:keyboard': { title: 'Keyboard shortcuts', subtitle: 'Udaan Settings', keywords: 'hotkeys keys', run: udaanSettings('keyboard') },
  'setting:windows': { title: 'Window behaviour', subtitle: 'Udaan Settings', keywords: 'snap tiling', run: udaanSettings('windows') },
  'setting:display': { title: 'Display', subtitle: 'Windows Settings', keywords: 'screen resolution brightness monitor', run: win('ms-settings:display') },
  'setting:sound': { title: 'Sound', subtitle: 'Windows Settings', keywords: 'volume audio speakers microphone', run: win('ms-settings:sound') },
  'setting:network': { title: 'Wi-Fi & network', subtitle: 'Windows Settings', keywords: 'wifi internet ethernet vpn', run: win('ms-settings:network') },
  'setting:bluetooth': { title: 'Bluetooth & devices', subtitle: 'Windows Settings', keywords: 'printer mouse pair', run: win('ms-settings:bluetooth') },
  'setting:apps': { title: 'Apps & features', subtitle: 'Windows Settings', keywords: 'uninstall programs', run: win('ms-settings:appsfeatures') },
  'setting:update': { title: 'Windows Update', subtitle: 'Windows Settings', keywords: 'upgrade patches', run: win('ms-settings:windowsupdate') },
  'setting:power': { title: 'Battery & power', subtitle: 'Windows Settings', keywords: 'sleep screen timeout', run: win('ms-settings:powersleep') },
  'setting:privacy': { title: 'Privacy & security', subtitle: 'Windows Settings', keywords: 'camera microphone location', run: win('ms-settings:privacy') },
  'setting:time': { title: 'Date & time', subtitle: 'Windows Settings', keywords: 'clock timezone', run: win('ms-settings:dateandtime') },
  'setting:storage': { title: 'Storage', subtitle: 'Windows Settings', keywords: 'disk space cleanup', run: win('ms-settings:storagesense') },
  'action:lock': { title: 'Lock Udaan', subtitle: 'Action', keywords: 'lock screen secure', run: () => void emit('launcher:lock') },
  'action:screensaver': { title: 'Start screensaver', subtitle: 'Action', keywords: 'saver idle', run: () => void emit('launcher:screensaver') },
  'action:sleep': { title: 'Sleep', subtitle: 'Action', keywords: 'suspend', run: power('sleep') },
  'action:restart': { title: 'Restart', subtitle: 'Action', keywords: 'reboot', run: power('restart') },
  'action:shutdown': { title: 'Shut down', subtitle: 'Action', keywords: 'power off turn off', run: power('shut-down') },
  'action:signout': { title: 'Sign out', subtitle: 'Action', keywords: 'log off logout', run: power('sign-out') },
}

let registered = false

/** Tells the search engine about Udaan's own apps, settings pages and actions. Once per session. */
export function registerStartEntries() {
  if (registered) return
  registered = true
  // Anvil belongs to Work: it is reached from Work's section of Start, never from Personal's search.
  const apps = APP_IDS.filter((id) => id !== 'anvil').map((id) => ({ id: `udaan:${id}`, kind: 'app', title: APP_DEFS[id].name, subtitle: 'Udaan', keywords: '', target: id }))
  const settings = Object.entries(ACTIONS)
    .filter(([id]) => id.startsWith('setting:'))
    .map(([id, a]) => ({ id, kind: 'setting', title: a.title, subtitle: a.subtitle, keywords: a.keywords, target: id }))
  const actions = Object.entries(ACTIONS)
    .filter(([id]) => id.startsWith('action:'))
    .map(([id, a]) => ({ id, kind: 'action', title: a.title, subtitle: a.subtitle, keywords: a.keywords, target: id }))
  void invoke('search_register', { source: 'udaan-apps', entries: apps })
  void invoke('search_register', { source: 'udaan-settings', entries: settings })
  void invoke('search_register', { source: 'udaan-actions', entries: actions })
}

export const search = (query: string, limit = 24) => invoke<Hit[]>('search_query', { query, limit })

/* ── Launching ───────────────────────────────────────────────────── */

export async function launchPin(p: Pin) {
  if (p.kind === 'udaan') return openApp(p.appId)
  return launchApp(`shell:AppsFolder\\${p.app.id}`)
}

/** Opens a search hit and tells the engine, so what you use rises. */
export async function openHit(h: Hit, opts?: { reveal?: boolean }) {
  void invoke('search_record_launch', { id: h.id }).catch(() => {})
  if (h.id.startsWith('udaan:')) return openApp(h.target as AppId)
  const act = ACTIONS[h.id]
  if (act) return act.run()
  if (h.kind === 'app') return launchApp(`shell:AppsFolder\\${h.target}`)
  if (h.kind === 'folder') return openApp('file-explorer', { initialPath: h.target })
  if (h.kind === 'file') {
    if (opts?.reveal) return openApp('file-explorer', { initialPath: h.target.replace(/[\\/][^\\/]+$/, '') })
    return openWithSystem(h.target)
  }
}

export const webSearch = (q: string) => launchApp(`https://www.google.com/search?q=${encodeURIComponent(q)}`)
