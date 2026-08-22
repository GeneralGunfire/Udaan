export const MODES = [
  { id: 'local', label: 'Local' },
  { id: 'claude', label: 'Claude' },
] as const

export type ModeId = (typeof MODES)[number]['id']
