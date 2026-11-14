import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { cn } from '@/shared/lib/cn'
import { fileKind } from '@/features/file-explorer/lib/fileKind'
import { iconForKind } from '@/features/file-explorer/lib/iconForKind'
import { type AppId } from '@/os/kernel/registry'
import { openApp } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { AppTileContextMenu } from '@/os/ui/AppTileContextMenu'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button } from '@/os/ui/controls'
import { SearchIcon, SettingsIcon } from '@/shared/icons'
import { evaluate, formatResult } from './calc'
import { MyDay } from './MyDay'
import { AllApps } from './start/AllApps'
import {
  installedApps,
  launchPin,
  loadPins,
  openHit,
  pinKey,
  pinName,
  registerStartEntries,
  savePins,
  search,
  webSearch,
  type Hit,
  type InstalledApp,
  type Pin,
} from './start/model'

/**
 * THE START MENU.
 *
 * Three views in one card: Home (pinned apps + what you use most), All apps
 * (A to Z), and My Day. Typing anywhere replaces the view with results from
 * the engine's index (`search_query`): apps, settings, actions and files,
 * ranked by match quality and learned from what you open.
 *
 * The data layer is `start/model.ts`; this file is only the view.
 */

let userCache = ''
const iconCache = new Map<string, string | null>()

function InstalledIcon({ id, size }: { id: string; size: number }) {
  const [src, setSrc] = useState(() => iconCache.get(id) ?? null)
  useEffect(() => {
    if (iconCache.has(id)) return
    let cancelled = false
    void invoke<Record<string, string | null>>('shell_installed_app_icons', { ids: [id] }).then((r) => {
      iconCache.set(id, r[id] ?? null)
      if (!cancelled) setSrc(r[id] ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [id])
  return src ? <img src={src} alt="" draggable={false} style={{ width: size, height: size }} className="object-contain" /> : <span style={{ width: size, height: size }} className="rounded-[22%] bg-(--u-wash-on)" />
}

function PinIcon({ pin, size }: { pin: Pin; size: number }) {
  return pin.kind === 'udaan' ? <AppIcon appId={pin.appId} size={size} /> : <InstalledIcon id={pin.app.id} size={size} />
}

function HitIcon({ hit, size }: { hit: Hit; size: number }) {
  if (hit.id.startsWith('udaan:')) return <AppIcon appId={hit.target as AppId} size={size} />
  if (hit.kind === 'app') return <InstalledIcon id={hit.target} size={size} />
  const icon =
    hit.kind === 'file' || hit.kind === 'folder' ? iconForKind(fileKind(hit.title.includes('.') ? hit.title.split('.').pop()! : '', hit.kind === 'folder')) : hit.kind === 'setting' ? SettingsIcon : SearchIcon
  return (
    <span className="flex items-center justify-center rounded-[22%] bg-(--u-wash-on)" style={{ width: size, height: size }}>
      {createElement(icon, { width: size * 0.55, height: size * 0.55 })}
    </span>
  )
}

const KIND_LABEL: Record<Hit['kind'], string> = { app: 'Apps', setting: 'Settings', action: 'Actions', folder: 'Folders', file: 'Files' }
const KIND_ORDER: Hit['kind'][] = ['app', 'action', 'setting', 'folder', 'file']

/** A search row. Calculator and web rows are not index hits, so they share this shape. */
type Row = { key: string; group: string; title: string; subtitle?: string; icon: ReactNode; big?: boolean; run: () => void; reveal?: () => void }

export function StartMenu({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'home' | 'all' | 'day'>('home')
  const [active, setActive] = useState(0)
  const [pins, setPins] = useState<Pin[]>(loadPins)
  const [installed, setInstalled] = useState<InstalledApp[]>([])
  const [hits, setHits] = useState<Hit[]>([])
  const [recent, setRecent] = useState<Hit[]>([])
  const dragKey = useRef<string | null>(null)
  const [user, setUser] = useState(userCache)
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const openShellMenu = useShellMenu()
  const q = query.trim()

  useEffect(() => {
    registerStartEntries()
    inputRef.current?.focus()
    void installedApps().then(setInstalled)
    void search('', 8).then(setRecent, () => {})
    if (!userCache) void invoke<string>('shell_user_name').then((u) => ((userCache = u), setUser(u)), () => {})
  }, [])

  // Query the engine as the user types (it answers from memory, so a short debounce is plenty).
  useEffect(() => {
    if (!q) return void setHits([])
    let stale = false
    const t = setTimeout(() => void search(q).then((h) => !stale && setHits(h), () => !stale && setHits([])), 40)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q])

  const finish = useCallback(
    (fn: () => unknown) => {
      onClose()
      void fn()
    },
    [onClose],
  )

  const rows = useMemo<Row[]>(() => {
    if (!q) return []
    const out: Row[] = []
    const value = evaluate(query)
    if (value !== null) {
      const text = formatResult(value)
      out.push({ key: 'calc', group: 'Calculator', title: `= ${text}`, subtitle: 'Enter to copy', icon: <HitIcon hit={{ id: 'calc', kind: 'action', title: '', subtitle: '', target: '', score: 0 }} size={32} />, big: true, run: () => void navigator.clipboard.writeText(String(value)) })
    }
    // Keep the engine's order within a kind; show kinds in a fixed order.
    for (const kind of KIND_ORDER) {
      for (const h of hits.filter((x) => x.kind === kind).slice(0, kind === 'file' ? 6 : 5)) {
        out.push({
          key: h.id,
          group: KIND_LABEL[kind],
          title: h.title,
          subtitle: kind === 'file' || kind === 'folder' ? h.target.replace(/[\\/][^\\/]+$/, '') : h.subtitle,
          icon: <HitIcon hit={h} size={32} />,
          run: () => void openHit(h),
          reveal: kind === 'file' ? () => void openHit(h, { reveal: true }) : undefined,
        })
      }
    }
    out.push({ key: 'web', group: 'Web', title: `Search the web for “${q}”`, icon: <HitIcon hit={{ id: 'web', kind: 'action', title: '', subtitle: '', target: '', score: 0 }} size={32} />, run: () => void webSearch(q) })
    return out
  }, [q, query, hits])

  // The highlighted row restarts at the top whenever the results change.
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    bodyRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && q) setActive((a) => Math.min(rows.length - 1, a + 1))
    else if (e.key === 'ArrowUp' && q) setActive((a) => Math.max(0, a - 1))
    else if (e.key === 'Enter' && q) {
      const r = rows[active]
      if (r) finish(e.ctrlKey && r.reveal ? r.reveal : r.run)
    } else if (e.key === 'Escape') {
      if (query) setQuery('')
      else if (view !== 'home') setView('home')
      else onClose()
    } else return
    e.preventDefault()
  }

  const pinned = (p: Pin) => pins.some((x) => pinKey(x) === pinKey(p))
  const setPinned = (next: Pin[]) => (setPins(next), savePins(next))
  const pinAction = (p: Pin) => ({
    pinned: pinned(p),
    onPin: () => setPinned([...pins, p]),
    onUnpin: () => setPinned(pins.filter((x) => pinKey(x) !== pinKey(p))),
  })

  const powerMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const pw = (a: string) => () => void invoke('shell_power', { action: a })
    openShellMenu({ x: r.right, y: r.top - 6 }, [
      { label: 'Lock Udaan', onSelect: () => finish(() => emit('launcher:lock')) },
      { label: 'Lock Windows', onSelect: pw('lock') },
      { label: 'Sleep', onSelect: pw('sleep') },
      { label: 'Sign out', onSelect: pw('sign-out') },
      { label: undefined },
      { label: 'Restart', onSelect: pw('restart') },
      { label: 'Shut down', onSelect: pw('shut-down'), danger: true },
    ])
  }

  let lastGroup = ''
  return (
    <motion.div
      className="fixed inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.16 } }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      style={{ background: 'rgb(0 0 0 / 28%)' }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Start"
        data-start-card
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="u-surface u-start absolute left-1/2 top-1/2 flex h-[min(720px,calc(100vh-100px))] w-[min(860px,calc(100vw-40px))] flex-col overflow-hidden"
      >
        {/* Search */}
        <div className="px-6 pb-3 pt-5">
          <label className="u-search">
            <SearchIcon width={16} height={16} className="shrink-0 opacity-50" />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps, settings, files and the web" spellCheck={false} className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-(--u-ink-3)" />
            {query && (
              <Button icon size="sm" pill aria-label="Clear search" onClick={() => setQuery('')}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
                </svg>
              </Button>
            )}
          </label>
        </div>

        {/* Body */}
        {view === 'day' && !q && <MyDay user={user} onClose={onClose} />}
        {view === 'all' && !q && <AllApps installed={installed} Icon={InstalledIcon} pinAction={pinAction} finish={finish} onBack={() => setView('home')} />}
        <div ref={bodyRef} className={cn('u-scroll relative min-h-0 flex-1 overflow-y-auto', !q && view !== 'home' && 'hidden')}>
          {q ? (
            <div className="px-5 pb-5">
              {rows.map((r, i) => {
                const header = r.group !== lastGroup
                lastGroup = r.group
                return (
                  <div key={r.key}>
                    {header && <h3 className="u-label px-2 pb-1 pt-3">{r.group}</h3>}
                    <button type="button" data-active={i === active} onMouseMove={() => setActive(i)} onClick={() => finish(r.run)} className="u-row min-h-0 gap-3 px-3 py-2">
                      {r.icon}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', r.big ? 'text-[20px] font-semibold' : 'text-[13.5px]')}>{r.title}</span>
                        {r.subtitle && <span className="u-row__sub block truncate">{r.subtitle}</span>}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          ) : view === 'home' ? (
            <div className="px-5 pb-4">
              <Header title="Pinned" action="All apps" onAction={() => setView('all')} />
              <div className="grid grid-cols-7 gap-1">
                {pins.map((p) => (
                  <AppTileContextMenu key={pinKey(p)} action={{ path: p.kind === 'installed' ? `shell:AppsFolder\\${p.app.id}` : undefined, onOpen: () => finish(() => launchPin(p)), ...pinAction(p) }}>
                    <button
                      type="button"
                      className="u-tile"
                      draggable
                      onDragStart={() => (dragKey.current = pinKey(p))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        const from = pins.findIndex((x) => pinKey(x) === dragKey.current)
                        const to = pins.findIndex((x) => pinKey(x) === pinKey(p))
                        dragKey.current = null
                        if (from < 0 || to < 0 || from === to) return
                        const next = [...pins]
                        next.splice(to, 0, next.splice(from, 1)[0])
                        setPinned(next)
                      }}
                      onClick={() => finish(() => launchPin(p))}
                    >
                      <PinIcon pin={p} size={40} />
                      <span className="w-full truncate text-center text-[12px] font-medium leading-tight">{pinName(p)}</span>
                    </button>
                  </AppTileContextMenu>
                ))}
              </div>

              {recent.length > 0 && (
                <>
                  <Header title="Most used" />
                  <div className="grid grid-cols-2 gap-x-2">
                    {recent.map((h) => (
                      <button key={h.id} type="button" onClick={() => finish(() => openHit(h))} className="u-row min-h-0 gap-3 px-3 py-2">
                        <HitIcon hit={h} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{h.title}</span>
                          {h.subtitle && <span className="u-row__sub block truncate">{h.kind === 'file' ? h.target.replace(/[\\/][^\\/]+$/, '') : h.subtitle}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="flex h-14 shrink-0 items-center justify-between border-t border-(--u-edge) px-5">
          <button type="button" onClick={() => finish(() => openApp('settings'))} className="u-btn u-btn--ghost h-10 gap-3 pl-1.5 pr-3 text-[13px] text-(--u-ink)">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-(--u-ink) text-[13px] font-semibold text-(--u-m-solid)">{(user || 'U').charAt(0).toUpperCase()}</span>
            {user}
          </button>
          <div className="flex items-center gap-1">
            <Button variant={view === 'day' ? 'primary' : 'tinted'} onClick={() => setView((v) => (v === 'day' ? 'home' : 'day'))} className="gap-2 px-3">
              My Day
            </Button>
            <Button icon aria-label="Start screensaver" title="Start screensaver" onClick={() => finish(() => emit('launcher:screensaver'))}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </Button>
            <Button icon aria-label="Power" onClick={powerMenu}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 3v8M6.3 6.6a8 8 0 1 0 11.4 0" />
              </svg>
            </Button>
          </div>
        </footer>
      </div>
    </motion.div>
  )
}

function Header({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between pb-1.5 pt-4">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {action && (
        <Button variant="tinted" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}
