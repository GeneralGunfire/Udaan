import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { listNotifications, markNotificationRead, type Notification } from '@/integrations/notifications/client'
import { launchApp } from '@/integrations/installed-apps/client'
import { openApp, shell } from '@/os/kernel/shell'
import { pxScale } from '@/os/kernel/uiScale'
import { NotificationIcon, notificationSource, windowsExtra } from '@/os/ui/NotificationIcon'
import { playSound } from '@/os/sound/sounds'
import { BannerStack } from '@/os/ui/pop/Notifications'
import type { Note } from '@/os/ui/pop/samples'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { toNote, useMuteApp } from '@/os/dock/popups/Connected'

export { windowsExtra }

/** One banner as the engine reports it (`notify://banners`). */
interface BannerData {
  id: string
  kind: string
  title: string
  body: string
  sourceApp: string
  actionLabel: string | null
  urgency: string
}

const CARD = 372
/** A transparent margin around the stack so the cards' shadows are not cut off flat at the window edge. */
const PAD = 14
const MENU_BAR = 34
/** How far the cards sit from the screen's right edge and from under the menu bar. */
const EDGE = 16
const TOP_GAP = 8

/**
 * Notification banners: a renderer, nothing more.
 *
 * The ENGINE decides everything: whether a notification shows at all (Do Not Disturb, muted apps, repeats, bursts),
 * how long it stays, and when it leaves. This window draws the stack it is told about (`notify://banners`), reports
 * what the user did (click, dismiss, right-click options), sizes itself to the stack, and never takes focus.
 *
 * PLACEMENT: the cards' right edge is EDGE from the work area's right edge, their top is TOP_GAP below the menu bar.
 * The window is the stack plus PAD all round, re-fitted whenever the stack changes size (a new banner, or the deck
 * fanning out on hover).
 */
export function ToastWindow() {
  const [banners, setBanners] = useState<BannerData[]>([])
  // The stored notification for each banner: carries the sender's picture and click target.
  const [full, setFull] = useState<Record<string, Notification>>({})
  const stackRef = useRef<HTMLDivElement>(null)
  const known = useRef(new Set<string>())
  const openMenu = useShellMenu()
  const mute = useMuteApp()

  useEffect(() => {
    const apply = (list: BannerData[]) => {
      const fresh = list.filter((b) => !known.current.has(b.id))
      list.forEach((b) => known.current.add(b.id))
      if (fresh.length) {
        playSound('notify')
        void listNotifications(false, 20).then((all) => setFull((f) => ({ ...f, ...Object.fromEntries(all.map((n) => [n.id, n])) })), () => {})
      }
      setBanners(list)
    }
    void invoke<BannerData[]>('notify_banners').then(apply, () => {})
    const un = listen<BannerData[]>('notify://banners', (e) => apply(e.payload))
    return () => void un.then((fn) => fn())
  }, [])

  const dismiss = useCallback((id: string) => void invoke('notify_dismiss_banner', { id }).catch(() => {}), [])

  /** The Notification as the engine stored it, or one rebuilt from the banner while the stored copy loads. */
  const notificationOf = useCallback(
    (b: BannerData): Notification => full[b.id] ?? { id: b.id, kind: b.kind, title: b.title, body: b.body, sourceApp: b.sourceApp, createdAt: new Date().toISOString(), readAt: null, actionLabel: b.actionLabel, actionPayload: null },
    [full],
  )

  const open = useCallback(
    (b: BannerData) => {
      dismiss(b.id)
      void markNotificationRead(b.id).catch(() => {})
      const extra = windowsExtra(notificationOf(b))
      if (extra?.launch) void launchApp(extra.launch)
      else void emit('dock:open-notifications')
    },
    [dismiss, notificationOf],
  )

  const notes = useMemo<Note[]>(
    () =>
      banners.map((b) => {
        const n = notificationOf(b)
        const extra = windowsExtra(n)
        const note = toNote({ ...n, readAt: null })
        return {
          ...note,
          time: 'now',
          kind: b.urgency === 'critical' ? 'critical' : 'normal',
          // A Windows notification with the sender's picture shows it with the app's icon pinned to the corner.
          renderIcon: (size) =>
            extra?.image ? (
              <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
                <img src={extra.image} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />
                <span className="absolute -bottom-1 -right-1 rounded-[7px] shadow-[0_1px_3px_rgb(0_0_0/0.45)]"><NotificationIcon n={n} size={Math.round(size / 2)} /></span>
              </span>
            ) : (
              <NotificationIcon n={n} size={size} />
            ),
        }
      }),
    [banners, notificationOf],
  )

  // Fit the OS window to the stack, top-right under the menu bar.
  const fit = useCallback(async () => {
    const win = getCurrentWindow()
    const el = stackRef.current
    if (!el || !banners.length) return
    try {
      const [, work] = await shell.monitorOf()
      const scale = pxScale()
      const w = Math.round((CARD + PAD * 2) * scale)
      const h = Math.round((el.offsetHeight + PAD * 2) * scale)
      await win.setSize(new PhysicalSize(w, h))
      await win.setPosition(new PhysicalPosition(work.right - w - Math.round((EDGE - PAD) * scale), work.top + Math.round((MENU_BAR + TOP_GAP - PAD) * scale)))
      void shell.setMemoryLow(false)
      await win.show()
    } catch (err) {
      console.error('[toast] placement failed', err)
    }
  }, [banners.length])

  useEffect(() => {
    const win = getCurrentWindow()
    if (!banners.length) {
      const t = setTimeout(() => {
        void win.hide()
        void shell.setMemoryLow(true)
      }, 200)
      return () => clearTimeout(t)
    }
    const frame = requestAnimationFrame(() => void fit())
    return () => cancelAnimationFrame(frame)
  }, [banners, fit])

  // The deck fanning out (hover) or folding changes the height: follow it.
  useEffect(() => {
    const el = stackRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void fit(), 60)
    })
    ro.observe(el)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [fit])

  const menu = (e: React.MouseEvent, note: Note) => {
    const b = banners.find((x) => x.id === note.id)
    if (!b) return
    const app = note.app
    openMenu({ clientX: e.clientX, clientY: e.clientY }, [
      { label: 'Open', icon: 'external', onSelect: () => open(b) },
      { label: 'Dismiss', icon: 'x', onSelect: () => dismiss(b.id) },
      { label: banners.length > 1 ? `Dismiss all ${banners.length} banners` : 'Dismiss all', icon: 'trash', disabled: banners.length < 2, onSelect: () => banners.forEach((x) => dismiss(x.id)) },
      { label: undefined },
      { label: `Mute ${app}`, icon: 'bell', onSelect: () => (mute(notificationSource(notificationOf(b))), banners.filter((x) => notificationSource(notificationOf(x)) === app).forEach((x) => dismiss(x.id))) },
      { label: 'Notification settings…', icon: 'sliders', onSelect: () => void openApp('settings', { section: 'notifications' }) },
    ])
  }

  return (
    <div style={{ padding: PAD, width: CARD + PAD * 2 }}>
      <div ref={stackRef} style={{ width: CARD }}>
        <BannerStack notes={notes} timer={false} onDismiss={dismiss} onOpen={(n) => { const b = banners.find((x) => x.id === n.id); if (b) open(b) }} onAction={(id) => { const b = banners.find((x) => x.id === id); if (b) open(b) }} onMenu={menu} />
      </div>
    </div>
  )
}
