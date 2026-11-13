/**
 * System-wide "always maximize new windows" toggle — thin wrapper over
 * the Rust `window_watcher` module (src-tauri/src/window_watcher/mod.rs),
 * a background WinEvent hook that maximizes every new top-level window
 * from ANY app, not just Udaan's own.
 */
import { invoke } from '@tauri-apps/api/core'

export interface WindowWatcherStatus {
  enabled: boolean
}

export async function setWindowWatcherEnabled(enabled: boolean): Promise<WindowWatcherStatus> {
  return invoke<WindowWatcherStatus>('window_watcher_set_enabled', { enabled })
}

export async function windowWatcherStatus(): Promise<WindowWatcherStatus> {
  return invoke<WindowWatcherStatus>('window_watcher_status')
}
