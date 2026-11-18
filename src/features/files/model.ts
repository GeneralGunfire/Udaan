import { useSyncExternalStore } from 'react'
import type { Entry } from './api'

/* ── paths ───────────────────────────────────────────────────────── */

export const sep = '\\'
export const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
export function parentOf(p: string): string | null {
  const t = p.replace(/[\\/]+$/, '')
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'))
  if (i < 0) return null
  const up = t.slice(0, i)
  return /^[A-Za-z]:$/.test(up) ? up + '\\' : up || null
}
export const join = (dir: string, name: string) => (dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + sep + name)
export const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
export const driveOf = (p: string) => (/^[A-Za-z]:/.test(p) ? p.slice(0, 2).toUpperCase() : '')

/* ── where a pane is looking ─────────────────────────────────────── */

export type Loc =
  | { kind: 'dir'; path: string }
  | { kind: 'zip'; path: string; inner: string }
  | { kind: 'search'; query: string; root?: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'recent' }
  | { kind: 'bin' }
  | { kind: 'dupes'; root: string }

export const locKey = (l: Loc) => {
  switch (l.kind) {
    case 'dir':
      return 'dir:' + l.path.toLowerCase()
    case 'zip':
      return `zip:${l.path.toLowerCase()}|${l.inner}`
    case 'search':
      return `search:${l.root ?? '*'}|${l.query}`
    case 'tag':
      return 'tag:' + l.tag
    case 'dupes':
      return 'dupes:' + l.root
    default:
      return l.kind
  }
}

export function locTitle(l: Loc): string {
  switch (l.kind) {
    case 'dir':
      return /^[A-Za-z]:\\?$/.test(l.path) ? `Local Disk (${l.path.slice(0, 2)})` : baseName(l.path)
    case 'zip':
      return l.inner ? baseName(l.inner) : baseName(l.path)
    case 'search':
      return `“${l.query}”`
    case 'tag':
      return l.tag
    case 'recent':
      return 'Recent'
    case 'bin':
      return 'Recycle Bin'
    case 'dupes':
      return 'Duplicates'
  }
}

/** A row in any listing. For archive entries `path` is "<zip>|<inner>" and `inner` is set. */
export interface Item {
  name: string
  path: string
  isDir: boolean
  size: number
  modifiedMs: number
  createdMs: number
  ext: string
  hidden?: boolean
  inner?: string
  /** Folder it lives in, shown for search/tag/recent results. */
  where?: string
}

export const fromEntry = (e: Entry): Item => ({ name: e.name, path: e.path, isDir: e.isDir, size: e.size, modifiedMs: e.modifiedMs, createdMs: e.createdMs, ext: e.ext, hidden: e.hidden || e.system })
export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

/* ── kinds ───────────────────────────────────────────────────────── */

export type Kind = 'folder' | 'image' | 'video' | 'audio' | 'doc' | 'sheet' | 'slides' | 'pdf' | 'text' | 'code' | 'archive' | 'app' | 'other'
const K: Record<string, Kind> = {}
const add = (kind: Kind, exts: string) => exts.split(' ').forEach((e) => (K[e] = kind))
add('image', 'png jpg jpeg gif webp bmp svg ico heic avif tif tiff')
add('video', 'mp4 mkv mov avi webm wmv m4v')
add('audio', 'mp3 wav flac ogg m4a aac wma opus')
add('doc', 'doc docx rtf odt')
add('sheet', 'xls xlsx csv ods')
add('slides', 'ppt pptx odp')
add('pdf', 'pdf')
add('text', 'txt md log ini cfg nfo')
add('code', 'rs ts tsx js jsx mjs py c cpp h hpp cs java go json toml yaml yml html css scss xml sh ps1 bat cmd sql lua')
add('archive', 'zip 7z rar tar gz xz bz2')
add('app', 'exe msi lnk appx')
export const kindOf = (ext: string, isDir: boolean): Kind => (isDir ? 'folder' : K[ext] ?? 'other')
export const KIND_LABEL: Record<Kind, string> = { folder: 'Folder', image: 'Image', video: 'Video', audio: 'Audio', doc: 'Document', sheet: 'Spreadsheet', slides: 'Presentation', pdf: 'PDF', text: 'Text', code: 'Code', archive: 'Archive', app: 'Application', other: 'File' }
export const typeLabel = (it: Pick<Item, 'ext' | 'isDir'>) => (it.isDir ? 'Folder' : it.ext ? `${it.ext.toUpperCase()} ${KIND_LABEL[kindOf(it.ext, false)] === 'File' ? 'file' : KIND_LABEL[kindOf(it.ext, false)].toLowerCase()}` : 'File')
export const isPreviewableText = (ext: string) => ['text', 'code'].includes(kindOf(ext, false)) || ext === 'csv'

/* ── formatting ──────────────────────────────────────────────────── */

export function bytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) (v /= 1024), i++
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

export function when(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const now = new Date()
  const day = 86_400_000
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= start) return `Today, ${t}`
  if (ms >= start - day) return `Yesterday, ${t}`
  if (now.getTime() - ms < 6 * day) return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${t}`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
export const fullDate = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/* ── sorting ─────────────────────────────────────────────────────── */

export type SortKey = 'name' | 'modified' | 'size' | 'type'
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export function sortItems(items: Item[], key: SortKey, asc: boolean): Item[] {
  const dir = asc ? 1 : -1
  return [...items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let c = 0
    if (key === 'modified') c = a.modifiedMs - b.modifiedMs
    else if (key === 'size') c = a.size - b.size
    else if (key === 'type') c = collator.compare(a.ext, b.ext)
    return (c || collator.compare(a.name, b.name)) * dir
  })
}

/* ── tiny persistent stores (shared by every tab and pane) ───────── */

function store<T>(key: string, initial: T) {
  let value: T = initial
  try {
    const raw = localStorage.getItem(key)
    if (raw) value = { ...initial, ...JSON.parse(raw) } as T
    if (raw && Array.isArray(initial)) value = JSON.parse(raw) as T
  } catch {
    /* defaults */
  }
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set(next: T | ((v: T) => T)) {
      value = typeof next === 'function' ? (next as (v: T) => T)(value) : next
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* full */
      }
      subs.forEach((s) => s())
    },
    subscribe(cb: () => void) {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
  }
}
export function useStore<T>(s: { get: () => T; subscribe: (cb: () => void) => () => void }): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get)
}

export interface Prefs {
  view: 'list' | 'grid'
  sort: SortKey
  asc: boolean
  hidden: boolean
  extensions: boolean
  inspector: boolean
  sidebar: boolean
  gridSize: number
}
export const prefs = store<Prefs>('files2.prefs', { view: 'list', sort: 'name', asc: true, hidden: false, extensions: true, inspector: true, sidebar: true, gridSize: 112 })

/** Favourites shown under Places in the sidebar. */
export const favourites = store<string[]>('files2.favourites', [])

/** Tags: a small fixed palette of named colours, and path -> tag names. */
export const TAG_COLORS = ['#e5534b', '#e0823d', '#d9b13b', '#4fae5d', '#3072f0', '#2fa39a', '#8b93a1'] as const
export interface TagDef {
  name: string
  color: string
}
export interface TagState {
  defs: TagDef[]
  map: Record<string, string[]>
}
export const tags = store<TagState>('files2.tags', {
  defs: [
    { name: 'Important', color: TAG_COLORS[0] },
    { name: 'Work', color: TAG_COLORS[4] },
    { name: 'Personal', color: TAG_COLORS[3] },
    { name: 'To review', color: TAG_COLORS[2] },
  ],
  map: {},
})
export const tagsOf = (s: TagState, path: string) => s.map[path.toLowerCase()] ?? []
export function setTag(path: string, tag: string, on: boolean) {
  tags.set((s) => {
    const k = path.toLowerCase()
    const cur = new Set(s.map[k] ?? [])
    if (on) cur.add(tag)
    else cur.delete(tag)
    const map = { ...s.map }
    if (cur.size) map[k] = [...cur]
    else delete map[k]
    return { ...s, map }
  })
}
/** Keeps tags attached when items are renamed or moved inside Files. */
export function moveTags(pairs: [string, string][]) {
  const s = tags.get()
  let changed = false
  const map = { ...s.map }
  for (const [from, to] of pairs) {
    const f = from.toLowerCase()
    for (const k of Object.keys(map)) {
      if (k === f || k.startsWith(f + '\\')) {
        map[to.toLowerCase() + k.slice(f.length)] = map[k]
        delete map[k]
        changed = true
      }
    }
  }
  if (changed) tags.set({ ...s, map })
}

/** Files opened from Files, newest first. */
export const recents = store<string[]>('files2.recent', [])
export const noteRecent = (path: string) => recents.set((r) => [path, ...r.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, 60))
