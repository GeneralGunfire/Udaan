import { useCallback, useEffect, useRef, useState } from 'react'
import { pxScale } from '@/os/kernel/uiScale'
import { AnimatePresence, motion } from 'framer-motion'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { listNotifications, markNotificationRead, onNotificationsChanged, type Notification } from '@/integrations/notifications/client'
import { getPref, usePref } from '@/os/kernel/prefs'
import { shell } from '@/os/kernel/shell'
import { NotificationIcon, notificationSource, windowsExtra } from '@/os/ui/NotificationIcon'
import { WindowCloseIcon } from '@/shared/icons'
import { curve, dur, springs } from '@/os/motion/systemMotion'
import { elevation } from '@/os/design/scale'
import { launchApp } from '@/integrations/installed-apps/client'
import { playSound } from '@/os/sound/sounds'

export { windowsExtra }

const WIDTH = 364
const MENU_BAR = 34
const GAP = 10
const EDGE = 16
const DEFAULT_VISIBLE_MS = 6000
const MAX = 3

/**
 * Toast banners for new notifications, bottom-right above the dock (like
 * Windows toasts). The window is sized to exactly the visible stack and
 * never takes focus, so it can't steal clicks or keystrokes.
 */
export function ToastWindow() {
  const [toasts, setToasts] = useState<Notification[]>([])
  const seen = useRef<Set<string> | null>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const visibleMs = useRef(DEFAULT_VISIBLE_MS)
  const [previews] = usePref('notifications.previews')

  const remove = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const schedule = useCallback(
    (id: string) => {
      clearTimeout(timers.current.get(id))
      timers.current.set(id, setTimeout(() => remove(id), visibleMs.current))
    },
    [remove],
  )

  // Remember what already exists at start-up: only notifications that
  // arrive while Udaan is running pop up.
  useEffect(() => {
    void listNotifications(false, 100).then((all) => (seen.current = new Set(all.map((n) => n.id))), () => (seen.current = new Set()))
    const un = onNotificationsChanged(async () => {
      if (!seen.current) return
      const latest = await listNotifications(true, 10).catch(() => [] as Notification[])
      let fresh = latest.filter((n) => !seen.current!.has(n.id))
      for (const n of latest) seen.current.add(n.id)
      // Apps the user silenced still reach Notification Center; they just don't pop up.
      let muted: string[] = []
      try {
        muted = JSON.parse(await getPref('notifications.muted')) as string[]
      } catch {
        /* a bad value means nothing is muted */
      }
      fresh = fresh.filter((n) => !muted.includes(notificationSource(n)))
      visibleMs.current = Math.max(2, (await getPref('notifications.duration')) || 6) * 1000
      if (!fresh.length || (await getPref('notifications.dnd'))) return
      setToasts((t) => [...fresh.reverse(), ...t].slice(0, MAX))
      playSound('notify')
      fresh.forEach((n) => schedule(n.id))
    })
    const timersMap = timers.current
    return () => {
      void un.then((fn) => fn())
      timersMap.forEach(clearTimeout)
    }
  }, [schedule])

  // Fit the OS window to the stack, anchored bottom-right of the work area.
  useEffect(() => {
    const win = getCurrentWindow()
    if (!toasts.length) {
      const t = setTimeout(() => {
        void win.hide()
        void shell.setMemoryLow(true)
      }, 220)
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
        // Top-right, just under the menu bar, like macOS banners.
        await win.setPosition(new PhysicalPosition(work.right - w - Math.round(EDGE * scale), work.top + Math.round((MENU_BAR + 8) * scale)))
        void shell.setMemoryLow(false)
        await win.show()
      } catch (err) {
        console.error('[toast] placement failed', err)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [toasts])

  return (
    <div ref={stackRef} className="flex flex-col gap-[10px] p-1" style={{ width: WIDTH + 8 }}>
      <AnimatePresence initial={false}>
        {toasts.map((n) => {
          const extra = windowsExtra(n)
          return (
            <motion.div
              key={n.id}
              layout
              initial={{ opacity: 0, y: -28, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: springs.flyout }}
              exit={{ opacity: 0, x: 48, transition: { duration: dur.fast, ease: curve.accelerate } }}
              onMouseEnter={() => clearTimeout(timers.current.get(n.id))}
              onMouseLeave={() => schedule(n.id)}
              onClick={() => {
                remove(n.id)
                void markNotificationRead(n.id)
                if (extra?.launch) void launchApp(extra.launch)
                else void emit('dock:open-notifications')
              }}
              className="group relative cursor-default overflow-hidden rounded-[20px] border border-[var(--os-acrylic-border)] text-[var(--os-menu-text)]"
              style={{ width: WIDTH, marginTop: GAP / 2, background: 'var(--os-acrylic)', boxShadow: `${elevation(4)}, var(--os-acrylic-edge)` }}
            >
              <div className="flex gap-3 px-4 py-3.5">
                {/* The sender's picture when there is one, with the app as a badge; otherwise just the app. */}
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
                <div className="min-w-0 flex-1 pr-5">
                  <div className="flex items-baseline gap-2">
                    <p className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5">{n.title}</p>
                    <span className="shrink-0 text-[11px] text-[var(--os-menu-text-dim)]">now</span>
                  </div>
                  <p className="truncate text-[11.5px] font-medium uppercase tracking-wide text-[var(--os-menu-text-dim)]">{notificationSource(n)}</p>
                  {n.body && previews && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] leading-[18px] text-[var(--os-menu-text)]/85">{n.body}</p>}
                </div>
              </div>
              <motion.div className="absolute bottom-0 left-0 h-[2px] bg-[var(--color-accent)]/70" initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: visibleMs.current / 1000, ease: 'linear' }} />
              <button
                type="button"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(n.id)
                }}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--os-menu-item-hover)] opacity-0 transition-opacity hover:bg-[var(--surface-hover)] group-hover:opacity-100"
              >
                <WindowCloseIcon width={11} height={11} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
