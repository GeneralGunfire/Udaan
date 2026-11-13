/**
 * Persisted taskbar/workspace preferences — thin wrapper over the Rust
 * `taskbar_prefs` module (src-tauri/src/taskbar_prefs/mod.rs).
 */
import { invoke } from '@tauri-apps/api/core'

export interface PinnedApp {
  id: string
  kind: 'builtin' | 'external'
  sortOrder: number
  launchRef: string
  name: string
}

interface RawPinnedApp {
  id: string
  kind: string
  sort_order: number
  launch_ref: string
  name: string
}

function fromRaw(raw: RawPinnedApp): PinnedApp {
  return { id: raw.id, kind: raw.kind as PinnedApp['kind'], sortOrder: raw.sort_order, launchRef: raw.launch_ref, name: raw.name }
}

function toRaw(item: PinnedApp): RawPinnedApp {
  return { id: item.id, kind: item.kind, sort_order: item.sortOrder, launch_ref: item.launchRef, name: item.name }
}

export async function listPinnedApps(): Promise<PinnedApp[]> {
  const raw = await invoke<RawPinnedApp[]>('taskbar_prefs_list_pinned')
  return raw.map(fromRaw)
}

export async function setPinnedApps(items: PinnedApp[]): Promise<void> {
  await invoke('taskbar_prefs_set_pinned', { items: items.map(toRaw) })
}

export async function getTaskbarPref(key: string): Promise<string | null> {
  return invoke<string | null>('taskbar_prefs_get', { key })
}

export async function setTaskbarPref(key: string, value: string): Promise<void> {
  await invoke('taskbar_prefs_set', { key, value })
}
