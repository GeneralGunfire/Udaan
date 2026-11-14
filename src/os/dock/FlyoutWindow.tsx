import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { pxScale } from '@/os/kernel/uiScale'
import { AnimatePresence, motion } from 'framer-motion'
import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { curve, dur, flyoutFromBottom, flyoutFromTop, flyoutMotionReduced } from '@/os/motion/systemMotion'
import { NetworkPanel } from './panels/NetworkPanel'
import { SoundPanel } from './panels/SoundPanel'
import { MediaPanel } from './panels/MediaPanel'
import { CalendarPanel } from './panels/CalendarPanel'
import { LayoutsPanel } from './panels/LayoutsPanel'
import { NotificationsPanel } from './NotificationsPanel'
import { ContextMenuList } from './ContextMenuList'
import type { FlyoutMenuItem, FlyoutPlacement, ShowTaskbarPopupPayload } from './taskbarPopupTypes'

/**
 * A sheet sliding in from the right edge of the screen.
 *
 * Springs rather than a tween, because a sheet is large enough that a
 * linear arrival reads as mechanical. The exit stays a tween: an exit that
 * overshoots reads as indecision.
 */
const sheetMotion = {
  initial: { opacity: 0, x: 48 },
  animate: { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 440, damping: 38, mass: 0.9 } },
  exit: { opacity: 0, x: 40, transition: { duration: dur.fast, ease: curve.accelerate } },
}

const WIDTH = { 'notifications-panel': 320, calendar: 300, layouts: 380, network: 280, sound: 340, media: 320, 'context-menu': 188 } as const
const GAP_ABOVE_DOCK = 10
const EDGE = 8
const MAX_HEIGHT = 640

type Kind = keyof typeof WIDTH

/**
 * The dock's flyouts (Quick Settings, Notifications) in their own window,
 * hidden (so receiving no input) unless one is open. Win11 behaviour:
 * slides up from the dock, dismisses on click-away, Escape, or re-click.
 */
export function FlyoutWindow() {
  const [kind, setKind] = useState<Kind | null>(null)
  const [placement, setPlacement] = useState<FlyoutPlacement>('above')
  const [menuItems, setMenuItems] = useState<FlyoutMenuItem[]>([])
  const anchor = useRef<{ x: number; y: number; placement: FlyoutPlacement }>({ x: 0, y: 0, placement: 'above' })
  const cardRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)
  // Bumped on every show request, so asking for a menu while another is open re-places it.
  const [seq, setSeq] = useState(0)
  const reduced = prefersReducedMotion()

  const hide = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    setKind(null)
    void invoke('engine_popup_watch', { on: false }).catch(() => {})
    void emit('taskbar-popup:hidden')
    // Gone at once: the compositor's blur belongs to the window, so waiting for a fade-out would leave a
    // blurred rectangle on screen after the card has already left.
    void invoke('engine_popup_dismiss').catch(() => {})
  }, [])

  useEffect(() => {
    const subs = [
      listen<ShowTaskbarPopupPayload>('taskbar-popup:show', (e) => {
        const p = e.payload
        if (!(p.kind in WIDTH)) return
        anchor.current = { x: p.x, y: p.y, placement: p.placement ?? 'above' }
        openRef.current = true
        setPlacement(p.placement ?? 'above')
        setMenuItems(p.items ?? [])
        setKind(p.kind)
        setSeq((n) => n + 1)
      }),
      listen('taskbar-popup:hide', hide),
      listen('engine://popup-outside', hide),
    ]
    return () => subs.forEach((s) => void s.then((fn) => fn()))
  }, [hide])

  // Size to the content and sit centred over the anchor, clamped on-screen.
  useLayoutEffect(() => {
    if (!kind) return
    let cancelled = false
    void (async () => {
      // Panels that load data (network, media, notifications...) start small and grow a
      // moment later. Wait for their height to stop changing so the window opens at its
      // real size instead of visibly moving and resizing after it appears.
      if (kind !== 'context-menu') {
        let last = -1
        for (let i = 0; i < 4 && !cancelled; i++) {
          const now = contentRef.current?.scrollHeight ?? 0
          if (now === last) break
          last = now
          await new Promise((r) => setTimeout(r, 40))
        }
      }
      const [scale, monitor] = [pxScale(), await currentMonitor()]
      if (cancelled) return
      const { placement } = anchor.current
      const naturalWidth = Math.max(WIDTH[kind], contentRef.current?.scrollWidth ?? 0, cardRef.current?.scrollWidth ?? 0)
      const w = Math.round(naturalWidth * scale)
      let x = placement === 'point' ? Math.round(anchor.current.x * scale) : Math.round(anchor.current.x * scale - w / 2)
      let y: number
      let h: number
      if (placement === 'sheet-right' && monitor) {
        // Notification Center: a full-height sheet on the right edge.
        const top = Math.round(anchor.current.y * scale + GAP_ABOVE_DOCK * scale)
        h = monitor.position.y + monitor.size.height - top - Math.round(EDGE * 2 * scale)
        x = monitor.position.x + monitor.size.width - w - Math.round(EDGE * scale)
        y = top
      } else if (placement === 'point') {
        // Context menu: top-left anchored exactly at the click point, like
        // a native right-click menu — not centred like the other panels.
        const height = Math.min(MAX_HEIGHT, contentRef.current?.scrollHeight ?? cardRef.current?.scrollHeight ?? 300) + 2
        h = Math.round(height * scale)
        y = Math.round(anchor.current.y * scale)
      } else {
        const height = Math.min(MAX_HEIGHT, contentRef.current?.scrollHeight ?? cardRef.current?.scrollHeight ?? 400) + 2
        h = Math.round(height * scale)
        y = placement === 'below' ? Math.round(anchor.current.y * scale + 6 * scale) : Math.round(anchor.current.y * scale - h - GAP_ABOVE_DOCK * scale)
      }
      let finalW = w
      if (monitor) {
        const { position: mp, size: ms } = monitor
        finalW = Math.min(w, ms.width - EDGE * 2 * scale)
        x = Math.min(Math.max(x, mp.x + EDGE * scale), mp.x + ms.width - finalW - EDGE * scale)
        y = Math.max(y, mp.y + EDGE * scale)
        if (placement === 'point' && y + h > mp.y + ms.height - EDGE * scale) {
          // No room below the click (the dock): open upward instead, like a native menu.
          y = Math.max(mp.y + EDGE * scale, Math.round(anchor.current.y * scale) - h)
        }
      }
      await invoke('shell_set_window_rect', { x, y, w: finalW, h })
      void invoke('engine_window_round', { radius: kind === 'context-menu' ? 10 : 16 }).catch(() => {})
      await invoke('engine_popup_present')
      // Any click outside the popup (the desktop included) closes it.
      void invoke('engine_popup_watch', { on: true }).catch(() => {})
    })()
    return () => {
      cancelled = true
    }
  }, [kind, placement, seq])

  // Panels load their data after opening; grow (or shrink) the window with them.
  useEffect(() => {
    const el = contentRef.current
    // A menu is complete the moment it opens: it never re-fits itself afterwards.
    if (!kind || !el || placement === 'sheet-right' || kind === 'context-menu') return
    // Debounced, not per-frame: resizing an OS window is an async IPC chain
    // (size, monitor, position, set rect) with the compositor re-blurring
    // behind it, so following content that is mid-animation would resize the
    // window sixty times a second. Waiting for the size to hold still for a
    // few frames makes it one resize, after the content has settled.
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const win = getCurrentWindow()
        const scale = pxScale()
        const height = Math.min(MAX_HEIGHT, el.scrollHeight) + 2
        const h = Math.round(height * scale)
        const naturalWidth = Math.max(WIDTH[kind], el.scrollWidth)
        let w = Math.round(naturalWidth * scale)
        const size = await win.innerSize()
        const monitor = await currentMonitor()
        if (monitor) w = Math.min(w, monitor.size.width - EDGE * 2 * scale)
        if (Math.abs(size.height - h) < 2 && Math.abs(size.width - w) < 2) return
        // One call for both, so a panel that grows upward never shows a frame where it
        // has moved but not yet resized.
        const pos = await win.outerPosition()
        const y = anchor.current.placement === 'above' ? pos.y + size.height - h : pos.y
        await invoke('shell_set_window_rect', { x: pos.x, y, w, h })
        void invoke('engine_window_round', { radius: 16 }).catch(() => {})
      }, 70)
    })
    ro.observe(el)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [kind, placement])

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

  return (
    <div className="fixed inset-0">
      <AnimatePresence>
        {kind && (
          <motion.div
            key={kind}
            ref={cardRef}
            {...(reduced
              ? flyoutMotionReduced
              : placement === 'sheet-right'
                ? sheetMotion
                : // Unfold from the edge the flyout is anchored to, so it
                  // visibly belongs to the control that opened it rather
                  // than appearing from its own centre.
                  placement === 'below' || placement === 'point'
                  ? flyoutFromTop
                  : flyoutFromBottom)}
            className={cn(
              'os-panel-material os-sheen text-(--os-text)',
              kind === 'context-menu' ? 'overflow-hidden rounded-(--os-radius-overlay)' : 'max-h-full overflow-y-auto rounded-(--os-radius-overlay)',
            )}
            style={{
              width: kind === 'context-menu' ? undefined : WIDTH[kind],
              minWidth: kind === 'context-menu' ? WIDTH[kind] : undefined,
              height: placement === 'sheet-right' ? '100%' : undefined,
              // Grow from the anchored edge. Scaling from the centre makes a
              // flyout look like it zoomed in from nowhere; scaling from the
              // edge it is attached to looks like it unfolded.
              transformOrigin:
                placement === 'sheet-right' ? 'right center' : placement === 'below' || placement === 'point' ? 'top center' : 'bottom center',
            }}
          >
            <div ref={contentRef} className={kind === 'context-menu' ? 'p-1' : undefined}>
              {kind === 'network' ? (
                <NetworkPanel />
              ) : kind === 'sound' ? (
                <SoundPanel />
              ) : kind === 'media' ? (
                <MediaPanel />
              ) : kind === 'calendar' ? (
                <CalendarPanel onClose={hide} />
              ) : kind === 'layouts' ? (
                <LayoutsPanel onDone={hide} />
              ) : kind === 'context-menu' ? (
                <ContextMenuList items={menuItems} onSelect={(id) => { void emit('taskbar-popup:select', id); hide() }} />
              ) : (
                <NotificationsPanel />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
