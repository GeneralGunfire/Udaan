import { useCallback, useEffect, useRef, useState } from 'react'
import { onLayoutChange, pxScale } from '@/os/kernel/uiScale'
import { useImmersive } from '@/os/kernel/useImmersive'
import { motion, useAnimationControls } from 'framer-motion'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/shared/lib/cn'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { launchApp, launchAppByExeName } from '@/integrations/installed-apps/client'
import { openSystemUtility } from '@/integrations/quick-settings/client'
import { groupKeyOf, onHotkey, openApp, shell, useShell, type ShellWindow } from '@/os/kernel/shell'
import { getPref, setPref, usePref } from '@/os/kernel/prefs'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { useShellMenu, type ShellMenuItemDef } from '@/os/ui/useShellMenu'
import { StartTile, TrashGlyph } from '@/os/ui/icons/SystemGlyphs'
import { useLatest } from '@/os/ui/useLatest'
import { launchBounce, minimizeNudge, restoreNudge, focusPop } from '@/os/motion/systemMotion'
import { playSound } from '@/os/sound/sounds'
import { dockMetrics } from './geometry'
import { isPermanent, savePins, togglePin } from './pins'
import { toPin, useDockItems, type DockItem } from './useDockItems'
import { GlassSlice } from '@/ui/GlassSlice'

const METRICS = dockMetrics()
const LAUNCH_TIMEOUT_MS = 8000
const HIDE_DELAY_MS = 450
const DRAG_THRESHOLD = 6
const UNPIN_LIFT = 60
const WHEEL_STEP = 60

async function launch(item: DockItem) {
  if (item.appId) return openApp(item.appId)
  const target = item.launch ?? item.exePath
  if (!target) return
  return /[\\/]|:/.test(target) ? launchApp(target) : launchAppByExeName(target)
}

/** Next window of a group after the active one (wraps). */
function nextWindow(ws: ShellWindow[], foreground: number, step = 1) {
  const idx = ws.findIndex((w) => w.handle === foreground)
  return ws[(Math.max(idx, step > 0 ? -1 : 0) + step + ws.length) % ws.length]
}

/**
 * Click: launch if nothing is open; a single window focuses or, if already
 * in front, minimizes (Windows); several windows open App Exposé (macOS).
 */
async function activate(item: DockItem, foreground: number) {
  const ws = item.windows
  if (!ws.length) return launch(item)
  if (ws.length === 1) {
    const w = ws[0]
    return w.handle === foreground && !w.isMinimized ? shell.minimize(w.handle) : shell.focus(w.handle)
  }
  return emit('launcher:expose', { title: item.name, handles: ws.map((w) => w.handle) })
}

function itemMenuItems(item: DockItem): ShellMenuItemDef[] {
  const ws = item.windows
  const truncate = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t || 'Untitled window')
  return [
    ...(ws.length > 1
      ? [
          ...ws.slice(0, 12).map((w) => ({ label: truncate(w.title), onSelect: () => void shell.focus(w.handle) })),
          { label: 'Show all windows', onSelect: () => void emit('launcher:expose', { title: item.name, handles: ws.map((w) => w.handle) }) },
          { label: undefined },
        ]
      : []),
    { label: item.appId || !ws.length ? `Open ${item.name}` : 'New window', onSelect: () => void launch(item) },
    ...(toPin(item) && !(item.pinned && isPermanent(item.key)) ? [{ label: item.pinned ? 'Unpin from dock' : 'Pin to dock', onSelect: () => void togglePin(toPin(item)!) }] : []),
    ...(ws.length
      ? [
          { label: undefined },
          { label: ws.length > 1 ? 'Minimize all' : 'Minimize', onSelect: () => ws.forEach((w) => void shell.minimize(w.handle)) },
          { label: ws.length > 1 ? `Close all ${ws.length} windows` : 'Close window', onSelect: () => ws.forEach((w) => void shell.close(w.handle)) },
        ]
      : []),
  ]
}

const dockMenuItems: ShellMenuItemDef[] = [
  { label: 'Show desktop', onSelect: () => void shell.toggleDesktop() },
  { label: 'Lock screen', onSelect: () => void emit('launcher:lock') },
  { label: undefined },
  { label: 'Change wallpaper…', onSelect: () => void emit('launcher:wallpaper') },
  { label: 'Next wallpaper', onSelect: () => void invoke('wallpaper_step', { forward: true }) },
  { label: undefined },
  { label: 'Auto-hide the dock', onSelect: () => void getPref('dock.autoHide').then((v) => setPref('dock.autoHide', !v)) },
  { label: 'Dock settings', onSelect: () => void openApp('settings', { section: 'dock' }) },
  { label: 'Task Manager', onSelect: () => void openSystemUtility('taskManager') },
]

/* ------------------------------------------------------------------ */

function DockIcon({
  item,
  foreground,
  dragOffset,
  onPointerDown,
  onOpenMenu,
}: {
  item: DockItem
  foreground: number
  dragOffset: { x: number; y: number } | null
  onPointerDown: (e: React.PointerEvent, item: DockItem, el: HTMLElement) => void
  onOpenMenu: (e: React.MouseEvent, items: ShellMenuItemDef[]) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const controls = useAnimationControls()
  const reduced = prefersReducedMotion()
  const [launching, setLaunching] = useState(false)
  const prevMin = useRef(item.allMinimized)
  const wheel = useRef(0)

  const bouncing = launching && item.windows.length === 0
  useEffect(() => {
    if (!bouncing) {
      void controls.start({ y: 0 })
      return
    }
    if (!reduced) void controls.start({ ...launchBounce, transition: { ...launchBounce.transition, repeat: Infinity } })
    const t = setTimeout(() => setLaunching(false), LAUNCH_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [bouncing, controls, reduced])

  useEffect(() => {
    if (prevMin.current === item.allMinimized) return
    prevMin.current = item.allMinimized
    if (!reduced) void controls.start(item.allMinimized ? minimizeNudge : restoreNudge)
  }, [item.allMinimized, controls, reduced])

  const count = item.windows.length

  return (
    <button
      ref={ref}
      type="button"
      data-dock-item={item.key}
      aria-label={count > 1 ? `${item.name}, ${count} windows` : item.name}
      aria-pressed={item.focused}
      onPointerDown={(e) => onPointerDown(e, item, ref.current!)}
      onClick={(e) => {
        if (e.defaultPrevented) return
        if (!count) {
          setLaunching(true)
          playSound('open')
        } else if (!reduced) {
          // Bringing an already-open window forward — the window itself
          // can't be animated (real OS window, outside this webview), so
          // the icon gets a quick pop instead, like macOS's dock does.
          void controls.start(focusPop)
        }
        void activate(item, foreground).catch((err) => console.error('[dock] activate', err))
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        setLaunching(true)
        void launch(item)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpenMenu(e, itemMenuItems(item))
      }}
      onWheel={(e) => {
        if (!count) return
        wheel.current += e.deltaY
        if (Math.abs(wheel.current) < WHEEL_STEP) return
        const step = wheel.current > 0 ? 1 : -1
        wheel.current = 0
        void shell.focus(nextWindow(item.windows, useShell.getState().foreground, step).handle)
      }}
      style={{ width: METRICS.slot, height: METRICS.slot, transform: dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined, zIndex: dragOffset ? 2 : undefined }}
      className="u-dock__item"
    >
      <DockLabel text={item.name} sub={count === 1 ? item.windows[0].title : undefined} count={count} />
      {/* The icon stack. Icons keep a fixed size: no magnification. */}
      <motion.span
        animate={controls}
        className="u-dock__glyph relative flex"
        style={{ width: METRICS.iconSize, height: METRICS.iconSize }}
      >
        <DockGlyph item={item} />
      </motion.span>

      {/* Running indicator. One pill that widens with the window count reads
          faster than counting dots, and it animates between states. */}
      {count > 0 && <span className="u-dock__dot" style={{ width: count > 1 ? 4 + Math.min(count, 4) * 4 : 4, opacity: item.allMinimized ? 0.45 : 1 }} />}
    </button>
  )
}

/**
 * The app's name on hover.
 *
 * Appears above the icon after a short delay, as a floating chip with a
 * pointer notch — the notch is what ties the label to the specific icon
 * rather than letting it read as a free-floating tooltip. The window count
 * rides along, so a glance answers "how many of these are open".
 */
/** The item's name on hover, a chip above the icon (the dock window leaves room for it). */
function DockLabel({ text, count, sub }: { text: string; count: number; sub?: string }) {
  const detail = sub && sub !== text ? (sub.length > 46 ? `${sub.slice(0, 45)}…` : sub) : ''
  return (
    <span className="u-dock__label">
      {text}
      {count > 1 && <span className="tabular-nums text-(--u-ink-3)"> · {count}</span>}
      {detail && <span className="block max-w-[260px] truncate text-[11px] font-normal text-(--u-ink-3)">{detail}</span>}
    </span>
  )
}

function DockGlyph({ item }: { item: DockItem }) {
  if (item.appId) return <AppIcon appId={item.appId} size={METRICS.iconSize} />
  if (item.iconUrl) return <img src={item.iconUrl} alt="" draggable={false} className="h-full w-full object-contain drop-shadow-[0_2px_4px_rgb(0_0_0/35%)]" />
  // No real icon: a monogram tile shaped like the app icons, so it sits in
  // the row correctly instead of reading as a different kind of object.
  return (
    <span
      className="flex h-full w-full items-center justify-center text-[18px] font-semibold text-white"
      style={{
        borderRadius: '26%',
        background: 'linear-gradient(145deg, hsl(220 10% 52%), hsl(220 12% 34%))',
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.25), 0 1px 3px rgb(0 0 0 / 0.3)',
      }}
    >
      {item.name.charAt(0).toUpperCase()}
    </span>
  )
}

/* ------------------------------------------------------------------ */

export function DockWindow() {
  const [autoHide] = usePref('dock.autoHide')
  const { items, pins, pinnedCount } = useDockItems()
  const foreground = useShell((s) => s.foreground)
  const immersive = useImmersive()
  const fullscreen = useShell((s) => s.fullscreen) || immersive

  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ key: string; startX: number; startY: number; active: boolean } | null>(null)
  const geometry = useRef({ x: 0, y: 0, scale: 1 })

  const [revealed, setRevealed] = useState(!autoHide)
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number } | null>(null)
  // A click often opens another always-on-top window (launcher, an app) right
  // over the dock while the cursor hasn't actually left the clicked button —
  // so its CSS :hover label would otherwise keep painting on top of whatever
  // just opened. Suppress labels for the rest of this hover until the
  // pointer genuinely leaves the dock.
  const [suppressLabels, setSuppressLabels] = useState(false)
  const openShellMenu = useShellMenu()
  // Dock menus open upward from the icon's top edge, so they sit above the dock instead of covering it.
  const openMenu = useCallback(
    (e: { currentTarget: EventTarget; clientX: number }, items: ShellMenuItemDef[]) => {
      const el = e.currentTarget as HTMLElement
      const r = el.getBoundingClientRect?.()
      const bar = barRef.current?.getBoundingClientRect()
      const x = r && el !== barRef.current ? r.left : e.clientX - 8
      openShellMenu({ x, y: (bar?.top ?? r?.top ?? 0) - 8 }, items, { up: true })
    },
    [openShellMenu],
  )

  // The drag-up switcher gesture often starts on the dock. When it opens,
  // drop whatever the dock thought was happening (press, drag, hover) and
  // swallow the click that the release would otherwise deliver to an icon.
  useEffect(() => {
    let suppressUntil = 0
    // Only the click produced by releasing the gesture is eaten, never a later real one.
    const guard = (ev: MouseEvent) => {
      if (Date.now() < suppressUntil) {
        ev.preventDefault()
        ev.stopPropagation()
      }
    }
    // A release anywhere always ends a dock drag, even one the dock missed.
    const reset = () => {
      if (dragRef.current && !dragRef.current.active) dragRef.current = null
    }
    window.addEventListener('click', guard, true)
    window.addEventListener('pointercancel', reset)
    window.addEventListener('blur', reset)
    const un = listen('gesture://start', () => {
      dragRef.current = null
      setDrag(null)
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.getSelection()?.removeAllRanges()
      setRevealed(false)
      suppressUntil = Date.now() + 700
    })
    const unEnd = listen('gesture://end', () => {
      suppressUntil = Date.now() + 300
    })
    return () => {
      window.removeEventListener('click', guard, true)
      window.removeEventListener('pointercancel', reset)
      window.removeEventListener('blur', reset)
      void un.then((fn) => fn())
      void unEnd.then((fn) => fn())
    }
  }, [])
  const [binCount, setBinCount] = useState(0)

  // Something taking the whole screen (a lock screen, the screensaver, the TV) hides the dock at once, and it
  // comes back when that ends. Without this a dock that is not auto-hiding stays "revealed" over the cover.
  useEffect(() => {
    setRevealed(fullscreen ? false : !autoHide)
  }, [fullscreen, autoHide])

  const shouldHide = autoHide || fullscreen
  const visible = !shouldHide || revealed
  const visibleRef = useLatest(visible)
  const itemsRef = useLatest(items)

  /* ---------- placement: the window IS the bar ----------
     The window is exactly as wide as the dock and sits on its reserved strip, so every pixel of it is
     the dock: always clickable, nothing to toggle, no click-through. The engine centres it and keeps it
     there (`engine_edge_bind`). Names on hover are popups of their own (see `tip` below). */
  const [barWidth, setBarWidth] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const measure = () => setBarWidth(Math.ceil(el.offsetWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!barWidth) return
    let cancelled = false
    const bind = async () => {
      const scale = pxScale()
      try {
        const r = await invoke<{ left: number; top: number }>('engine_edge_bind', {
          edge: 'bottom',
          windowPx: Math.round(METRICS.windowHeight * scale),
          reservePx: autoHide ? 0 : Math.round(METRICS.reserve * scale),
          widthPx: Math.round(barWidth * scale),
          insetPx: Math.round(METRICS.margin * scale),
        })
        if (cancelled) return
        geometry.current = { x: r.left, y: r.top, scale }
      } catch (err) {
        console.error('[dock] placement failed', err)
      }
    }
    void bind()
    const un = getCurrentWindow().onScaleChanged(() => void bind())
    const offLayout = onLayoutChange(() => void bind())
    return () => {
      offLayout()
      cancelled = true
      void un.then((fn) => fn())
    }
  }, [autoHide, barWidth])

  // Shown or hidden as a whole (auto-hide, full-screen apps).
  useEffect(() => {
    const win = getCurrentWindow()
    void (visible ? win.show() : win.hide())
  }, [visible])

  // Auto-hide: the native mouse hook reports the pointer only while it is near the bottom edge.
  useEffect(() => {
    if (!shouldHide) return
    void invoke('shell_set_dock_band', { heightPx: Math.round((METRICS.windowHeight + METRICS.margin) * (window.devicePixelRatio || 1)) + 8 }).catch(() => {})
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const un = listen<{ x: number; y: number }>('dock://pointer', ({ payload: { y } }) => {
      if (dragRef.current) return
      clearTimeout(hideTimer)
      if (y < 0) {
        hideTimer = setTimeout(() => setRevealed(false), HIDE_DELAY_MS)
      } else if (!visibleRef.current && !fullscreen) {
        setRevealed(true)
      }
    })
    return () => {
      clearTimeout(hideTimer)
      void un.then((fn) => fn())
    }
  }, [shouldHide, fullscreen, visibleRef])

  useEffect(() => {
    const refresh = () => void shell.recycleBinInfo().then((i) => setBinCount(i.itemCount), () => {})
    refresh()
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [])

  /* ---------- drag to reorder / drag off to unpin ---------- */
  const onPointerDown = useCallback((e: React.PointerEvent, item: DockItem, el: HTMLElement) => {
    if (e.button !== 0) return
    dragRef.current = { key: item.key, startX: e.clientX, startY: e.clientY, active: false }
    el.setPointerCapture(e.pointerId)
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (!d.active && Math.hypot(dx, dy) > DRAG_THRESHOLD) d.active = true
      if (d.active) setDrag({ key: d.key, dx, dy: Math.min(0, dy) })
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d?.active) return
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)

      const dragged = itemsRef.current.find((i) => i.key === d.key)
      if (!dragged) return
      const others = pins.filter((p) => p.key !== d.key)
      if (e.clientY - d.startY < -UNPIN_LIFT) {
        if (dragged.pinned && !isPermanent(dragged.key)) void savePins(others)
        return
      }
      const rects = others.map((p) => document.querySelector(`[data-dock-item="${CSS.escape(p.key)}"]`)?.getBoundingClientRect())
      let index = others.length
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]
        if (r && e.clientX < r.left + r.width / 2) {
          index = i
          break
        }
      }
      if (!dragged.pinned && e.clientX > (rects.at(-1)?.right ?? 0) + METRICS.slot) return
      const pin = toPin(dragged)
      if (!pin) return
      const next = [...others]
      next.splice(index, 0, pin)
      void savePins(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [pins, itemsRef])

  /* ---------- hotkeys: Win+1..9, Alt+` ---------- */
  useEffect(() => {
    const un = onHotkey((id) => {
      if (id === 'next-app-window' || id === 'prev-app-window') {
        const { windows, foreground: fg } = useShell.getState()
        const current = windows.find((w) => w.handle === fg)
        if (!current) return
        const group = windows.filter((w) => groupKeyOf(w) === groupKeyOf(current))
        if (group.length > 1) void shell.focus(nextWindow(group, fg, id === 'next-app-window' ? 1 : -1).handle)
      } else if (id.startsWith('dock-')) {
        const item = itemsRef.current[Number(id.slice(5)) - 1]
        if (!item) return
        const fg = useShell.getState().foreground
        if (item.windows.length > 1 && item.windows.some((w) => w.handle === fg)) void shell.focus(nextWindow(item.windows, fg).handle)
        else void activate(item, fg)
      }
    })
    return () => void un.then((fn) => fn())
  }, [itemsRef])

  // When Start or an app opens over the dock, this window never hears the
  // pointer leave, so the hovered button stays lit. Drop hover whenever the
  // dock loses focus and bring it back on the next real pointer movement.
  useEffect(() => {
    const off = () => barRef.current?.classList.add('dock-no-hover')
    const on = () => {
      const el = barRef.current
      if (el?.classList.contains('dock-no-hover')) el.classList.remove('dock-no-hover')
    }
    window.addEventListener('blur', off)
    window.addEventListener('pointermove', on)
    return () => {
      window.removeEventListener('blur', off)
      window.removeEventListener('pointermove', on)
    }
  }, [])

  return (
    <div className="fixed inset-0 flex select-none items-end justify-center" onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={barRef}
        onPointerDownCapture={() => setSuppressLabels(true)}
        onPointerLeave={() => setSuppressLabels(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          openMenu(e, dockMenuItems)
        }}
        className={cn('u-dock', suppressLabels && 'dock-suppress-labels')}
        style={{
          height: METRICS.barHeight,
          gap: METRICS.gap,
          padding: `0 ${METRICS.pad + 4}px`,
        }}
      >
        <GlassSlice edge="bottom" parentRef={barRef} />
        <button
          type="button"
          aria-label="Start"
          onClick={() => void emit('launcher:toggle')}
          className="u-dock__item"
          style={{ width: METRICS.slot, height: METRICS.slot }}
        >
          <DockLabel text="Start" count={0} />
          <span className="u-dock__glyph relative">
            <StartTile size={METRICS.iconSize} />
          </span>
        </button>
        <Divider />

        {items.flatMap((item, i) => {
          const icon = (
            <DockIcon key={item.key} item={item} foreground={foreground} dragOffset={drag?.key === item.key ? { x: drag.dx, y: drag.dy } : null} onPointerDown={onPointerDown} onOpenMenu={openMenu} />
          )
          return i === pinnedCount && pinnedCount > 0 ? [<Divider key="div-running" />, icon] : [icon]
        })}

        <Divider />
        <button
          type="button"
          aria-label={binCount ? `Recycle Bin, ${binCount} items` : 'Recycle Bin, empty'}
          onClick={() => void launchApp('shell:RecycleBinFolder')}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openMenu(e, [
              { label: 'Open', onSelect: () => void launchApp('shell:RecycleBinFolder') },
              {
                label: 'Empty Recycle Bin',
                disabled: binCount === 0,
                onSelect: () => {
                  if (window.confirm('Permanently delete everything in the Recycle Bin?')) void shell.emptyRecycleBin().then(() => setBinCount(0))
                },
              },
            ])
          }}
          className="u-dock__item"
          style={{ width: METRICS.slot, height: METRICS.slot }}
        >
          <DockLabel text={binCount ? `Recycle Bin · ${binCount}` : 'Recycle Bin'} count={0} />
          <span className="u-dock__glyph relative">
            <TrashGlyph size={METRICS.iconSize} full={binCount > 0} />
          </span>
        </button>
        <Divider />
        <DockClock />
      </div>
    </div>
  )
}

function Divider() {
  return <span className="u-dock__sep" aria-hidden />
}

/** Time only, like a watch face on the dock; the date is in the tooltip and the menu bar. */
function DockClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Tick on the minute boundary, not every second.
    let t = setTimeout(function tick() {
      setNow(new Date())
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }, 60_000 - (Date.now() % 60_000))
    return () => clearTimeout(t)
  }, [])
  return (
    <button
      type="button"
      onClick={() => void emit('launcher:toggle')}
      className="u-dock__clock"
      style={{ height: METRICS.slot }}
    >
      <span className="text-[13px] font-semibold tabular-nums tracking-tight">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="text-[10px] text-(--u-ink-3)">{now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </button>
  )
}
