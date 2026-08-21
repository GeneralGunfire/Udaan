import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ClipboardEntry, ClipboardEntryKind } from './types'

/** Raw shape returned by Rust (serde snake_case). */
interface RawClipboardEntry {
  id: string
  kind: string
  content: string
  preview: string
  created_at: string
}

function fromRaw(raw: RawClipboardEntry): ClipboardEntry {
  return {
    id: raw.id,
    kind: raw.kind === 'image' ? 'image' : 'text',
    content: raw.content,
    preview: raw.preview,
    createdAt: raw.created_at,
  }
}

export async function listClipboardHistory(): Promise<ClipboardEntry[]> {
  const raw = await invoke<RawClipboardEntry[]>('clipboard_manager_list')
  return raw.map(fromRaw)
}

export async function deleteClipboardEntry(id: string): Promise<void> {
  await invoke('clipboard_manager_delete', { id })
}

export async function clearClipboardHistory(): Promise<void> {
  await invoke('clipboard_manager_clear')
}

/** Re-copies a stored entry back onto the system clipboard. */
export async function restoreClipboardEntry(kind: ClipboardEntryKind, content: string): Promise<void> {
  await invoke('clipboard_manager_restore', { kind, content })
}

/** Fires whenever the background watcher records a new clipboard entry (new text copy or new image copy). */
export async function onClipboardChanged(
  callback: (entry: ClipboardEntry) => void,
): Promise<() => void> {
  const unlisten = await listen<RawClipboardEntry>('clipboard://changed', (event) => {
    callback(fromRaw(event.payload))
  })
  return unlisten
}
