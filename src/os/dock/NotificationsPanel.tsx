import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellIcon } from '@/shared/icons'
import { listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification, onNotificationsChanged, type Notification } from '@/integrations/notifications/client'
import { launchApp } from '@/integrations/installed-apps/client'
import { usePref } from '@/os/kernel/prefs'
import { isAppId } from '@/os/kernel/registry'
import { openApp } from '@/os/kernel/shell'
import { NotificationIcon, notificationSource, windowsExtra } from '@/os/ui/NotificationIcon'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

/** Notification Centre: grouped by app, newest first. Click opens the sender, the cross clears it. */
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
    if (extra?.launch) void launchApp(extra.launch)
    else if (isAppId(n.sourceApp)) void openApp(n.sourceApp)
  }
  const clearAll = () => void Promise.all((items ?? []).map((n) => dismissNotification(n.id))).then(reload)

  return (
    <div className="flex h-full max-h-[600px] flex-col">
      <header className="flex items-center gap-2 px-4 pb-2 pt-4">
        <h2 className="flex-1 text-[16px] font-semibold">Notifications</h2>
        <Button size="sm" variant={dnd ? 'primary' : 'tinted'} aria-pressed={!!dnd} onClick={() => void setDnd(!dnd)}>
          {dnd ? 'Do not disturb: on' : 'Do not disturb'}
        </Button>
        {!!items?.length && (
          <Button size="sm" variant="tinted" onClick={clearAll}>
            Clear all
          </Button>
        )}
      </header>

      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {items === null ? null : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-(--u-wash-on) text-(--u-ink-2)">
              <BellIcon width={20} height={20} />
            </span>
            <p className="text-[13.5px] text-(--u-ink-3)">You're all caught up</p>
          </div>
        ) : (
          groups.map(([source, list]) => (
            <section key={source} className="mt-2">
              <p className="flex items-center gap-2 px-1 pb-1.5 text-[12px] font-semibold text-(--u-ink-2)">
                <NotificationIcon n={list[0]} size={20} />
                {notificationSource(list[0])}
              </p>
              {list.map((n) => {
                const extra = windowsExtra(n)
                return (
                  <div key={n.id} role="button" tabIndex={0} onClick={() => open(n)} onKeyDown={(e) => e.key === 'Enter' && open(n)} className={cn('u-surface--card group relative mb-1.5 flex gap-3 p-3 hover:brightness-110', n.readAt && 'opacity-80')}>
                    {extra?.image && <img src={extra.image} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />}
                    <div className="min-w-0 flex-1 pr-5">
                      <div className="flex items-baseline gap-2">
                        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{n.title}</p>
                        <span className="shrink-0 text-[11px] tabular-nums text-(--u-ink-3)">{ago(n.createdAt)}</span>
                      </div>
                      {n.body && <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-[12.5px] leading-snug text-(--u-ink-2)">{n.body}</p>}
                    </div>
                    <Button
                      icon
                      size="sm"
                      pill
                      aria-label="Clear"
                      onClick={(e) => {
                        e.stopPropagation()
                        void dismissNotification(n.id).then(reload)
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
            </section>
          ))
        )}
      </div>
    </div>
  )
}
