import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { getTaskbarPref, setTaskbarPref } from '@/integrations/taskbar-prefs/client'
import { APP_DEFS, isAppId, type AppArgsMap, type AppId } from './registry'

export interface ShellWindow {
  handle: number
  title: string
  processName: string
  exePath: string | null
  isMinimized: boolean
  isMaximized: boolean
  /** Set when this is one of Udaan's own app windows. */
  appId: AppId | null
}

export interface ShellSnapshot {
  windows: ShellWindow[]
  foreground: number
  fullscreen: boolean
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export type HotkeyId =
  | 'start'
  | 'show-desktop'
  | 'file-explorer'
  | 'quick-settings'
  | 'notifications'
  | 'search'
  | 'next-app-window'
  | 'task-view'
  | 'snap-layouts'
  | 'corner-tl'
  | 'corner-tr'
  | 'corner-bl'
  | 'corner-br'
  | 'prev-app-window'
  | 'desktop-next'
  | 'desktop-prev'
  | 'switcher-ctrl'
  | `dock-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const shell = {
  snapshot: () => invoke<ShellSnapshot>('shell_snapshot'),
  focus: (handle: number) => invoke<void>('shell_focus_window', { handle }),
  minimize: (handle: number) => invoke<void>('shell_minimize_window', { handle }),
  toggleMaximize: (handle: number) => invoke<void>('shell_toggle_maximize_window', { handle }),
  close: (handle: number) => invoke<void>('shell_close_window', { handle }),
  toggleDesktop: () => invoke<boolean>('shell_toggle_desktop'),
  setExplorerChromeHidden: (hidden: boolean) => invoke<void>('shell_set_explorer_chrome_hidden', { hidden }),
  setKeyboardHook: (enabled: boolean) => invoke<void>('shell_set_keyboard_hook', { enabled }),
  /** WebView2 trims this window's memory while it sits hidden. */
  setMemoryLow: (low: boolean) => invoke<void>('shell_set_webview_memory_low', { low }).catch(() => {}),
  monitorOf: () => invoke<[Rect, Rect]>('shell_monitor_of'),
  autostartEnabled: () => invoke<boolean>('shell_autostart_enabled'),
  setHotCorners: (enabled: boolean) => invoke<void>('shell_set_hot_corners', { enabled }),
  setAutostart: (enabled: boolean) => invoke<void>('shell_set_autostart', { enabled }),
  takeAppArgs: () => invoke<string | null>('shell_take_app_args'),
  fileIcons: (paths: string[]) => invoke<Record<string, string | null>>('shell_file_icons', { paths }),
  windowIcons: (handles: number[]) => invoke<Record<string, string | null>>('shell_window_icons', { handles }),
  resolveLaunch: (exes: string[]) => invoke<Record<string, string | null>>('shell_resolve_launch', { exes }),
  appNames: (paths: string[]) => invoke<Record<string, string>>('shell_app_names', { paths }),
  invalidateIcon: (path: string) => invoke<void>('shell_invalidate_icon', { path }),
  recycle: (paths: string[]) => invoke<void>('shell_recycle', { paths }),
  recycleBinInfo: () => invoke<{ itemCount: number }>('shell_recycle_bin_info'),
  emptyRecycleBin: () => invoke<void>('shell_empty_recycle_bin'),
  watchDirs: (dirs: string[]) => invoke<void>('shell_watch_dirs', { dirs }),
  clipboardSetFiles: (paths: string[], cut: boolean) => invoke<void>('shell_clipboard_set_files', { paths, cut }),
  invokeVerb: (path: string, verb: 'open' | 'properties' | 'openas' | 'runas' | 'edit' | 'print' | 'explore') =>
    invoke<void>('shell_invoke_verb', { path, verb }),
  idleMs: () => invoke<number>('shell_idle_ms'),
  clipboardGetFiles: () => invoke<{ paths: string[]; cut: boolean }>('shell_clipboard_get_files'),
  setWindowsHidden: (hide: number[], show: number[], focusAfter: number | null) =>
    invoke<void>('shell_set_windows_hidden', { hide, show, focusAfter }),
}

export function onDirChanged(handler: (dir: string) => void): Promise<UnlistenFn> {
  return listen<{ dir: string }>('shell://dir-changed', (e) => handler(e.payload.dir))
}

// --- Live mirror of the Rust window registry -----------------------------

interface ShellState extends ShellSnapshot {
  ready: boolean
}

export const useShell = create<ShellState>(() => ({ windows: [], foreground: 0, fullscreen: false, ready: false }))

let subscribed: Promise<UnlistenFn> | null = null

function normalize(snap: ShellSnapshot): ShellSnapshot {
  return {
    ...snap,
    windows: snap.windows.map((w) => ({ ...w, appId: isAppId(w.appId) ? w.appId : null })),
  }
}

/** Idempotent: every webview that needs the window list calls this once. */
export function subscribeShell(): void {
  if (subscribed || !inTauri) return
  subscribed = listen<ShellSnapshot>('shell://snapshot', (e) => {
    useShell.setState({ ...normalize(e.payload), ready: true })
  })
  // Focus changes arrive as a tiny event without the window list.
  void listen<{ foreground: number; fullscreen: boolean }>('shell://foreground', (e) => {
    useShell.setState({ foreground: e.payload.foreground, fullscreen: e.payload.fullscreen })
  })
  void shell
    .snapshot()
    .then((snap) => useShell.setState({ ...normalize(snap), ready: true }))
    .catch((err) => console.error('[shell] snapshot failed', err))
}

export function onHotkey(handler: (id: HotkeyId) => void): Promise<UnlistenFn> {
  return listen<{ id: HotkeyId }>('shell://hotkey', (e) => handler(e.payload.id))
}

// --- Launching Udaan apps --------------------------------------------------

interface SavedBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

// v2: windows open larger now; older, smaller saved sizes are dropped once.
const boundsKey = (id: AppId) => `window-bounds.v2:${id}`

export async function loadBounds(id: AppId): Promise<SavedBounds | null> {
  try {
    const raw = await getTaskbarPref(boundsKey(id))
    return raw ? (JSON.parse(raw) as SavedBounds) : null
  } catch {
    return null
  }
}

export function saveBounds(id: AppId, bounds: SavedBounds): Promise<void> {
  return setTaskbarPref(boundsKey(id), JSON.stringify(bounds))
}

export async function openApp<Id extends AppId>(id: Id, args?: Partial<AppArgsMap[Id]>): Promise<void> {
  const def = APP_DEFS[id]
  const saved = await loadBounds(id)
  // A generous default: most of the screen, never less than the app's own size.
  const width = Math.max(def.size.width, Math.round(window.screen.availWidth * 0.72))
  const height = Math.max(def.size.height, Math.round(window.screen.availHeight * 0.8))
  await invoke('shell_open_app', {
    req: {
      appId: id,
      title: def.name,
      // Saved sizes from a bigger monitor are shrunk to fit this one.
      width: Math.min(saved?.width ?? width, window.screen.availWidth - 80),
      height: Math.min(saved?.height ?? height, window.screen.availHeight - 60),
      minWidth: Math.min(def.minSize.width, window.screen.availWidth - 80),
      minHeight: Math.min(def.minSize.height, window.screen.availHeight - 60),
      // A saved spot that's off this screen (another monitor, other resolution) is dropped: centre instead.
      x: saved && saved.x >= 0 && saved.x + 100 < window.screen.availWidth ? saved.x : null,
      y: saved && saved.y >= 0 && saved.y + 60 < window.screen.availHeight ? saved.y : null,
      maximized: saved?.maximized ?? false,
      args: args ? JSON.stringify(args) : null,
    },
  })
}

/** Groups windows the way the dock shows them: by Udaan app, else by executable. */
export function groupKeyOf(w: ShellWindow): string {
  if (w.appId) return `app:${w.appId}`
  return `exe:${w.processName.toLowerCase()}`
}
