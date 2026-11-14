import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { pxScale } from '@/os/kernel/uiScale'
import { NetworkPanel } from './panels/NetworkPanel'
import { SoundPanel } from './panels/SoundPanel'
import { MediaPanel } from './panels/MediaPanel'
import { CalendarPanel } from './panels/CalendarPanel'
import { LayoutsPanel } from './panels/LayoutsPanel'
import { NotificationsPanel } from './NotificationsPanel'
import { ContextMenuList } from './ContextMenuList'
import type { FlyoutMenuItem, FlyoutPlacement, ShowTaskbarPopupPayload } from './taskbarPopupTypes'

/**
 * THE POPUP HOST.
 *
 * One transparent window that every shell popup (sound, network, media,
 * calendar, notifications, snap layouts, context menus) is shown in.
 *
 * Division of labour:
 *   - This file renders the card and measures it.
 *   - The ENGINE (`engine_popup_open` / `_resize` / `_close`) decides where
 *     the window goes (next to the anchor, flipped and clamped on screen),
 *     shows it in the same call, cuts it to the card's rounded shape so the
 *     compositor blur follows the corners, and hides it when it loses focus.
 *
 * So there is no JS placement maths, no polling for "has the content
 * settled", and no window resize per animation frame: the card is measured
 * (ResizeObserver), the engine moves and resizes the window in one call,
 * and a panel that loads data later simply grows from the edge it is
 * anchored to.
 */

const WIDTH = { 'notifications-panel': 340, calendar: 312, layouts: 380, network: 300, sound: 360, media: 340, 'context-menu': 220, tip: 0 } as const
const MAX_HEIGHT = 640
type Kind = keyof typeof WIDTH

const PLACEMENT: Record<FlyoutPlacement, 'above' | 'below' | 'point' | 'sheet-right'> = {
  above: 'above',
  below: 'below',
  point: 'point',
  'sheet-right': 'sheet-right',
}

export function FlyoutWindow() {
  const [kind, setKind] = useState<Kind | null>(null)
  const [menuItems, setMenuItems] = useState<FlyoutMenuItem[]>([])
  const [shown, setShown] = useState(false)
  const [origin, setOrigin] = useState<'top' | 'bottom' | 'right'>('top')
  const payload = useRef<ShowTaskbarPopupPayload | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  /** The engine has the popup open for the current payload. */
  const opened = useRef(false)
  const openCall = useRef(0)
  const revealed = useRef(false)

  const close = useCallback(() => {
    if (!payload.current) return
    const wasTip = payload.current.kind === 'tip'
    payload.current = null
    opened.current = false
    openCall.current++
    setShown(false)
    setKind(null)
    void invoke('engine_popup_close').catch(() => {})
    if (!wasTip) void emit('taskbar-popup:hidden')
  }, [])

  useEffect(() => {
    const subs = [
      listen<ShowTaskbarPopupPayload>('taskbar-popup:show', (e) => {
        const p = e.payload
        if (!(p.kind in WIDTH)) return
        // A name tip never replaces a real popup that is open.
        if (p.kind === 'tip' && payload.current && payload.current.kind !== 'tip') return
        payload.current = p
        opened.current = false
        setShown(false)
        revealed.current = false
        setMenuItems(p.items ?? [])
        const placement = PLACEMENT[p.placement ?? 'above']
        setOrigin(placement === 'above' ? 'bottom' : placement === 'sheet-right' ? 'right' : 'top')
        setKind(p.kind)
        // If the popup has not come up shortly (the webview was asleep), ask again.
        for (const ms of [350, 900]) {
          setTimeout(() => {
            if (payload.current === p && !revealed.current) {
              opened.current = false
              fitRef.current()
            }
          }, ms)
        }
      }),
      listen('taskbar-popup:hide', close),
      listen('taskbar-tip:hide', () => payload.current?.kind === 'tip' && close()),
      // The engine hid the popup because it lost focus; just bring the UI state in line.
      listen('engine://popup-dismissed', () => {
        if (!payload.current) return
        payload.current = null
        opened.current = false
        openCall.current++
        setShown(false)
        setKind(null)
        void emit('taskbar-popup:hidden')
      }),
    ]
    return () => subs.forEach((s) => void s.then((fn) => fn()))
  }, [close])

  /** Ask the engine to place (first time) or re-fit (after) the window for the card's current size. */
  const fit = useCallback(() => {
    const card = cardRef.current
    const p = payload.current
    if (!card || !p) return
    const scale = pxScale()
    const w = Math.ceil(card.offsetWidth * scale)
    const h = Math.ceil(Math.min(card.offsetHeight, MAX_HEIGHT) * scale)
    if (w < 2 || h < 2) return
    if (opened.current) {
      void invoke('engine_popup_resize', { width: w, height: h }).catch(() => {})
      return
    }
    opened.current = true
    const call = ++openCall.current
    const placement = PLACEMENT[p.placement ?? 'above']
    // The trigger gives the anchor as a point (x = centre, y = edge) in logical px.
    const x = Math.round(p.x * scale)
    const y = Math.round(p.y * scale)
    const anchor = { left: x, right: x, top: y, bottom: y }
    void invoke('engine_popup_open', {
      anchor,
      width: w,
      height: placement === 'sheet-right' ? 100000 : h,
      placement,
      focus: p.kind !== 'tip',
      radius: p.kind === 'tip' ? 8 : p.kind === 'context-menu' ? 10 : 16,
    })
      .then(() => {
        // Only reveal if this is still the popup that was asked for.
        if (call === openCall.current) {
          revealed.current = true
          setShown(true)
        }
      })
      .catch(() => {
        opened.current = false
      })
  }, [])

  const fitRef = useRef(() => {})
  useEffect(() => {
    fitRef.current = fit
  }, [fit])

  // Measure as soon as the card exists, and follow its size afterwards.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!kind || !card) return
    fit()
    const ro = new ResizeObserver(() => fit())
    ro.observe(card)
    return () => ro.disconnect()
  }, [kind, fit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const isMenu = kind === 'context-menu'
  const isTip = kind === 'tip'
  const sheet = payload.current?.placement === 'sheet-right'

  return (
    <div className="fixed inset-0 overflow-hidden">
      {kind && (
        <div
          key={kind}
          ref={cardRef}
          data-shown={shown}
          data-origin={origin}
          className={`u-surface u-popup u-scroll ${isMenu ? 'u-popup--menu' : ''} ${isTip ? 'u-popup--tip' : ''}`}
          style={{
            width: isMenu || isTip ? undefined : WIDTH[kind],
            minWidth: isMenu ? WIDTH[kind] : undefined,
            maxHeight: sheet ? '100%' : MAX_HEIGHT,
            height: sheet ? '100%' : undefined,
          }}
        >
          {isTip ? (
            <div className="whitespace-nowrap px-2.5 py-1.5 text-[12px] font-medium">
              {menuItems[0]?.label}
              {menuItems[0]?.id && <span className="block max-w-[260px] truncate text-[11px] font-normal text-(--u-ink-3)">{menuItems[0].id}</span>}
            </div>
          ) : kind === 'network' ? (
            <NetworkPanel />
          ) : kind === 'sound' ? (
            <SoundPanel />
          ) : kind === 'media' ? (
            <MediaPanel />
          ) : kind === 'calendar' ? (
            <CalendarPanel onClose={close} />
          ) : kind === 'layouts' ? (
            <LayoutsPanel onDone={close} />
          ) : isMenu ? (
            <ContextMenuList
              items={menuItems}
              onSelect={(id) => {
                void emit('taskbar-popup:select', id)
                close()
              }}
            />
          ) : (
            <NotificationsPanel />
          )}
        </div>
      )}
    </div>
  )
}
