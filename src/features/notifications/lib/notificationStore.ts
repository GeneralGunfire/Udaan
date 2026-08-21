/**
 * Module-level singleton notification log. Subscribes once (at module load,
 * lazily on first import) to Claude Code task events and appends a
 * notification whenever a task finishes (done or failed). Kept as a plain
 * singleton rather than React context/state so the unread badge in the
 * Sidebar stays live even when the Notifications view isn't mounted — this
 * is a personal single-user app, a small pub/sub module is enough, no need
 * for a heavier state library.
 */
import { getTask, onTaskEvent, type ClaudeCodeTaskEvent } from '@/integrations/claude-code'

export interface Notification {
  id: string
  /** Claude-Code-task notifications carry a taskId; automation-pushed ones may not. */
  taskId?: string
  /** Original field name kept for the Claude Code path; used as the notification body generally. */
  prompt: string
  status: 'done' | 'failed' | 'info'
  createdAt: string
  read: boolean
  /** Which automation rule produced this, if any — lets the Notifications view attribute it. */
  source?: string
}

type Listener = () => void

let notifications: Notification[] = []
const listeners = new Set<Listener>()
let started = false

function notify() {
  for (const l of listeners) l()
}

async function handleEvent(event: ClaudeCodeTaskEvent) {
  if (event.kind !== 'status') return
  if (event.status !== 'done' && event.status !== 'failed') return

  // Avoid duplicate notifications if the same status event somehow fires twice.
  if (notifications.some((n) => n.taskId === event.task_id && n.status === event.status)) return

  let prompt = '(unknown task)'
  try {
    const task = await getTask(event.task_id)
    if (task) prompt = task.prompt
  } catch {
    // best-effort — still record the notification even if the lookup fails
  }

  notifications = [
    {
      id: `${event.task_id}-${event.status}-${Date.now()}`,
      taskId: event.task_id,
      prompt,
      status: event.status,
      createdAt: new Date().toISOString(),
      read: false,
    },
    ...notifications,
  ]
  notify()
}

/** Starts the subscription exactly once, no matter how many callers ask. */
function ensureStarted() {
  if (started) return
  started = true
  onTaskEvent((event) => {
    void handleEvent(event)
  })
}

export function subscribe(listener: Listener): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getNotifications(): Notification[] {
  ensureStarted()
  return notifications
}

export function getUnreadCount(): number {
  ensureStarted()
  return notifications.filter((n) => !n.read).length
}

/** Marks every notification read — called when the Notifications view is opened. */
export function markAllRead() {
  if (notifications.every((n) => n.read)) return
  notifications = notifications.map((n) => ({ ...n, read: true }))
  notify()
}

/** Marks a single notification read, leaving the rest of the log untouched. */
export function markRead(id: string) {
  const target = notifications.find((n) => n.id === id)
  if (!target || target.read) return
  notifications = notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
  notify()
}

/** Removes every notification from the log. */
export function clearAll() {
  if (notifications.length === 0) return
  notifications = []
  notify()
}

/**
 * Generic push, for any source other than Claude Code task events — used
 * by Rule-Based Automations (src/features/automations) so triggered
 * actions ("create a notification") reuse this same log/badge instead of
 * a separate automation-only notification list.
 */
export function pushNotification(input: { message: string; source: string }) {
  ensureStarted()
  notifications = [
    {
      id: `${input.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: input.message,
      status: 'info',
      createdAt: new Date().toISOString(),
      read: false,
      source: input.source,
    },
    ...notifications,
  ]
  notify()
}
