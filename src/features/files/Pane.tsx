import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useShellMenu, type ShellMenuItemDef } from '@/os/ui/useShellMenu'
import { getHandlersForExtension, openFileWith } from '@/integrations/installed-apps/client'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/os/ui/controls'
import { errorText, fs, on, type ArchiveEntry, type IndexStatus } from './api'
import {
  baseName,
  extOf,
  favourites,
  fromEntry,
  join,
  locKey,
  noteRecent,
  parentOf,
  prefs,
  recents,
  setTag,
  sortItems,
  tags,
  tagsOf,
  typeLabel,
  useStore,
  bytes,
  when,
  type Item,
  type Loc,
  type SortKey,
} from './model'
import * as ops from './ops'
import { clipBus } from './ops'
import { dragBus, dropTargetAt, FileIcon, Glyph, TagDot, Thumb, useBus } from './ui'

/* ── which folders are on screen, so Rust can watch exactly those ── */

const shown = new Map<number, string>()
let watchTimer: ReturnType<typeof setTimeout> | undefined
function syncWatch() {
  clearTimeout(watchTimer)
  watchTimer = setTimeout(() => void fs.watch([...new Set(shown.values())]).catch(() => {}), 250)
}
let paneSeq = 0

/* ── archive cache ───────────────────────────────────────────────── */

const zipCache = new Map<string, Promise<ArchiveEntry[]>>()
const zipEntries = (path: string) => {
  const k = path.toLowerCase()
  if (!zipCache.has(k)) zipCache.set(k, fs.zipList(path).catch((e) => (zipCache.delete(k), Promise.reject(e))))
  return zipCache.get(k)!
}

/* ── loading what a location shows ───────────────────────────────── */

interface Loaded {
  items: Item[]
  loading: boolean
  error: string | null
  index?: IndexStatus
  total?: number
}

function useItems(loc: Loc, tick: number): Loaded {
  const [state, setState] = useState<Loaded>({ items: [], loading: true, error: null })
  const tagState = useStore(tags)
  const recentList = useStore(recents)
  const tagKey = loc.kind === 'tag' ? JSON.stringify(Object.entries(tagState.map).filter(([, t]) => t.includes(loc.tag))) : ''
  const recentKey = loc.kind === 'recent' ? recentList.join('|') : ''
  const key = locKey(loc)
  const prevKey = useRef('')

  useEffect(() => {
    let live = true
    const fresh = prevKey.current !== key
    prevKey.current = key
    if (fresh) setState({ items: [], loading: true, error: null })
    const done = (p: Promise<Partial<Loaded>>) =>
      p.then(
        (r) => live && setState({ items: [], loading: false, error: null, ...r }),
        (e) => live && setState({ items: [], loading: false, error: errorText(e) }),
      )
    const withWhere = (list: Item[]) => list.map((i) => ({ ...i, where: parentOf(i.path) ?? '' }))
    const statPaths = (paths: string[]) => fs.stat(paths).then((r) => withWhere(r.filter((x): x is NonNullable<typeof x> => !!x).map(fromEntry)))

    switch (loc.kind) {
      case 'dir':
        done(fs.list(loc.path).then((l) => ({ items: l.map(fromEntry) })))
        break
      case 'zip':
        done(
          zipEntries(loc.path).then((all) => {
            const prefix = loc.inner ? loc.inner + '/' : ''
            const items: Item[] = all
              .filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/') && e.path.length > prefix.length)
              .map((e) => {
                const name = e.path.slice(prefix.length)
                return { name, path: `${loc.path}|${e.path}`, inner: e.path, isDir: e.isDir, size: e.size, modifiedMs: e.modifiedMs, createdMs: e.modifiedMs, ext: e.isDir ? '' : extOf(name) }
              })
            return { items }
          }),
        )
        break
      case 'search':
        if (!loc.query.trim()) done(Promise.resolve({ items: [] }))
        else if (loc.root)
          done(
            invoke<{ name: string; path: string; is_dir: boolean; size_bytes: number; modified_ms: number; created_ms: number; extension: string }[]>('file_explorer_search', { dirPath: loc.root, query: loc.query, recursive: true }).then((r) => ({
              items: withWhere(r.map((x) => ({ name: x.name, path: x.path, isDir: x.is_dir, size: x.size_bytes, modifiedMs: x.modified_ms, createdMs: x.created_ms, ext: x.extension }))),
            })),
          )
        else
          done(
            fs.indexQuery(loc.query, 500).then((r) => ({
              items: r.hits.map((h) => ({ name: h.name, path: h.path, isDir: h.isDir, size: h.size, modifiedMs: h.modifiedMs, createdMs: h.modifiedMs, ext: h.isDir ? '' : extOf(h.name), where: parentOf(h.path) ?? '' })),
              index: r.status,
              total: r.total,
            })),
          )
        break
      case 'tag':
        done(statPaths(Object.entries(tags.get().map).filter(([, t]) => t.includes(loc.tag)).map(([p]) => p)).then((items) => ({ items })))
        break
      case 'recent':
        done(statPaths(recents.get()).then((items) => ({ items: items.map((i, n) => ({ ...i, createdMs: -n })) })))
        break
      default:
        done(Promise.resolve({ items: [] }))
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, tagKey, recentKey])
  return state
}

/* ── the pane ────────────────────────────────────────────────────── */

export interface PaneApi {
  focus: () => void
  newFolder: () => void
  newFile: (kind: 'text' | 'word' | 'excel' | 'power_point') => void
  selectAll: () => void
  refresh: () => void
  selection: () => Item[]
  batchRename: () => void
}

export interface PaneProps {
  loc: Loc
  active: boolean
  filter: string
  /** The other pane's folder in a split, for F5 / F6. */
  otherDir: string | null
  onActivate: () => void
  onGo: (loc: Loc) => void
  onOpenTab: (loc: Loc) => void
  onOpenOther: ((loc: Loc) => void) | null
  onSelection: (items: Item[], all: Item[]) => void
  onQuickLook: (items: Item[], index: number) => void
  onBatchRename: (items: Item[]) => void
  onIndex?: (s: IndexStatus | undefined, total?: number) => void
}

const ROW = 30
const HEAD = 30

export const Pane = forwardRef<PaneApi, PaneProps>(function Pane(p, ref) {
  const { loc, active, filter } = p
  const pr = useStore(prefs)
  const tagState = useStore(tags)
  const clip = useBus(clipBus)
  const dragging = useBus(dragBus)
  const openMenu = useShellMenu()
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const data = useItems(loc, tick)
  const dir = loc.kind === 'dir' ? loc.path : null
  const zip = loc.kind === 'zip' ? loc : null

  // Live folder: re-list when Rust says this folder changed.
  const id = useRef(++paneSeq).current
  useEffect(() => {
    if (dir) shown.set(id, dir)
    else shown.delete(id)
    syncWatch()
    return () => {
      shown.delete(id)
      syncWatch()
    }
  }, [dir, id])
  useEffect(() => (dir ? on<{ dir: string }>('files://changed', (e) => e.dir.toLowerCase() === dir.toLowerCase().replace(/\\$/, '') && refresh()) : undefined), [dir, refresh])
  useEffect(() => (loc.kind === 'search' && !loc.root ? on<IndexStatus>('files://index', (s) => !s.building && refresh()) : undefined), [loc, refresh])
  useEffect(() => p.onIndex?.(data.index, data.total), [data.index, data.total, p])

  // What is visible: hidden files, the quick filter, then sort.
  const items = useMemo(() => {
    let l = data.items
    if (!pr.hidden) l = l.filter((i) => !i.hidden)
    const f = filter.trim().toLowerCase()
    if (f) l = l.filter((i) => i.name.toLowerCase().includes(f))
    if (loc.kind === 'recent') return [...l].sort((a, b) => b.createdMs - a.createdMs)
    if (loc.kind === 'search' && !loc.root && pr.sort === 'name') return l // index already ranks by relevance
    return sortItems(l, pr.sort, pr.asc)
  }, [data.items, pr.hidden, pr.sort, pr.asc, filter, loc])

  /* selection */
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const anchor = useRef<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const pendingSelect = useRef<string | null>(null)
  const key = locKey(loc)
  useEffect(() => {
    setSel(new Set())
    setCursor(null)
    setRenaming(null)
    anchor.current = null
  }, [key])
  // After a create/rename/paste, select the new item once the listing has it.
  useEffect(() => {
    const want = pendingSelect.current
    if (!want) return
    const hit = items.find((i) => i.path.toLowerCase() === want.toLowerCase())
    if (hit) {
      pendingSelect.current = null
      setSel(new Set([hit.path]))
      setCursor(hit.path)
      anchor.current = hit.path
    }
  }, [items])
  // Drop selected paths that disappeared.
  useEffect(() => {
    setSel((s) => {
      if (!s.size) return s
      const live = new Set(items.map((i) => i.path))
      const n = new Set([...s].filter((x) => live.has(x)))
      return n.size === s.size ? s : n
    })
  }, [items])
  const selected = useMemo(() => items.filter((i) => sel.has(i.path)), [items, sel])
  useEffect(() => p.onSelection(selected, items), [selected, items, p])

  /* geometry + virtualisation */
  const scroller = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState({ top: 0, h: 600, w: 800 })
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setVp({ top: el.scrollTop, h: el.clientHeight, w: el.clientWidth }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const raf = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current
      if (el) setVp((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop }))
    })
  }
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [key])

  const grid = pr.view === 'grid'
  const tileW = pr.gridSize
  const tileH = pr.gridSize + 44
  const cols = grid ? Math.max(1, Math.floor((vp.w - 24 + 8) / (tileW + 8))) : 1
  const cell = (i: number) => (grid ? { x: 12 + (i % cols) * (tileW + 8), y: 12 + Math.floor(i / cols) * (tileH + 8), w: tileW, h: tileH } : { x: 0, y: HEAD + i * ROW, w: vp.w, h: ROW })
  const contentH = grid ? 24 + Math.ceil(items.length / cols) * (tileH + 8) : HEAD + items.length * ROW + 8
  const firstRow = grid ? Math.max(0, Math.floor((vp.top - 12) / (tileH + 8)) - 1) : Math.max(0, Math.floor((vp.top - HEAD) / ROW) - 6)
  const lastRow = grid ? Math.ceil((vp.top + vp.h) / (tileH + 8)) + 1 : Math.ceil((vp.top + vp.h) / ROW) + 6
  const from = firstRow * cols
  const to = Math.min(items.length, (lastRow + 1) * cols)

  const reveal = useCallback(
    (path: string) => {
      const i = items.findIndex((x) => x.path === path)
      const el = scroller.current
      if (i < 0 || !el) return
      const c = cell(i)
      const top = grid ? c.y - 8 : c.y - HEAD
      if (top < el.scrollTop) el.scrollTop = top
      else if (c.y + c.h + 8 > el.scrollTop + el.clientHeight) el.scrollTop = c.y + c.h + 8 - el.clientHeight
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, grid, cols, tileH],
  )

  /* opening */
  const open = useCallback(
    async (it: Item) => {
      if (it.inner !== undefined && zip) {
        if (it.isDir) p.onGo({ kind: 'zip', path: zip.path, inner: it.inner })
        else p.onQuickLook(items.filter((x) => !x.isDir), items.filter((x) => !x.isDir).indexOf(it))
        return
      }
      if (it.isDir) return p.onGo({ kind: 'dir', path: it.path })
      if (it.ext === 'zip') return p.onGo({ kind: 'zip', path: it.path, inner: '' })
      noteRecent(it.path)
      try {
        await fs.open(it.path)
      } catch (e) {
        ops.fail(e)
      }
    },
    [items, p, zip],
  )

  const quickLook = useCallback(() => {
    const files = items
    const cur = items.find((i) => i.path === cursor) ?? selected[0]
    if (!cur) return
    p.onQuickLook(files, files.indexOf(cur))
  }, [items, cursor, selected, p])

  /* actions */
  const paths = () => selected.filter((i) => i.inner === undefined).map((i) => i.path)
  const newFolder = useCallback(async () => {
    if (!dir) return
    const made = await ops.newFolder(dir)
    if (made) {
      pendingSelect.current = made
      refresh()
      setRenaming(made)
    }
  }, [dir, refresh])
  const newFile = useCallback(
    async (kind: 'text' | 'word' | 'excel' | 'power_point') => {
      if (!dir) return
      const made = await ops.newFile(dir, kind)
      if (made) {
        pendingSelect.current = made
        refresh()
        setRenaming(made)
      }
    },
    [dir, refresh],
  )
  const paste = useCallback(
    async (into = dir) => {
      const c = clipBus.get()
      if (!c || !into) return
      await ops.transfer(c.paths, into, c.mode === 'cut' ? 'move' : 'copy')
      if (c.mode === 'cut') clipBus.set(null)
      refresh()
    },
    [dir, refresh],
  )
  const setClip = (mode: 'copy' | 'cut') => {
    const ps = paths()
    if (!ps.length) return
    clipBus.set({ paths: ps, mode })
    ops.toast(`${mode === 'copy' ? 'Copied' : 'Cut'} ${ps.length === 1 ? `“${baseName(ps[0])}”` : `${ps.length} items`}. Paste with Ctrl+V.`)
  }
  const extractSel = async (dest?: string) => {
    if (!zip) return
    const inners = selected.map((i) => i.inner!).filter(Boolean)
    await ops.extract(zip.path, inners.length ? inners : undefined, dest ?? parentOf(zip.path) ?? undefined)
  }
  const commitRename = async (it: Item, name: string) => {
    setRenaming(null)
    const r = await ops.rename(it.path, name)
    if (r) {
      pendingSelect.current = r
      refresh()
    }
  }
  const startRename = () => {
    if (selected.length > 1) return p.onBatchRename(selected)
    const it = selected[0]
    if (it && it.inner === undefined) setRenaming(it.path)
  }

  useImperativeHandle(ref, () => ({
    focus: () => scroller.current?.focus(),
    newFolder: () => void newFolder(),
    newFile: (k) => void newFile(k),
    selectAll: () => setSel(new Set(items.map((i) => i.path))),
    refresh,
    selection: () => selected,
    batchRename: () => p.onBatchRename(selected.length ? selected : items.filter((i) => i.inner === undefined)),
  }))

  /* context menus */
  const itemMenu = async (it: Item, at: { clientX: number; clientY: number }) => {
    const many = sel.has(it.path) ? selected : [it]
    const single = many.length === 1 ? many[0] : null
    const ps = many.map((i) => i.path)
    const m: ShellMenuItemDef[] = []
    if (it.inner !== undefined && zip) {
      m.push({ label: single?.isDir ? 'Open' : 'Quick Look', onSelect: () => void (single?.isDir ? open(single) : quickLook()) })
      m.push({})
      m.push({ label: `Extract ${many.length === 1 ? `“${it.name}”` : `${many.length} items`} next to the archive`, onSelect: () => void extractSel() })
      if (p.otherDir) m.push({ label: 'Extract to the other pane', onSelect: () => void extractSel(p.otherDir!) })
      return openMenu(at, m)
    }
    if (single && !single.isDir) {
      m.push({ label: 'Open', onSelect: () => void open(single) })
      const handlers = await getHandlersForExtension(single.ext).catch(() => [])
      for (const h of handlers.filter((h) => !h.isDefault).slice(0, 4)) m.push({ label: `Open with ${h.name}`, onSelect: () => void openFileWith(h.exePath, single.path).then(() => noteRecent(single.path), ops.fail) })
      m.push({ label: 'Quick Look', onSelect: quickLook })
    } else if (single?.isDir) {
      m.push({ label: 'Open', onSelect: () => void open(single) })
      m.push({ label: 'Open in new tab', onSelect: () => p.onOpenTab({ kind: 'dir', path: single.path }) })
      if (p.onOpenOther) m.push({ label: 'Open in other pane', onSelect: () => p.onOpenOther!({ kind: 'dir', path: single.path }) })
    }
    if (single && loc.kind !== 'dir') m.push({ label: 'Show in its folder', onSelect: () => p.onGo({ kind: 'dir', path: parentOf(single.path) ?? single.path }) })
    m.push({})
    m.push({ label: 'Cut', onSelect: () => setClip('cut') })
    m.push({ label: 'Copy', onSelect: () => setClip('copy') })
    if (single?.isDir && clip) m.push({ label: 'Paste into folder', onSelect: () => void paste(single.path) })
    m.push({ label: 'Duplicate', onSelect: () => void ops.duplicate(ps).then(refresh) })
    if (p.otherDir) {
      m.push({ label: 'Copy to other pane', onSelect: () => void ops.transfer(ps, p.otherDir!, 'copy') })
      m.push({ label: 'Move to other pane', onSelect: () => void ops.transfer(ps, p.otherDir!, 'move') })
    }
    m.push({ label: many.length > 1 ? `Rename ${many.length} items…` : 'Rename', onSelect: () => (many.length > 1 ? p.onBatchRename(many) : setRenaming(it.path)) })
    m.push({})
    if (dir || loc.kind === 'search') m.push({ label: 'Compress to .zip', onSelect: () => void ops.compress(ps, dir ?? parentOf(ps[0])!).then((z) => z && ((pendingSelect.current = z), refresh())) })
    if (single?.ext === 'zip') {
      m.push({ label: 'Browse archive', onSelect: () => p.onGo({ kind: 'zip', path: single.path, inner: '' }) })
      m.push({ label: 'Extract here', onSelect: () => void ops.extract(single.path).then((d) => d && ((pendingSelect.current = d), refresh())) })
    }
    for (const t of tagState.defs) {
      const has = many.every((i) => tagsOf(tagState, i.path).includes(t.name))
      m.push({ label: `${has ? '✓ ' : ''}Tag: ${t.name}`, onSelect: () => many.forEach((i) => setTag(i.path, t.name, !has)) })
    }
    if (single?.isDir) {
      const fav = favourites.get().some((f) => f.toLowerCase() === single.path.toLowerCase())
      m.push({ label: fav ? 'Remove from Favourites' : 'Add to Favourites', onSelect: () => favourites.set((l) => (fav ? l.filter((f) => f.toLowerCase() !== single.path.toLowerCase()) : [...l, single.path])) })
    }
    m.push({})
    m.push({ label: many.length > 1 ? 'Copy paths' : 'Copy path', onSelect: () => void ops.copyText(ps.join('\r\n'), many.length > 1 ? 'Paths copied' : 'Path copied') })
    if (single) m.push({ label: 'Show in Windows Explorer', onSelect: () => void fs.reveal(single.path).catch(ops.fail) })
    if (single?.isDir) m.push({ label: 'Open terminal here', onSelect: () => void fs.terminal(single.path).catch(ops.fail) })
    m.push({})
    m.push({ label: 'Move to Recycle Bin', danger: true, onSelect: () => void ops.recycle(ps).then(refresh) })
    m.push({ label: 'Delete permanently…', danger: true, onSelect: () => void ops.deleteForever(ps).then(refresh) })
    openMenu(at, m)
  }

  const backgroundMenu = (at: { clientX: number; clientY: number }) => {
    const sorts: [SortKey, string][] = [
      ['name', 'Name'],
      ['modified', 'Date modified'],
      ['size', 'Size'],
      ['type', 'Type'],
    ]
    const m: ShellMenuItemDef[] = []
    if (dir) {
      m.push({ label: 'New folder', onSelect: () => void newFolder() })
      m.push({ label: 'New text document', onSelect: () => void newFile('text') })
      m.push({ label: 'New Word document', onSelect: () => void newFile('word') })
      m.push({ label: 'New Excel workbook', onSelect: () => void newFile('excel') })
      m.push({ label: 'New PowerPoint presentation', onSelect: () => void newFile('power_point') })
      m.push({})
      m.push({ label: clip ? `Paste ${clip.paths.length === 1 ? `“${baseName(clip.paths[0])}”` : `${clip.paths.length} items`}` : 'Paste', disabled: !clip, onSelect: () => void paste() })
      m.push({})
    }
    if (zip) {
      m.push({ label: 'Extract everything next to the archive', onSelect: () => void ops.extract(zip.path) })
      m.push({})
    }
    m.push({ label: 'Select all', onSelect: () => setSel(new Set(items.map((i) => i.path))) })
    for (const [k, l] of sorts) m.push({ label: `${pr.sort === k ? (pr.asc ? '↑ ' : '↓ ') : ''}Sort by ${l.toLowerCase()}`, onSelect: () => prefs.set((s) => ({ ...s, sort: k, asc: s.sort === k ? !s.asc : k === 'name' || k === 'type' })) })
    m.push({ label: pr.view === 'list' ? 'View as icons' : 'View as list', onSelect: () => prefs.set((s) => ({ ...s, view: s.view === 'list' ? 'grid' : 'list' })) })
    m.push({ label: `${pr.hidden ? '✓ ' : ''}Show hidden items`, onSelect: () => prefs.set((s) => ({ ...s, hidden: !s.hidden })) })
    if (dir) {
      m.push({})
      m.push({ label: 'Rename items in this folder…', onSelect: () => p.onBatchRename(items) })
      m.push({ label: 'Find duplicates in this folder', onSelect: () => p.onGo({ kind: 'dupes', root: dir }) })
      m.push({ label: 'Open terminal here', onSelect: () => void fs.terminal(dir).catch(ops.fail) })
      m.push({ label: 'Copy folder path', onSelect: () => void ops.copyText(dir, 'Path copied') })
      m.push({ label: 'Show in Windows Explorer', onSelect: () => void fs.reveal(dir).catch(ops.fail) })
    }
    m.push({ label: 'Refresh', onSelect: refresh })
    openMenu(at, m)
  }

  /* keyboard */
  const typeAhead = useRef({ text: '', t: 0 as unknown as ReturnType<typeof setTimeout> })
  const moveCursor = (delta: number, extend: boolean, absolute?: number) => {
    if (!items.length) return
    const at = items.findIndex((i) => i.path === cursor)
    const n = absolute !== undefined ? absolute : at < 0 ? 0 : Math.min(items.length - 1, Math.max(0, at + delta))
    const target = items[n].path
    setCursor(target)
    if (extend && anchor.current) {
      const a = items.findIndex((i) => i.path === anchor.current)
      const [lo, hi] = a < n ? [a, n] : [n, a]
      setSel(new Set(items.slice(lo, hi + 1).map((i) => i.path)))
    } else {
      anchor.current = target
      setSel(new Set([target]))
    }
    reveal(target)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).tagName === 'INPUT') return
    const k = e.key
    const ctrl = e.ctrlKey || e.metaKey
    const handled = () => (e.preventDefault(), e.stopPropagation())
    const page = Math.max(1, Math.floor(vp.h / (grid ? tileH + 8 : ROW)) - 1) * cols
    if (k === 'ArrowDown') return handled(), moveCursor(grid ? cols : 1, e.shiftKey)
    if (k === 'ArrowUp' && !e.altKey) return handled(), moveCursor(grid ? -cols : -1, e.shiftKey)
    if (k === 'ArrowRight' && grid) return handled(), moveCursor(1, e.shiftKey)
    if (k === 'ArrowLeft' && grid) return handled(), moveCursor(-1, e.shiftKey)
    if (k === 'PageDown') return handled(), moveCursor(page, e.shiftKey)
    if (k === 'PageUp') return handled(), moveCursor(-page, e.shiftKey)
    if (k === 'Home') return handled(), moveCursor(0, e.shiftKey, 0)
    if (k === 'End') return handled(), moveCursor(0, e.shiftKey, items.length - 1)
    if (k === 'Enter' && e.altKey) return handled(), prefs.set((s) => ({ ...s, inspector: true }))
    if (k === 'Enter') {
      handled()
      if (selected.length === 1) void open(selected[0])
      else selected.filter((i) => !i.isDir).forEach((i) => void open(i))
      return
    }
    if (k === ' ' && !ctrl) return handled(), quickLook()
    if (k === 'F2') return handled(), startRename()
    if (k === 'Delete') return handled(), void (e.shiftKey ? ops.deleteForever(paths()) : ops.recycle(paths())).then(refresh)
    if (ctrl && k.toLowerCase() === 'a') return handled(), setSel(new Set(items.map((i) => i.path)))
    if (ctrl && e.shiftKey && k.toLowerCase() === 'c') return handled(), void ops.copyText(paths().join('\r\n'), 'Path copied')
    if (ctrl && k.toLowerCase() === 'c') return handled(), setClip('copy')
    if (ctrl && k.toLowerCase() === 'x') return handled(), setClip('cut')
    if (ctrl && k.toLowerCase() === 'v') return handled(), void paste()
    if (ctrl && e.shiftKey && k.toLowerCase() === 'n') return handled(), void newFolder()
    if (ctrl && k.toLowerCase() === 'd') return handled(), void ops.duplicate(paths()).then(refresh)
    if (k === 'F5' && p.otherDir && selected.length) return handled(), void ops.transfer(paths(), p.otherDir, 'copy')
    if (k === 'F6' && p.otherDir && selected.length) return handled(), void ops.transfer(paths(), p.otherDir, 'move')
    if (k === 'F5' || (ctrl && k.toLowerCase() === 'r')) return handled(), refresh()
    if (k === 'Escape' && sel.size) return handled(), setSel(new Set())
    if (k.length === 1 && !ctrl && !e.altKey && items.length) {
      handled()
      const t = typeAhead.current
      t.text += k.toLowerCase()
      clearTimeout(t.t)
      t.t = setTimeout(() => (t.text = ''), 800)
      const at = Math.max(0, items.findIndex((i) => i.path === cursor))
      const order = [...items.slice(at + (t.text.length === 1 ? 1 : 0)), ...items.slice(0, at + 1)]
      const hit = order.find((i) => i.name.toLowerCase().startsWith(t.text))
      if (hit) moveCursor(0, false, items.indexOf(hit))
    }
  }

  /* pointer: select, rubber band, drag */
  const press = useRef<{ x: number; y: number; it: Item | null; band: boolean; base: Set<string>; moved: boolean; wasSelected: boolean } | null>(null)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const contentPoint = (e: { clientX: number; clientY: number }) => {
    const r = scroller.current!.getBoundingClientRect()
    return { x: e.clientX - r.left + scroller.current!.scrollLeft, y: e.clientY - r.top + scroller.current!.scrollTop }
  }

  const onPointerDown = (e: React.PointerEvent, it: Item | null) => {
    p.onActivate()
    if (e.button !== 0) {
      if (it && !sel.has(it.path)) {
        setSel(new Set([it.path]))
        setCursor(it.path)
        anchor.current = it.path
      }
      return
    }
    if ((e.target as HTMLElement).closest('input, button, [data-nodrag]')) return
    e.preventDefault()
    scroller.current?.focus({ preventScroll: true })
    const ctrl = e.ctrlKey || e.metaKey
    if (it) {
      const wasSelected = sel.has(it.path)
      if (e.shiftKey && anchor.current) {
        const a = items.findIndex((i) => i.path === anchor.current)
        const b = items.indexOf(it)
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSel(new Set([...(ctrl ? sel : []), ...items.slice(lo, hi + 1).map((i) => i.path)]))
      } else if (ctrl) {
        const n = new Set(sel)
        if (n.has(it.path)) n.delete(it.path)
        else n.add(it.path)
        setSel(n)
        anchor.current = it.path
      } else if (!wasSelected) {
        setSel(new Set([it.path]))
        anchor.current = it.path
      }
      setCursor(it.path)
      press.current = { ...contentPoint(e), it, band: false, base: sel, moved: false, wasSelected: wasSelected && !ctrl && !e.shiftKey }
    } else {
      const pt = contentPoint(e)
      press.current = { ...pt, it: null, band: true, base: ctrl ? new Set(sel) : new Set(), moved: false, wasSelected: false }
      if (!ctrl) setSel(new Set())
    }
    const move = (ev: PointerEvent) => {
      const pr0 = press.current
      if (!pr0) return
      const pt = contentPoint(ev)
      if (!pr0.moved && Math.hypot(pt.x - pr0.x, pt.y - pr0.y) < 5) return
      pr0.moved = true
      if (pr0.band) {
        const x1 = Math.min(pr0.x, pt.x), y1 = Math.min(pr0.y, pt.y), x2 = Math.max(pr0.x, pt.x), y2 = Math.max(pr0.y, pt.y)
        setBand({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
        const hit = new Set(pr0.base)
        items.forEach((i, n) => {
          const c = cell(n)
          const cx = grid ? c.x : 0
          const cw = grid ? c.w : Math.min(vp.w, 420)
          if (c.x + cw >= x1 && cx <= x2 && c.y + c.h >= y1 && c.y <= y2) hit.add(i.path)
        })
        setSel(hit)
        // Auto-scroll near the edges.
        const r = scroller.current!.getBoundingClientRect()
        if (ev.clientY > r.bottom - 20) scroller.current!.scrollTop += 18
        else if (ev.clientY < r.top + 20) scroller.current!.scrollTop -= 18
      } else if (pr0.it) {
        const dragItems = sel.has(pr0.it.path) ? items.filter((i) => sel.has(i.path) || i.path === pr0.it!.path) : [pr0.it]
        const target = dropTargetAt(ev.clientX, ev.clientY)
        const fromZip = pr0.it.inner !== undefined && zip
        const dps = dragItems.map((i) => i.path)
        dragBus.set({
          paths: fromZip ? [] : dps,
          zip: fromZip ? zip!.path : undefined,
          inners: fromZip ? dragItems.map((i) => i.inner!) : undefined,
          label: dragItems.length === 1 ? dragItems[0].name : `${dragItems.length} items`,
          x: ev.clientX,
          y: ev.clientY,
          target: target && !dps.some((d) => d.toLowerCase() === target.toLowerCase()) ? target : null,
          copy: !!fromZip || (target ? ops.dropMode(dps, target, ev) === 'copy' : ev.ctrlKey),
        })
      }
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const pr0 = press.current
      press.current = null
      setBand(null)
      const d = dragBus.get()
      if (d) {
        dragBus.set(null)
        if (d.target) {
          if (d.zip) void ops.extract(d.zip, d.inners, d.target)
          else void ops.transfer(d.paths, d.target, ops.dropMode(d.paths, d.target, ev)).then(refresh)
        }
        return
      }
      if (pr0?.it && !pr0.moved && pr0.wasSelected && sel.size > 1) setSel(new Set([pr0.it.path]))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* render */
  const narrow = vp.w < 640
  const showWhere = loc.kind === 'search' || loc.kind === 'tag' || loc.kind === 'recent'
  const cutSet = clip?.mode === 'cut' ? new Set(clip.paths.map((x) => x.toLowerCase())) : null
  const dropHere = dragging?.target && dir && dragging.target.toLowerCase() === dir.toLowerCase()

  const sortHead = (k: SortKey, label: string, cls: string) => (
    <button
      type="button"
      data-nodrag
      onClick={() => prefs.set((s) => ({ ...s, sort: k, asc: s.sort === k ? !s.asc : k === 'name' || k === 'type' }))}
      className={cn('flex h-full items-center gap-1 px-2 text-left hover:text-(--u-ink)', pr.sort === k && 'text-(--u-ink)', cls)}
    >
      {label}
      {pr.sort === k && <Glyph d={pr.asc ? 'M4.5 9.5 8 6l3.5 3.5' : 'M4.5 6.5 8 10l3.5-3.5'} size={11} />}
    </button>
  )

  return (
    <div className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col', dropHere && 'shadow-[inset_0_0_0_2px_var(--u-accent)]')} onPointerDownCapture={p.onActivate}>
      <div
        ref={scroller}
        tabIndex={0}
        data-drop={dir ?? undefined}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        onPointerDown={(e) => onPointerDown(e, null)}
        onContextMenu={(e) => {
          e.preventDefault()
          const it = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')
          const item = it ? items.find((i) => i.path === it.dataset.item) : null
          if (item) void itemMenu(item, e)
          else backgroundMenu(e)
        }}
        className="u-scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none"
      >
        <div className="relative" style={{ height: Math.max(contentH, 1) }}>
          {!grid && (
            <div className="sticky top-0 z-10 flex h-[30px] items-stretch border-b border-(--u-edge) bg-(--u-m-solid) pl-3 pr-2 text-[11.5px] text-(--u-ink-3)">
              {sortHead('name', 'Name', 'min-w-0 flex-1 pl-[30px]')}
              {showWhere && !narrow && <span className="flex w-[220px] items-center px-2">Location</span>}
              {sortHead('modified', 'Date modified', 'w-[150px] shrink-0')}
              {!narrow && sortHead('type', 'Type', 'w-[120px] shrink-0')}
              {sortHead('size', 'Size', 'w-[84px] shrink-0 justify-end')}
            </div>
          )}
          {items.slice(from, to).map((it, k) => {
            const n = from + k
            const c = cell(n)
            const isSel = sel.has(it.path)
            const isCursor = cursor === it.path && active
            const isTarget = dragging?.target && it.isDir && dragging.target.toLowerCase() === it.path.toLowerCase()
            const itemTags = tagsOf(tagState, it.path)
            const cut = cutSet?.has(it.path.toLowerCase())
            const common = {
              key: it.path,
              'data-item': it.path,
              'data-drop': it.isDir && it.inner === undefined ? it.path : undefined,
              onPointerDown: (e: React.PointerEvent) => (e.stopPropagation(), onPointerDown(e, it)),
              onDoubleClick: () => void open(it),
            }
            const nameNode =
              renaming === it.path ? (
                <RenameField name={it.name} onDone={(v) => (v === null ? setRenaming(null) : void commitRename(it, v))} grid={grid} />
              ) : (
                <span className={cn('min-w-0 truncate', grid && 'line-clamp-2 whitespace-normal break-words text-center')} title={it.name}>
                  {pr.extensions || it.isDir ? it.name : it.name.replace(/\.[^.]+$/, '') || it.name}
                </span>
              )
            const tone = isTarget ? 'bg-(--u-accent) text-white' : isSel ? (active ? 'bg-(--u-accent) text-white' : 'bg-(--u-wash-on)') : 'hover:bg-(--u-wash-hover)'
            if (grid)
              return (
                <div {...common} className={cn('absolute flex flex-col items-center gap-1.5 rounded-[10px] px-1.5 pt-2 pb-1.5 text-[12px]', !isSel && !isTarget && 'hover:bg-(--u-wash-hover)', cut && 'opacity-45')} style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
                  <div className={cn('flex shrink-0 items-center justify-center rounded-[8px]', (isSel || isTarget) && 'bg-(--u-wash-on)')} style={{ width: tileW - 12, height: tileW - 12 }}>
                    <Thumb path={it.path} ext={it.ext} isDir={it.isDir} size={tileW - 24} inner={it.inner !== undefined} />
                  </div>
                  <div className={cn('flex max-w-full items-start gap-1 rounded-[5px] px-1.5 py-px leading-[1.3]', isTarget ? 'bg-(--u-accent) text-white' : isSel && (active ? 'bg-(--u-accent) text-white' : 'bg-(--u-wash-on)'), isCursor && !isSel && 'shadow-[inset_0_0_0_1px_var(--u-accent)]')}>
                    {itemTags.length > 0 && (
                      <span className="mt-[5px] flex -space-x-1">
                        {itemTags.slice(0, 3).map((t) => (
                          <TagDot key={t} color={tagState.defs.find((d) => d.name === t)?.color ?? '#888'} size={7} />
                        ))}
                      </span>
                    )}
                    {nameNode}
                  </div>
                </div>
              )
            return (
              <div {...common} className={cn('absolute left-1 right-1 flex items-center rounded-[6px] pl-2 pr-1 text-[12.5px]', tone, isCursor && !isSel && 'shadow-[inset_0_0_0_1px_var(--u-accent)]', cut && 'opacity-45')} style={{ top: c.y, height: ROW - 2 }}>
                <span className="flex min-w-0 flex-1 items-center gap-2.5 pr-2">
                  <FileIcon ext={it.ext} isDir={it.isDir} size={18} />
                  {nameNode}
                  {itemTags.map((t) => (
                    <TagDot key={t} color={tagState.defs.find((d) => d.name === t)?.color ?? '#888'} />
                  ))}
                </span>
                {showWhere && !narrow && <span className={cn('w-[220px] shrink-0 truncate px-2', isSel && active ? 'text-white/80' : 'text-(--u-ink-3)')} title={it.where}>{it.where}</span>}
                <span className={cn('w-[150px] shrink-0 truncate px-2', isSel && active ? 'text-white/80' : 'text-(--u-ink-2)')}>{loc.kind === 'zip' && !it.modifiedMs ? '' : when(it.modifiedMs)}</span>
                {!narrow && <span className={cn('w-[120px] shrink-0 truncate px-2', isSel && active ? 'text-white/80' : 'text-(--u-ink-3)')}>{typeLabel(it)}</span>}
                <span className={cn('w-[84px] shrink-0 truncate px-2 text-right tabular-nums', isSel && active ? 'text-white/80' : 'text-(--u-ink-3)')}>{it.isDir ? '' : bytes(it.size)}</span>
              </div>
            )
          })}
          {band && <div className="pointer-events-none absolute z-20 rounded-[3px] bg-[color-mix(in_srgb,var(--u-accent)_16%,transparent)] shadow-[inset_0_0_0_1px_var(--u-accent)]" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
        </div>
        {!data.loading && !items.length && <Empty loc={loc} error={data.error} filtered={!!filter.trim() || (!pr.hidden && data.items.length > 0)} index={data.index} onGo={p.onGo} />}
        {data.loading && !data.items.length && <p className="absolute inset-x-0 top-16 text-center text-[12.5px] text-(--u-ink-3)">Loading…</p>}
      </div>
    </div>
  )
})

function RenameField({ name, onDone, grid }: { name: string; onDone: (v: string | null) => void; grid: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current!
    el.focus()
    const dot = name.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name])
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      ref={ref}
      defaultValue={name}
      spellCheck={false}
      data-nodrag
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className={cn('h-[22px] min-w-0 flex-1 rounded-[4px] bg-(--u-m-solid) px-1.5 text-[12.5px] text-(--u-ink) outline-none shadow-[inset_0_0_0_1.5px_var(--u-accent)]', grid && 'w-full text-center')}
    />
  )
}

function Empty({ loc, error, filtered, index, onGo }: { loc: Loc; error: string | null; filtered: boolean; index?: IndexStatus; onGo: (l: Loc) => void }) {
  let title = 'This folder is empty'
  let body: React.ReactNode = 'Drop files here, or right-click to make something new.'
  if (error) (title = 'Can’t open this'), (body = error)
  else if (filtered) (title = 'Nothing matches'), (body = 'Nothing here matches the filter, or the items are hidden.')
  else if (loc.kind === 'search' && !loc.root && index && !index.ready)
    (title = index.building ? 'Building the search index…' : 'Search everywhere needs an index'),
      (body = index.building ? `${index.count.toLocaleString()} items so far. Results appear when it finishes.` : (
        <span className="flex flex-col items-center gap-3">
          Files lists every file in your user folders and other drives once, then searches them instantly.
          <Button variant="accent" onClick={() => void fs.indexBuild()}>Build index</Button>
        </span>
      ))
  else if (loc.kind === 'search') (title = 'No results'), (body = loc.root ? `Nothing named like “${loc.query}” in ${baseName(loc.root)}.` : `Nothing named like “${loc.query}”. Try ext:pdf, kind:image, size:>10mb or modified:<7d.`)
  else if (loc.kind === 'tag') (title = `Nothing tagged ${loc.tag}`), (body = 'Right-click any file or folder and choose a tag.')
  else if (loc.kind === 'recent') (title = 'Nothing opened yet'), (body = 'Files you open from here will be listed.')
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-20 mx-auto flex max-w-[360px] flex-col items-center gap-2 px-6 text-center" data-nodrag>
      <p className="text-[14px] font-medium text-(--u-ink-2)">{title}</p>
      <div className="text-[12.5px] leading-relaxed text-(--u-ink-3)">{body}</div>
      {error && loc.kind === 'dir' && parentOf(loc.path) && (
        <Button size="sm" variant="tinted" onClick={() => onGo({ kind: 'dir', path: parentOf(loc.path)! })}>
          Go up
        </Button>
      )}
    </div>
  )
}

export { join }
