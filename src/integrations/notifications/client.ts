import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface Notification {
  id: string
  kind: string
  title: string
  body: string
  sourceApp: string
  createdAt: string
  readAt: string | null
  actionLabel: string | null
  actionPayload: string | null
}

interface RawNotification {
  id: string
  kind: string
  title: string
  body: string
  source_app: string
  created_at: string
  read_at: string | null
  action_label: string | null
  action_payload: string | null
}

function fromRaw(raw: RawNotification): Notification {
  return {
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    body: raw.body,
    sourceApp: raw.source_app,
    createdAt: raw.created_at,
    readAt: raw.read_at,
    actionLabel: raw.action_label,
    actionPayload: raw.action_payload,
  }
}

export async function listNotifications(unreadOnly = false, limit = 100): Promise<Notification[]> {
  const raw = await invoke<RawNotification[]>('notifications_list', { unreadOnly, limit })
  return raw.map(fromRaw)
}

export async function getUnreadCount(): Promise<number> {
  return invoke<number>('notifications_unread_count')
}

export async function markNotificationRead(id: string): Promise<void> {
  await invoke('notifications_mark_read', { id })
}

export async function markAllNotificationsRead(): Promise<void> {
  await invoke('notifications_mark_all_read')
}

export async function dismissNotification(id: string): Promise<void> {
  await invoke('notifications_dismiss', { id })
}

/** For producers that only exist in TypeScript (e.g. Phase 8's TTS error
 *  path, which surfaces inside the JS playback engine, not Rust). Rust-
 *  side producers (e.g. daily_brief) call `push_notification`
 *  directly instead — this command exists so both sides can push through
 *  the same store. */
export async function pushNotification(input: {
  kind: string
  title: string
  body: string
  sourceApp: string
  actionLabel?: string
  actionPayload?: string
}): Promise<Notification> {
  const raw = await invoke<RawNotification>('notifications_push', {
    kind: input.kind,
    title: input.title,
    body: input.body,
    sourceApp: input.sourceApp,
    actionLabel: input.actionLabel ?? null,
    actionPayload: input.actionPayload ?? null,
  })
  return fromRaw(raw)
}

/** Fires whenever the store changes (push/mark-read/dismiss, from any
 *  window) — the taskbar panel subscribes to this instead of polling. */
export async function onNotificationsChanged(callback: () => void): Promise<() => void> {
  return listen('notifications:changed', () => callback())
}
