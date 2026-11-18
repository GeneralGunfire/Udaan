import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pxScale } from '@/os/kernel/uiScale'
import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { availableMonitors, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { CalendarConnected, LayoutsConnected, MediaConnected, NetworkConnected, NotificationsConnected, SoundConnected } from './popups/Connected'
import { ContextMenuList } from './ContextMenuList'
import type { FlyoutMenuItem, FlyoutPlacement, ShowTaskbarPopupPayload } from './taskbarPopupTypes'

/**
 * THE POPUP WINDOW. One transparent OS window that shows whichever popup was asked for: a top-bar panel, the
 * Notification Center, or a context menu. It is placed, sized and shown from here, never by the caller.
 *
 * PLACEMENT (all in logical pixels; the window is set in physical pixels at the very end):
 *   below       a menu-bar panel. Hangs under its button, centred on it, kept clear of the dock.
 *   above       a dock panel. Sits above its button, centred, kept clear of the menu bar.
 *   sheet-right the Notification Center: the full height of the work area, flush to the right edge.
 *   point       a context menu. Its top-left corner is the pointer; if there is no room to the right it opens to the
 *               left of the pointer, and if there is no room below it opens upward.
 *   point-up    a context menu from the dock: opens upward from the pointer.
 * A card never leaves the screen, never covers the menu bar or the dock, and if it is taller than the room it
 * scrolls instead of overflowing.
 *
 * The window is the card plus a PAD-wide transparent margin, so the card's shadow is never cut off flat at the window
 * edge. A menu with sub-menus reserves room for them to open beside it, on the side with more space.
 */

const PAD = 14
const PANEL_W = 340
const SHEET_W = 392
const MENU_W = 236
const SUB_OVERLAP = 6
const EDGE = 8
const TOP_BAR = 34
const DOCK_ZONE = 76
const GAP = 6

const WIDTH = { 'notifications-panel': PANEL_W, calendar: PANEL_W, layouts: PANEL_W, network: PANEL_W, sound: PANEL_W, media: PANEL_W, 'context-menu': MENU_W } as const
type Kind = keyof typeof WIDTH

/** Heights of a menu's rows in px (see Menu.tsx): a row, a separator, a section label. */
const rowH = (it: FlyoutMenuItem) => (it.header ? 31 : it.label === undefined ? 9 : 30)
const listH = (items: FlyoutMenuItem[]) => 12 + items.reduce((h, it) => h + rowH(it), 0)

/** How tall the card is, and how tall its sub-menus make the window (a sub-menu opens beside its item and may hang lower). */
function menuExtent(items: FlyoutMenuItem[]): { card: number; window: number; depth: number } {
  const card = listH(items)
  let win = card
  let depth = 0
  items.forEach((it, i) => {
    if (!it.items) return
    const top = items.slice(0, i).reduce((h, x) => h + rowH(x), 0)
    const sub = menuExtent(it.items)
    win = Math.max(win, top + sub.window)
    depth = Math.max(depth, 1 + sub.depth)
  })
  return { card, window: win, depth }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function FlyoutWindow() {
  const [kind, setKind] = useState<Kind | null>(null)
  const [placement, setPlacement] = useState<FlyoutPlacement>('above')
  const [menuItems, setMenuItems] = useState<FlyoutMenuItem[]>([])
  const [cap, setCap] = useState<number | null>(null)
  const [side, setSide] = useState<'right' | 'left'>('right')
  const anchor = useRef<{ x: number; y: number; placement: FlyoutPlacement }>({ x: 0, y: 0, placement: 'above' })
  const contentRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)
  const last = useRef<Box | null>(null)
  // Bumped on every show request, so asking for a menu while another is open re-places it.
  const [seq, setSeq] = useState(0)

  const hide = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    last.current = null
    setKind(null)
    void invoke('engine_popup_watch', { on: false }).catch(() => {})
    void emit('taskbar-popup:hidden')
    // Gone at once, so nothing is left on screen while the card would still be fading.
    void invoke('engine_popup_dismiss').catch(() => {})
  }, [])

  useEffect(() => {
    const subs = [
      listen<ShowTaskbarPopupPayload>('taskbar-popup:show', (e) => {
        const p = e.payload
        if (!(p.kind in WIDTH)) return
        anchor.current = { x: p.x, y: p.y, placement: p.placement ?? 'above' }
        openRef.current = true
        last.current = null
        setPlacement(p.placement ?? 'above')
        setMenuItems(p.items ?? [])
        setCap(null)
        setKind(p.kind)
        setSeq((n) => n + 1)
      }),
      listen('taskbar-popup:hide', hide),
      listen('engine://popup-outside', hide),
    ]
    return () => subs.forEach((s) => void s.then((fn) => fn()))
  }, [hide])

  /** Works out the card's box on the screen and the window around it, then moves the window there. */
  const place = useCallback(async (first: boolean) => {
    if (!kind) return
    const scale = pxScale()
    const a = anchor.current
    const [here, all] = await Promise.all([currentMonitor(), availableMonitors().catch(() => [])])
    // The screen the anchor is on (in physical pixels), not necessarily the one the popup was last shown on.
    const monitors = all.length ? all : here ? [here] : []
    const pick = monitors.find((m) => a.x * scale >= m.position.x && a.x * scale < m.position.x + m.size.width && a.y * scale >= m.position.y && a.y * scale < m.position.y + m.size.height) ?? here ?? monitors[0]
    const mon = {
      x: (pick?.position.x ?? 0) / scale,
      y: (pick?.position.y ?? 0) / scale,
      w: (pick?.size.width ?? window.screen.width * scale) / scale,
      h: (pick?.size.height ?? window.screen.height * scale) / scale,
    }
    const left = mon.x + EDGE
    const right = mon.x + mon.w - EDGE
    const top = mon.y + TOP_BAR + GAP
    const bottom = mon.y + mon.h - DOCK_ZONE
    const el = contentRef.current

    let card: Box
    let win: Box
    let nextCap: number | null = null
    let nextSide: 'right' | 'left' = 'right'

    if (kind === 'context-menu') {
      const ext = menuExtent(menuItems)
      const subSpace = ext.depth * (MENU_W - SUB_OVERLAP)
      // Left/right: the pointer is the top-left corner; no room to the right means open to its left.
      let mx = a.x + MENU_W <= right ? a.x : a.x - MENU_W
      mx = Math.max(left, mx)
      // Sub-menus open on whichever side has room.
      if (subSpace && mx + MENU_W + subSpace > right && mx - subSpace >= left) nextSide = 'left'
      // Up/down: opens down from the pointer, or up when it would not fit (always up for point-up).
      const fitsBelow = a.y + ext.window <= mon.y + mon.h - EDGE
      let my = a.placement === 'point-up' || !fitsBelow ? a.y - ext.card : a.y
      my = Math.min(Math.max(mon.y + EDGE, my), mon.y + mon.h - EDGE - ext.window)
      const wx = nextSide === 'left' ? mx - subSpace : mx
      card = { x: mx, y: my, w: MENU_W, h: ext.card }
      win = { x: wx, y: my, w: MENU_W + subSpace, h: ext.window }
    } else if (a.placement === 'sheet-right') {
      const w = SHEET_W
      const h = mon.y + mon.h - EDGE - top
      card = { x: right - w, y: top, w, h }
      win = card
    } else {
      const w = WIDTH[kind]
      const natural = el?.offsetHeight || 400
      // Centred on its button, then pulled back inside the screen.
      const x = Math.min(Math.max(a.x - w / 2, left), right - w)
      if (a.placement === 'below') {
        const y = a.y + GAP
        const room = bottom - y
        const h = Math.min(natural, Math.max(room, 120))
        nextCap = natural > h ? h : null
        card = { x, y, w, h }
      } else {
        const room = a.y - GAP - top
        const h = Math.min(natural, Math.max(room, 120))
        nextCap = natural > h ? h : null
        card = { x, y: a.y - GAP - h, w, h }
      }
      win = card
    }

    // The window is the card plus its transparent margin.
    const box: Box = { x: win.x - PAD, y: win.y - PAD, w: win.w + PAD * 2, h: win.h + PAD * 2 }
    setCap(nextCap)
    setSide(nextSide)
    const prev = last.current
    if (!first && prev && Math.abs(prev.x - box.x) < 1 && Math.abs(prev.y - box.y) < 1 && Math.abs(prev.w - box.w) < 2 && Math.abs(prev.h - box.h) < 2) return
    last.current = box
    await invoke('shell_set_window_rect', { x: Math.round(box.x * scale), y: Math.round(box.y * scale), w: Math.round(box.w * scale), h: Math.round(box.h * scale) })
  }, [kind, menuItems])

  // Show: wait for the card's height to settle (panels that load data start small), place it, then present it.
  useLayoutEffect(() => {
    if (!kind) return
    let cancelled = false
    void (async () => {
      if (kind !== 'context-menu' && placement !== 'sheet-right') {
        let lastH = -1
        for (let i = 0; i < 5 && !cancelled; i++) {
          const now = contentRef.current?.offsetHeight ?? 0
          if (now > 0 && now === lastH) break
          lastH = now
          await new Promise((r) => setTimeout(r, 40))
        }
      }
      if (cancelled) return
      await place(true)
      if (cancelled) return
      await invoke('engine_popup_present')
      // Tell whoever asked that the popup is really up (a request sent before this window loaded is lost, so they retry until they hear this).
      void emit('taskbar-popup:shown')
      // Any click outside the popup (the desktop included) closes it.
      void invoke('engine_popup_watch', { on: true }).catch(() => {})
    })()
    return () => {
      cancelled = true
    }
  }, [kind, placement, seq, place])

  // Panels load data after opening; follow their height (debounced: resizing an OS window is an async chain).
  useEffect(() => {
    const el = contentRef.current
    if (!kind || !el || kind === 'context-menu' || placement === 'sheet-right') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void place(false), 70)
    })
    ro.observe(el)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [kind, placement, place])

  useEffect(() => {
    const un = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) hide()
    })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('keydown', onKey)
    return () => {
      void un.then((fn) => fn())
      window.removeEventListener('keydown', onKey)
    }
  }, [hide])

  const sheet = placement === 'sheet-right'
  return (
    <div className="popup-host fixed inset-0" style={{ padding: PAD }}>
      {kind && (
        <div
          key={`${kind}-${seq}`}
          ref={contentRef}
          className={sheet ? 'h-full' : kind === 'context-menu' ? `flex h-full ${side === 'left' ? 'justify-end' : 'justify-start'}` : 'w-fit'}
          style={!sheet && cap ? { maxHeight: cap, overflowY: 'auto', borderRadius: 24 } : undefined}
        >
          {kind === 'network' ? (
            <NetworkConnected />
          ) : kind === 'sound' ? (
            <SoundConnected />
          ) : kind === 'media' ? (
            <MediaConnected />
          ) : kind === 'calendar' ? (
            <CalendarConnected onClose={hide} />
          ) : kind === 'layouts' ? (
            <LayoutsConnected onDone={hide} />
          ) : kind === 'context-menu' ? (
            <ContextMenuList
              items={menuItems}
              onClose={hide}
              onSelect={(id) => {
                void emit('taskbar-popup:select', id)
                hide()
              }}
              side={side}
            />
          ) : (
            <NotificationsConnected onClose={hide} sheet={sheet} />
          )}
        </div>
      )}
    </div>
  )
}
