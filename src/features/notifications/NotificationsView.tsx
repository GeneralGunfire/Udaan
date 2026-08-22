import { GlassPanel } from '@/shared/components/GlassPanel'
import { BellIcon, TrashIcon } from '@/shared/icons'
import { useNotifications } from './hooks/useNotifications'
import { Button } from '@/shared/components/ui/button'

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Real notification center. Sources today: Claude Code task completions/failures, and any
 * feature that calls `pushNotification()` (e.g. Automations) — both land in the same log via
 * `src/features/notifications/lib/notificationStore.ts`, so future features push into this
 * one system instead of building their own. Unread state is per-item now rather than
 * "opening the view marks everything read", so mark-as-read is a real user action.
 */
export function NotificationsView() {
  const { notifications, markAllRead, markRead, clearAll } = useNotifications()
  const hasUnread = notifications.some((n) => !n.read)

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BellIcon width={16} height={16} className="text-brand-teal" />
          <h1 className="font-display text-text-primary text-[16px] font-semibold">
            Notifications
          </h1>
        </div>
        {notifications.length > 0 && (
          <div className="flex items-center gap-3">
            {hasUnread && (
              <Button
                type="button"
                onClick={markAllRead}
                variant="ghost"
                size="pill-sm"
                className="rounded-full"
              >
                Mark all read
              </Button>
            )}
            <Button
              type="button"
              onClick={clearAll}
              variant="ghost"
              size="pill-sm"
              className="rounded-full hover:text-red-400"
            >
              <TrashIcon width={12} height={12} />
              Clear all
            </Button>
          </div>
        )}
      </div>

      {notifications.length === 0 ? (
        <GlassPanel>
          <p className="text-text-secondary text-[12.5px]">
            No notifications yet. You'll see one here whenever a Claude Code task finishes, or
            when another feature (like Automations) pushes one in.
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => (
            <GlassPanel
              key={n.id}
              className={`flex items-start justify-between gap-3 ${!n.read ? 'border border-brand-teal/30' : ''}`}
            >
              <button
                type="button"
                onClick={() => markRead(n.id)}
                disabled={n.read}
                className="focus-visible:ring-brand-cyan/60 min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 disabled:cursor-default"
              >
                <div className="flex items-center gap-1.5">
                  {!n.read && <span className="bg-brand-teal h-1.5 w-1.5 shrink-0 rounded-full" />}
                  <p className="text-text-primary truncate text-[12.5px] font-medium">
                    {n.prompt}
                  </p>
                </div>
                <p className="text-text-tertiary mt-0.5 text-[11px]">
                  {formatTimestamp(n.createdAt)}
                </p>
              </button>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  n.status === 'done'
                    ? 'bg-success/20 text-success'
                    : n.status === 'failed'
                      ? 'bg-red-400/20 text-red-400'
                      : 'bg-brand-teal/20 text-brand-teal'
                }`}
              >
                {n.status === 'done' ? 'Done' : n.status === 'failed' ? 'Failed' : n.source || 'Info'}
              </span>
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  )
}
