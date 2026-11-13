import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { desktopDir, documentDir, downloadDir } from '@tauri-apps/api/path'
import { cn } from '@/shared/lib/cn'
import { launchApp } from '@/integrations/installed-apps/client'
import { openWithSystem, searchDir } from '@/integrations/file-explorer/client'
import type { FileEntry } from '@/integrations/file-explorer/types'
import { fileKind } from '@/features/file-explorer/lib/fileKind'
import { iconForKind } from '@/features/file-explorer/lib/iconForKind'
import { APP_DEFS, APP_IDS, isAppId, type AppId } from '@/os/kernel/registry'
import { openApp } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { AppTileContextMenu } from '@/os/ui/AppTileContextMenu'
import { Menu } from '@tauri-apps/api/menu'
import { curve, dur, springs } from '@/os/motion/systemMotion'
import { SearchIcon, ChevronRightIcon, GlobeIcon, SettingsIcon } from '@/shared/icons'
import { useSystemStatus, describeNetwork } from '@/shared/hooks/useSystemStatus'
import { NetworkStatusIcon } from '@/shared/components/NetworkStatusIcon'
import { evaluate, formatResult } from './calc'
import { MyDay } from './MyDay'
import { getTodayBrief, type DailyBrief } from '@/integrations/daily-brief'
import { buildStories, parseRawItems } from '@/features/news-brief/NewsBriefView'
import { resolveStoryImage } from './newsImages'

const tileHover = { y: -2, scale: 1.04 }
const tileTap   = { scale: 0.93 }
const tileTrans = springs.micro
const ROW_TRANS = 'background-color 80ms ease'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InstalledApp { name: string; id: string }

type PinnedApp =
  | { kind: 'udaan'; appId: AppId }
  | { kind: 'installed'; app: InstalledApp }

type FolderDef = { folder: true; name: string; items: PinnedApp[] }
type PinnedItem = PinnedApp | FolderDef

type Result =
  | { kind: 'udaan';    key: string; title: string; appId: AppId }
  | { kind: 'installed'; key: string; title: string; app: InstalledApp }
  | { kind: 'setting';  key: string; title: string; subtitle: string; run: () => void }
  | { kind: 'file';     key: string; title: string; subtitle: string; entry: FileEntry }
  | { kind: 'calc';     key: string; title: string; value: string }
  | { kind: 'web';      key: string; title: string; query: string }

// ─── Settings search ──────────────────────────────────────────────────────────

const SETTINGS: { title: string; subtitle: string; run: () => void }[] = [
  { title: 'Change wallpaper',     subtitle: 'Wallpaper gallery',  run: () => void emit('launcher:wallpaper') },
  { title: 'Start screensaver',    subtitle: 'Udaan Settings',     run: () => void emit('launcher:screensaver') },
  { title: 'Wallpaper & appearance', subtitle: 'Udaan Settings',  run: () => void openApp('settings', { section: 'personalization' }) },
  { title: 'Dock',                 subtitle: 'Udaan Settings',     run: () => void openApp('settings', { section: 'dock' }) },
  { title: 'Keyboard shortcuts',   subtitle: 'Udaan Settings',     run: () => void openApp('settings', { section: 'keyboard' }) },
  { title: 'Window behaviour',     subtitle: 'Udaan Settings',     run: () => void openApp('settings', { section: 'windows' }) },
  { title: 'Display',              subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:display') },
  { title: 'Sound',                subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:sound') },
  { title: 'Wi-Fi & network',      subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:network') },
  { title: 'Bluetooth & devices',  subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:bluetooth') },
  { title: 'Apps & features',      subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:appsfeatures') },
  { title: 'Windows Update',       subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:windowsupdate') },
  { title: 'Battery & power',      subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:powersleep') },
  { title: 'Privacy & security',   subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:privacy') },
  { title: 'Date & time',          subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:dateandtime') },
  { title: 'Storage',              subtitle: 'Windows Settings',   run: () => void launchApp('ms-settings:storagesense') },
]

// ─── Persistence ──────────────────────────────────────────────────────────────

const SK_PINNED    = 'udaan-start-pinned-v2'
const SK_UTILITIES = 'udaan-start-utilities-v2'

const DEFAULT_PINNED: PinnedItem[] = [
  { kind: 'udaan', appId: 'file-explorer' },
  { kind: 'udaan', appId: 'chat' },
  { kind: 'udaan', appId: 'calendar' },
  { kind: 'udaan', appId: 'notes' },
  { kind: 'udaan', appId: 'private-player' },
  { kind: 'udaan', appId: 'news-brief' },
  { kind: 'udaan', appId: 'omni-find' },
  { kind: 'udaan', appId: 'studio' },
  { kind: 'udaan', appId: 'tv' },
  { kind: 'udaan', appId: 'audio-recorder' },
  { folder: true, name: 'Utilities', items: [
    { kind: 'udaan', appId: 'screenshot' },
    { kind: 'udaan', appId: 'clipboard' },
    { kind: 'udaan', appId: 'photos' },
    { kind: 'udaan', appId: 'storage' },
    { kind: 'udaan', appId: 'viewer-3d' },
    { kind: 'udaan', appId: 'cnc-mod-switcher' },
  ]},
  { kind: 'udaan', appId: 'settings' },
]
const DEFAULT_UTILITIES: PinnedApp[] = [{ kind: 'udaan', appId: 'claude-usage' }]

// Saved lists outlive the apps in them; an id whose app was removed (the
// Creator Studio apps, AgriTrack) crashed every surface that drew it.
function validApp(a: PinnedApp | null | undefined): a is PinnedApp {
  if (!a) return false
  return a.kind === 'udaan' ? isAppId(a.appId) : a.kind === 'installed' && !!a.app?.id
}
function cleanItems(items: unknown): PinnedItem[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((it: PinnedItem): PinnedItem[] =>
    it && 'folder' in it
      ? Array.isArray(it.items) ? [{ ...it, items: it.items.filter(validApp) }] : []
      : validApp(it) ? [it] : [],
  )
}

function loadPinned(): PinnedItem[] {
  try {
    const r = localStorage.getItem(SK_PINNED)
    if (r) {
      const saved = cleanItems(JSON.parse(r))
      if (saved.length) return saved
    }
  } catch {}
  return DEFAULT_PINNED
}
function savePinned(v: PinnedItem[]) { try { localStorage.setItem(SK_PINNED, JSON.stringify(v)) } catch {} }
function loadUtilities(): PinnedApp[] {
  try {
    const r = localStorage.getItem(SK_UTILITIES)
    if (r) { const v = JSON.parse(r); if (Array.isArray(v)) return v.filter(validApp) }
  } catch {}
  return DEFAULT_UTILITIES
}
function saveUtilities(v: PinnedApp[]) { try { localStorage.setItem(SK_UTILITIES, JSON.stringify(v)) } catch {} }

// ─── Scoring ──────────────────────────────────────────────────────────────────

function score(text: string, q: string): number {
  const t = text.toLowerCase()
  if (!q) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 60
  if (t.includes(q)) return 40
  let i = 0; for (const c of t) if (c === q[i]) i++
  return i === q.length ? 15 : 0
}

// ─── Caches ───────────────────────────────────────────────────────────────────

let appsCache: InstalledApp[] | null = null
let appsFetchedAt = 0
let userCache = ''
const iconCache = new Map<string, string | null>()

function useInstalledApps() {
  const [apps, setApps] = useState<InstalledApp[]>(appsCache ?? [])
  useEffect(() => {
    if (appsCache && Date.now() - appsFetchedAt < 10 * 60_000) return
    appsFetchedAt = Date.now()
    void invoke<InstalledApp[]>('shell_installed_apps').then((list) => { appsCache = list; setApps(list) }, () => {})
  }, [])
  return apps
}

// ─── Icon components ──────────────────────────────────────────────────────────

function InstalledIcon({ id, size }: { id: string; size: number }) {
  const [src, setSrc] = useState(() => iconCache.get(id) ?? null)
  useEffect(() => {
    if (iconCache.has(id)) return
    let cancelled = false
    void invoke<Record<string, string | null>>('shell_installed_app_icons', { ids: [id] }).then((r) => {
      iconCache.set(id, r[id] ?? null)
      if (!cancelled) setSrc(r[id] ?? null)
    })
    return () => { cancelled = true }
  }, [id])
  return src
    ? <img src={src} alt="" draggable={false} style={{ width: size, height: size }} className="object-contain" />
    : <span style={{ width: size, height: size }} className="rounded-[22%] bg-(--os-hover)" />
}

function PinnedAppIcon({ item, size }: { item: PinnedApp; size: number }) {
  if (item.kind === 'udaan') return <AppIcon appId={item.appId} size={size} />
  return <InstalledIcon id={item.app.id} size={size} />
}
function PinnedAppName(item: PinnedApp): string {
  return item.kind === 'udaan' ? APP_DEFS[item.appId].name : item.app.name
}

function ResultIcon({ r, size }: { r: Result; size: number }) {
  if (r.kind === 'udaan') return <AppIcon appId={r.appId} size={size} />
  if (r.kind === 'installed') return <InstalledIcon id={r.app.id} size={size} />
  const icon = r.kind === 'file' ? iconForKind(fileKind(r.entry.extension, r.entry.isDir))
    : r.kind === 'web' ? GlobeIcon : r.kind === 'setting' ? SettingsIcon : SearchIcon
  return (
    <span className="flex items-center justify-center rounded-[22%] bg-(--os-hover)" style={{ width: size, height: size }}>
      {createElement(icon, { width: size * 0.55, height: size * 0.55, className: 'text-(--os-text)' })}
    </span>
  )
}

// ─── Launch ───────────────────────────────────────────────────────────────────

async function launchPinnedApp(item: PinnedApp) {
  if (item.kind === 'udaan') return openApp(item.appId)
  return launchApp(`shell:AppsFolder\\${item.app.id}`)
}
async function runResult(r: Result) {
  if (r.kind === 'udaan') return openApp(r.appId)
  if (r.kind === 'installed') return launchApp(`shell:AppsFolder\\${r.app.id}`)
  if (r.kind === 'setting') return r.run()
  if (r.kind === 'file') return r.entry.isDir ? openApp('file-explorer', { initialPath: r.entry.path }) : openWithSystem(r.entry.path)
  if (r.kind === 'calc') return navigator.clipboard.writeText(r.value)
  if (r.kind === 'web') return launchApp(`https://www.google.com/search?q=${encodeURIComponent(r.query)}`)
}
async function showPowerMenu() {
  const pw = (action: string) => () => void invoke('shell_power', { action })
  const menu = await Menu.new({ items: [
    { text: 'Lock Udaan',  action: () => void emit('launcher:lock') },
    { text: 'Lock Windows', action: pw('lock') },
    { text: 'Sleep',       action: pw('sleep') },
    { text: 'Sign out',    action: pw('sign-out') },
    { item: 'Separator' },
    { text: 'Restart',     action: pw('restart') },
    { text: 'Shut down',   action: pw('shut-down') },
  ]})
  await menu.popup()
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

/**
 * An app tile.
 *
 * The highlight follows the pointer rather than filling the whole tile.
 * On a grid this size a uniform hover wash says "something is selected";
 * a light that tracks the cursor says "this is a surface you are touching",
 * and it makes the grid feel responsive between tiles as well as on them.
 */
function Tile({ label, path, onClick, children }: { label: string; path?: string; onClick: () => void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null)
  const tile = (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      onPointerMove={(e) => {
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        // Written straight to CSS custom properties: no React state, so
        // this costs nothing per frame even across sixty tiles.
        el.style.setProperty('--tile-x', `${e.clientX - r.left}px`)
        el.style.setProperty('--tile-y', `${e.clientY - r.top}px`)
      }}
      whileHover={tileHover}
      whileTap={tileTap}
      transition={tileTrans}
      className="group relative isolate flex flex-col items-center gap-[7px] rounded-[12px] px-1 py-3"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(120px circle at var(--tile-x, 50%) var(--tile-y, 50%), var(--os-active), var(--os-hover) 70%)',
        }}
      />
      {children}
      <span className="w-full truncate text-center text-[12px] font-medium leading-tight">{label}</span>
    </motion.button>
  )
  return <AppTileContextMenu action={{ path, onOpen: onClick }}>{tile}</AppTileContextMenu>
}

/** The real launch target for a pinned item's "Run as administrator"/"Properties" menu items — a `shell:AppsFolder\<id>` path for installed apps, absent for Udaan's own built-in views (nothing on disk to elevate). */
function pinnedAppPath(item: PinnedApp): string | undefined {
  return item.kind === 'installed' ? `shell:AppsFolder\\${item.app.id}` : undefined
}

function appKey(a: PinnedApp): string {
  return a.kind === 'udaan' ? `u:${a.appId}` : `i:${a.app.id}`
}

// ─── Folder tile ──────────────────────────────────────────────────────────────

function FolderTile({ folder, onOpen }: { folder: FolderDef; onOpen: () => void }) {
  const preview = folder.items.slice(0, 4)
  return (
    <motion.button type="button" onClick={onOpen}
      whileHover={tileHover} whileTap={tileTap} transition={tileTrans}
      className="flex flex-col items-center gap-[7px] rounded-[12px] px-1 py-3 hover:bg-(--os-hover)"
    >
      <div className="grid grid-cols-2 gap-[3px] rounded-[10px] p-[5px]"
        style={{ width: 44, height: 44, background: 'var(--os-menu-item-hover)' }}>
        {preview.map((item, i) => <PinnedAppIcon key={i} item={item} size={17} />)}
        {preview.length < 4 && Array.from({ length: 4 - preview.length }).map((_, i) => (
          <span key={i} className="rounded-[3px] opacity-30" style={{ width: 17, height: 17, background: 'var(--surface-hover)' }} />
        ))}
      </div>
      <span className="w-full truncate text-center text-[12px] font-medium leading-tight">{folder.name}</span>
    </motion.button>
  )
}

// ─── Folder modal ─────────────────────────────────────────────────────────────

function FolderModal({ folder, onClose, onLaunch }: { folder: FolderDef; onClose: () => void; onLaunch: (item: PinnedApp) => void }) {
  return (
    <motion.div className="absolute inset-0 z-10 flex flex-col items-center justify-center"
      style={{ background: 'color-mix(in srgb, var(--os-acrylic) 94%, transparent)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.fast } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
    >
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close folder" />
      <motion.div className="relative z-10 w-[540px] overflow-hidden rounded-[20px] border border-[var(--os-acrylic-border)] bg-(--os-hover) shadow-[var(--os-shadow-overlay)]"
        initial={{ scale: 0.88, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1, transition: { ...springs.flyout } }}
        exit={{ scale: 0.92, y: 8, opacity: 0, transition: { duration: 0.1, ease: curve.accelerate } }}
      >
        <div className="px-6 pb-1 pt-5"><h3 className="text-[16px] font-semibold">{folder.name}</h3></div>
        <div className="grid grid-cols-5 gap-1 px-4 pb-5 pt-2">
          {folder.items.map((item, i) => (
            <motion.button key={i} type="button" onClick={() => onLaunch(item)}
              whileHover={tileHover} whileTap={tileTap} transition={tileTrans}
              className="flex flex-col items-center gap-2 rounded-[12px] px-2 py-3 hover:bg-(--os-hover)"
            >
              <PinnedAppIcon item={item} size={42} />
              <span className="w-full truncate text-center text-[11px] font-medium">{PinnedAppName(item)}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Drag-to-reorder grid ─────────────────────────────────────────────────────
// Uses pointermove + getBoundingClientRect hit-test on the container so that
// setPointerCapture (which routes all events to the dragging element) still
// lets us figure out which cell the pointer is over.

function DragGrid({
  items,
  cols = 4,
  onChange,
  renderItem,
}: {
  items: PinnedItem[]
  cols?: number
  onChange: (items: PinnedItem[]) => void
  renderItem: (item: PinnedItem, idx: number) => ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragIdx = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  function hitIndex(clientX: number, clientY: number): number | null {
    const el = containerRef.current
    if (!el) return null
    const cells = el.querySelectorAll<HTMLElement>('[data-drag-cell]')
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i].getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return i
    }
    return null
  }

  function onPointerDown(idx: number, e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragIdx.current = idx
    setDragOver(idx)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragIdx.current === null) return
    const over = hitIndex(e.clientX, e.clientY)
    if (over === null || over === dragIdx.current) return
    setDragOver(over)
    const next = [...items]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(over, 0, moved)
    dragIdx.current = over
    onChange(next)
  }

  function onPointerUp() {
    dragIdx.current = null
    setDragOver(null)
  }

  return (
    <div
      ref={containerRef}
      className={`grid gap-1`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          data-drag-cell
          className={cn(
            'group relative flex flex-col items-center gap-1 rounded-[10px] p-2 select-none transition-[transform,background-color,box-shadow] duration-100',
            dragOver === idx ? 'scale-105 bg-(--os-hover) ring-1 ring-accent/40' : 'hover:bg-(--os-hover)',
          )}
          style={{ cursor: dragIdx.current !== null ? 'grabbing' : 'grab', touchAction: 'none' }}
          onPointerDown={(e) => onPointerDown(idx, e)}
        >
          {renderItem(item, idx)}
        </div>
      ))}
    </div>
  )
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({
  pinned, utilities, allInstalled, onSave, onClose,
}: {
  pinned: PinnedItem[]
  utilities: PinnedApp[]
  allInstalled: InstalledApp[]
  onSave: (pinned: PinnedItem[], utilities: PinnedApp[]) => void
  onClose: () => void
}) {
  const [draft, setDraft]       = useState<PinnedItem[]>(pinned)
  const [utilDraft, setUtilDraft] = useState<PinnedApp[]>(utilities)
  const [tab, setTab]           = useState<'pinned' | 'quick' | 'folder'>('pinned')
  const [folderName, setFolderName] = useState('')
  const [folderItems, setFolderItems] = useState<PinnedApp[]>([])
  const [editingFolderIdx, setEditingFolderIdx] = useState<number | null>(null)
  const [appSearch, setAppSearch] = useState('')
  const aq = appSearch.trim().toLowerCase()

  const installedNotPinned = allInstalled.filter((a) =>
    !draft.some((p) => 'folder' in p
      ? p.items.some((i) => i.kind === 'installed' && i.app.id === a.id)
      : p.kind === 'installed' && p.app.id === a.id)
    && !utilDraft.some((u) => u.kind === 'installed' && u.app.id === a.id)
  )
  const udaanNotPinned = APP_IDS.filter((id) =>
    !draft.some((p) => 'folder' in p
      ? p.items.some((i) => i.kind === 'udaan' && i.appId === id)
      : p.kind === 'udaan' && p.appId === id)
    && !utilDraft.some((u) => u.kind === 'udaan' && u.appId === id)
  )
  const filteredInstalled = aq
    ? installedNotPinned.filter((a) => a.name.toLowerCase().includes(aq))
    : installedNotPinned

  function removeItem(idx: number) { setDraft((d) => d.filter((_, i) => i !== idx)) }
  function addUdaanApp(id: AppId)  { setDraft((d) => [...d, { kind: 'udaan', appId: id }]) }
  function addInstalledApp(a: InstalledApp) { setDraft((d) => [...d, { kind: 'installed', app: a }]) }

  function startEditFolder(idx: number) {
    const item = draft[idx]
    if ('folder' in item) { setFolderName(item.name); setFolderItems(item.items); setEditingFolderIdx(idx); setTab('folder') }
  }

  function toggleFolderUdaan(id: AppId) {
    const has = folderItems.some((i) => i.kind === 'udaan' && i.appId === id)
    setFolderItems((p) => has ? p.filter((i) => !(i.kind === 'udaan' && i.appId === id)) : [...p, { kind: 'udaan', appId: id }])
  }
  function toggleFolderInstalled(app: InstalledApp) {
    const has = folderItems.some((i) => i.kind === 'installed' && i.app.id === app.id)
    setFolderItems((p) => has ? p.filter((i) => !(i.kind === 'installed' && i.app.id === app.id)) : [...p, { kind: 'installed', app }])
  }

  function saveFolder() {
    if (!folderName.trim() || folderItems.length === 0) return
    const folder: FolderDef = { folder: true, name: folderName.trim(), items: folderItems }
    if (editingFolderIdx !== null) setDraft((d) => d.map((item, i) => i === editingFolderIdx ? folder : item))
    else setDraft((d) => [...d, folder])
    setTab('pinned'); setFolderName(''); setFolderItems([]); setEditingFolderIdx(null)
  }

  const TAB_LABEL: Record<'pinned' | 'quick' | 'folder', string> = {
    pinned: 'Pinned',
    quick: 'Quick bar',
    folder: editingFolderIdx !== null ? 'Edit folder' : 'New folder',
  }

  return (
    <motion.div className="absolute inset-0 z-20 flex flex-col bg-[var(--os-acrylic)]"
      initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.fast } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-(--os-separator) px-5 py-3">
        <div className="flex gap-1">
          {(['pinned', 'quick', 'folder'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn('rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                tab === t ? 'bg-[var(--color-accent)] text-white' : 'bg-(--os-hover) hover:bg-(--os-active)')}
            >{TAB_LABEL[t]}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onSave(draft, utilDraft)} className="rounded-[8px] bg-[var(--color-accent)] px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[var(--color-accent-muted)]">Done</button>
          <button type="button" onClick={onClose} className="rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12.5px] font-medium hover:bg-(--os-active)">Cancel</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Pinned tab ── */}
        {tab === 'pinned' && (
          <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
            {/* Left: current pinned — drag to reorder */}
            <div className="flex w-[260px] shrink-0 flex-col border-r border-(--os-separator)">
              <p className="px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-(--os-text-dim)">
                Drag to reorder · × to remove
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                <DragGrid items={draft} cols={4} onChange={setDraft}
                  renderItem={(item, idx) => (
                    <>
                      {'folder' in item ? (
                        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => startEditFolder(idx)}
                          className="flex flex-col items-center gap-1">
                          <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-(--os-hover) text-[20px]">📁</span>
                          <span className="w-full truncate text-center text-[10px]">{item.name}</span>
                        </button>
                      ) : (
                        <>
                          <PinnedAppIcon item={item} size={32} />
                          <span className="w-full truncate text-center text-[10px]">{PinnedAppName(item)}</span>
                        </>
                      )}
                      <button type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => removeItem(idx)}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500/80 text-[9px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >×</button>
                    </>
                  )}
                />
              </div>
            </div>

            {/* Right: add apps */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-(--os-text-dim)">Add app</p>
                <input value={appSearch} onChange={(e) => setAppSearch(e.target.value)}
                  placeholder="Search…"
                  className="ml-auto w-[160px] rounded-[8px] border border-[var(--border-hairline)] bg-(--os-hover) px-3 py-1 text-[12px] outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {!aq && udaanNotPinned.length > 0 && (
                  <>
                    <p className="mb-1 px-1 text-[10px] text-(--os-text-dim)">Udaan</p>
                    <div className="mb-3 grid grid-cols-5 gap-1">
                      {udaanNotPinned.map((id) => (
                        <button key={id} type="button" onClick={() => addUdaanApp(id)}
                          className="flex flex-col items-center gap-1 rounded-[8px] p-2 opacity-60 hover:bg-(--os-hover) hover:opacity-100">
                          <AppIcon appId={id} size={26} />
                          <span className="w-full truncate text-center text-[10px]">{APP_DEFS[id].name}</span>
                        </button>
                      ))}
                    </div>
                    <p className="mb-1 px-1 text-[10px] text-(--os-text-dim)">Installed ({installedNotPinned.length})</p>
                  </>
                )}
                {aq && <p className="mb-1 px-1 text-[10px] text-(--os-text-dim)">{filteredInstalled.length} result{filteredInstalled.length !== 1 ? 's' : ''}</p>}
                <div className="grid grid-cols-5 gap-1">
                  {filteredInstalled.map((a) => (
                    <button key={a.id} type="button" onClick={() => addInstalledApp(a)}
                      className="flex flex-col items-center gap-1 rounded-[8px] p-2 opacity-60 hover:bg-(--os-hover) hover:opacity-100">
                      <InstalledIcon id={a.id} size={26} />
                      <span className="w-full truncate text-center text-[10px]">{a.name}</span>
                    </button>
                  ))}
                  {filteredInstalled.length === 0 && aq && (
                    <p className="col-span-5 py-4 text-center text-[12px] text-(--os-text-dim)">No results for "{appSearch}"</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Quick bar tab ── */}
        {tab === 'quick' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-(--os-text-dim)">Current</p>
            <div className="flex flex-wrap gap-1.5">
              {utilDraft.map((item, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-[8px] bg-(--os-hover) px-2.5 py-1.5">
                  <PinnedAppIcon item={item} size={15} />
                  <span className="text-[12px]">{PinnedAppName(item)}</span>
                  <button type="button" onClick={() => setUtilDraft((d) => d.filter((_, j) => j !== i))} className="ml-0.5 text-[11px] opacity-50 hover:opacity-100">×</button>
                </div>
              ))}
              {utilDraft.length === 0 && <p className="text-[12px] text-(--os-text-dim)">Nothing added yet</p>}
            </div>
            <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-(--os-text-dim)">Add</p>
            <div className="flex flex-wrap gap-1.5">
              {APP_IDS.filter((id) => !utilDraft.some((u) => u.kind === 'udaan' && u.appId === id)).map((id) => (
                <button key={id} type="button" onClick={() => setUtilDraft((d) => [...d, { kind: 'udaan', appId: id }])}
                  className="flex items-center gap-1.5 rounded-[8px] border border-dashed border-[var(--border-hairline)] px-2.5 py-1.5 opacity-50 hover:opacity-100">
                  <AppIcon appId={id} size={15} />
                  <span className="text-[12px]">{APP_DEFS[id].name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Folder tab ── */}
        {tab === 'folder' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <input value={folderName} onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name" autoFocus
              className="w-full rounded-[8px] border border-[var(--border-hairline)] bg-(--os-hover) px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-(--os-text-dim)">Udaan apps</p>
            <div className="grid grid-cols-7 gap-1">
              {APP_IDS.map((id) => {
                const sel = folderItems.some((i) => i.kind === 'udaan' && i.appId === id)
                return (
                  <button key={id} type="button" onClick={() => toggleFolderUdaan(id)}
                    className={cn('flex flex-col items-center gap-1 rounded-[8px] p-2 text-[10px]', sel ? 'bg-[var(--color-accent)]/15 ring-1 ring-accent' : 'hover:bg-(--os-hover)')}>
                    <AppIcon appId={id} size={26} />
                    <span className="w-full truncate text-center">{APP_DEFS[id].name}</span>
                  </button>
                )
              })}
            </div>
            {allInstalled.length > 0 && (
              <>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-(--os-text-dim)">Installed apps</p>
                <div className="grid grid-cols-7 gap-1">
                  {allInstalled.map((a) => {
                    const sel = folderItems.some((i) => i.kind === 'installed' && i.app.id === a.id)
                    return (
                      <button key={a.id} type="button" onClick={() => toggleFolderInstalled(a)}
                        className={cn('flex flex-col items-center gap-1 rounded-[8px] p-2 text-[10px]', sel ? 'bg-[var(--color-accent)]/15 ring-1 ring-accent' : 'hover:bg-(--os-hover)')}>
                        <InstalledIcon id={a.id} size={26} />
                        <span className="w-full truncate text-center">{a.name}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={saveFolder} disabled={!folderName.trim() || folderItems.length === 0}
                className="rounded-[8px] bg-[var(--color-accent)] px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40 hover:bg-[var(--color-accent-muted)]">
                {editingFolderIdx !== null ? 'Update' : 'Create'}
              </button>
              <button type="button" onClick={() => { setTab('pinned'); setEditingFolderIdx(null) }}
                className="rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12.5px] hover:bg-(--os-active)">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Status bar (above footer) ────────────────────────────────────────────────

function StatusBar({ onClose }: { onClose: () => void }) {
  const { battery, wifi, online } = useSystemStatus()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const networkLabel = describeNetwork(wifi, online)
  function BatteryIcon({ pct, charging }: { pct: number; charging: boolean }) {
    const fill = Math.max(0, Math.min(1, pct / 100))
    const color = charging ? '#22c55e' : pct <= 20 ? '#ef4444' : 'currentColor'
    return (
      <svg viewBox="0 0 24 12" width="28" height="14" fill="none">
        <rect x="0.5" y="0.5" width="20" height="11" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <rect x="21" y="4" width="2.5" height="4" rx="1" fill="currentColor" opacity="0.4" />
        <rect x="1.5" y="1.5" width={Math.round(18 * fill)} height="9" rx="1.5" fill={color} />
        {charging && (
          <path d="M9 7.5 11 4.5h2L11 7.5h2L10 10.5l1-3z" fill="white" opacity="0.9" />
        )}
      </svg>
    )
  }

  return (
    <div className="flex items-center border-t border-(--os-separator) bg-(--os-hover)/30 px-5 py-2.5">
      {/* Time + date */}
      <button type="button" onClick={() => { onClose(); void launchApp('ms-settings:dateandtime') }}
        className="mr-4 flex flex-col items-start rounded-[8px] px-2.5 py-1.5 hover:bg-(--os-hover) transition-colors duration-75">
        <span className="text-[18px] font-semibold leading-none">{timeStr}</span>
        <span className="text-[11px] text-(--os-text-dim)">{dateStr}</span>
      </button>

      <div className="h-8 w-px bg-(--os-separator) mx-1" />

      {/* Network */}
      <button type="button" title={networkLabel}
        onClick={() => { onClose(); void launchApp('ms-settings:network') }}
        className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] hover:bg-(--os-hover) transition-colors duration-75">
        <NetworkStatusIcon wifi={wifi} online={online} width={17} height={17} />
        <span className="max-w-[110px] truncate text-[11.5px]">{networkLabel}</span>
      </button>

      {/* Battery */}
      {battery?.hasBattery && (
        <button type="button" title={`Battery ${battery.percent}%${battery.isCharging ? ' · Charging' : ''}`}
          onClick={() => { onClose(); void launchApp('ms-settings:powersleep') }}
          className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 hover:bg-(--os-hover) transition-colors duration-75">
          <BatteryIcon pct={battery.percent} charging={battery.isCharging} />
          <span className="text-[11.5px]">{battery.percent}%</span>
        </button>
      )}

      <span className="flex-1" />

      {/* Quick shortcuts */}
      <div className="flex items-center gap-1">
        <button type="button" title="Sound settings"
          onClick={() => { onClose(); void launchApp('ms-settings:sound') }}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-(--os-hover) transition-colors duration-75">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
        <button type="button" title="Bluetooth"
          onClick={() => { onClose(); void launchApp('ms-settings:bluetooth') }}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-(--os-hover) transition-colors duration-75">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" />
          </svg>
        </button>
        <button type="button" title="Notifications · Focus assist"
          onClick={() => { onClose(); void launchApp('ms-settings:quiethours') }}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-(--os-hover) transition-colors duration-75">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <button type="button" title="Screen brightness"
          onClick={() => { onClose(); void launchApp('ms-settings:display') }}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-(--os-hover) transition-colors duration-75">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, action, onAction, extra }: { title: string; action?: string; onAction?: () => void; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2.5 pt-4">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <span className="flex-1" />
      {extra}
      {action && (
        <button type="button" onClick={onAction}
          className="flex items-center gap-1 rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12px] font-medium hover:bg-(--os-active)">
          {action} <ChevronRightIcon width={11} height={11} />
        </button>
      )}
    </div>
  )
}

// ─── News feed ────────────────────────────────────────────────────────────────
// Win11's Start Menu carries a "News and interests" strip of image-backed
// headline cards below the pinned/recommended apps — this is Udaan's
// equivalent, reusing the same daily-brief data MyDay's "Your news brief"
// card shows, just surfaced directly on the home screen rather than behind
// the My Day toggle, since that's where Win11 actually puts it.

function useStartMenuBrief() {
  const [brief, setBrief] = useState<DailyBrief | null | undefined>(undefined)
  useEffect(() => {
    void getTodayBrief().then(setBrief, () => setBrief(null))
  }, [])
  return brief
}

/** The "Udaan News" tile shown when a story has no picture that is good enough: the News app's mark on an ink-and-red backdrop. */
function UdaanNewsTile({ section }: { section: string }) {
  return (
    <span
      className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden"
      style={{ background: 'radial-gradient(120% 140% at 12% 0%, #6d1522 0%, #2a0d14 38%, #0d0a0c 100%)' }}
    >
      <span aria-hidden className="absolute inset-0 opacity-[0.14]" style={{ backgroundImage: 'repeating-linear-gradient(115deg, #fff 0 1px, transparent 1px 14px)' }} />
      <span aria-hidden className="absolute -right-8 -top-10 h-40 w-40 rounded-full" style={{ background: 'radial-gradient(circle, rgb(255 79 94 / 0.38), transparent 68%)' }} />
      <span className="relative flex items-center gap-3">
        <AppIcon appId="news-brief" size={46} />
        <span className="flex flex-col leading-none">
          <span className="text-[19px] font-bold tracking-[-0.01em] text-white">
            Udaan<span className="font-light text-white/70"> News</span>
          </span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <span className="h-[2px] w-5 rounded-full bg-[#ff4f5e]" />
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-white/55">{section}</span>
          </span>
        </span>
      </span>
    </span>
  )
}

/** One story card. A real picture is only ever shown if it was checked for size and quality; otherwise the Udaan News tile stands in. */
function NewsCard({ story, src, onOpen }: { story: { headline: string; section: string; source: string | null }; src: string | null; onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: curve.decelerate }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      className="group flex min-w-0 flex-col overflow-hidden rounded-[12px] bg-(--os-hover) text-left transition-colors hover:bg-(--os-hover)"
    >
      {src ? (
        <span className="relative block aspect-[16/9] w-full overflow-hidden bg-(--os-hover)">
          <img src={src} alt="" decoding="async" referrerPolicy="no-referrer" draggable={false} className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />
        </span>
      ) : (
        <UdaanNewsTile section={story.section} />
      )}
      <span className="block p-2.5">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">
          {story.section}
          {story.source && <span className="font-medium normal-case tracking-normal text-(--os-text-dim)"> · {story.source}</span>}
        </span>
        <span className="mt-1 line-clamp-2 block text-[12.5px] font-medium leading-snug">{story.headline}</span>
      </span>
    </motion.button>
  )
}

function NewsFeedSection({ onClose }: { onClose: () => void }) {
  const brief = useStartMenuBrief()
  // A generous pool, round-robin across sections, so there are plenty of
  // candidates to find good pictures for.
  const pool = useMemo(() => {
    if (!brief) return []
    const { sections } = buildStories(brief, parseRawItems(brief.raw_items_json))
    const ranked = sections.map((s) => [...s.stories].sort((a, b) => Number(!!b.image) - Number(!!a.image)))
    const out = []
    for (let round = 0; out.length < 18 && round < 4; round++) for (const stories of ranked) if (stories[round] && out.length < 18) out.push(stories[round])
    return out
  }, [brief])

  const [images, setImages] = useState<Record<string, string>>({})
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    let off = false
    setSettled(false)
    const queue = [...pool]
    let found = 0
    const worker = async () => {
      while (!off && queue.length && found < 6) {
        const story = queue.shift()!
        const url = await resolveStoryImage(story)
        if (url && !off && found < 6) {
          found++
          setImages((m) => ({ ...m, [story.headline]: url }))
        }
      }
    }
    void Promise.all([worker(), worker(), worker(), worker()]).then(() => !off && setSettled(true))
    return () => {
      off = true
    }
  }, [pool])

  if (brief === undefined) return null
  if (pool.length === 0 && !brief?.degraded) return null

  // Stories with a verified picture first; once searching is done, any gaps are
  // filled with the next stories shown on the Udaan News tile.
  const withPicture = pool.filter((s) => images[s.headline])
  const cards = settled ? [...withPicture, ...pool.filter((s) => !images[s.headline])].slice(0, 6) : withPicture.slice(0, 6)

  const open = () => {
    onClose()
    void openApp('news-brief')
  }

  return (
    <>
      <SectionHeader title="News and interests" action="Open" onAction={open} />
      {pool.length === 0 ? (
        <p className="pb-3 text-[12.5px] text-(--os-text-dim)">Today's brief couldn't be written — open News to retry.</p>
      ) : cards.length === 0 ? (
        <div className="grid grid-cols-3 gap-2.5 pb-5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-[12px] bg-(--os-hover)">
              <div className="aspect-[16/9] animate-pulse bg-(--os-hover)" />
              <div className="space-y-2 p-2.5">
                <div className="h-2 w-1/3 animate-pulse rounded bg-(--os-hover)" />
                <div className="h-3 w-full animate-pulse rounded bg-(--os-hover)" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 pb-5">
          {cards.map((s) => (
            <NewsCard key={s.headline} story={s} src={images[s.headline] ?? null} onOpen={open} />
          ))}
        </div>
      )}
    </>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function StartMenu({ onClose }: { onClose: () => void }) {
  const apps    = useInstalledApps()
  const [query, setQuery]   = useState('')
  const [view, setView]     = useState<'home' | 'all' | 'day'>('home')
  const [active, setActive] = useState(0)
  const [files, setFiles]   = useState<FileEntry[]>([])
  const [user, setUser]     = useState(userCache)
  const [openFolder, setOpenFolder] = useState<FolderDef | null>(null)
  const [editing, setEditing]       = useState(false)
  const [pinned, setPinned]         = useState<PinnedItem[]>(loadPinned)
  const [utilities, setUtilities]   = useState<PinnedApp[]>(loadUtilities)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)
  // Heavier content waits for the open animation, so the panel itself animates on a light tree.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 240)
    return () => clearTimeout(timer)
  }, [])
  const q = query.trim().toLowerCase()

  useEffect(() => {
    if (!userCache)
      void invoke<string>('shell_user_name').then((u) => { userCache = u; setUser(u) }, () => {})
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (q.length < 2) return
    let stale = false
    const t = setTimeout(async () => {
      const dirs = await Promise.all([desktopDir(), documentDir(), downloadDir()])
      const found = (await Promise.all(dirs.map((d) => searchDir(d, q, true).catch(() => [] as FileEntry[])))).flat()
      if (!stale) setFiles(found.sort((a, b) => score(b.name, q) - score(a.name, q)).slice(0, 6))
    }, 180)
    return () => { stale = true; clearTimeout(t) }
  }, [q])

  const groups = useMemo(() => {
    if (!q) return [] as { label: string; items: Result[] }[]
    const udaan = APP_IDS.map((id) => ({ id, s: score(APP_DEFS[id].name, q) }))
      .filter((x) => x.s > 0)
      .map((x): Result & { s: number } => ({ kind: 'udaan', key: `u:${x.id}`, title: APP_DEFS[x.id].name, appId: x.id, s: x.s + 5 }))
    const installed = apps.map((a) => ({ a, s: score(a.name, q) })).filter((x) => x.s > 0)
      .map((x): Result & { s: number } => ({ kind: 'installed', key: `i:${x.a.id}`, title: x.a.name, app: x.a, s: x.s }))
    const allApps = [...udaan, ...installed].sort((a, b) => b.s - a.s).slice(0, 8)
    const settings = SETTINGS.map((st) => ({ st, s: Math.max(score(st.title, q), score(st.subtitle, q) / 3) }))
      .filter((x) => x.s > 10).sort((a, b) => b.s - a.s).slice(0, 4)
      .map((x): Result => ({ kind: 'setting', key: `s:${x.st.title}`, title: x.st.title, subtitle: x.st.subtitle, run: x.st.run }))
    const value = evaluate(query)
    const out: { label: string; items: Result[] }[] = []
    if (value !== null) out.push({ label: 'Calculator', items: [{ kind: 'calc', key: 'calc', title: `= ${formatResult(value)}`, value: String(value) }] })
    if (allApps.length) out.push({ label: 'Apps', items: allApps })
    if (settings.length) out.push({ label: 'Settings', items: settings })
    if (q.length >= 2 && files.length)
      out.push({ label: 'Files', items: files.map((f): Result => ({ kind: 'file', key: `f:${f.path}`, title: f.name, subtitle: f.path.replace(/[\\/][^\\/]+$/, ''), entry: f })) })
    out.push({ label: 'Web', items: [{ kind: 'web', key: 'web', title: `Search the web for "${query.trim()}"`, query: query.trim() }] })
    return out
  }, [q, query, apps, files])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const [lastQ, setLastQ] = useState(q)
  if (q !== lastQ) { setLastQ(q); setActive(0) }

  const run = useCallback((r: Result | undefined) => {
    if (!r) return; onClose(); void runResult(r)
  }, [onClose])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(flat.length - 1, a + 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
    else if (e.key === 'Enter' && q) {
      const r = flat[active]
      if (e.ctrlKey && r?.kind === 'file') { onClose(); void openApp('file-explorer', { initialPath: r.subtitle }) }
      else run(r)
    } else if (e.key === 'Escape') {
      if (openFolder) { setOpenFolder(null); return }
      if (editing) { setEditing(false); return }
      if (query) setQuery('')
      else if (view !== 'home') setView('home')
      else onClose()
    } else return
    e.preventDefault()
  }

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const letters = useMemo(() => {
    const m = new Map<string, InstalledApp[]>()
    for (const a of apps) {
      const c = /[a-z]/i.test(a.name[0]) ? a.name[0].toUpperCase() : '#'
      m.set(c, [...(m.get(c) ?? []), a])
    }
    return [...m.entries()]
  }, [apps])

  function handleSaveEdit(np: PinnedItem[], nu: PinnedApp[]) {
    setPinned(np); setUtilities(nu); savePinned(np); saveUtilities(nu); setEditing(false)
  }

  const isPinned = (item: PinnedApp) => pinned.some((p) => !('folder' in p) && appKey(p) === appKey(item))
  const pinAction = (item: PinnedApp) => ({
    pinned: isPinned(item),
    onPin: () => { const next = [...pinned, item]; setPinned(next); savePinned(next) },
    onUnpin: () => { const next = pinned.filter((p) => 'folder' in p || appKey(p) !== appKey(item)); setPinned(next); savePinned(next) },
  })

  let index = -1
  return (
    <motion.div className="fixed inset-0"
      // The backdrop darkens as the menu comes forward, so the desktop
      // recedes behind it rather than merely being covered. No CSS blur:
      // this window already carries real DWM acrylic (ThemeProvider), and
      // a backdrop-filter on top of it would blur the tint rather than the
      // desktop while costing a full-screen filter pass every frame.
      initial={{ opacity: 0, backgroundColor: 'rgba(0,0,0,0)' }}
      animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0.25)', transition: { duration: dur.normal, ease: curve.decelerate } }}
      exit={{ opacity: 0, backgroundColor: 'rgba(0,0,0,0)', transition: { duration: dur.fast, ease: curve.accelerate } }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog" aria-label="Start"
        initial={{ opacity: 0, y: 120, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 270, damping: 26, mass: 0.95 } }}
        exit={{ opacity: 0, y: 90, scale: 0.94, transition: { duration: 0.2, ease: curve.accelerate } }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{ willChange: 'transform, opacity', transformOrigin: '50% 100%' }}
        className="os-panel-material os-sheen absolute left-1/2 top-1/2 flex h-[min(740px,calc(100vh-100px))] w-[min(860px,calc(100vw-40px))] -translate-x-1/2 -translate-y-[calc(50%+24px)] flex-col overflow-hidden rounded-[var(--os-radius-overlay)] text-[var(--os-text)]"
      >
        {/* Search */}
        <div className="px-6 pb-3 pt-5">
          <label className="flex h-11 items-center gap-3 rounded-full border border-[var(--os-border)] bg-[var(--os-hover)] px-5 transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]">
            <SearchIcon width={16} height={16} className="shrink-0 opacity-50" />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps, settings, files and the web"
              spellCheck={false}
              className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--os-text-faint)]"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')}
                className="text-[var(--os-text-dim)] transition-colors hover:text-[var(--os-text)]">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm2.78 4.22a.75.75 0 0 1 0 1.06L9.06 8l1.72 1.72a.75.75 0 1 1-1.06 1.06L8 9.06l-1.72 1.72a.75.75 0 0 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 0 1 1.06 0Z" />
                </svg>
              </button>
            )}
          </label>
        </div>

        {/* Body */}
        {view === 'day' && !q && <MyDay user={user} onClose={onClose} />}
        <div ref={listRef} className={cn('relative min-h-0 flex-1', view === 'day' && !q ? 'hidden' : view === 'all' ? 'flex overflow-hidden' : 'overflow-y-auto')}>
          {q ? (
            <div className="px-5 pb-5">
              {groups.map((g) => (
                <section key={g.label} className="mb-1">
                  <h3 className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-(--os-text-dim)">{g.label}</h3>
                  {g.items.map((r) => {
                    index++; const i = index
                    return (
                      <button key={r.key} type="button" data-active={i === active}
                        onMouseMove={() => setActive(i)} onClick={() => run(r)}
                        style={{ transition: ROW_TRANS }}
                        className={cn('flex w-full items-center gap-3 rounded-[10px] px-3 py-[9px] text-left', i === active ? 'bg-(--os-hover)' : '')}
                      >
                        <ResultIcon r={r} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate', r.kind === 'calc' ? 'text-[19px] font-semibold' : 'text-[13.5px]')}>{r.title}</span>
                          {'subtitle' in r && <span className="block truncate text-[11px] text-(--os-text-dim)">{r.subtitle}</span>}
                          {r.kind === 'calc' && <span className="block text-[11px] text-(--os-text-dim)">Enter to copy</span>}
                        </span>
                      </button>
                    )
                  })}
                </section>
              ))}
            </div>
          ) : view === 'day' ? null : view === 'home' ? (
            <div className="px-5">
              <SectionHeader title="Pinned" action="All apps" onAction={() => setView('all')} extra={
                <button type="button" onClick={() => setEditing(true)}
                  className="rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12px] font-medium hover:bg-(--os-active)">
                  Edit
                </button>
              } />
              <div className="grid grid-cols-8 gap-0.5">
                {pinned.map((item, idx) =>
                  'folder' in item ? (
                    <FolderTile key={`f-${idx}`} folder={item} onOpen={() => setOpenFolder(item)} />
                  ) : (
                    <Tile key={`${item.kind === 'udaan' ? item.appId : item.app.id}-${idx}`}
                      label={PinnedAppName(item)}
                      path={pinnedAppPath(item)}
                      onClick={() => { onClose(); void launchPinnedApp(item) }}>
                      <PinnedAppIcon item={item} size={38} />
                    </Tile>
                  )
                )}
              </div>

              {ready && <NewsFeedSection onClose={onClose} />}
            </div>
          ) : (
            /* All apps view — three-column list, sticky letter headers, A–Z rail on the right */
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto pl-5 pr-1 pb-5">
                <div className="flex items-center gap-2 px-1 pb-2 pt-4">
                  <h2 className="text-[14px] font-semibold">All apps</h2>
                  <span className="text-[12px] text-(--os-text-dim)">{APP_IDS.length + apps.length}</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => setView('home')}
                    className="flex items-center gap-1 rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12px] font-medium hover:bg-(--os-active)">
                    <ChevronRightIcon width={11} height={11} className="rotate-180" /> Back
                  </button>
                </div>

                <section data-section="udaan">
                  <p className="sticky top-0 z-10 flex items-center gap-3 rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)]">
                    Udaan <span className="h-px flex-1 bg-(--os-separator)" />
                  </p>
                  <div className="grid grid-cols-3 gap-x-1 pb-2">
                    {APP_IDS.map((id) => {
                      const item: PinnedApp = { kind: 'udaan', appId: id }
                      const open = () => run({ kind: 'udaan', key: id, title: APP_DEFS[id].name, appId: id })
                      return (
                        <AppTileContextMenu key={id} action={{ onOpen: open, ...pinAction(item) }}>
                          <button type="button" onClick={open} style={{ transition: ROW_TRANS }}
                            className="flex h-11 min-w-0 items-center gap-3 rounded-[10px] px-3 text-left hover:bg-(--os-hover)">
                            <AppIcon appId={id} size={28} />
                            <span className="truncate text-[13px] font-medium">{APP_DEFS[id].name}</span>
                          </button>
                        </AppTileContextMenu>
                      )
                    })}
                  </div>
                </section>

                {letters.map(([letter, list]) => (
                  <section key={letter} data-letter={letter}>
                    <p className="sticky top-0 z-10 flex items-center gap-3 rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)]">
                      {letter} <span className="h-px flex-1 bg-(--os-separator)" />
                    </p>
                    <div className="grid grid-cols-3 gap-x-1 pb-2">
                      {list.map((a) => {
                        const item: PinnedApp = { kind: 'installed', app: a }
                        const open = () => run({ kind: 'installed', key: a.id, title: a.name, app: a })
                        return (
                          <AppTileContextMenu key={a.id} action={{ path: `shell:AppsFolder\\${a.id}`, onOpen: open, ...pinAction(item) }}>
                            <button type="button" onClick={open} style={{ transition: ROW_TRANS }}
                              className="flex h-11 min-w-0 items-center gap-3 rounded-[10px] px-3 text-left hover:bg-(--os-hover)">
                              <InstalledIcon id={a.id} size={28} />
                              <span className="truncate text-[13px] font-medium">{a.name}</span>
                            </button>
                          </AppTileContextMenu>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <div className="flex w-8 shrink-0 flex-col items-center justify-center gap-px overflow-y-auto py-2 pr-1">
                <button type="button" title="Udaan"
                  onClick={() => listRef.current?.querySelector('[data-section="udaan"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex h-5 w-6 items-center justify-center rounded-[5px] text-[10px] font-bold text-[var(--color-accent)] transition-colors duration-75 hover:bg-(--os-hover)">★</button>
                {letters.map(([letter]) => (
                  <button key={letter} type="button"
                    onClick={() => listRef.current?.querySelector(`[data-letter="${letter}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="flex h-5 w-6 items-center justify-center rounded-[5px] text-[10.5px] font-semibold text-(--os-text-dim) transition-colors duration-75 hover:bg-(--os-hover) hover:text-(--os-text)">
                    {letter}
                  </button>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence>
            {openFolder && (
              <FolderModal folder={openFolder} onClose={() => setOpenFolder(null)}
                onLaunch={(item) => { setOpenFolder(null); onClose(); void launchPinnedApp(item) }} />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {editing && (
              <EditModal pinned={pinned} utilities={utilities} allInstalled={apps}
                onSave={handleSaveEdit} onClose={() => setEditing(false)} />
            )}
          </AnimatePresence>
        </div>

        {/* Status bar — time, battery, network, quick shortcuts */}
        <StatusBar onClose={onClose} />

        {/* Footer — user + My Day + power */}
        <footer className="flex h-[56px] shrink-0 items-center justify-between border-t border-(--os-separator) bg-(--os-hover)/40 px-6">
          <button type="button" onClick={() => { onClose(); void openApp('settings') }}
            className="-ml-1.5 flex items-center gap-3 rounded-[10px] px-2 py-1.5 text-[13px] transition-colors duration-75 hover:bg-(--os-hover)">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-[13px] font-semibold text-[var(--color-accent-contrast)]">
              {user.charAt(0).toUpperCase()}
            </span>
            {user}
          </button>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setView((v) => (v === 'day' ? 'home' : 'day'))}
              className={cn('flex h-8 items-center gap-2 rounded-[10px] px-3 text-[12.5px] font-medium transition-colors duration-75',
                view === 'day' ? 'bg-[var(--color-accent)] text-white' : 'bg-(--os-hover) hover:bg-(--os-active)')}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
              </svg>
              My Day
            </button>
            <button type="button" aria-label="Screensaver" title="Start screensaver"
              onClick={() => { onClose(); void emit('launcher:screensaver') }}
              className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors duration-75 hover:bg-(--os-hover)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
                <circle cx="12" cy="10.5" r="2.5" />
              </svg>
            </button>
            <button type="button" aria-label="Power" onClick={() => void showPowerMenu()}
              className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors duration-75 hover:bg-(--os-hover)">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 3v8M6.3 6.6a8 8 0 1 0 11.4 0" />
              </svg>
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}
