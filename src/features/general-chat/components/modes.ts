export const MODES = [
  { id: 'local', label: 'Local' },
  { id: 'router', label: 'Router' },
  { id: 'claude', label: 'Claude' },
] as const

export type ModeId = (typeof MODES)[number]['id']
