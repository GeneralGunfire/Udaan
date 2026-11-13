import { invoke } from '@tauri-apps/api/core'

export interface NoteMeta {
  id: string
  title: string
  /** Tab order, ascending. */
  position: number
  createdAt: string
}

interface RawNoteMeta {
  id: string
  title: string
  position: number
  created_at: string
}

function fromRaw(raw: RawNoteMeta): NoteMeta {
  return { id: raw.id, title: raw.title, position: raw.position, createdAt: raw.created_at }
}

function toRaw(meta: NoteMeta): RawNoteMeta {
  return { id: meta.id, title: meta.title, position: meta.position, created_at: meta.createdAt }
}

/** All notes (tab metadata only — not bodies), in tab order. */
export async function listNotes(): Promise<NoteMeta[]> {
  const raw = await invoke<RawNoteMeta[]>('notes_list')
  return raw.map(fromRaw)
}

/** One note's plain-text body — empty string if it hasn't been saved yet. */
export async function readNoteBody(id: string): Promise<string> {
  return invoke<string>('notes_read_body', { id })
}

/** Registers a new note's tab metadata (call once, before its first body save). */
export async function createNote(meta: NoteMeta): Promise<void> {
  await invoke('notes_create', { note: toRaw(meta) })
}

/** Writes a note's body and its derived title in one call — used by the debounced autosave. */
export async function saveNoteBody(id: string, title: string, body: string): Promise<void> {
  await invoke('notes_save_body', { id, title, body })
}

/** Deletes a note's tab metadata and body file. */
export async function deleteNote(id: string): Promise<void> {
  await invoke('notes_delete', { id })
}

/** Persists tab order — call whenever the open-tab list changes. */
export async function setNotesOrder(orderedIds: string[]): Promise<void> {
  await invoke('notes_set_order', { orderedIds })
}

/** The last-active tab id, or null if none/never set. */
export async function getActiveNote(): Promise<string | null> {
  return invoke<string | null>('notes_get_active')
}

/** Persists which tab is active — call on every tab switch. */
export async function setActiveNote(id: string | null): Promise<void> {
  await invoke('notes_set_active', { id })
}
