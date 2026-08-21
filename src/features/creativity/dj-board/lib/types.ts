import type { AudioTrack } from '@/integrations/audio-library'

export type DeckId = 'A' | 'B'

export interface CuePoint {
  id: string
  label: string
  seconds: number
}

export interface DeckState {
  track: AudioTrack | null
  isPlaying: boolean
  isLoading: boolean
  currentTime: number
  duration: number
  /** Estimated BPM — TODO: real beat-detection (onset analysis) is future work; user can tap-set for now. */
  bpm: number | null
  tempoPercent: number
  cuePoints: CuePoint[]
  volume: number
  eq: { low: number; mid: number; high: number }
  bass: number
}

export function defaultDeckState(): DeckState {
  return {
    track: null,
    isPlaying: false,
    isLoading: false,
    currentTime: 0,
    duration: 0,
    bpm: null,
    tempoPercent: 0,
    cuePoints: [],
    volume: 0.85,
    eq: { low: 0, mid: 0, high: 0 },
    bass: 0,
  }
}
