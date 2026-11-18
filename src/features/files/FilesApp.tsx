import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { fs, type IndexStatus } from './api'
import { baseName, bytes, driveOf, locKey, locTitle, parentOf, prefs, useStore, when, type Item, type Loc } from './model'
import * as ops from './ops'
import { clipBus, undoBus } from './ops'
import { Pane, type PaneApi } from './Pane'
import { Inspector, QuickLook } from './Preview'
import { Sidebar } from './Sidebar'
import { BatchRename, Duplicates, RecycleBin } from './Tools'
import { AskHost, DragGhost, dragBus, dropTargetAt, G, Glyph, Toasts, useBus } from './ui'
import './files.css'

/**
 * FILES. One window, any number of tabs; each tab is a workspace of one or
 * two panes. Shared across every tab: the clipboard, undo history, tags,
 * favourites and preferences.
 *
 *   Ctrl+T / Ctrl+W / Ctrl+Tab   tabs
 *   Ctrl+\                       split into two panes; Tab switches pane; F5 / F6 copy / move across
 *   Space                        Quick Look        Ctrl+F  search        Ctrl+L  type a path
 *   Ctrl+Z / Ctrl+Y              undo / redo       Ctrl+I  details pane  F2      rename (several: batch rename)
 */

interface TabState {
  id: number
  initial: Loc | null
  title: string
}

export function FilesApp({ onClose, initialPath }: { onClose: () => void; initialPath?: string }) {
  const next = useRef(2)
  const [tabs, setTabs] = useState<TabState[]>([{ id: 1, initial: initialPath ? { kind: 'dir', path: initialPath } : null, title: initialPath ? baseName(initialPath) : 'Home' }])
  const [active, setActive] = useState(1)

  const add = useCallback((loc?: Loc) => {
    const id = next.current++
    setTabs((t) => [...t, { id, initial: loc ?? null, title: loc ? locTitle(loc) : 'Home' }])
    setActive(id)
  }, [])
  const close = useCallback(
    (id: number) =>
      setTabs((t) => {
        if (t.length === 1) {
          onClose()
          return t
        }
        const i = t.findIndex((x) => x.id === id)
        const rest = t.filter((x) => x.id !== id)
        setActive((a) => (a === id ? (rest[Math.max(0, i - 1)] ?? rest[0]).id : a))
        return rest
      }),
    [onClose],
  )
  const setTitle = useCallback((id: number, title: string) => setTabs((t) => (t.find((x) => x.id === id)?.title === title ? t : t.map((x) => (x.id === id ? { ...x, title } : x)))), [])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const key = e.key.toLowerCase()
      if (key === 't') (e.preventDefault(), add())
      else if (key === 'w') (e.preventDefault(), close(active))
      else if (e.key === 'Tab') {
        e.preventDefault()
        setTabs((t) => {
          const i = t.findIndex((x) => x.id === active)
          setActive(t[(i + (e.shiftKey ? t.length - 1 : 1)) % t.length].id)
          return t
        })
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [active, add, close])

  // Another "open this folder" request opens a tab. Launch arguments can arrive a moment after the
  // window mounts; then they replace the untouched Home tab instead of sitting beside it.
  const last = useRef(initialPath)
  const mountedAt = useRef(Date.now())
  useEffect(() => {
    if (!initialPath || initialPath === last.current) return
    last.current = initialPath
    const loc: Loc = { kind: 'dir', path: initialPath }
    if (Date.now() - mountedAt.current < 4000) {
      const id = next.current++
      setTabs((t) => (t.length === 1 && !t[0].initial ? [{ id, initial: loc, title: locTitle(loc) }] : [...t, { id, initial: loc, title: locTitle(loc) }]))
      setActive(id)
    } else add(loc)
  }, [initialPath, add])

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col text-(--u-ink)">
      {tabs.length > 1 && (
        <div className="flex h-9 shrink-0 items-end gap-1 border-b border-(--u-edge) px-2 pt-1">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              onClick={() => setActive(t.id)}
              onAuxClick={(e) => e.button === 1 && close(t.id)}
              className={cn('group flex h-[28px] min-w-[110px] max-w-[200px] cursor-default items-center gap-2 rounded-t-[8px] px-3 text-[12px]', t.id === active ? 'bg-(--u-wash-on) font-medium' : 'text-(--u-ink-2) hover:bg-(--u-wash-hover)')}
            >
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <button type="button" aria-label="Close tab" onClick={(e) => (e.stopPropagation(), close(t.id))} className="flex h-4 w-4 items-center justify-center rounded-full text-(--u-ink-3) opacity-0 hover:bg-(--u-wash-press) group-hover:opacity-100">
                <Glyph d={G.close} size={9} />
              </button>
            </div>
          ))}
          <Button icon size="sm" aria-label="New tab" title="New tab (Ctrl+T)" onClick={() => add()} className="mb-0.5">
            <Glyph d={G.plus} size={13} />
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {tabs.map((t) => (
          <div key={t.id} className={cn('absolute inset-0 flex', t.id !== active && 'invisible')}>
            <Workspace visible={t.id === active} initial={t.initial} onTitle={(s) => setTitle(t.id, s)} onOpenTab={add} />
          </div>
        ))}
      </div>
      <Toasts />
      <AskHost />
      <DragGhost />
    </div>
  )
}

/* ── one tab ─────────────────────────────────────────────────────── */

interface PaneNav {
  loc: Loc
  back: Loc[]
  fwd: Loc[]
}

function Workspace({ visible, initial, onTitle, onOpenTab }: { visible: boolean; initial: Loc | null; onTitle: (t: string) => void; onOpenTab: (l: Loc) => void }) {
  const pr = useStore(prefs)
  const undoState = useBus(undoBus)
  const clip = useBus(clipBus)
  const openMenu = useShellMenu()
  const [panes, setPanes] = useState<PaneNav[] | null>(initial ? [{ loc: initial, back: [], fwd: [] }] : null)
  const [split, setSplit] = useState(false)
  const [act, setAct] = useState(0)
  const [filters, setFilters] = useState(['', ''])
  const [sel, setSel] = useState<{ items: Item[]; all: Item[] }[]>([
    { items: [], all: [] },
    { items: [], all: [] },
  ])
  const [quick, setQuick] = useState<{ items: Item[]; index: number } | null>(null)
  const [renameSet, setRenameSet] = useState<Item[] | null>(null)
  const [index, setIndex] = useState<{ s?: IndexStatus; total?: number }>({})
  const [editingPath, setEditingPath] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const apis = [useRef<PaneApi>(null), useRef<PaneApi>(null)]
  const searchRef = useRef<HTMLInputElement>(null)

  // Start at Home when nothing was asked for.
  useEffect(() => {
    if (panes) return
    void fs.places().then((p) => setPanes([{ loc: { kind: 'dir', path: p[0]?.path ?? 'C:\\' }, back: [], fwd: [] }]))
  }, [panes])

  const cur = panes?.[split ? act : 0]?.loc
  useEffect(() => void (cur && onTitle(locTitle(cur))), [cur, onTitle])

  const go = useCallback(
    (loc: Loc, which?: number) => {
      const i = which ?? (split ? act : 0)
      setPanes((ps) => {
        if (!ps) return ps
        const n = [...ps]
        const p = n[i] ?? n[0]
        if (locKey(p.loc) === locKey(loc)) return ps
        n[i] = { loc, back: [...p.back, p.loc].slice(-60), fwd: [] }
        return n
      })
      setFilters((f) => f.map((x, k) => (k === i ? '' : x)))
      setEditingPath(false)
    },
    [act, split],
  )
  const back = () =>
    setPanes((ps) => {
      if (!ps) return ps
      const i = split ? act : 0
      const p = ps[i]
      if (!p.back.length) return ps
      const n = [...ps]
      n[i] = { loc: p.back[p.back.length - 1], back: p.back.slice(0, -1), fwd: [p.loc, ...p.fwd] }
      return n
    })
  const fwd = () =>
    setPanes((ps) => {
      if (!ps) return ps
      const i = split ? act : 0
      const p = ps[i]
      if (!p.fwd.length) return ps
      const n = [...ps]
      n[i] = { loc: p.fwd[0], back: [...p.back, p.loc], fwd: p.fwd.slice(1) }
      return n
    })
  const upLoc = (l: Loc | undefined): Loc | null => {
    if (!l) return null
    if (l.kind === 'dir') return parentOf(l.path) ? { kind: 'dir', path: parentOf(l.path)! } : null
    if (l.kind === 'zip') return l.inner ? { kind: 'zip', path: l.path, inner: l.inner.includes('/') ? l.inner.slice(0, l.inner.lastIndexOf('/')) : '' } : { kind: 'dir', path: parentOf(l.path)! }
    return null
  }
  const up = () => {
    const u = upLoc(cur)
    if (u) go(u)
  }

  const toggleSplit = () => {
    setSplit((s) => {
      if (!s)
        setPanes((ps) => {
          if (!ps) return ps
          if (ps[1]) return ps
          return [ps[0], { loc: ps[0].loc, back: [], fwd: [] }]
        })
      else setAct(0)
      return !s
    })
  }
  useEffect(() => {
    // Leaving split keeps whichever pane was active.
    if (!split && act === 1 && panes?.[1]) setPanes((ps) => (ps ? [ps[1], ps[0]] : ps))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split])

  // Window-level shortcuts for the visible tab.
  useEffect(() => {
    if (!visible) return
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
      const key = e.key.toLowerCase()
      if (e.altKey && e.key === 'ArrowLeft') (e.preventDefault(), back())
      else if (e.altKey && e.key === 'ArrowRight') (e.preventDefault(), fwd())
      else if (e.altKey && e.key === 'ArrowUp') (e.preventDefault(), up())
      else if (e.key === 'Backspace' && !typing) (e.preventDefault(), up())
      else if (e.ctrlKey && key === 'l') (e.preventDefault(), setEditingPath(true))
      else if ((e.ctrlKey && key === 'f') || (e.key === 'F3' && !e.shiftKey)) (e.preventDefault(), searchRef.current?.focus(), searchRef.current?.select())
      else if (e.ctrlKey && key === 'z' && !typing) (e.preventDefault(), void ops.undo())
      else if (e.ctrlKey && (key === 'y' || (e.shiftKey && key === 'z')) && !typing) (e.preventDefault(), void ops.redo())
      else if (e.ctrlKey && e.key === '\\') (e.preventDefault(), toggleSplit())
      else if (e.ctrlKey && key === 'i') (e.preventDefault(), prefs.set((s) => ({ ...s, inspector: !s.inspector })))
      else if (e.ctrlKey && key === 'b') (e.preventDefault(), prefs.set((s) => ({ ...s, sidebar: !s.sidebar })))
      else if (e.ctrlKey && (key === '1' || key === '2')) (e.preventDefault(), prefs.set((s) => ({ ...s, view: key === '1' ? 'list' : 'grid' })))
      else if (e.key === 'Tab' && !e.ctrlKey && split && !typing) {
        e.preventDefault()
        const n = act === 0 ? 1 : 0
        setAct(n)
        apis[n].current?.focus()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // Files dropped in from Windows Explorer: copy (or move on the same drive) into the folder under the pointer.
  useEffect(() => {
    if (!visible) return
    let un: (() => void) | undefined
    let dead = false
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload
        const r = window.devicePixelRatio || 1
        if (p.type === 'over' || p.type === 'enter') {
          const x = p.position.x / r
          const y = p.position.y / r
          const target = dropTargetAt(x, y)
          const paths = p.type === 'enter' ? p.paths : dragBus.get()?.paths ?? []
          dragBus.set({ paths, label: paths.length === 1 ? baseName(paths[0]) : `${paths.length} items`, x, y, target, copy: !!target && paths.some((s) => driveOf(s) !== driveOf(target)) })
        } else if (p.type === 'drop') {
          const target = dropTargetAt(p.position.x / r, p.position.y / r)
          dragBus.set(null)
          if (target && p.paths.length) void ops.transfer(p.paths, target, ops.dropMode(p.paths, target, { ctrlKey: false, shiftKey: false }))
        } else dragBus.set(null)
      })
      .then((u) => (dead ? u() : (un = u)))
    return () => {
      dead = true
      un?.()
    }
  }, [visible])

  if (!panes) return <div className="m-auto text-[12.5px] text-(--u-ink-3)">Loading…</div>

  const ai = split ? act : 0
  const curPane = panes[ai]
  const loc = curPane.loc
  const special = (l: Loc) => l.kind === 'bin' || l.kind === 'dupes'
  const dirOf = (l?: Loc) => (l?.kind === 'dir' ? l.path : null)
  const filter = filters[ai]
  const query = loc.kind === 'search' ? loc.query : filter
  const s = sel[ai]
  const selSize = s.items.reduce((a, i) => a + (i.isDir ? 0 : i.size), 0)

  const runSearch = (everywhere: boolean) => {
    const q = (searchRef.current?.value ?? '').trim()
    if (!q) return
    setSearchOpen(false)
    const root = loc.kind === 'dir' ? loc.path : loc.kind === 'search' ? loc.root : undefined
    go({ kind: 'search', query: q, root: everywhere ? undefined : root })
  }

  const newMenu = (e: React.MouseEvent) => {
    const api = apis[ai].current
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openMenu({ x: r.left, y: r.bottom + 4 }, [
      { label: 'Folder', onSelect: () => api?.newFolder() },
      {},
      { label: 'Text document', onSelect: () => api?.newFile('text') },
      { label: 'Word document', onSelect: () => api?.newFile('word') },
      { label: 'Excel workbook', onSelect: () => api?.newFile('excel') },
      { label: 'PowerPoint presentation', onSelect: () => api?.newFile('power_point') },
    ])
  }
  const moreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const d = dirOf(loc)
    openMenu({ x: r.right - 220, y: r.bottom + 4 }, [
      { label: undoState.undo ? `Undo ${undoState.undo}` : 'Undo', disabled: !undoState.undo, onSelect: () => void ops.undo() },
      { label: undoState.redo ? `Redo ${undoState.redo}` : 'Redo', disabled: !undoState.redo, onSelect: () => void ops.redo() },
      {},
      { label: 'Rename several items…', disabled: !d, onSelect: () => apis[ai].current?.batchRename() },
      { label: 'Open terminal here', disabled: !d, onSelect: () => d && void fs.terminal(d).catch(ops.fail) },
      { label: 'Find duplicates here', disabled: !d, onSelect: () => d && go({ kind: 'dupes', root: d }) },
      {},
      { label: `${pr.hidden ? '✓ ' : ''}Show hidden items`, onSelect: () => prefs.set((x) => ({ ...x, hidden: !x.hidden })) },
      { label: `${pr.extensions ? '✓ ' : ''}Show file extensions`, onSelect: () => prefs.set((x) => ({ ...x, extensions: !x.extensions })) },
      { label: `${pr.sidebar ? '✓ ' : ''}Sidebar`, onSelect: () => prefs.set((x) => ({ ...x, sidebar: !x.sidebar })) },
      ...(pr.view === 'grid'
        ? [
            { label: 'Larger icons', disabled: pr.gridSize >= 192, onSelect: () => prefs.set((x) => ({ ...x, gridSize: Math.min(192, x.gridSize + 32) })) },
            { label: 'Smaller icons', disabled: pr.gridSize <= 80, onSelect: () => prefs.set((x) => ({ ...x, gridSize: Math.max(80, x.gridSize - 32) })) },
          ]
        : []),
      {},
      { label: 'Rebuild search index', onSelect: () => void fs.indexBuild().then(() => ops.toast('Rebuilding the search index in the background')) },
    ])
  }

  const paneView = (i: number) => {
    const p = panes[i]
    const other = split ? panes[i === 0 ? 1 : 0] : undefined
    if (p.loc.kind === 'bin') return <RecycleBin onGo={(l) => go(l, i)} />
    if (p.loc.kind === 'dupes') return <Duplicates root={p.loc.root} onGo={(l) => go(l, i)} />
    return (
      <Pane
        ref={apis[i]}
        loc={p.loc}
        active={ai === i}
        filter={filters[i]}
        otherDir={dirOf(other?.loc)}
        onActivate={() => split && act !== i && setAct(i)}
        onGo={(l) => go(l, i)}
        onOpenTab={onOpenTab}
        onOpenOther={split ? (l) => go(l, i === 0 ? 1 : 0) : null}
        onSelection={(items, all) => setSel((v) => (v[i].items === items && v[i].all === all ? v : v.map((x, k) => (k === i ? { items, all } : x))))}
        onQuickLook={(items, index) => setQuick({ items, index: Math.max(0, index) })}
        onBatchRename={(items) => items.length && setRenameSet(items.filter((x) => x.inner === undefined))}
        onIndex={i === ai ? (st, total) => setIndex({ s: st, total }) : undefined}
      />
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-(--u-edge) px-2.5">
        <Button icon size="sm" aria-label="Sidebar" title="Sidebar (Ctrl+B)" onClick={() => prefs.set((x) => ({ ...x, sidebar: !x.sidebar }))} className={cn(pr.sidebar && 'text-(--u-accent)')}>
          <Glyph d={G.sidebar} />
        </Button>
        <span className="mx-1 h-4 w-px bg-(--u-edge)" />
        <Button icon size="sm" aria-label="Back" title="Back (Alt+Left)" disabled={!curPane.back.length} onClick={back}>
          <Glyph d={G.back} />
        </Button>
        <Button icon size="sm" aria-label="Forward" title="Forward (Alt+Right)" disabled={!curPane.fwd.length} onClick={fwd}>
          <Glyph d={G.fwd} />
        </Button>
        <Button icon size="sm" aria-label="Up" title="Up (Alt+Up)" disabled={!upLoc(loc)} onClick={up}>
          <Glyph d={G.up} />
        </Button>
        <PathBar loc={loc} editing={editingPath} onEdit={setEditingPath} onGo={go} />
        <div className="relative">
          <label className="flex h-8 w-[240px] items-center gap-2 rounded-[8px] bg-(--u-wash-hover) px-2.5 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
            <Glyph d={G.search} size={14} className="text-(--u-ink-3)" />
            <input
              ref={searchRef}
              value={query}
              placeholder={loc.kind === 'dir' ? `Search ${baseName(loc.path)}` : 'Search'}
              spellCheck={false}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onChange={(e) => {
                const v = e.target.value
                if (loc.kind === 'search') go({ ...loc, query: v })
                else setFilters((f) => f.map((x, k) => (k === ai ? v : x)))
                setSearchOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.preventDefault(), runSearch(e.shiftKey || loc.kind !== 'dir'))
                else if (e.key === 'Escape') {
                  e.preventDefault()
                  setFilters((f) => f.map((x, k) => (k === ai ? '' : x)))
                  setSearchOpen(false)
                  apis[ai].current?.focus()
                } else if (e.key === 'ArrowDown') (e.preventDefault(), apis[ai].current?.focus())
              }}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--u-ink-3)"
            />
            {query && (
              <button type="button" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => (loc.kind === 'search' ? back() : setFilters((f) => f.map((x, k) => (k === ai ? '' : x))))} className="text-(--u-ink-3) hover:text-(--u-ink)">
                <Glyph d={G.close} size={11} />
              </button>
            )}
          </label>
          {searchOpen && query.trim() && loc.kind !== 'search' && (
            <div className="absolute right-0 top-[38px] z-30 w-[320px] rounded-[10px] bg-(--u-m-solid-hi) p-1 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
              {loc.kind === 'dir' && (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runSearch(false)} className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-(--u-wash-hover)">
                  <Glyph d={G.folder} size={14} className="text-(--u-accent)" />
                  <span className="min-w-0 flex-1 truncate">
                    Search <b className="font-medium">{baseName(loc.path)}</b> and its subfolders
                  </span>
                  <span className="text-[11px] text-(--u-ink-3)">Enter</span>
                </button>
              )}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runSearch(true)} className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-(--u-wash-hover)">
                <Glyph d={G.search} size={14} className="text-(--u-accent)" />
                <span className="min-w-0 flex-1 truncate">Search everywhere</span>
                <span className="text-[11px] text-(--u-ink-3)">{loc.kind === 'dir' ? 'Shift+Enter' : 'Enter'}</span>
              </button>
              <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-relaxed text-(--u-ink-3)">Typing filters this folder. Everywhere understands ext:pdf, kind:image, size:&gt;10mb, modified:&lt;7d.</p>
            </div>
          )}
        </div>
        <span className="mx-1 h-4 w-px bg-(--u-edge)" />
        <Button size="sm" variant="tinted" disabled={loc.kind !== 'dir'} onClick={newMenu} title="New folder or file">
          <Glyph d={G.plus} size={13} /> New
        </Button>
        <Button icon size="sm" aria-label="List view" title="List (Ctrl+1)" onClick={() => prefs.set((x) => ({ ...x, view: 'list' }))} className={cn(pr.view === 'list' && 'bg-(--u-wash-on) text-(--u-accent)')}>
          <Glyph d={G.list} />
        </Button>
        <Button icon size="sm" aria-label="Icon view" title="Icons (Ctrl+2)" onClick={() => prefs.set((x) => ({ ...x, view: 'grid' }))} className={cn(pr.view === 'grid' && 'bg-(--u-wash-on) text-(--u-accent)')}>
          <Glyph d={G.grid} />
        </Button>
        <Button icon size="sm" aria-label="Two panes" title="Two panes (Ctrl+\)" onClick={toggleSplit} className={cn(split && 'bg-(--u-wash-on) text-(--u-accent)')}>
          <Glyph d={G.split} />
        </Button>
        <Button icon size="sm" aria-label="Details" title="Details (Ctrl+I)" onClick={() => prefs.set((x) => ({ ...x, inspector: !x.inspector }))} className={cn(pr.inspector && 'bg-(--u-wash-on) text-(--u-accent)')}>
          <Glyph d={G.info} />
        </Button>
        <Button icon size="sm" aria-label="More" onClick={moreMenu}>
          <Glyph d={G.more} />
        </Button>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {pr.sidebar && <Sidebar loc={loc} onGo={(l) => go(l)} onOpenTab={onOpenTab} />}
        <div className="flex min-h-0 min-w-0 flex-1">
          {(split ? [0, 1] : [0]).map((i) => (
            <div key={i} className={cn('flex min-h-0 min-w-0 flex-1 flex-col', i === 1 && 'border-l border-(--u-edge)')}>
              {split && (
                <button type="button" onClick={() => (setAct(i), apis[i].current?.focus())} className={cn('flex h-7 shrink-0 items-center gap-2 border-b border-(--u-edge) px-3 text-left text-[11.5px]', ai === i ? 'text-(--u-ink)' : 'text-(--u-ink-3)')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', ai === i ? 'bg-(--u-accent)' : 'bg-(--u-wash-press)')} />
                  <span className="truncate">{panes[i].loc.kind === 'dir' ? (panes[i].loc as { path: string }).path : locTitle(panes[i].loc)}</span>
                </button>
              )}
              {paneView(i)}
            </div>
          ))}
        </div>
        {pr.inspector && !special(loc) && (
          <aside className="u-scroll w-[264px] shrink-0 overflow-y-auto border-l border-(--u-edge) p-4">
            <Inspector selected={s.items} all={s.all} loc={loc} onGo={(l) => go(l)} />
          </aside>
        )}
      </div>

      {/* status */}
      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-(--u-edge) px-3 text-[11.5px] text-(--u-ink-3)">
        {!special(loc) && <span>{s.all.length.toLocaleString()} items</span>}
        {s.items.length > 0 && (
          <span className="text-(--u-ink-2)">
            {s.items.length.toLocaleString()} selected{selSize ? ` · ${bytes(selSize)}` : ''}
          </span>
        )}
        {loc.kind === 'search' && !loc.root && index.s?.ready && (
          <span>
            {(index.total ?? 0) > s.all.length ? `First ${s.all.length} of ${index.total!.toLocaleString()} · ` : ''}Index of {index.s.count.toLocaleString()} items, updated {when(index.s.builtMs).toLowerCase()}
            {index.s.building ? ' · rebuilding…' : ''}
          </span>
        )}
        {clip && (
          <span className="flex items-center gap-1.5">
            {clip.mode === 'cut' ? 'Cut' : 'Copied'} {clip.paths.length === 1 ? `“${baseName(clip.paths[0])}”` : `${clip.paths.length} items`}
            <button type="button" className="text-(--u-ink-3) hover:text-(--u-ink)" aria-label="Clear clipboard" onClick={() => clipBus.set(null)}>
              <Glyph d={G.close} size={10} />
            </button>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" disabled={!undoState.undo} title={undoState.undo ? `Undo ${undoState.undo} (Ctrl+Z)` : 'Nothing to undo'} onClick={() => void ops.undo()} className="rounded-[5px] p-1 enabled:hover:bg-(--u-wash-hover) enabled:hover:text-(--u-ink) disabled:opacity-40">
            <Glyph d={G.undo} size={13} />
          </button>
          <button type="button" disabled={!undoState.redo} title={undoState.redo ? `Redo ${undoState.redo} (Ctrl+Y)` : 'Nothing to redo'} onClick={() => void ops.redo()} className="rounded-[5px] p-1 enabled:hover:bg-(--u-wash-hover) enabled:hover:text-(--u-ink) disabled:opacity-40">
            <Glyph d={G.redo} size={13} />
          </button>
        </span>
      </div>

      {quick && <QuickLook items={quick.items} index={quick.index} onIndex={(index) => setQuick((q) => (q ? { ...q, index } : q))} onClose={() => (setQuick(null), apis[ai].current?.focus())} />}
      {renameSet && <BatchRename items={renameSet} onClose={() => setRenameSet(null)} onDone={() => apis[ai].current?.refresh()} />}
    </div>
  )
}

/* ── breadcrumb that turns into a path field ─────────────────────── */

function PathBar({ loc, editing, onEdit, onGo }: { loc: Loc; editing: boolean; onEdit: (b: boolean) => void; onGo: (l: Loc) => void }) {
  const drag = useBus(dragBus)
  const crumbs = useMemo(() => {
    const out: { label: string; loc: Loc; drop?: string }[] = []
    const dirCrumbs = (path: string) => {
      const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
      let acc = ''
      parts.forEach((p, i) => {
        acc = i === 0 ? p + '\\' : acc.replace(/\\$/, '') + '\\' + p
        out.push({ label: i === 0 ? (/^[A-Za-z]:$/.test(p) ? `Local Disk (${p})` : p) : p, loc: { kind: 'dir', path: acc }, drop: acc })
      })
    }
    if (loc.kind === 'dir') dirCrumbs(loc.path)
    else if (loc.kind === 'zip') {
      dirCrumbs(loc.path)
      out[out.length - 1] = { label: baseName(loc.path), loc: { kind: 'zip', path: loc.path, inner: '' } }
      let acc = ''
      for (const part of loc.inner.split('/').filter(Boolean)) {
        acc = acc ? `${acc}/${part}` : part
        out.push({ label: part, loc: { kind: 'zip', path: loc.path, inner: acc } })
      }
    } else out.push({ label: loc.kind === 'search' ? (loc.root ? `Search in ${baseName(loc.root)}` : 'Search everywhere') : locTitle(loc), loc })
    return out
  }, [loc])

  if (editing)
    return (
      <form
        className="mx-1 flex min-w-0 flex-1"
        onSubmit={async (e) => {
          e.preventDefault()
          const v = (new FormData(e.currentTarget).get('p') as string).trim().replace(/^"|"$/g, '')
          if (!v) return onEdit(false)
          const expanded = v.replace(/%([^%]+)%/g, (m) => m)
          const [st] = await fs.stat([expanded]).catch(() => [null])
          if (!st) return ops.toast(`Can’t find “${v}”`, { tone: 'danger' })
          if (st.isDir) onGo({ kind: 'dir', path: st.path })
          else if (st.ext === 'zip') onGo({ kind: 'zip', path: st.path, inner: '' })
          else (onGo({ kind: 'dir', path: parentOf(st.path)! }), void fs.open(st.path).catch(ops.fail))
        }}
      >
        <input
          name="p"
          autoFocus
          defaultValue={loc.kind === 'dir' || loc.kind === 'zip' ? loc.path : ''}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => onEdit(false)}
          onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), onEdit(false))}
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-[8px] bg-(--u-wash-hover) px-3 text-[12.5px] outline-none shadow-[inset_0_0_0_1.5px_var(--u-accent)]"
        />
      </form>
    )

  return (
    <div className="mx-1 flex h-8 min-w-0 flex-1 cursor-text items-center overflow-hidden rounded-[8px] px-1 hover:bg-(--u-wash-hover)" onClick={(e) => e.target === e.currentTarget && onEdit(true)} title="Click to type a path (Ctrl+L)">
      <div className="flex min-w-0 items-center" style={{ direction: 'rtl' }}>
        <div className="flex items-center" style={{ direction: 'ltr' }}>
          {crumbs.map((c, i) => {
            const target = c.drop && drag?.target?.toLowerCase() === c.drop.toLowerCase()
            const last = i === crumbs.length - 1
            return (
              <span key={i} className="flex shrink-0 items-center">
                {i > 0 && <Glyph d={G.chevron} size={11} className="mx-0.5 text-(--u-ink-3)" />}
                <button type="button" data-drop={c.drop} onClick={() => onGo(c.loc)} className={cn('h-6 max-w-[200px] truncate rounded-[6px] px-1.5 text-[12.5px]', target ? 'bg-(--u-accent) text-white' : last ? 'font-semibold text-(--u-ink)' : 'text-(--u-ink-2) hover:bg-(--u-wash-on) hover:text-(--u-ink)')}>
                  {c.label}
                </button>
              </span>
            )
          })}
        </div>
      </div>
      <div className="h-full min-w-6 flex-1" onClick={() => onEdit(true)} />
    </div>
  )
}
