import type { AudioTrack } from '@/integrations/audio-library'
import type { DeckState } from './types'
import type { CrossfaderCurve } from './audioEngine'

/**
 * Auto-persisted session snapshot — restored on app restart so closing
 * and reopening the DJ Board doesn't lose which track was loaded or how
 * the decks were set up. Separate from named presets (presets.ts): this
 * is one implicit "last session" slot, always kept current, not
 * something the user names/manages.
 */
export interface DeckSessionSnapshot {
  track: AudioTrack | null
  volume: number
  eq: { low: number; mid: number; high: number }
  bass: number
  filter: number
  tempoPercent: number
}

export interface BoardSession {
  deckA: DeckSessionSnapshot
  deckB: DeckSessionSnapshot
  crossfade: number
  crossfaderCurve: CrossfaderCurve
  masterVolume: number
}

const SESSION_STORAGE_KEY = 'udaan.dj-board.session'

export function snapshotDeckSession(state: DeckState): DeckSessionSnapshot {
  return {
    track: state.track,
    volume: state.volume,
    eq: { ...state.eq },
    bass: state.bass,
    filter: state.filter,
    tempoPercent: state.tempoPercent,
  }
}

export function loadBoardSession(): BoardSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as BoardSession
  } catch {
    return null
  }
}

export function saveBoardSession(session: BoardSession) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}
