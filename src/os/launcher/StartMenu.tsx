import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { sheetMotion, useMotion } from '@/os/motion/config'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { cn } from '@/shared/lib/cn'
import { fileKind } from '@/features/file-explorer/lib/fileKind'
import { iconForKind } from '@/features/file-explorer/lib/iconForKind'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { launchApp } from '@/integrations/installed-apps/client'
import { APP_DEFS, type AppId } from '@/os/kernel/registry'
import { openApp, shell } from '@/os/kernel/shell'
import { useProfile } from '@/os/kernel/profile'
import { usePref } from '@/os/kernel/prefs'
import { pictureOf, useIdentity } from '@/os/kernel/identity'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { PopIcon } from '@/os/ui/pop/icons'
import { usePopMenu, type MenuEntry } from '@/os/ui/pop/Menu'
import { Surface } from '@/os/ui/pop/Surface'
import { appKey, exeKey, loadPins as loadDockPins, onPinsChanged, togglePin, type Pin as DockPin } from '@/os/dock/pins'
import { MyDay } from './MyDay'
import { evaluate, formatResult } from './calc'
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
  workStartPins,
  webSearch,
  type Hit,
  type InstalledApp,
  type Pin,
} from './start/model'

/**
 * THE START MENU, rebuilt.
 *
 * One liquid-glass card of a constant size, in the Windows 11 arrangement: a search pill on top; Pinned (with an
 * "All apps" link) and Recommended in the middle; and who you are, the Personal / Work switch, My Day, lock and power
 * along the bottom. There is no side panel and no tab bar. Typing anywhere replaces the body with results from the engine's index
 * (apps, settings, actions, files, a calculator, the web). All apps is the A to Z list.
 *
 * Everything is right-clickable: an app can be pinned to Start or to the taskbar, moved to the front, opened as
 * administrator, uninstalled or inspected; a file can be opened, shown in its folder or have its path copied; the empty
 * part of Pinned can sort, reset or customise it.
 *
 * The data layer is `start/model.ts`; this file is the view.
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
  // Bare icon, no box behind it.
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center">
      {src && <img src={src} alt="" draggable={false} style={{ width: size, height: size }} className="object-contain" />}
    </span>
  )
}

function PinIcon({ pin, size }: { pin: Pin; size: number }) {
  return pin.kind === 'udaan' ? <AppIcon appId={pin.appId} size={size} /> : <InstalledIcon id={pin.app.id} size={size} />
}

function HitIcon({ hit, size }: { hit: Hit; size: number }) {
  if (hit.id.startsWith('udaan:')) return <AppIcon appId={hit.target as AppId} size={size} />
  if (hit.kind === 'app') return <InstalledIcon id={hit.target} size={size} />
  const icon = hit.kind === 'file' || hit.kind === 'folder' ? iconForKind(fileKind(hit.title.includes('.') ? hit.title.split('.').pop()! : '', hit.kind === 'folder')) : null
  return (
    <span className="flex items-center justify-center rounded-[22%] bg-white/10" style={{ width: size, height: size }}>
      {icon ? createElement(icon, { width: size * 0.55, height: size * 0.55 }) : <PopIcon name={hit.kind === 'setting' ? 'sliders' : 'search'} size={size * 0.55} />}
    </span>
  )
}

const KIND_LABEL: Record<Hit['kind'], string> = { app: 'Apps', setting: 'Settings', action: 'Actions', folder: 'Folders', file: 'Files' }
const KIND_ORDER: Hit['kind'][] = ['app', 'action', 'setting', 'folder', 'file']

/** A search row. Calculator and web rows are not index hits, so they share this shape. */
type Row = { key: string; group: string; title: string; subtitle?: string; icon: ReactNode; big?: boolean; run: () => void; hit?: Hit }

const dirOf = (p: string) => p.replace(/[\\/][^\\/]+$/, '')

/** A Start pin as the dock stores it. An installed app has no executable name here, so it matches by its name. */
function dockPinOf(p: Pin): DockPin {
  if (p.kind === 'udaan') return { key: appKey(p.appId), kind: 'app', appId: p.appId, name: APP_DEFS[p.appId].name }
  const match = `${p.app.name}.exe`
  return { key: exeKey(match), kind: 'exe', match, launch: `shell:AppsFolder\\${p.app.id}`, name: p.app.name }
}

function useDockPinKeys() {
  const [keys, setKeys] = useState<Set<string>>(new Set())
  useEffect(() => {
    const load = () => void loadDockPins().then((p) => setKeys(new Set(p.map((x) => x.key))), () => {})
    load()
    const un = onPinsChanged(load)
    return () => void un.then((f) => f())
  }, [])
  return keys
}


export function StartMenu({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'home' | 'all' | 'day'>('home')
  const [active, setActive] = useState(0)
  const profile = useProfile()
  const [workOn] = usePref('work.enabled')
  const [pins, setPins] = useState<Pin[]>(loadPins)
  // Work's section sits above the normal Start; it is only built when Work is active.
  const [workPins, setWorkPins] = useState<Pin[]>([])
  useEffect(() => {
    if (profile !== 'work') return setWorkPins([])
    let live = true
    void workStartPins().then((list) => live && setWorkPins(list))
    return () => {
      live = false
    }
  }, [profile])
  const [installed, setInstalled] = useState<InstalledApp[]>([])
  const [hits, setHits] = useState<Hit[]>([])
  const dragKey = useRef<string | null>(null)
  const [user, setUser] = useState(userCache)
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { open: openMenu, node: menuNode } = usePopMenu()
  const dockKeys = useDockPinKeys()
  const ident = useIdentity(user)
  const startMo = useMotion('start')
  const sheet = sheetMotion(startMo, startMo.style)
  const picture = pictureOf(ident.avatar)
  const q = query.trim()

  useEffect(() => {
    registerStartEntries()
    inputRef.current?.focus()
    void installedApps().then(setInstalled)
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

  /* ── right-click menus ─────────────────────────────────────────── */

  const startPinned = (p: Pin) => pins.some((x) => pinKey(x) === pinKey(p))
  const setStartPins = (next: Pin[]) => (setPins(next), savePins(next))

  /** Everything you can do with an app. `run` opens it. */
  const appMenu = (e: React.MouseEvent, p: Pin, run: () => void) => {
    e.preventDefault()
    e.stopPropagation()
    const onStart = startPinned(p)
    const dock = dockPinOf(p)
    const onDock = dockKeys.has(dock.key)
    const path = p.kind === 'installed' ? `shell:AppsFolder\\${p.app.id}` : undefined
    const idx = pins.findIndex((x) => pinKey(x) === pinKey(p))
    const items: MenuEntry[] = [
      { label: 'Open', icon: 'external', onSelect: run },
      { type: 'sep' },
      { label: onStart ? 'Unpin from Start' : 'Pin to Start', icon: 'pin', onSelect: () => setStartPins(onStart ? pins.filter((x) => pinKey(x) !== pinKey(p)) : [...pins, p]) },
      { label: onDock ? 'Unpin from taskbar' : 'Pin to taskbar', icon: 'window', onSelect: () => void togglePin(dock) },
      ...(onStart && idx > 0 ? ([{ label: 'Move to front', icon: 'star', onSelect: () => setStartPins([pins[idx], ...pins.filter((_, i) => i !== idx)]) }] satisfies MenuEntry[]) : []),
    ]
    if (path) {
      items.push(
        { type: 'sep' },
        { label: 'Run as administrator', icon: 'shield', onSelect: () => void shell.invokeVerb(path, 'runas').catch(() => {}) },
        { label: 'Uninstall…', icon: 'trash', danger: true, onSelect: () => finish(() => launchApp('ms-settings:appsfeatures')) },
        { label: 'Properties', icon: 'info', onSelect: () => void shell.invokeVerb(path, 'properties').catch(() => {}) },
      )
    } else if (p.kind === 'udaan') {
      items.push({ type: 'sep' }, { label: `${APP_DEFS[p.appId].name} settings`, icon: 'sliders', onSelect: () => finish(() => openApp('settings')) })
    }
    openMenu(e, items)
  }

  /** A file, folder or settings hit. */
  const hitMenu = (e: React.MouseEvent, h: Hit, run: () => void) => {
    e.preventDefault()
    e.stopPropagation()
    const isFile = h.kind === 'file'
    const isFolder = h.kind === 'folder'
    const items: MenuEntry[] = [{ label: 'Open', icon: 'external', onSelect: run }]
    if (isFile || isFolder) {
      items.push(
        { label: isFile ? 'Show in folder' : 'Open in Files', icon: 'folder', onSelect: () => finish(() => openHit(h, { reveal: true })) },
        { type: 'sep' },
        { label: 'Copy path', icon: 'copy', onSelect: () => void navigator.clipboard.writeText(h.target) },
        { label: 'Open with default app', icon: 'file', disabled: isFolder, onSelect: () => finish(() => openWithSystem(h.target)) },
      )
    }
    openMenu(e, items)
  }

  const pinnedAreaMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    openMenu(e, [
      { label: 'Sort pinned A to Z', icon: 'sort', onSelect: () => setStartPins([...pins].sort((a, b) => pinName(a).localeCompare(pinName(b)))) },
      { label: 'Reset pinned apps', icon: 'refresh', onSelect: () => (localStorage.removeItem(profile === 'work' ? 'udaan-start-pins-work' : 'udaan-start-pins-v3'), setPins(loadPins())) },
      { label: 'Unpin all', icon: 'trash', danger: true, disabled: !pins.length, onSelect: () => setStartPins([]) },
      { type: 'sep' },
      { label: 'Start menu settings…', icon: 'sliders', onSelect: () => finish(() => openApp('settings', { section: 'personalization' })) },
    ])
  }

  /* ── search rows ───────────────────────────────────────────────── */

  const rows = useMemo<Row[]>(() => {
    if (!q) return []
    const out: Row[] = []
    const value = evaluate(query)
    if (value !== null) {
      const text = formatResult(value)
      out.push({ key: 'calc', group: 'Calculator', title: `= ${text}`, subtitle: 'Enter to copy', icon: <span className="flex h-8 w-8 items-center justify-center rounded-[22%] bg-white/10"><PopIcon name="plus" size={16} /></span>, big: true, run: () => void navigator.clipboard.writeText(String(value)) })
    }
    // Keep the engine's order within a kind; show kinds in a fixed order.
    for (const kind of KIND_ORDER) {
      for (const h of hits.filter((x) => x.kind === kind).slice(0, kind === 'file' ? 6 : 5)) {
        out.push({ key: h.id, group: KIND_LABEL[kind], title: h.title, subtitle: kind === 'file' || kind === 'folder' ? dirOf(h.target) : h.subtitle, icon: <HitIcon hit={h} size={32} />, run: () => void openHit(h), hit: h })
      }
    }
    out.push({ key: 'web', group: 'Web', title: `Search the web for “${q}”`, icon: <span className="flex h-8 w-8 items-center justify-center rounded-[22%] bg-white/10"><PopIcon name="search" size={16} /></span>, run: () => void webSearch(q) })
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
      if (r) finish(e.ctrlKey && r.hit?.kind === 'file' ? () => openHit(r.hit!, { reveal: true }) : r.run)
    } else if (e.key === 'Escape') {
      if (query) setQuery('')
      else if (view !== 'home') setView('home')
      else onClose()
    } else return
    e.preventDefault()
  }

  const powerMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const pw = (a: string) => () => void invoke('shell_power', { action: a })
    openMenu({ clientX: r.right - 236, clientY: r.top - 6 - 218, preventDefault: () => {} }, [
      { label: 'Lock Udaan', icon: 'lock', onSelect: () => finish(() => emit('launcher:lock')) },
      { label: 'Lock Windows', icon: 'shield', onSelect: pw('lock') },
      { label: 'Sleep', icon: 'moon', onSelect: pw('sleep') },
      { label: 'Sign out', icon: 'user', onSelect: pw('sign-out') },
      { type: 'sep' },
      { label: 'Restart', icon: 'refresh', onSelect: pw('restart') },
      { label: 'Shut down', icon: 'power', danger: true, onSelect: pw('shut-down') },
    ])
  }

  const userMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const toWork = profile !== 'work'
    openMenu({ clientX: r.left, clientY: r.top - 6 - 232, preventDefault: () => {} }, [
      ...(workOn || profile === 'work' ? [{ label: toWork ? 'Switch to Work' : 'Switch to Personal', icon: 'user' as const, onSelect: () => finish(() => emit(toWork ? 'launcher:work' : 'launcher:personal')) }] : []),
      { label: 'My Day', icon: 'calendar', onSelect: () => setView('day') },
      { label: 'Lock Udaan', icon: 'lock', onSelect: () => finish(() => emit('launcher:lock')) },
      { type: 'sep' },
      { label: 'Account settings', icon: 'sliders', onSelect: () => finish(() => openApp('settings')) },
      { label: 'Change wallpaper…', icon: 'image', onSelect: () => finish(() => emit('launcher:wallpaper')) },
      { label: 'Start screensaver', icon: 'monitor', onSelect: () => finish(() => emit('launcher:screensaver')) },
    ])
  }

  let lastGroup = ''
  const tile = (p: Pin, key: string) => (
    <motion.button
      key={key}
      type="button"
      draggable
      whileTap={{ scale: 0.95 }}
      className="group flex h-[78px] w-full flex-col items-center gap-1.5 rounded-[10px] px-0.5 pt-2.5 transition-colors hover:bg-white/10 active:bg-white/15"
      onContextMenu={(e) => appMenu(e, p, () => finish(() => launchPin(p)))}
      onDragStart={() => (dragKey.current = pinKey(p))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        const from = pins.findIndex((x) => pinKey(x) === dragKey.current)
        const to = pins.findIndex((x) => pinKey(x) === pinKey(p))
        dragKey.current = null
        if (from < 0 || to < 0 || from === to) return
        const next = [...pins]
        next.splice(to, 0, next.splice(from, 1)[0])
        setStartPins(next)
      }}
      onClick={() => finish(() => launchPin(p))}
    >
      <motion.span whileHover={{ scale: 1.1, y: -1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}><PinIcon pin={p} size={38} /></motion.span>
      <span className="w-full truncate px-0.5 text-center text-[10.5px] font-semibold leading-[14px]">{pinName(p)}</span>
    </motion.button>
  )

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center"
      initial={startMo.on ? { opacity: 0 } : false}
      animate={{ opacity: 1, transition: { duration: 0.16 / startMo.k } }}
      exit={{ opacity: 0, transition: { duration: startMo.on ? 0.12 / startMo.k : 0 } }}
      // The card sits in the work area: below the top bar and above the dock, never under either. Its size and its place
      // never change, whichever view is showing.
      style={{ background: 'rgb(0 0 0 / 24%)', paddingTop: 34 + 12, paddingBottom: 76 + 12 }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-label="Start"
        data-start-card
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        // How Start arrives and leaves is chosen in Settings → Animations.
        {...sheet}
        style={{ willChange: 'transform, opacity', transformOrigin: '50% 100%' }}
      >
        <Surface glass="start" radius={28} className="flex flex-col" style={{ height: 'min(650px, calc(100vh - 140px))', width: 'min(800px, calc(100vw - 40px))' }}>
          {/* Search */}
          <div className="px-7 pb-0 pt-5">
            <label className="flex h-[42px] items-center gap-3 rounded-full bg-black/10 px-4 shadow-[inset_0_0_0_1.5px_rgb(255_255_255/.38)] transition-shadow focus-within:bg-black/20 focus-within:shadow-[inset_0_0_0_1.5px_rgb(255_255_255/.8)]">
              <PopIcon name="search" size={16} className="shrink-0 opacity-60" />
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps, settings, files and the web" spellCheck={false} className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-(--u-ink-3)" />
              {query && (
                <button type="button" aria-label="Clear search" className="pop-iconbtn h-6 w-6" onClick={() => setQuery('')}>
                  <PopIcon name="x" size={13} strokeWidth={2.2} />
                </button>
              )}
            </label>
          </div>

          {/* Body: search results, or the current view */}
          {view === 'day' && !q && (
            <motion.div key="day" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, x: 36 }} animate={{ opacity: 1, x: 0, transition: { type: 'spring', stiffness: 380, damping: 32 } }}>
              <div className="px-7 pb-2 pt-1">
                <button type="button" className="pop-btn" onClick={() => setView('home')}><PopIcon name="chevron" size={12} style={{ transform: 'scaleX(-1)' }} /> Back</button>
              </div>
              <MyDay user={ident.name} onClose={onClose} />
            </motion.div>
          )}
          {view === 'all' && !q && (
            <motion.div key="all" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, x: 36 }} animate={{ opacity: 1, x: 0, transition: { type: 'spring', stiffness: 380, damping: 32 } }}>
              <AllApps installed={installed} Icon={InstalledIcon} onMenu={appMenu} finish={finish} onBack={() => setView('home')} />
            </motion.div>
          )}
          <div ref={bodyRef} className={cn('pop-scroll relative min-h-0 flex-1 overflow-y-auto px-7 pb-3', !q && view !== 'home' && 'hidden')}>
            {q ? (
              <div className="pb-2">
                {rows.map((r, i) => {
                  const header = r.group !== lastGroup
                  lastGroup = r.group
                  return (
                    <div key={r.key}>
                      {header && <h3 className="pop-label px-2.5 pb-1 pt-3">{r.group}</h3>}
                      <button
                        type="button"
                        data-active={i === active}
                        onMouseMove={() => setActive(i)}
                        onClick={() => finish(r.run)}
                        onContextMenu={(e) => (r.hit ? hitMenu(e, r.hit, () => finish(r.run)) : e.preventDefault())}
                        className="pop-row w-full data-[active=true]:bg-white/[0.13]"
                      >
                        {r.icon}
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate', r.big ? 'text-[20px] font-semibold' : 'text-[13.5px]')}>{r.title}</span>
                          {r.subtitle && <span className="block truncate text-[11.5px] text-(--u-ink-3)">{r.subtitle}</span>}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div onContextMenu={pinnedAreaMenu}>
                {workPins.length > 0 && (
                  <div className="mb-2 mt-1">
                    <div className="flex items-center gap-2 px-1 pb-1.5 pt-2">
                      <h2 className="text-[14px] font-bold">Work</h2>
                    </div>
                    <div className="grid grid-cols-8 pb-0.5">{workPins.map((p) => tile(p, `work-${pinKey(p)}`))}</div>
                  </div>
                )}

                <Header title="Pinned" action="All apps" onAction={() => setView('all')} />
                <div key={profile} className="grid grid-cols-8">{pins.map((p) => tile(p, pinKey(p)))}</div>
                {pins.length === 0 && <p className="px-2 py-6 text-[12.5px] text-(--u-ink-3)">Nothing is pinned. Open All apps and right-click an app to pin it.</p>}
              </div>
            )}
          </div>

          {/* Footer: who you are, and power. The profile switch, My Day and lock live in the account menu. */}
          <footer className="flex h-[88px] shrink-0 items-center border-t border-white/[0.08] bg-black/[0.26] px-7">
            <button type="button" onClick={userMenu} onContextMenu={userMenu} className="group -ml-2.5 flex items-center gap-4 rounded-[14px] py-2 pl-2.5 pr-5 transition-colors hover:bg-white/10">
              {picture ? <img src={picture} alt="" draggable={false} className="h-12 w-12 rounded-full object-cover shadow-[0_2px_8px_rgb(0_0_0/.3)]" /> : <span className={cn('flex h-12 w-12 items-center justify-center rounded-full text-[19px] font-semibold shadow-[0_2px_8px_rgb(0_0_0/.3)]', profile === 'work' ? 'bg-[#2f6bff] text-white' : 'bg-white/[0.18]')}>{(ident.name || 'U').charAt(0).toUpperCase()}</span>}
              <span className="text-[16px] font-semibold tracking-tight">{ident.name || 'Account'}{profile === 'work' && <span className="ml-2.5 rounded-full bg-[#2f6bff]/30 px-2 py-px align-middle text-[10.5px] font-semibold uppercase tracking-wide text-[#9dbaff]">Work</span>}</span>
            </button>
            {(workOn || profile === 'work') && (
              <button type="button" onClick={() => finish(() => emit(profile !== 'work' ? 'launcher:work' : 'launcher:personal'))} className="ml-3 flex h-10 items-center gap-2 rounded-full bg-white/[0.08] px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.16] active:bg-white/[0.22]">
                <PopIcon name="user" size={15} /> {profile !== 'work' ? 'Switch to Work' : 'Switch to Personal'}
              </button>
            )}
            <button type="button" aria-label="Power" title="Power" className="pop-iconbtn ml-auto h-12 w-12 rounded-full bg-white/[0.08] hover:bg-white/[0.16]" onClick={powerMenu}><PopIcon name="power" size={22} /></button>
          </footer>
        </Surface>
      </motion.div>
      <div onMouseDown={(e) => e.stopPropagation()}>{menuNode}</div>
    </motion.div>
  )
}

/** A section title, with an optional link on the right ("All apps ›"). */
function Header({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between px-1 pb-1.5 pt-3.5">
      <h2 className="text-[14px] font-bold">{title}</h2>
      {action && (
        <button type="button" className="rounded-[8px] bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-(--u-ink) transition-colors hover:bg-white/20 active:bg-white/25" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}
