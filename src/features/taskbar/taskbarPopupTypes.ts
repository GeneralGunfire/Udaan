/**
 * Shared event-payload contract between TaskbarEntry.tsx (emits) and
 * TaskbarPopupWindow.tsx (listens) — the two live in separate Tauri
 * windows and only talk to each other via these events, so this is the
 * one place their data shape must agree.
 */
import type { OpenWindow } from '@/integrations/taskbar/client'

export interface ShowHoverPreviewPayload {
  kind: 'hover-preview'
  x: number
  y: number
  processName: string
  isGroup: boolean
  windows: OpenWindow[]
  foreground: number
}

/**
 * Anchor-only payload for the notifications tray panel — unlike the
 * window-list payload above, it carries no live data of its own. The
 * popup window fetches/subscribes to that itself once shown, rather than
 * snapshotting it into the event, since a snapshot would go stale the
 * moment something changes while the panel is still open (e.g. a new
 * notification arrives).
 */
export interface ShowNotificationsPanelPayload {
  kind: 'notifications-panel'
  x: number
  y: number
}

/**
 * Anchor-only payload for the quick-settings flyout. Same reasoning as
 * the notifications panel above: the popup window polls battery, Wi-Fi
 * and system stats itself while open, so snapshotting them into the
 * event would only guarantee stale numbers.
 */
export interface ShowQuickSettingsPayload {
  kind: 'quick-settings'
  x: number
  y: number
}

export type ShowTaskbarPopupPayload =
  | ShowHoverPreviewPayload
  | ShowNotificationsPanelPayload
  | ShowQuickSettingsPayload
