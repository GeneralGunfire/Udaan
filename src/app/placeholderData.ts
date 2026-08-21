/**
 * Placeholder data source for counts/descriptors shown in the sidebar.
 * Not real data — swap this module for a real store/query once the
 * corresponding features exist.
 */
export const PLACEHOLDER_BADGES = {
  taskQueue: '2',
  notifications: '8',
} as const

export const PLACEHOLDER_DESCRIPTORS: Record<string, string> = {
  school: '3 active',
  work: '2 due today',
  creativity: '1 draft',
}
