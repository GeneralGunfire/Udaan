import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { listNotifications, markNotificationRead, type Notification } from '@/integrations/notifications/client'
import { launchApp } from '@/integrations/installed-apps/client'
import { shell } from '@/os/kernel/shell'
import { pxScale } from '@/os/kernel/uiScale'
import { NotificationIcon, notificationSource, windowsExtra } from '@/os/ui/NotificationIcon'
import { playSound } from '@/os/sound/sounds'
import { Button } from '@/os/ui/controls'

export { windowsExtra }

/** One banner as the engine reports it (`notify://banners`). */
interface Banner {
  id: string
  kind: string
  title: string
  body: string
  sourceApp: string
  actionLabel: string | null
  urgency: string
}

const WIDTH = 364
const MENU_BAR = 34
const EDGE = 16

/**
 * Notification banners: a renderer, nothing more.
 *
 * The ENGINE decides everything: whether a notification shows at all (Do
 * Not Disturb, muted apps, repeats, bursts), how long it stays, and when it
 * leaves. This window shows the stack it is told about (`notify://banners`),
 * reports what the user did (click, dismiss), sizes itself to the stack,
 * and never takes focus.
 */
export function ToastWindow() {
  const [banners, setBanners] = useState<Banner[]>([])
  // The stored notification for each banner: carries the sender's picture and click target.
  const [full, setFull] = useState<Record<string, Notification>>({})
  const stackRef = useRef<HTMLDivElement>(null)
  const known = useRef(new Set<string>())

  useEffect(() => {
    const apply = (list: Banner[]) => {
      const fresh = list.filter((b) => !known.current.has(b.id))
      list.forEach((b) => known.current.add(b.id))
      if (fresh.length) {
        playSound('notify')
        void listNotifications(false, 20).then((all) => setFull((f) => ({ ...f, ...Object.fromEntries(all.map((n) => [n.id, n])) })), () => {})
      }
      setBanners(list)
    }
    void invoke<Banner[]>('notify_banners').then(apply, () => {})
    const un = listen<Banner[]>('notify://banners', (e) => apply(e.payload))
    return () => void un.then((fn) => fn())
  }, [])

  const dismiss = useCallback((id: string) => void invoke('notify_dismiss_banner', { id }).catch(() => {}), [])

  const open = (b: Banner) => {
    dismiss(b.id)
    void markNotificationRead(b.id).catch(() => {})
    const extra = full[b.id] ? windowsExtra(full[b.id]) : null
    if (extra?.launch) void launchApp(extra.launch)
    else void emit('dock:open-notifications')
  }

  // Fit the OS window to the stack, top-right under the menu bar.
  useEffect(() => {
    const win = getCurrentWindow()
    if (!banners.length) {
      const t = setTimeout(() => {
        void win.hide()
        void shell.setMemoryLow(true)
      }, 200)
      return () => clearTimeout(t)
    }
    const frame = requestAnimationFrame(async () => {
      const height = (stackRef.current?.scrollHeight ?? 100) + 8
      try {
        const [, work] = await shell.monitorOf()
        const scale = pxScale()
        const w = Math.round((WIDTH + 8) * scale)
        const h = Math.round(height * scale)
        await win.setSize(new PhysicalSize(w, h))
        await win.setPosition(new PhysicalPosition(work.right - w - Math.round(EDGE * scale), work.top + Math.round((MENU_BAR + 8) * scale)))
        void shell.setMemoryLow(false)
        await win.show()
      } catch (err) {
        console.error('[toast] placement failed', err)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [banners])

  return (
    <div ref={stackRef} className="flex flex-col gap-2.5 p-1" style={{ width: WIDTH + 8 }}>
      {banners.map((b) => {
        const n: Notification = full[b.id] ?? { id: b.id, kind: b.kind, title: b.title, body: b.body, sourceApp: b.sourceApp, createdAt: new Date().toISOString(), readAt: null, actionLabel: b.actionLabel, actionPayload: null }
        const extra = windowsExtra(n)
        return (
          <div key={b.id} role="alert" onClick={() => open(b)} className="u-surface u-banner group" style={{ width: WIDTH }}>
            <div className="flex gap-3 px-4 py-3.5">
              <div className="relative h-10 w-10 shrink-0">
                {extra?.image ? (
                  <>
                    <img src={extra.image} alt="" className="h-10 w-10 rounded-full object-cover" />
                    <span className="absolute -bottom-1 -right-1 rounded-[7px] shadow-[0_1px_3px_rgb(0_0_0/0.45)]">
                      <NotificationIcon n={n} size={20} />
                    </span>
                  </>
                ) : (
                  <NotificationIcon n={n} size={40} />
                )}
              </div>
              <div className="min-w-0 flex-1 pr-6">
                <p className="truncate text-[14px] font-semibold leading-5">{b.title}</p>
                <p className="u-label truncate">{notificationSource(n)}</p>
                {b.body && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] leading-[18px] text-(--u-ink-2)">{b.body}</p>}
              </div>
            </div>
            <Button
              icon
              size="sm"
              pill
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation()
                dismiss(b.id)
              }}
              className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </Button>
          </div>
        )
      })}
    </div>
  )
}
