/**
 * Placeholder data source for counts/descriptors shown in the sidebar.
 * Not real data — swap this module for a real store/query once the
 * corresponding features exist.
 *
 * `notifications` used to live here as a hardcoded '8' — it's now a real
 * derived count from `useUnreadNotificationCount()` (see
 * src/features/notifications), so it's been removed from this module.
 */
export const PLACEHOLDER_BADGES = {
  taskQueue: '2',
} as const

export const PLACEHOLDER_DESCRIPTORS: Record<string, string> = {
  school: '3 active',
  work: '2 due today',
  creativity: '1 draft',
}
