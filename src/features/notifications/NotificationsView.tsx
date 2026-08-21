import { useEffect } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { BellIcon } from '@/shared/icons'
import { useNotifications } from './hooks/useNotifications'

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
 * Real notifications generated from Claude Code task completions — no
 * sample/fabricated entries. Opening this view marks everything read,
 * clearing the sidebar badge.
 */
export function NotificationsView() {
  const { notifications, markAllRead } = useNotifications()

  useEffect(() => {
    markAllRead()
  }, [])

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center gap-2">
        <BellIcon width={16} height={16} className="text-brand-teal" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">
          Notifications
        </h1>
      </div>

      {notifications.length === 0 ? (
        <GlassPanel>
          <p className="text-text-secondary text-[12.5px]">
            No notifications yet. You'll see one here whenever a Claude Code task finishes —
            successfully or not.
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => (
            <GlassPanel key={n.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-text-primary truncate text-[12.5px] font-medium">
                  {n.prompt}
                </p>
                <p className="text-text-tertiary mt-0.5 text-[11px]">
                  {formatTimestamp(n.createdAt)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  n.status === 'done'
                    ? 'bg-success/20 text-success'
                    : 'bg-red-400/20 text-red-400'
                }`}
              >
                {n.status === 'done' ? 'Done' : 'Failed'}
              </span>
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  )
}
