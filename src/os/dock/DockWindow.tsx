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
import { usePref } from '@/os/kernel/prefs'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { useShellMenu, type ShellMenuItemDef } from '@/os/ui/useShellMenu'
import { StartTile, TrashGlyph } from '@/os/ui/icons/SystemGlyphs'
import { useLatest } from '@/os/ui/useLatest'
import { launchBounce, minimizeNudge, restoreNudge, focusPop, curve, dur, springs } from '@/os/motion/systemMotion'
import { playSound } from '@/os/sound/sounds'
import { dockMetrics } from './geometry'
import { isPermanent, savePins, togglePin } from './pins'
import { toPin, useDockItems, type DockItem } from './useDockItems'

const METRICS = dockMetrics()
const LAUNCH_TIMEOUT_MS = 8000
const REVEAL_EDGE_PX = 2
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
  { label: 'Dock settings', onSelect: () => void openApp('settings', { section: 'dock' }) },
  { label: undefined },
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
      className="group relative flex shrink-0 items-end justify-center rounded-[14px] pb-[6px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
    >
      <DockLabel text={item.name} count={count} />
      {/* The icon stack. Icons keep a fixed size: no magnification. */}
      <motion.span
        animate={controls}
        className="relative flex origin-bottom transition-transform duration-150 ease-out group-active:scale-[0.9]"
        style={{ width: METRICS.iconSize, height: METRICS.iconSize }}
      >
        <DockGlyph item={item} />
        {/* Reflection: a flipped, faded copy of the icon on the dock floor.
            Masked to fade out with distance, as a real reflection does. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-full w-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            height: METRICS.iconSize * 0.5,
            transform: 'scaleY(-1)',
            transformOrigin: 'top',
            maskImage: 'linear-gradient(to top, transparent 15%, rgb(0 0 0 / 0.28))',
            WebkitMaskImage: 'linear-gradient(to top, transparent 15%, rgb(0 0 0 / 0.28))',
          }}
        >
          <DockGlyph item={item} />
        </span>
      </motion.span>

      {/* Running indicator. One pill that widens with the window count reads
          faster than counting dots, and it animates between states. */}
      {count > 0 && (
        <motion.span
          className="absolute bottom-[1px] left-1/2 h-[3px] rounded-full"
          initial={false}
          animate={{
            width: count > 1 ? 4 + Math.min(count, 4) * 4 : 4,
            backgroundColor: item.focused ? 'var(--color-accent)' : 'var(--os-text-dim)',
            opacity: item.allMinimized ? 0.45 : 1,
          }}
          style={{ x: '-50%' }}
          transition={springs.indicator}
        />
      )}
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
function DockLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="os-dock-label pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 translate-y-1 scale-95 whitespace-nowrap opacity-0 transition-[opacity,transform] delay-0 duration-150 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-hover:delay-[350ms]">
      <span className="os-panel-material relative flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12px] font-medium text-[var(--os-text)]">
        {text}
        {count > 1 && <span className="text-[var(--os-text-dim)] tabular-nums">· {count}</span>}
        {/* Notch, rotated 45° and clipped by the chip above it. */}
        <span
          aria-hidden
          className="absolute left-1/2 top-full h-[7px] w-[7px] -translate-x-1/2 -translate-y-[4px] rotate-45 rounded-[1.5px]"
          style={{ background: 'var(--os-panel-solid)', borderRight: '1px solid var(--os-border)', borderBottom: '1px solid var(--os-border)' }}
        />
      </span>
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
  const reduced = prefersReducedMotion()

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
  const openMenu = useShellMenu()

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

  const shouldHide = autoHide || fullscreen
  const visible = !shouldHide || revealed
  const visibleRef = useLatest(visible)
  const itemsRef = useLatest(items)

  /* ---------- placement: one fixed spot, bottom-centre ---------- */
  useEffect(() => {
    let cancelled = false
    async function place() {
      const win = getCurrentWindow()
      const scale = pxScale()
      try {
        const h = Math.round(METRICS.windowHeight * scale)
        // One call: reserve the strip (not while auto-hiding), put the window exactly on it,
        // and from then on the engine keeps it there and releases it however the window ends.
        const r = await invoke<{ left: number; top: number }>('engine_edge_bind', {
          edge: 'bottom',
          windowPx: h,
          reservePx: autoHide ? 0 : Math.round(METRICS.reserve * scale),
        })
        if (cancelled) return
        geometry.current = { x: r.left, y: r.top, scale }
        await win.show()
        // Showing can nudge a window; binding is idempotent, so just assert it once more.
        await invoke('engine_edge_bind', {
          edge: 'bottom',
          windowPx: h,
          reservePx: autoHide ? 0 : Math.round(METRICS.reserve * scale),
        })
      } catch (err) {
        console.error('[dock] placement failed', err)
      }
    }
    void place()
    const un = getCurrentWindow().onScaleChanged(() => void place())
    const offLayout = onLayoutChange(() => void place())
    return () => {
      offLayout()
      cancelled = true
      void un.then((fn) => fn())
    }
  }, [autoHide])

  /* ---------- click-through + auto-hide ----------
     The window spans the screen width; a transparent window takes clicks
     over its whole rectangle, so outside the bar it ignores the cursor.
     While ignoring or auto-hiding, one cursor read per tick (geometry is
     cached) decides whether to take input back or reveal the dock. */
  const ignoring = useRef(false)
  const setIgnore = useCallback((v: boolean) => {
    if (ignoring.current === v) return
    ignoring.current = v
    getCurrentWindow()
      .setIgnoreCursorEvents(v)
      .catch((err) => {
        ignoring.current = false
        console.error('[dock] click-through unavailable', err)
      })
  }, [])

  // The native click-through flag outlives a reload of this webview, while
  // `ignoring` starts false again: sync them once on mount or the dock can
  // be left unclickable.
  useEffect(() => {
    ignoring.current = false
    void getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {})
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) return
      if (!barRef.current?.contains(e.target as Node)) setIgnore(true)
    }
    document.addEventListener('pointermove', onMove)
    return () => document.removeEventListener('pointermove', onMove)
  }, [setIgnore])

  // Pointer reports come from the native mouse hook, only while the cursor
  // is near the bottom edge (no polling): reveal at the edge, take clicks
  // over the bar, hide a moment after leaving.
  useEffect(() => {
    void invoke('shell_set_dock_band', { heightPx: Math.round(METRICS.windowHeight * (window.devicePixelRatio || 1)) + 8 }).catch(() => {})
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleHide = () => {
      if (!shouldHide || hideTimer) return
      hideTimer = setTimeout(() => {
        hideTimer = undefined
        setRevealed(false)
      }, HIDE_DELAY_MS)
    }
    const cancelHide = () => {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
    const un = listen<{ x: number; y: number }>('dock://pointer', ({ payload: { x: cx, y: cy } }) => {
      if (dragRef.current) return
      if (cy < 0) {
        // Left the bottom band entirely.
        setIgnore(true)
        if (visibleRef.current) scheduleHide()
        return
      }
      const g = geometry.current
      const x = (cx - g.x) / g.scale
      const y = (cy - g.y) / g.scale
      const bar = barRef.current?.getBoundingClientRect()
      const inBar = !!bar && visibleRef.current && x >= bar.left - 4 && x <= bar.right + 4 && y >= bar.top - 4 && y <= METRICS.windowHeight
      setIgnore(!inBar)
      if (!shouldHide) return
      const atEdge = y >= METRICS.windowHeight - REVEAL_EDGE_PX && x >= 0 && x <= window.innerWidth
      if (!visibleRef.current && atEdge && !fullscreen) {
        cancelHide()
        setRevealed(true)
      } else if (visibleRef.current && !inBar) scheduleHide()
      else cancelHide()
    })
    return () => {
      cancelHide()
      void un.then((fn) => fn())
    }
  }, [shouldHide, fullscreen, setIgnore, visibleRef])

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
    <div className="fixed inset-0 flex select-none items-end justify-center" style={{ paddingBottom: METRICS.margin }} onContextMenu={(e) => e.preventDefault()}>
      <motion.div
        ref={barRef}
        initial={false}
        animate={{ y: visible ? 0 : METRICS.windowHeight + 8 }}
        transition={reduced ? { duration: dur.fade } : visible ? { type: 'spring', stiffness: 420, damping: 36 } : { duration: dur.normal, ease: curve.accelerate }}
        onPointerEnter={() => setIgnore(false)}
        onPointerDownCapture={() => setSuppressLabels(true)}
        onPointerLeave={() => setSuppressLabels(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          openMenu(e, dockMenuItems)
        }}
        className={cn('os-dock-material os-sheen relative flex items-center', suppressLabels && 'dock-suppress-labels')}
        style={{
          height: METRICS.barHeight,
          gap: METRICS.gap,
          padding: `0 ${METRICS.pad + 4}px`,
          borderRadius: 'var(--os-radius-dock)',
        }}
      >
        <button
          type="button"
          aria-label="Start"
          onClick={() => void emit('launcher:toggle')}
          className="group relative flex shrink-0 items-end justify-center rounded-[14px] pb-[6px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
          style={{ width: METRICS.slot, height: METRICS.slot }}
        >
          <DockLabel text="Start" count={0} />
          <span className="relative origin-bottom transition-transform duration-150 ease-out group-hover:scale-[1.12] group-active:scale-[0.92]">
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
          className="group relative flex shrink-0 items-end justify-center rounded-[14px] pb-[6px] outline-none"
          style={{ width: METRICS.slot, height: METRICS.slot }}
        >
          <DockLabel text={binCount ? `Recycle Bin · ${binCount}` : 'Recycle Bin'} count={0} />
          <span className="relative origin-bottom transition-transform duration-150 ease-out group-hover:scale-[1.12] group-active:scale-[0.92]">
            <TrashGlyph size={METRICS.iconSize} full={binCount > 0} />
          </span>
        </button>
        <Divider />
        <DockClock />
      </motion.div>
    </div>
  )
}

function Divider() {
  return <span className="mx-1.5 h-7 w-px shrink-0 bg-[var(--os-separator)]" aria-hidden />
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
      className="group relative flex shrink-0 flex-col items-center justify-center rounded-[12px] px-2.5 leading-tight text-[var(--os-text)] transition-colors duration-150 hover:bg-[var(--os-hover)] active:bg-[var(--os-active)]"
      style={{ height: METRICS.slot }}
    >
      <span className="text-[14px] font-semibold tabular-nums tracking-tight">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="text-[11px] text-[var(--os-text-dim)]">{now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </button>
  )
}
