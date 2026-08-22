import type { AudioTrack } from '@/integrations/audio-library'

export type DeckId = 'A' | 'B'

export interface CuePoint {
  id: string
  label: string
  seconds: number
}

/** One of 4 fixed hot-cue slots, triggerable via number keys 1-4. null = unset. */
export type HotCueSlot = number | null

export interface LoopState {
  active: boolean
  /** Loop length in beats — meaningful once a BPM is known; otherwise a flat 4s default. */
  beats: 4 | 8 | 16
  inSeconds: number | null
  outSeconds: number | null
}

export function defaultLoopState(): LoopState {
  return { active: false, beats: 4, inSeconds: null, outSeconds: null }
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
  /** 4 fixed hot-cue slots (keys 1-4), separate from the freeform cuePoints list. */
  hotCues: HotCueSlot[]
  loop: LoopState
  volume: number
  eq: { low: number; mid: number; high: number }
  bass: number
  /** -1 (full lowpass sweep) .. 0 (open) .. 1 (full highpass sweep). */
  filter: number
  /** Real click-to-toggle lowpass (phone-in-pocket effect) — distinct from the hold-to-apply rack Filter. */
  muffled: boolean
  /** Real click-to-toggle instant low-band mute, independent of the Bass knob's boost/cut value. */
  bassKilled: boolean
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
    hotCues: [null, null, null, null],
    loop: defaultLoopState(),
    volume: 0.85,
    eq: { low: 0, mid: 0, high: 0 },
    bass: 0,
    filter: 0,
    muffled: false,
    bassKilled: false,
  }
}
