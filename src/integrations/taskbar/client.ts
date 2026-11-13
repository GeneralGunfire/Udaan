/**
 * Windows taskbar replacement — thin wrapper over the Rust `taskbar`
 * module (src-tauri/src/taskbar/mod.rs). Only ever called from the
 * dedicated taskbar window (see src/features/taskbar/TaskbarWindow.tsx),
 * never from the main app window.
 */
import { invoke } from '@tauri-apps/api/core'

export interface OpenWindow {
  handle: number
  title: string
  processName: string
  isMinimized: boolean
  /** `data:image/png;base64,...` of the window's real icon, or null if extraction failed. */
  iconDataUrl: string | null
}

interface RawOpenWindow {
  handle: number
  title: string
  process_name: string
  is_minimized: boolean
  icon_data_url: string | null
}

function fromRaw(raw: RawOpenWindow): OpenWindow {
  return {
    handle: raw.handle,
    title: raw.title,
    processName: raw.process_name,
    isMinimized: raw.is_minimized,
    iconDataUrl: raw.icon_data_url,
  }
}

export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right'

export interface AppbarRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Every visible, titled, non-tool top-level window currently open on the desktop. */
export async function listOpenWindows(): Promise<OpenWindow[]> {
  const raw = await invoke<RawOpenWindow[]>('taskbar_list_windows')
  return raw.map(fromRaw)
}

/** Brings a window to the foreground, restoring it first if minimized. */
export async function focusWindow(handle: number): Promise<void> {
  await invoke('taskbar_focus_window', { handle })
}

export async function minimizeWindow(handle: number): Promise<void> {
  await invoke('taskbar_minimize_window', { handle })
}

/** Closes a window via WM_CLOSE — same effect as clicking its own titlebar X (may prompt "save changes?" first, that's expected, not a bug). */
export async function closeWindow(handle: number): Promise<void> {
  await invoke('taskbar_close_window', { handle })
}

/** Screen-relative physical-pixel cursor position `[x, y]` — backs the taskbar dock's auto-hide reveal-on-approach. */
export async function cursorPosition(): Promise<[number, number]> {
  return invoke<[number, number]>('taskbar_cursor_position')
}

/** The handle of whichever window currently has focus, for active-entry highlighting. */
export async function foregroundWindow(): Promise<number> {
  return invoke<number>('taskbar_foreground_window')
}

/** Registers the CALLING window as a real Windows AppBar, reserving `thicknessPx` of `edge`. Must be called from the taskbar window itself — the Rust side resolves the HWND from whichever window invoked it. */
export async function registerAppbar(edge: ScreenEdge, thicknessPx: number): Promise<AppbarRect> {
  return invoke<AppbarRect>('taskbar_register_appbar', { edge, thicknessPx })
}

/** Unregisters the calling window's appbar registration. */
export async function unregisterAppbar(): Promise<void> {
  await invoke('taskbar_unregister_appbar')
}

/** Hides the real Windows taskbar (Explorer's Shell_TrayWnd) — a plain window-visibility toggle, not the actual shell switch, fully reversible via `showWindowsTaskbar`. */
export async function hideWindowsTaskbar(): Promise<void> {
  await invoke('taskbar_hide_windows_taskbar')
}

export async function showWindowsTaskbar(): Promise<void> {
  await invoke('taskbar_show_windows_taskbar')
}

/** Re-asserts the CALLING window's topmost z-order — call periodically, not once, since Explorer's own taskbar is also topmost and can still win transient z-order fights against a window that was only made topmost at creation. */
export async function forceTopmost(): Promise<void> {
  await invoke('taskbar_force_topmost')
}

export interface ThumbnailRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Registers a live DWM thumbnail of `sourceHandle` (a real app window) into
 * the CALLING window (must be the taskbar-popup window) at `rect` (in the
 * popup's own client coordinates), and returns an opaque thumbnail id to
 * pass to `updateThumbnail`/`unregisterThumbnail`. Rejects if DWM can't
 * register it (source window closed, composition off, access denied) —
 * callers must catch this and fall back to an icon/title-only row rather
 * than treat it as fatal.
 */
export async function registerThumbnail(sourceHandle: number, rect: ThumbnailRect): Promise<number> {
  return invoke<number>('taskbar_register_thumbnail', {
    sourceHandle,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  })
}

/** Re-sizes/repositions an already-registered thumbnail — cheaper than unregister+register on every reflow. */
export async function updateThumbnail(thumb: number, rect: ThumbnailRect, opacity = 255): Promise<void> {
  await invoke('taskbar_update_thumbnail', {
    thumb,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    opacity: Math.round(Math.max(0, Math.min(255, opacity))),
  })
}

/** Unregisters one thumbnail by its SOURCE window handle (not the thumbnail id) — safe to call even if it was never registered or already unregistered. */
export async function unregisterThumbnail(sourceHandle: number): Promise<void> {
  await invoke('taskbar_unregister_thumbnail', { sourceHandle })
}

/** Unregisters every currently-tracked thumbnail — defensive sweep called on popup hide, belt-and-suspenders alongside per-window unregisterThumbnail calls. */
export async function unregisterAllThumbnails(): Promise<void> {
  await invoke('taskbar_unregister_all_thumbnails')
}
