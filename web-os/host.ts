/**
 * The browser preview of Udaan: this page IS the screen.
 *
 * In the real OS every shell surface (desktop, menu bar, dock, popups, Start, each app) is its own
 * Windows window running the same React build. Here each one is an iframe running that same build,
 * placed where the Rust engine would place it. This file plays the part of Rust (commands, events,
 * preferences) and of the window manager (position, focus, stacking, snapping). Nothing touches the PC.
 *
 * Commands nobody has taught the host yet answer `null` and are listed in the dev panel (F2), so
 * missing pieces are visible instead of silent.
 */

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Win {
  label: string
  kind: string
  handle: number
  appId: string | null
  title: string
  el: HTMLIFrameElement
  rect: Rect
  visible: boolean
  minimized: boolean
  maximized: boolean
  restore: Rect | null
  /** An app window the user closed: kept (hidden) so reopening is instant, like the real warm windows. */
  closed: boolean
  z: number
  args: string | null
  dragStart: Rect | null
}

const screenEl = document.getElementById('screen')!
const W = window.innerWidth
const H = window.innerHeight
const MENU_H = 34

/* ------------------------------------------------------------------ preferences */

const STORE = 'udaan-web-os'
const DEFAULT_PREFS: Record<string, string> = {
  'dock.autoHide': 'false',
  'dock.pinsInitialized.v3': 'true',
  'tips.seen': 'true',
  'sounds.enabled': 'false',
  'focus.enabled': 'false',
  'apps.warm': '[]',
}
const DEFAULT_PINS = ['file-explorer', 'chat', 'calendar', 'private-player', 'notes', 'news-brief', 'settings']

function load<T>(key: string, fallback: T): T {
  try {
    if (new URLSearchParams(location.search).has('reset')) return fallback
    const raw = localStorage.getItem(`${STORE}:${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value))
  } catch {
    /* private mode: the preview just forgets */
  }
}

const prefs: Record<string, string> = { ...DEFAULT_PREFS, ...load<Record<string, string>>('prefs', {}) }
let pinRows: { id: string; kind: string; sort_order: number; launch_ref: string; name: string }[] = load('pins', [])
if (!pinRows.length) {
  pinRows = DEFAULT_PINS.map((id, i) => ({ id: `app:${id}`, kind: 'builtin', sort_order: i, launch_ref: id, name: id }))
}
/** Pictures the preview can put on the desktop, from dark to bright, so the bars can be judged on each. */
const WALLPAPERS: { id: string; name: string; src: string }[] = [
  ...['manhattan-noir', 'skyline-mono-i', 'skyline-mono-ii', 'skyline-mono-iii'].map((n) => ({ id: `file:/src/assets/wallpapers/${n}.jpg`, name: n, src: `/src/assets/wallpapers/${n}.jpg` })),
  ...['alhambra', 'machu-picchu', 'scene3'].map((n) => ({ id: `file:/next/shell/theme/wallpapers/${n}.jpg`, name: n, src: `/next/shell/theme/wallpapers/${n}.jpg` })),
  { id: 'color:#eef0f3', name: 'white', src: '' },
  { id: 'color:#8a93a3', name: 'mid grey', src: '' },
  { id: 'color:#1f3a8a', name: 'deep blue', src: '' },
  { id: 'color:#0b0f16', name: 'near black', src: '' },
]
let wallpaper = load('wallpaper','file:/src/assets/wallpapers/manhattan-noir.jpg')

/* ------------------------------------------------------------------ windows */

let handleSeq = 1000
let zTop = 100
let foreground = 0
const wins = new Map<string, Win>()
const reserve = { top: 0, bottom: 0 }
let dockBand = 0

const FRAME_Z: Record<string, number> = { gallery: 900, taskbar: 1000, menubar: 1001, launcher: 1500, 'taskbar-popup': 2000, toast: 2500, edgelight: 3000 }

function frameUrl(params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, sw: String(W), sh: String(H) })
  return `/web-os/frame.html?${q}`
}

function applyRect(w: Win) {
  const s = w.el.style
  s.left = `${Math.round(w.rect.x)}px`
  s.top = `${Math.round(w.rect.y)}px`
  s.width = `${Math.max(1, Math.round(w.rect.w))}px`
  s.height = `${Math.max(1, Math.round(w.rect.h))}px`
  w.el.contentWindow?.postMessage({ __udaan: true, type: 'geometry', x: Math.round(w.rect.x), y: Math.round(w.rect.y) }, '*')
  tell('tauri://resize', { width: Math.round(w.rect.w), height: Math.round(w.rect.h) }, w.label)
  tell('tauri://move', { x: Math.round(w.rect.x), y: Math.round(w.rect.y) }, w.label)
}

function applyVisible(w: Win) {
  w.el.style.visibility = w.visible ? 'visible' : 'hidden'
  w.el.style.pointerEvents = w.visible && w.kind !== 'edgelight' ? 'auto' : 'none'
}

function createFrame(label: string, kind: string, rect: Rect, extra: Partial<Win> & { url?: string } = {}): Win {
  const { url, ...winExtra } = extra
  const el = document.createElement('iframe')
  el.dataset.label = label
  el.style.zIndex = String(FRAME_Z[kind] ?? 0)
  const params: Record<string, string> = { label }
  if (kind === 'app') {
    params.window = 'app'
    params.app = extra.appId ?? ''
  } else if (kind !== 'desktop') params.window = kind
  el.src = url ?? frameUrl(params)
  const w: Win = {
    label,
    kind,
    handle: ++handleSeq,
    appId: null,
    title: '',
    el,
    rect,
    visible: kind === 'desktop',
    minimized: false,
    maximized: false,
    restore: null,
    closed: false,
    z: FRAME_Z[kind] ?? 0,
    args: null,
    dragStart: null,
    ...winExtra,
  }
  wins.set(label, w)
  applyRect(w)
  applyVisible(w)
  screenEl.appendChild(el)
  return w
}

const workArea = (): Rect => ({ x: 0, y: reserve.top, w: W, h: H - reserve.top - reserve.bottom })

function zoneRect(z: { x: number; y: number; w: number; h: number }): Rect {
  const a = workArea()
  return { x: Math.round(a.x + z.x * a.w), y: Math.round(a.y + z.y * a.h), w: Math.round(z.w * a.w), h: Math.round(z.h * a.h) }
}

/* ------------------------------------------------------------------ events */

function frames(): Win[] {
  return [...wins.values()]
}

/** Sends an event to every frame (what Tauri's emit does), or only to the window it is aimed at. */
function tell(event: string, payload: unknown, to?: string) {
  for (const w of frames()) {
    if (to && w.label !== to) continue
    w.el.contentWindow?.postMessage({ __udaan: true, type: 'event', event, payload, to }, '*')
  }
}

const appWins = () => frames().filter((w) => w.kind === 'app' && !w.closed)

function snapshot() {
  return {
    windows: appWins().map((w) => ({
      handle: w.handle,
      title: w.title || w.appId || 'Udaan',
      processName: 'Udaan.exe',
      exePath: null,
      isMinimized: w.minimized,
      isMaximized: w.maximized,
      appId: w.appId,
    })),
    foreground,
    fullscreen: false,
  }
}
const emitSnapshot = () => tell('shell://snapshot', snapshot())

function focusWin(w: Win) {
  if (w.kind !== 'app') return
  if (w.minimized) {
    w.minimized = false
    w.visible = true
    applyVisible(w)
  }
  w.z = ++zTop
  w.el.style.zIndex = String(w.z)
  w.el.contentWindow?.focus()
  foreground = w.handle
  tell('shell://foreground', { foreground, fullscreen: false })
  emitSnapshot()
}

function byHandle(h: number): Win | undefined {
  return frames().find((w) => w.handle === h)
}

function setRect(w: Win, r: Rect) {
  w.rect = r
  applyRect(w)
}

function maximize(w: Win) {
  if (!w.maximized) w.restore = { ...w.rect }
  w.maximized = true
  setRect(w, workArea())
  emitSnapshot()
}
function unmaximize(w: Win) {
  w.maximized = false
  if (w.restore) setRect(w, w.restore)
  emitSnapshot()
}

function openApp(req: Record<string, unknown>) {
  const id = String(req.appId)
  const label = `app:${id}`
  const existing = wins.get(label)
  if (existing) {
    existing.closed = false
    existing.visible = true
    existing.minimized = false
    applyVisible(existing)
    if (req.args) {
      existing.args = String(req.args)
      tell('shell://app-args', existing.args, label)
    }
    focusWin(existing)
    return
  }
  const a = workArea()
  const width = Math.min(Number(req.width) || 1000, a.w - 40)
  const height = Math.min(Number(req.height) || 700, a.h - 30)
  const n = appWins().length
  const rect: Rect = {
    x: req.x != null ? Number(req.x) : Math.round(a.x + (a.w - width) / 2 + n * 28),
    y: req.y != null ? Number(req.y) : Math.round(a.y + (a.h - height) / 2 + n * 22),
    w: width,
    h: height,
  }
  const w = createFrame(label, 'app', rect, { appId: id, title: String(req.title ?? id), args: req.args ? String(req.args) : null, visible: true })
  w.el.classList.add('app-frame')
  focusWin(w)
}

/* ------------------------------------------------------------------ the pretend Rust */

const unhandled = new Map<string, number>()
const NOOP = new Set([
  'shell_set_webview_memory_low', 'notes_set_profile', 'clip_set_profile', 'shell_set_explorer_chrome_hidden', 'shell_set_keyboard_hook',
  'speaker_keepalive_set', 'shell_set_hot_corners', 'shell_set_autostart', 'omniroute_start', 'wallpaper_prerender', 'daily_brief_save',
  'daily_brief_get_today', 'shell_now_playing', 'taskbar_unregister_all_thumbnails', 'search_register', 'files_watch', 'shell_watch_dirs',
])

const APPS = ['Google Chrome', 'Visual Studio Code', 'Microsoft Excel', 'Microsoft Word', 'Microsoft Outlook', 'Spotify', 'Steam', 'Notepad', 'Calculator', 'Paint', 'Command Prompt', 'Task Manager', 'File Explorer', 'OneDrive', 'Power BI Desktop', 'pgAdmin 4', 'SQL Server Management Studio']

const HOME = 'C:\\Users\\Udaan'

/** A believable folder: the same name always lists the same things. */
function fakeDir(dir: string) {
  const seed = [...dir].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
  const now = Date.now()
  const folders = ['Projects', 'Archive', 'Reference', 'Screenshots', 'Notes', 'Exports', 'Backups', 'Templates']
  const files: [string, number][] = [
    ['Quarterly report.pdf', 2_400_000], ['Budget 2026.xlsx', 184_000], ['Meeting notes.docx', 58_000], ['holiday-01.jpg', 3_900_000],
    ['holiday-02.jpg', 4_100_000], ['mix-final.mp3', 9_300_000], ['readme.md', 3_200], ['setup.exe', 61_000_000], ['backup.zip', 220_000_000], ['todo.txt', 800],
  ]
  const entry = (name: string, isDir: boolean, size: number, i: number) => {
    const ext = isDir ? '' : (name.split('.').pop() ?? '')
    const t = now - (((seed >> (i % 7)) % 400) + i * 9) * 86_400_000
    return { name, path: `${dir.replace(/\\$/, '')}\\${name}`, isDir, size, modifiedMs: t, createdMs: t - 5 * 86_400_000, ext, hidden: false, system: false, readonly: false }
  }
  const nFolders = 3 + (seed % 4)
  const nFiles = 5 + (seed % 5)
  return [
    ...folders.slice(0, nFolders).map((n, i) => entry(n, true, 0, i)),
    ...files.slice(0, nFiles).map(([n, s], i) => entry(n, false, s, i + 3)),
  ]
}

function sizeArg(v: unknown): { w: number; h: number } | null {
  const d = (v as { data?: { width?: number; height?: number } } | undefined)?.data
  return d && d.width != null && d.height != null ? { w: d.width, h: d.height } : null
}
function posArg(v: unknown): { x: number; y: number } | null {
  const d = (v as { data?: { x?: number; y?: number } } | undefined)?.data
  return d && d.x != null && d.y != null ? { x: d.x, y: d.y } : null
}

const monitor = () => ({
  name: 'Udaan preview',
  position: { x: 0, y: 0 },
  size: { width: W, height: H },
  scaleFactor: 1,
  workArea: { position: { x: 0, y: reserve.top }, size: { width: W, height: H - reserve.top - reserve.bottom } },
})

async function windowCommand(op: string, a: Record<string, unknown>, from: Win): Promise<unknown> {
  const w = (typeof a.label === 'string' && wins.get(a.label)) || from
  switch (op) {
    case 'show':
      // The edge light stays off until the user switches it on (edge_light_set_enabled), as in the real OS.
      if (w.kind === 'edgelight' && !edgeLightOn) return null
      w.visible = true
      applyVisible(w)
      if (w.kind === 'launcher') w.el.contentWindow?.focus()
      return null
    case 'hide':
      w.visible = false
      applyVisible(w)
      return null
    case 'set_focus':
      if (w.kind === 'app') focusWin(w)
      else w.el.contentWindow?.focus()
      return null
    case 'is_visible':
      return w.visible
    case 'is_focused':
      return foreground === w.handle
    case 'is_minimized':
      return w.minimized
    case 'is_maximized':
      return w.maximized
    case 'is_fullscreen':
      return false
    case 'outer_position':
    case 'inner_position':
      return { x: Math.round(w.rect.x), y: Math.round(w.rect.y) }
    case 'outer_size':
    case 'inner_size':
      return { width: Math.round(w.rect.w), height: Math.round(w.rect.h) }
    case 'scale_factor':
      return 1
    case 'set_size': {
      const s = sizeArg(a.value)
      if (s) setRect(w, { ...w.rect, w: s.w, h: s.h })
      return null
    }
    case 'set_position': {
      const p = posArg(a.value)
      if (p) setRect(w, { ...w.rect, x: p.x, y: p.y })
      return null
    }
    case 'minimize':
      w.minimized = true
      w.visible = false
      applyVisible(w)
      emitSnapshot()
      return null
    case 'unminimize':
      w.minimized = false
      w.visible = true
      applyVisible(w)
      emitSnapshot()
      return null
    case 'maximize':
      maximize(w)
      return null
    case 'unmaximize':
      unmaximize(w)
      return null
    case 'toggle_maximize':
      if (w.maximized) unmaximize(w)
      else maximize(w)
      return null
    case 'close':
    case 'destroy':
      if (w.kind === 'app') {
        wins.delete(w.label)
        w.el.remove()
        emitSnapshot()
      }
      return null
    case 'set_title':
      if (typeof a.value === 'string') {
        w.title = a.value
        emitSnapshot()
      }
      return null
    case 'current_monitor':
    case 'primary_monitor':
      return monitor()
    case 'available_monitors':
      return [monitor()]
    case 'get_all_windows':
      return frames().map((x) => x.label)
    default:
      return null
  }
}

async function invokeHost(cmd: string, a: Record<string, unknown>, from: Win): Promise<unknown> {
  if (cmd.startsWith('plugin:window|')) return windowCommand(cmd.slice('plugin:window|'.length), a, from)
  if (cmd === 'plugin:webview|get_all_webviews') return frames().map((w) => ({ windowLabel: w.label, label: w.label }))
  if (cmd.startsWith('plugin:webview|') || cmd.startsWith('plugin:resources|')) return null

  switch (cmd) {
    case 'plugin:event|emit':
    case 'plugin:event|emit_to':
      tell(String(a.event), a.payload)
      return null

    /* --- preferences and pins --- */
    case 'taskbar_prefs_get':
      return prefs[String(a.key)] ?? null
    case 'taskbar_prefs_set': {
      const key = String(a.key)
      prefs[key] = String(a.value)
      save('prefs', prefs)
      try {
        tell('shell://pref-changed', { key, value: JSON.parse(String(a.value)) })
      } catch {
        /* not JSON: a plain marker, nobody listens */
      }
      if (key === 'dock.autoHide') applyDockMode()
      return null
    }
    case 'taskbar_prefs_all':
      return { ...prefs }
    case 'taskbar_prefs_list_pinned':
      return pinRows
    case 'taskbar_prefs_set_pinned':
      pinRows = (a.items as typeof pinRows) ?? []
      save('pins', pinRows)
      return null

    /* --- windows --- */
    case 'shell_snapshot':
      return snapshot()
    case 'shell_open_app':
      openApp(a.req as Record<string, unknown>)
      return null
    case 'shell_take_app_args': {
      const args = from.args
      from.args = null
      return args
    }
    case 'engine_app_closed':
      from.closed = true
      from.visible = false
      applyVisible(from)
      emitSnapshot()
      return null
    case 'shell_focus_window': {
      const t = byHandle(Number(a.handle))
      if (t) focusWin(t)
      return null
    }
    case 'shell_minimize_window': {
      const t = byHandle(Number(a.handle))
      if (t) await windowCommand('minimize', {}, t)
      return null
    }
    case 'shell_toggle_maximize_window': {
      const t = byHandle(Number(a.handle))
      if (t) await windowCommand('toggle_maximize', {}, t)
      return null
    }
    case 'shell_close_window': {
      const t = byHandle(Number(a.handle))
      if (t) {
        t.closed = true
        t.visible = false
        applyVisible(t)
        emitSnapshot()
      }
      return null
    }
    case 'shell_snap_self':
      setRect(from, zoneRect(a.zone as Rect))
      return null
    case 'shell_snap_window': {
      const t = byHandle(Number(a.handle))
      if (t) setRect(t, zoneRect(a.zone as Rect))
      return null
    }
    case 'shell_set_window_rect':
      setRect(from, { x: Number(a.x), y: Number(a.y), w: Number(a.w), h: Number(a.h) })
      return null
    case 'shell_monitor_of':
      return [
        { left: 0, top: 0, right: W, bottom: H },
        { left: 0, top: reserve.top, right: W, bottom: H - reserve.bottom },
      ]
    case 'shell_toggle_desktop': {
      const any = appWins().some((w) => !w.minimized)
      for (const w of appWins()) {
        w.minimized = any
        w.visible = !any
        applyVisible(w)
      }
      emitSnapshot()
      return any
    }
    case 'shell_set_windows_hidden':
      return null
    case 'edge_light_set_enabled': {
      edgeLightOn = !!a.enabled
      const el = wins.get('edgelight')
      if (el) {
        el.visible = edgeLightOn
        applyVisible(el)
      }
      return null
    }
    case 'taskbar_list_windows':
      return []
    case 'shell_window_sizes':
    case 'shell_window_icons':
    case 'shell_file_icons':
    case 'shell_resolve_launch':
    case 'shell_app_names':
    case 'shell_installed_app_icons':
      return {}

    /* --- bars and popups --- */
    case 'engine_edge_bind': {
      const edge = String(a.edge)
      const windowPx = Number(a.windowPx)
      const reservePx = Number(a.reservePx ?? 0)
      const widthPx = a.widthPx != null ? Number(a.widthPx) : W
      const inset = Number(a.insetPx ?? 0)
      if (edge === 'top') reserve.top = reservePx
      else reserve.bottom = reservePx
      const left = Math.round((W - widthPx) / 2)
      const top = edge === 'top' ? 0 : H - windowPx - inset
      setRect(from, { x: left, y: top, w: widthPx, h: windowPx })
      emitDisplays()
      return { left, top }
    }
    case 'engine_edge_release':
      if (from.label === 'menubar') reserve.top = 0
      else if (from.label === 'taskbar') reserve.bottom = 0
      emitDisplays()
      return null
    case 'shell_set_dock_band':
      dockBand = Number(a.heightPx)
      return null
    case 'engine_popup_present':
      from.visible = true
      applyVisible(from)
      from.el.contentWindow?.focus()
      return null
    case 'engine_popup_dismiss':
      from.visible = false
      applyVisible(from)
      popupWatch = false
      return null
    case 'engine_popup_watch':
      popupWatch = !!a.on
      return null

    /* --- wallpaper --- */
    case 'wallpaper_current':
      return wallpaper
    case 'wallpaper_library':
      // The same shape the engine reports (os/wallpaper/library.ts), so the real Settings picker works here.
      return {
        items: WALLPAPERS.filter((w) => w.src).map((w) => ({
          id: w.id,
          name: w.name,
          path: w.src,
          width: 3840,
          height: 2160,
          bytes: 2_400_000,
          aspect: 'wide',
          tone: w.name === 'manhattan-noir' || w.name.startsWith('skyline') ? 'dark' : 'light',
        })),
        packs: [],
        unplaced: [],
        current: wallpaper,
        rotation: { mode: { mode: 'off' }, order: 'shuffle', packId: null, fitScreen: true },
        folders: ['C:\\Users\\Udaan\\Downloads'],
        fits: {},
      }
    case 'wallpaper_thumb':
      return String(a.path)
    case 'wallpaper_render':
      return String(a.path)
    case 'wallpaper_set':
      setWallpaper(String(a.id))
      return null

    /* --- window material: the compositor's blur, done with CSS on the frame element --- */
    case 'shell_set_material': {
      // The real popup window deliberately has no OS blur (its card paints its own material).
      const blur = from.kind === 'menubar' || from.kind === 'toast' || from.kind === 'launcher'
      from.el.style.backdropFilter = blur && a.material !== 'none' ? 'blur(26px) saturate(1.35)' : ''
      return { blurred: true, modern: false }
    }

    /* --- Files: a small pretend disk, so the app has something to show --- */
    case 'files_places':
      return ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'].map((n) => ({ id: n.toLowerCase(), name: n, path: `${HOME}\\${n}` }))
    case 'file_explorer_drives':
      return [
        { name: 'Windows (C:)', mount: 'C:\\', totalBytes: 480e9, freeBytes: 212e9, removable: false },
        { name: 'Data (D:)', mount: 'D:\\', totalBytes: 1e12, freeBytes: 640e9, removable: false },
      ]
    case 'files_list':
      return fakeDir(String(a.dir))
    case 'files_subdirs':
      return fakeDir(String(a.dir))
        .filter((e) => e.isDir)
        .map((e) => ({ name: e.name, path: e.path, hasChildren: true, hidden: false }))
    case 'files_stat':
      return ((a.paths as string[]) ?? []).map(() => null)
    case 'files_index_status':
      return { ready: true, building: false, count: 0, builtMs: 0, roots: [] }
    case 'files_bin_list':
      return []

    /* --- the rest of the shell --- */
    case 'boot_optimize_run':
      return {
        temp_files_deleted: 0,
        temp_bytes_freed: 0,
        startup_programs: [],
        disk_free_bytes: 400e9,
        disk_total_bytes: 1e12,
        memory_free_bytes: 6e9,
        memory_total_bytes: 8e9,
        dns_cache_flushed: true,
        log_file_path: '',
      }
    case 'quick_settings_battery_status':
      return { has_battery: false, percent: 100, is_charging: false }
    case 'quick_settings_network_online':
      return true
    case 'quick_settings_wifi_details':
      return { has_adapter: true, radio_on: true, connected: true, ssid: 'Home', signal_quality: 80 }
    case 'notifications_unread_count':
      return 0
    case 'desktop_recycle_bin':
      return { itemCount: 0 }
    case 'daily_brief_fetch_feed':
      return ''
    case 'audio_active_apps':
    case 'schedule_list_events':
    case 'general_chat_list_sessions':
      return []
    case 'shell_user_name':
      return 'Udaan'
    case 'shell_installed_apps':
      return APPS.map((name) => ({ name, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }))
    case 'shell_volume':
      return { level: 0.62, muted: false }
    case 'shell_network_status':
      return { connected: true, kind: 'wifi', signal: 80 }
    case 'shell_recycle_bin_info':
      return { itemCount: 0 }
    case 'shell_idle_ms':
      return 0
    case 'notify_unread_count':
      return 0
    case 'notify_list':
    case 'notify_banners':
    case 'desktop_items_list':
    case 'desktop_items_dirs':
      return []
    case 'search_query': {
      // A few believable recents, so Start's Recommended has something to show.
      const H = 'C:/Users/Udaan'
      const all = [
        { id: 'file:1', kind: 'file', title: 'Quarterly report.pdf', subtitle: '', target: `${H}/Documents/Quarterly report.pdf`, score: 9 },
        { id: 'udaan:chat', kind: 'app', title: 'Chat', subtitle: 'Udaan', target: 'chat', score: 8 },
        { id: 'file:2', kind: 'file', title: 'Budget 2026.xlsx', subtitle: '', target: `${H}/Documents/Work/Budget 2026.xlsx`, score: 7 },
        { id: 'file:3', kind: 'file', title: 'holiday-02.jpg', subtitle: '', target: `${H}/Pictures/holiday-02.jpg`, score: 6 },
        { id: 'udaan:private-player', kind: 'app', title: 'Music', subtitle: 'Udaan', target: 'private-player', score: 5 },
        { id: 'file:4', kind: 'file', title: 'Meeting notes.docx', subtitle: '', target: `${H}/Documents/Meeting notes.docx`, score: 4 },
      ]
      const q = String(a.query ?? '').trim().toLowerCase()
      return all.filter((h) => !q || h.title.toLowerCase().includes(q))
    }
    case 'engine_tier':
      return 'normal'

    default:
      // Things that only act on the real PC (or answer "nothing" correctly): fine to ignore here.
      if (NOOP.has(cmd)) return null
      unhandled.set(cmd, (unhandled.get(cmd) ?? 0) + 1)
      renderDev()
      return null
  }
}

let popupWatch = false
let edgeLightOn = false

function emitDisplays() {
  tell('displays://changed', null)
}

/** Dock auto-hide: the real engine reports the pointer near the bottom edge; the host does the same. */
function applyDockMode() {
  /* the dock itself decides from `dock.autoHide`; nothing to move here */
}

/* ------------------------------------------------------------------ messages from the frames */

function fromFrame(source: MessageEventSource | null): Win | undefined {
  return frames().find((w) => w.el.contentWindow === source)
}

window.addEventListener('message', async (e) => {
  const m = e.data as { __udaan?: boolean; type?: string; id?: number; cmd?: string; args?: Record<string, unknown> } & Record<string, unknown>
  if (!m || !m.__udaan) return
  const w = fromFrame(e.source)
  if (!w) return

  if (m.type === 'invoke') {
    try {
      const value = await invokeHost(String(m.cmd), (m.args as Record<string, unknown>) ?? {}, w)
      ;(e.source as Window).postMessage({ __udaan: true, type: 'result', id: m.id, ok: true, value }, '*')
    } catch (err) {
      ;(e.source as Window).postMessage({ __udaan: true, type: 'result', id: m.id, ok: false, error: String(err) }, '*')
    }
  } else if (m.type === 'ptr') {
    const sx = w.rect.x + Number(m.x)
    const sy = w.rect.y + Number(m.y)
    if (m.kind === 'down') {
      if (w.kind === 'app') focusWin(w)
      if (popupWatch && w.kind !== 'taskbar-popup') tell('engine://popup-outside', null, 'taskbar-popup')
    }
    if (m.kind === 'move' && prefs['dock.autoHide'] === 'true') {
      tell('dock://pointer', { x: sx, y: sy >= H - dockBand ? sy - (H - dockBand) : -1 })
    }
  } else if (m.type === 'hello') {
    w.el.contentWindow?.postMessage({ __udaan: true, type: 'geometry', x: Math.round(w.rect.x), y: Math.round(w.rect.y) }, '*')
  } else if (m.type === 'key') {
    functionKey(String(m.key))
  } else if (m.type === 'drag') {
    if (w.maximized && m.phase === 'start') return
    if (m.phase === 'start') w.dragStart = { ...w.rect }
    else if (m.phase === 'move' && w.dragStart) {
      const y = Math.max(reserve.top, w.dragStart.y + Number(m.dy))
      setRect(w, { ...w.dragStart, x: w.dragStart.x + Number(m.dx), y })
    } else if (m.phase === 'end') w.dragStart = null
  }
})

// Clicks that land on the host itself (there are none: the frames cover the screen) are ignored.

/* ------------------------------------------------------------------ dev panel (F2) */

const dev = document.getElementById('dev')!
function renderDev() {
  const rows = [...unhandled].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}  ×${n}`)
  dev.innerHTML = `<h4>Udaan browser preview</h4><div>F1 Start · F2 this panel · add ?reset to the address to forget everything</div><h4>Commands the host does not know yet (${rows.length})</h4><div>${rows.join('\n') || 'none'}</div>`
}
renderDev()
window.addEventListener('keydown', (e) => {
  if (e.key === 'F2') {
    e.preventDefault()
    dev.style.display = dev.style.display === 'block' ? 'none' : 'block'
  } else if (['F1', 'F3'].includes(e.key)) {
    e.preventDefault()
    functionKey(e.key)
  }
})

/** The design gallery: the new popups, notifications, menus and Start, shown over the desktop (below the real bars). */
function toggleGallery() {
  const g = wins.get('gallery')
  if (!g) {
    createFrame('gallery', 'gallery', { x: 0, y: MENU_H, w: W, h: H - MENU_H }, { url: `/web-os/gallery.html?label=gallery&sw=${W}&sh=${H}`, visible: true })
  } else {
    g.visible = !g.visible
    applyVisible(g)
  }
  renderPanel()
}

function setWallpaper(id: string) {
  wallpaper = id
  save('wallpaper', wallpaper)
  tell('wallpaper://changed', wallpaper)
  renderPanel()
}
function functionKey(key: string) {
  if (key === 'F1') tell('shell://hotkey', { id: 'start' })
  else if (key === 'F3') tell('shell://hotkey', { id: 'task-view' })
}

/* ------------------------------------------------------------------ preview controls (the corner button) */

const panel = document.createElement('div')
panel.id = 'panel'
const panelBtn = document.createElement('button')
panelBtn.id = 'panel-btn'
panelBtn.textContent = 'Preview'
panelBtn.title = 'Wallpaper and glass controls'
let panelOpen = false
panelBtn.onclick = () => {
  panelOpen = !panelOpen
  panel.style.display = panelOpen ? 'block' : 'none'
  panelBtn.classList.toggle('on', panelOpen)
}
document.body.append(panel, panelBtn)

function renderPanel() {
  const walls = WALLPAPERS.map((w) => {
    const sel = wallpaper === w.id ? ' sel' : ''
    const style = w.src ? `background-image:url('${w.src}')` : `background:${w.id.slice(6)}`
    return `<button class="wp${sel}" data-wp="${w.id}" title="${w.name}" style="${style}"></button>`
  }).join('')
  panel.innerHTML = `
    <h5>Design gallery</h5><div class="row"><button data-gallery class="${wins.get('gallery')?.visible ? 'sel' : ''}">${wins.get('gallery')?.visible ? 'Hide' : 'Open'} the gallery</button></div>
    <h5>Wallpaper</h5><div class="wps">${walls}</div>
    <div class="hint">The dock and top bar glass is in Settings, under Appearance &amp; Wallpaper. F1 Start · F3 task view · F2 debug</div>`
}
panel.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button')
  if (!t) return
  if (t.dataset.wp) setWallpaper(t.dataset.wp)
  else if (t.hasAttribute('data-gallery')) toggleGallery()

})
renderPanel()
;(window as unknown as { __host: unknown }).__host = { wins, prefs, unhandled, tell }

/* ------------------------------------------------------------------ start up */

// The same set of windows tauri.conf.json declares, created together once the page is ready.
createFrame('main', 'desktop', { x: 0, y: 0, w: W, h: H })
createFrame('menubar', 'menubar', { x: 0, y: 0, w: W, h: MENU_H })
createFrame('taskbar', 'taskbar', { x: 0, y: H - 120, w: 1200, h: 120 })
createFrame('taskbar-popup', 'taskbar-popup', { x: 0, y: 0, w: 1, h: 1 })
createFrame('launcher', 'launcher', { x: 0, y: 0, w: W, h: H })
createFrame('toast', 'toast', { x: W - 400, y: MENU_H + 8, w: 380, h: 120 })
createFrame('edgelight', 'edgelight', { x: 0, y: 0, w: W, h: H })

let resizeTimer: ReturnType<typeof setTimeout> | undefined
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => location.reload(), 500)
})

if (new URLSearchParams(location.search).has('gallery')) toggleGallery()
