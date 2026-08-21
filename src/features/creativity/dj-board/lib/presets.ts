import type { DeckState } from './types'

/**
 * Serializable snapshot of one deck's *settings* (EQ/bass/filter/volume/
 * tempo) — deliberately excludes track/playback/cue state, since a
 * preset is "how I like my decks configured," not "resume exactly where
 * I left off." Session auto-restore (see boardSession.ts) is the
 * separate mechanism for "remember what I was doing."
 */
export interface DeckSettingsSnapshot {
  volume: number
  eq: { low: number; mid: number; high: number }
  bass: number
  filter: number
  tempoPercent: number
}

export interface BoardPreset {
  id: string
  name: string
  deckA: DeckSettingsSnapshot
  deckB: DeckSettingsSnapshot
  crossfade: number
  masterVolume: number
  createdAt: string
}

const PRESETS_STORAGE_KEY = 'udaan.dj-board.presets'

export function snapshotDeckSettings(state: DeckState): DeckSettingsSnapshot {
  return {
    volume: state.volume,
    eq: { ...state.eq },
    bass: state.bass,
    filter: state.filter,
    tempoPercent: state.tempoPercent,
  }
}

export function loadPresets(): BoardPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function savePresets(presets: BoardPreset[]) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets))
}

let presetIdCounter = 0
export function nextPresetId(): string {
  presetIdCounter += 1
  return `preset-${Date.now()}-${presetIdCounter}`
}
