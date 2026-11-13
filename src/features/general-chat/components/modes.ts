export const MODES = [{ id: 'omniroute', label: 'OmniRoute' }] as const

export type ModeId = (typeof MODES)[number]['id']
