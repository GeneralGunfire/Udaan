import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import * as ops from '@/features/files/ops'
import { Duplicates } from '@/features/files/Tools'
import { AskHost, FileIcon, Toasts } from '@/features/files/ui'
import { openApp } from '@/os/kernel/shell'
import { Button, Segmented } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { squarify } from './treemap'

interface Drive {
  mount: string
  name: string
  total: number
  free: number
}
interface DirSize {
  path: string
  name: string
  bytes: number
  isDir: boolean
}
interface Cleanable {
  id: string
  label: string
  detail: string
  path: string
  bytes: number
}
interface Found {
  path: string
  size: number
  modifiedMs: number
}

const fmt = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const parentOf = (p: string) => {
  const t = p.replace(/[\\/]+$/, '')
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'))
  return i > 2 ? t.slice(0, i) : null
}
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
const extOf = (n: string) => (n.includes('.') ? n.split('.').pop()!.toLowerCase() : '')
const openInFiles = (path: string) => void openApp('file-explorer', { initialPath: path })

type Tab = 'overview' | 'folders' | 'large' | 'old' | 'dupes'
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['folders', 'Folders'],
  ['large', 'Large files'],
  ['old', 'Old files'],
  ['dupes', 'Duplicates'],
]

/**
 * STORAGE. What fills each drive, how to get space back, and where it went:
 *   Overview     every drive, safe clutter you can clear in one click, your biggest folders
 *   Folders      a treemap of any folder: click a block to go inside
 *   Large files  the biggest files on a drive, with recycle
 *   Old files    big files nobody has touched in a long time
 *   Duplicates   identical copies, compared by content
 * Everything that deletes goes to the Recycle Bin and can be undone.
 */
export function StorageApp(_props: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [drives, setDrives] = useState<Drive[]>([])
  const [home, setHome] = useState('C:\\Users')
  const [folder, setFolder] = useState<string | null>(null)

  useEffect(() => {
    void invoke<Drive[]>('storage_drives').then((d) => setDrives(d.filter((x) => x.total > 0)), () => {})
    void homeDir().then((h) => setHome(h.replace(/[\\/]+$/, '')), () => {})
  }, [])

  const browse = (p: string) => {
    setFolder(p)
    setTab('folders')
  }
  const scopes = useMemo(() => [{ label: 'Your user folder', path: home }, ...drives.map((d) => ({ label: `${d.name || 'Local disk'} (${d.mount.replace(/\\$/, '')})`, path: d.mount }))], [drives, home])

  return (
    <div className="relative flex h-full text-(--u-ink)">
      <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-(--u-edge) px-2.5 py-4">
        <h1 className="px-2.5 pb-3 text-[18px] font-semibold tracking-tight">Storage</h1>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={cn('flex h-[32px] items-center rounded-[8px] px-2.5 text-left text-[13px]', tab === id ? 'bg-(--u-wash-on) font-medium' : 'text-(--u-ink-2) hover:bg-(--u-wash-hover) hover:text-(--u-ink)')}>
            {label}
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-2 px-2.5 pt-4">
          {drives.slice(0, 3).map((d) => {
            const pct = ((d.total - d.free) / Math.max(1, d.total)) * 100
            return (
              <div key={d.mount} className="text-[11px] text-(--u-ink-3)">
                <div className="flex justify-between">
                  <span>{d.mount.replace(/\\$/, '')}</span>
                  <span>{fmt(d.free)} free</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-(--u-wash-press)">
                  <div className={cn('h-full rounded-full', pct > 90 ? 'bg-(--u-danger)' : 'bg-(--u-accent)')} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </nav>

      <main className="min-w-0 flex-1">
        {tab === 'overview' && <Overview drives={drives} home={home} onBrowse={browse} onTab={setTab} />}
        {tab === 'folders' && <Folders start={folder ?? home} drives={drives} />}
        {tab === 'large' && <Finder key="large" mode="large" scopes={scopes} />}
        {tab === 'old' && <Finder key="old" mode="old" scopes={scopes} />}
        {tab === 'dupes' && <DupesTab scopes={scopes} />}
      </main>
      <Toasts />
      <AskHost />
    </div>
  )
}

/* ── overview ────────────────────────────────────────────────────── */

function Overview({ drives, home, onBrowse, onTab }: { drives: Drive[]; home: string; onBrowse: (p: string) => void; onTab: (t: Tab) => void }) {
  const [clean, setClean] = useState<Cleanable[] | null>(null)
  const [cleaning, setCleaning] = useState<string | null>(null)
  const [freed, setFreed] = useState(0)
  const [big, setBig] = useState<DirSize[] | null>(null)

  useEffect(() => {
    void invoke<Cleanable[]>('storage_cleanables').then(setClean, () => setClean([]))
  }, [])
  useEffect(() => {
    setBig(null)
    void invoke<DirSize[]>('storage_scan', { path: home }).then((l) => setBig(l.filter((x) => x.isDir).slice(0, 8)), () => setBig([]))
  }, [home])

  const doClean = async (c: Cleanable) => {
    setCleaning(c.id)
    const bytes = await invoke<number>('storage_clean', { id: c.id }).catch(() => 0)
    setFreed((f) => f + bytes)
    setCleaning(null)
    setClean((l) => (l ?? []).map((x) => (x.id === c.id ? { ...x, bytes: Math.max(0, x.bytes - bytes) } : x)).filter((x) => x.bytes > 1_000_000))
  }
  const total = (clean ?? []).reduce((s, c) => s + c.bytes, 0)
  const maxBig = Math.max(1, ...(big ?? []).map((b) => b.bytes))

  return (
    <div className="u-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-8 pb-12 pt-8">
        <h2 className="text-[26px] font-bold tracking-tight">Overview</h2>
        <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
          {drives.map((d) => {
            const used = d.total - d.free
            const pct = (used / Math.max(1, d.total)) * 100
            return (
              <button key={d.mount} type="button" onClick={() => onBrowse(d.mount)} className="flex items-center gap-5 rounded-[14px] bg-(--u-wash-hover) p-4 text-left shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-on)">
                <Ring pct={pct} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">
                    {d.name || 'Local disk'} ({d.mount.replace(/\\$/, '')})
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-(--u-ink-3)">
                    {fmt(used)} of {fmt(d.total)} used
                  </span>
                  <span className={cn('mt-1 block text-[13px] font-medium', pct > 90 ? 'text-(--u-danger)' : 'text-(--u-ink-2)')}>{fmt(d.free)} free{pct > 90 ? ': nearly full' : ''}</span>
                </span>
              </button>
            )
          })}
        </div>

        <section className="mt-9">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[17px] font-semibold">Safe to clear</h3>
            <span className="text-[12.5px] text-(--u-ink-3)">{clean === null ? 'Measuring…' : freed ? `${fmt(freed)} freed this session` : total ? `${fmt(total)} can be freed` : 'Nothing to clear'}</span>
          </div>
          <p className="mt-1 text-[12.5px] text-(--u-ink-3)">Caches and temporary files that rebuild themselves. Nothing of yours is in here.</p>
          <div className="mt-3 flex flex-col gap-2">
            {(clean ?? []).map((c) => (
              <div key={c.id} className="flex items-center gap-4 rounded-[12px] px-4 py-3 shadow-[inset_0_0_0_1px_var(--u-edge)]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">{c.label}</span>
                  <span className="block text-[12px] text-(--u-ink-3)">{c.detail}</span>
                </span>
                <span className="text-[13px] tabular-nums text-(--u-ink-2)">{fmt(c.bytes)}</span>
                <Button size="sm" variant="tinted" disabled={!!cleaning} onClick={() => void doClean(c)}>
                  {cleaning === c.id ? 'Clearing…' : 'Clear'}
                </Button>
              </div>
            ))}
            {clean?.length === 0 && <p className="py-3 text-[13px] text-(--u-ink-3)">Your system is tidy.</p>}
          </div>
        </section>

        <section className="mt-9">
          <h3 className="text-[17px] font-semibold">Biggest folders in your user folder</h3>
          <div className="mt-3 flex flex-col gap-1">
            {big === null && <p className="py-3 text-[13px] text-(--u-ink-3)">Measuring…</p>}
            {big?.map((b) => (
              <button key={b.path} type="button" onClick={() => onBrowse(b.path)} className="group flex items-center gap-4 rounded-[8px] px-3 py-2 text-left hover:bg-(--u-wash-hover)">
                <FileIcon ext="" isDir size={20} />
                <span className="w-[200px] shrink-0 truncate text-[13px]">{b.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-(--u-wash-press)">
                  <span className="block h-full rounded-full bg-(--u-accent)" style={{ width: `${(b.bytes / maxBig) * 100}%` }} />
                </span>
                <span className="w-[70px] shrink-0 text-right text-[12.5px] tabular-nums text-(--u-ink-2)">{fmt(b.bytes)}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-9 grid grid-cols-3 gap-3">
          {([
            ['large', 'Find large files', 'The biggest files, ready to review'],
            ['old', 'Find old files', 'Big files you haven’t touched in years'],
            ['dupes', 'Find duplicates', 'Identical copies, by content'],
          ] as const).map(([t, title, sub]) => (
            <button key={t} type="button" onClick={() => onTab(t)} className="rounded-[14px] p-4 text-left shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-hover)">
              <span className="block text-[14px] font-semibold">{title}</span>
              <span className="mt-1 block text-[12px] leading-snug text-(--u-ink-3)">{sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Ring({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" className="shrink-0" aria-hidden>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--u-wash-press)" strokeWidth="7" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={pct > 90 ? 'var(--u-danger)' : 'var(--u-accent)'} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor">
        {Math.round(pct)}%
      </text>
    </svg>
  )
}

/* ── folders: a treemap ──────────────────────────────────────────── */

function Folders({ start, drives }: { start: string; drives: Drive[] }) {
  const [path, setPath] = useState(start)
  const [items, setItems] = useState<DirSize[] | null>(null)
  const [view, setView] = useState<'map' | 'list'>('map')
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => setPath(start), [start])
  const load = useCallback(async (p: string) => {
    setItems(null)
    setItems(await invoke<DirSize[]>('storage_scan', { path: p }).catch(() => []))
  }, [])
  useEffect(() => void load(path), [path, load])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [view])

  const total = (items ?? []).reduce((s, i) => s + i.bytes, 0)
  const tiles = useMemo(() => {
    const sorted = (items ?? []).filter((i) => i.bytes > 0)
    // Many tiny items become one "other" tile so every block stays readable.
    const main = sorted.slice(0, 40)
    const rest = sorted.slice(40)
    const list = rest.length ? [...main, { path: '', name: `${rest.length} smaller items`, bytes: rest.reduce((s, r) => s + r.bytes, 0), isDir: false }] : main
    return squarify(list.map((i) => ({ item: i, value: i.bytes })), 0, 0, size.w, size.h)
  }, [items, size])

  const crumbs = useMemo(() => {
    const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
    return parts.map((p, i) => ({ label: p, to: parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '') }))
  }, [path])
  const up = parentOf(path)
  const maxB = Math.max(1, ...(items ?? []).map((i) => i.bytes))

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-(--u-edge) px-5 py-3">
        <Button icon size="sm" aria-label="Up" disabled={!up} onClick={() => up && setPath(up)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 13V3.5M4 7.5l4-4 4 4" />
          </svg>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[13px]">
          {crumbs.map((c, i) => (
            <span key={c.to} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span className="text-(--u-ink-3)">›</span>}
              <button type="button" onClick={() => setPath(c.to)} className={cn('rounded-[6px] px-1.5 py-0.5 hover:bg-(--u-wash-hover)', i === crumbs.length - 1 && 'font-semibold')}>
                {c.label}
              </button>
            </span>
          ))}
        </div>
        <span className="text-[12.5px] text-(--u-ink-3)">{items ? fmt(total) : 'Measuring…'}</span>
        <Segmented<'map' | 'list'> value={view} onChange={setView} options={[{ value: 'map', label: 'Map' }, { value: 'list', label: 'List' }]} />
        <Button size="sm" variant="tinted" onClick={() => openInFiles(path)}>
          Open in Files
        </Button>
      </header>
      {drives.length > 1 && (
        <div className="flex shrink-0 gap-1.5 border-b border-(--u-edge) px-5 py-2">
          {drives.map((d) => (
            <button key={d.mount} type="button" onClick={() => setPath(d.mount)} className={cn('h-7 rounded-full px-3 text-[12px]', path.toLowerCase().startsWith(d.mount.toLowerCase()) ? 'bg-(--u-wash-on) font-medium' : 'text-(--u-ink-3) hover:bg-(--u-wash-hover)')}>
              {d.mount.replace(/\\$/, '')}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 p-4">
        {items === null ? (
          <p className="pt-24 text-center text-[13.5px] text-(--u-ink-3)">Measuring this folder. Large folders take a moment.</p>
        ) : !items.length ? (
          <p className="pt-24 text-center text-[13.5px] text-(--u-ink-3)">This folder is empty.</p>
        ) : view === 'map' ? (
          <div ref={box} className="relative h-full w-full overflow-hidden rounded-[10px]">
            {tiles.map(({ item, x, y, w, h }) => {
              const share = item.bytes / Math.max(1, total)
              const big = w > 90 && h > 44
              return (
                <button
                  key={item.path || 'other'}
                  type="button"
                  disabled={!item.path}
                  title={`${item.name}\n${fmt(item.bytes)} (${Math.round(share * 100)}%)`}
                  onClick={() => (item.isDir ? setPath(item.path) : openInFiles(parentOf(item.path) ?? path))}
                  className="absolute overflow-hidden p-2 text-left text-[12px] leading-tight transition-[filter] duration-100 hover:brightness-125"
                  style={{
                    left: x + 1,
                    top: y + 1,
                    width: Math.max(0, w - 2),
                    height: Math.max(0, h - 2),
                    borderRadius: 6,
                    background: item.isDir ? `color-mix(in srgb, var(--u-accent) ${Math.round(28 + Math.min(1, share * 3) * 50)}%, #14171d)` : 'rgb(255 255 255 / 0.09)',
                  }}
                >
                  {big && (
                    <>
                      <span className="block truncate font-medium text-white/95">{item.name}</span>
                      <span className="block truncate text-white/60">{fmt(item.bytes)}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="u-scroll h-full overflow-y-auto">
            {items.map((i) => (
              <div key={i.path} className="group flex items-center gap-3 rounded-[8px] px-3 py-1.5 hover:bg-(--u-wash-hover)">
                <FileIcon ext={extOf(i.name)} isDir={i.isDir} size={18} />
                <button type="button" onClick={() => (i.isDir ? setPath(i.path) : openInFiles(parentOf(i.path) ?? path))} className="w-[240px] shrink-0 truncate text-left text-[13px]">
                  {i.name}
                </button>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--u-wash-press)">
                  <span className="block h-full rounded-full bg-(--u-accent)" style={{ width: `${(i.bytes / maxB) * 100}%` }} />
                </span>
                <span className="w-[70px] shrink-0 text-right text-[12.5px] tabular-nums text-(--u-ink-2)">{fmt(i.bytes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── large and old files ─────────────────────────────────────────── */

function ScopePicker({ scopes, value, onChange }: { scopes: { label: string; path: string }[]; value: string; onChange: (p: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {scopes.map((s) => (
        <button key={s.path} type="button" aria-pressed={value === s.path} onClick={() => onChange(s.path)} className={cn('h-8 rounded-full px-3.5 text-[12.5px] font-medium', value === s.path ? 'bg-(--u-ink) text-(--u-m-solid)' : 'bg-(--u-wash-hover) text-(--u-ink-2) hover:bg-(--u-wash-on)')}>
          {s.label}
        </button>
      ))}
    </div>
  )
}

function Finder({ mode, scopes }: { mode: 'large' | 'old'; scopes: { label: string; path: string }[] }) {
  const [scope, setScope] = useState('')
  const [minMb, setMinMb] = useState(mode === 'large' ? '100' : '20')
  const [age, setAge] = useState('730')
  const [res, setRes] = useState<{ files: Found[]; scanned: number; partial: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!scope && scopes[0]) setScope(scopes[0].path)
  }, [scope, scopes])
  useEffect(() => {
    const un = listen<{ files: number }>('storage://find-progress', (e) => setProgress(e.payload.files))
    return () => {
      void un.then((f) => f())
      void invoke('storage_find_cancel')
    }
  }, [])

  const run = async () => {
    setBusy(true)
    setRes(null)
    setSel(new Set())
    setError(null)
    setProgress(0)
    try {
      const r = await invoke<{ files: Found[]; scanned: number; partial: boolean }>('storage_find_files', {
        root: scope,
        minSize: Number(minMb) * 1024 * 1024,
        olderThanDays: mode === 'old' ? Number(age) : null,
        sort: mode === 'old' ? 'oldest' : 'size',
        limit: 300,
      })
      setRes(r)
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'The scan failed.')
    }
    setBusy(false)
  }

  const picked = res?.files.filter((f) => sel.has(f.path)) ?? []
  const pickedSize = picked.reduce((s, f) => s + f.size, 0)
  const sum = (res?.files ?? []).reduce((s, f) => s + f.size, 0)
  const years = (ms: number) => {
    const d = Math.round((Date.now() - ms) / 86_400_000)
    return d > 700 ? `${(d / 365).toFixed(1)} years ago` : d > 60 ? `${Math.round(d / 30)} months ago` : `${d} days ago`
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-(--u-edge) px-6 py-4">
        <h2 className="text-[22px] font-bold tracking-tight">{mode === 'large' ? 'Large files' : 'Old files'}</h2>
        <p className="mt-0.5 text-[12.5px] text-(--u-ink-3)">{mode === 'large' ? 'The biggest files in a place, biggest first.' : 'Big files nobody has changed in a long time: old downloads, installers, finished projects.'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <ScopePicker scopes={scopes} value={scope} onChange={setScope} />
          <Segmented value={minMb} onChange={setMinMb} options={mode === 'large' ? [{ value: '50', label: '50 MB+' }, { value: '100', label: '100 MB+' }, { value: '500', label: '500 MB+' }, { value: '1024', label: '1 GB+' }] : [{ value: '5', label: '5 MB+' }, { value: '20', label: '20 MB+' }, { value: '100', label: '100 MB+' }]} />
          {mode === 'old' && <Segmented value={age} onChange={setAge} options={[{ value: '180', label: '6 months' }, { value: '365', label: '1 year' }, { value: '730', label: '2 years' }, { value: '1825', label: '5 years' }]} />}
          {busy ? (
            <Button variant="tinted" onClick={() => void invoke('storage_find_cancel')}>
              Stop
            </Button>
          ) : (
            <Button variant="accent" disabled={!scope} onClick={() => void run()}>
              {res ? 'Scan again' : 'Scan'}
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 u-scroll">
        {busy && <p className="pt-20 text-center text-[13.5px] text-(--u-ink-3)">Looking through {progress.toLocaleString()} files… This can take a minute on a full drive.</p>}
        {error && <p className="pt-20 text-center text-[13.5px] text-(--u-danger)">{error}</p>}
        {!busy && !res && !error && <p className="mx-auto max-w-[380px] pt-20 text-center text-[13.5px] leading-relaxed text-(--u-ink-3)">Pick where to look and press Scan. Nothing is deleted without you choosing it, and deleted files go to the Recycle Bin.</p>}
        {res && !res.files.length && <p className="pt-20 text-center text-[13.5px] text-(--u-ink-3)">No files match. Try a smaller size{mode === 'old' ? ' or a shorter age' : ''}.</p>}
        {res && res.files.length > 0 && (
          <>
            <p className="px-3 pb-2 pt-1 text-[12px] text-(--u-ink-3)">
              {res.files.length} files, {fmt(sum)} together. Looked through {res.scanned.toLocaleString()} files{res.partial ? ' (stopped at the time limit; the biggest of what it saw are shown)' : ''}.
            </p>
            {res.files.map((f) => {
              const on = sel.has(f.path)
              const name = baseName(f.path)
              return (
                <label key={f.path} className={cn('group flex items-center gap-3 rounded-[8px] px-3 py-1.5', on ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)')}>
                  <input type="checkbox" className="accent-(--u-accent)" checked={on} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(f.path); else n.delete(f.path); return n })} />
                  <FileIcon ext={extOf(name)} isDir={false} size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{name}</span>
                    <span className="block truncate text-[11.5px] text-(--u-ink-3)" title={f.path}>
                      {parentOf(f.path)}
                    </span>
                  </span>
                  <span className="w-[110px] shrink-0 text-right text-[12px] text-(--u-ink-3)">{f.modifiedMs ? years(f.modifiedMs) : ''}</span>
                  <span className="w-[72px] shrink-0 text-right text-[13px] font-medium tabular-nums">{fmt(f.size)}</span>
                  <button type="button" title="Show in Files" onClick={(e) => (e.preventDefault(), openInFiles(parentOf(f.path) ?? f.path))} className="hidden rounded-[6px] px-2 py-0.5 text-[12px] text-(--u-ink-3) hover:bg-(--u-wash-press) hover:text-(--u-ink) group-hover:block">
                    Show
                  </button>
                </label>
              )
            })}
          </>
        )}
      </div>

      {picked.length > 0 && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-(--u-edge) px-6 py-3">
          <span className="flex-1 text-[13px]">
            {picked.length} selected, <b className="font-semibold">{fmt(pickedSize)}</b>
          </span>
          <Button variant="tinted" onClick={() => setSel(new Set())}>
            Clear
          </Button>
          <Button
            variant="danger-solid"
            onClick={async () => {
              const paths = picked.map((p) => p.path)
              await ops.recycle(paths)
              setRes((r) => (r ? { ...r, files: r.files.filter((f) => !paths.includes(f.path)) } : r))
              setSel(new Set())
            }}
          >
            Move to Recycle Bin
          </Button>
        </footer>
      )}
    </div>
  )
}

/* ── duplicates (the same finder Files uses) ─────────────────────── */

function DupesTab({ scopes }: { scopes: { label: string; path: string }[] }) {
  const [scope, setScope] = useState('')
  useEffect(() => {
    if (!scope && scopes[0]) setScope(scopes[0].path)
  }, [scope, scopes])
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-(--u-edge) px-6 py-3">
        <ScopePicker scopes={scopes} value={scope} onChange={setScope} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{scope && <Duplicates key={scope} root={scope} onGo={(l) => l.kind === 'dir' && openInFiles(l.path)} />}</div>
    </div>
  )
}

