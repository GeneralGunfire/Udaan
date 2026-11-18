import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
import { DEFAULT_INSTALLED } from './services'
import { keyOf, type Library, type ListItem, type Status, type Title } from './types'

/**
 * The TV library: installed apps, recent apps and the watch list. One JSON file written by Rust, so it
 * survives a cleared webview. Nothing can change until it has loaded (`ready`), so an early click can't
 * be overwritten by the load. Saves are debounced.
 */

const DEFAULT: Library = { v: 2, installed: DEFAULT_INSTALLED, recent: [], provider: 'netflix', items: {} }

let state: Library = DEFAULT
let loaded = false
let snap = { lib: state, ready: false }
const subs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

const emit = () => {
  snap = { lib: state, ready: loaded }
  subs.forEach((s) => s())
}
const save = () => {
  clearTimeout(timer)
  timer = setTimeout(() => void invoke('tv_library_set', { json: JSON.stringify(state) }).catch(() => {}), 400)
}
const change = (fn: (l: Library) => Library) => {
  if (!loaded) return
  state = fn(state)
  emit()
  save()
}

/** What the old TV kept in localStorage, carried over once. */
function fromOldStorage(): Library {
  const out: Library = { ...DEFAULT, v: 1 }
  try {
    const inst = JSON.parse(localStorage.getItem('tv.installed.v2') ?? 'null')
    if (Array.isArray(inst)) out.installed = inst.filter((x) => typeof x === 'string')
    const rec = JSON.parse(localStorage.getItem('tv.recent') ?? '[]')
    if (Array.isArray(rec)) out.recent = rec.filter((x) => typeof x === 'string')
  } catch {
    /* defaults */
  }
  return out
}

export async function loadLibrary() {
  if (loaded) return
  let next: Library
  try {
    const raw = await invoke<string>('tv_library_get')
    next = raw ? { ...DEFAULT, ...JSON.parse(raw) } : fromOldStorage()
  } catch {
    next = fromOldStorage()
  }
  // Netflix joins everyone's apps, once.
  if ((next.v ?? 1) < 2) {
    next = { ...next, v: 2, installed: next.installed.includes('netflix') ? next.installed : ['netflix', ...next.installed] }
  }
  state = next
  loaded = true
  emit()
  save()
}

export const useLibrary = () =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => snap,
  )

export const tvLib = {
  toggleInstalled: (id: string) => change((l) => ({ ...l, installed: l.installed.includes(id) ? l.installed.filter((x) => x !== id) : [...l.installed, id] })),
  noteRecent: (id: string) => change((l) => ({ ...l, recent: [id, ...l.recent.filter((x) => x !== id)].slice(0, 6) })),
  setProvider: (id: string) => change((l) => ({ ...l, provider: id })),
  /** Adds the title to the list (as "want to watch") or updates what is kept about it. */
  put: (t: Title, patch: Partial<ListItem> = {}) =>
    change((l) => {
      const k = keyOf(t)
      const now = Date.now()
      const base: ListItem = l.items[k] ?? { ...t, status: 'want', addedMs: now, updatedMs: now }
      return { ...l, items: { ...l.items, [k]: { ...base, ...patch, updatedMs: now } } }
    }),
  remove: (t: Pick<Title, 'kind' | 'id'>) =>
    change((l) => {
      const items = { ...l.items }
      delete items[keyOf(t)]
      return { ...l, items }
    }),
}

export const STATUS_LABEL: Record<Status, string> = { want: 'Want to watch', watching: 'Watching', watched: 'Watched' }
