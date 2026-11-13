import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BellIcon, WindowCloseIcon } from '@/shared/icons'
import { listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification, onNotificationsChanged, type Notification } from '@/integrations/notifications/client'
import { launchApp } from '@/integrations/installed-apps/client'
import { usePref } from '@/os/kernel/prefs'
import { isAppId } from '@/os/kernel/registry'
import { openApp } from '@/os/kernel/shell'
import { NotificationIcon, notificationSource, windowsExtra } from '@/os/ui/NotificationIcon'

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

/** Notification Centre: grouped by app, newest first, click to open, × to clear. */
export function NotificationsPanel() {
  const [items, setItems] = useState<Notification[] | null>(null)
  const [dnd, setDnd] = usePref('notifications.dnd')

  const reload = useCallback(() => void listNotifications(false, 60).then(setItems, () => setItems([])), [])
  useEffect(() => {
    reload()
    const un = onNotificationsChanged(reload)
    // Opening the centre counts as seeing everything in it.
    const t = setTimeout(() => void markAllNotificationsRead().catch(() => {}), 1200)
    return () => {
      clearTimeout(t)
      void un.then((fn) => fn())
    }
  }, [reload])

  const groups = useMemo(() => {
    const map = new Map<string, Notification[]>()
    for (const n of items ?? []) map.set(n.sourceApp, [...(map.get(n.sourceApp) ?? []), n])
    return [...map.entries()]
  }, [items])

  const open = (n: Notification) => {
    void markNotificationRead(n.id)
    const extra = windowsExtra(n)
    if (extra?.launch) {
      void launchApp(extra.launch)
      return
    }
    // A notification from one of Udaan's own apps opens that app —
    // previously only Windows app launches were handled, so clicking e.g.
    // a Scholar study reminder marked it read and did nothing else, which
    // reads as a dead control.
    if (isAppId(n.sourceApp)) void openApp(n.sourceApp)
  }
  const clearAll = () => void Promise.all((items ?? []).map((n) => dismissNotification(n.id))).then(reload)

  return (
    <div className="flex max-h-[600px] flex-col text-[var(--os-menu-text)]">
      <header className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <h2 className="flex-1 text-[15px] font-semibold">Notifications</h2>
        <button
          type="button"
          onClick={() => void setDnd(!dnd)}
          className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${dnd ? 'bg-[#bf5af2] text-white' : 'bg-[var(--os-menu-item-hover)] text-[var(--os-menu-text-dim)] hover:bg-[var(--surface-hover)]'}`}
        >
          {dnd ? 'Do not disturb: on' : 'Do not disturb'}
        </button>
        {!!items?.length && (
          <button type="button" onClick={clearAll} className="rounded-full bg-[var(--os-menu-item-hover)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--os-menu-text-dim)] hover:bg-[var(--surface-hover)]">
            Clear all
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {items === null ? null : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--os-menu-item-hover)] text-[var(--os-menu-text-dim)]">
              <BellIcon width={20} height={20} />
            </span>
            <p className="text-[13.5px] text-[var(--os-menu-text-dim)]">You're all caught up</p>
          </div>
        ) : (
          groups.map(([source, list]) => (
            <section key={source} className="mt-2">
              <p className="flex items-center gap-2 px-1 pb-1.5 text-[12px] font-semibold text-[var(--os-menu-text-dim)]">
                <NotificationIcon n={list[0]} size={20} />
                {notificationSource(list[0])}
              </p>
              <AnimatePresence initial={false}>
                {list.map((n) => {
                  const extra = windowsExtra(n)
                  return (
                    <motion.div
                      key={n.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
                      onClick={() => open(n)}
                      className={`group relative mb-1.5 flex cursor-default gap-3 rounded-[12px] border border-[var(--border-hairline)] p-3 transition-colors hover:bg-[var(--os-menu-item-hover)] ${n.readAt ? 'bg-transparent' : 'bg-[var(--os-menu-item-hover)]'}`}
                    >
                      {extra?.image && <img src={extra.image} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 pr-5">
                          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{n.title}</p>
                          <span className="shrink-0 text-[11px] tabular-nums text-[var(--os-menu-text-dim)]">{ago(n.createdAt)}</span>
                        </div>
                        {n.body && <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-[12.5px] leading-snug text-[var(--os-menu-text-dim)]">{n.body}</p>}
                      </div>
                      <button
                        type="button"
                        aria-label="Clear"
                        onClick={(e) => {
                          e.stopPropagation()
                          void dismissNotification(n.id).then(reload)
                        }}
                        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--os-menu-item-hover)] opacity-0 transition-opacity hover:bg-[var(--surface-hover)] group-hover:opacity-100"
                      >
                        <WindowCloseIcon width={9} height={9} />
                      </button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
