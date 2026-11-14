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

/** Every visible, titled, non-tool top-level window currently open on the desktop. */
export async function listOpenWindows(): Promise<OpenWindow[]> {
  const raw = await invoke<RawOpenWindow[]>('taskbar_list_windows')
  return raw.map(fromRaw)
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
