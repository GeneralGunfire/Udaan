import { useEffect, useRef, useState } from 'react'
import { analyzeTrack, type TrackAnalysis } from '@/integrations/audio-library/client'
import type { AudioTrack } from '../lib/types'

export interface TrackAnalysisState {
  analysis: TrackAnalysis | null
  loading: boolean
  /** Present when analysis failed for this track — surfaced rather than
   * swallowed, since "no BPM shown" otherwise looks identical to "this
   * track has no detectable tempo", which is a different fact. */
  error: string | null
}

/**
 * Fetches cached musical analysis for whatever track a deck currently
 * holds, analysing it on first sight.
 *
 * Results are memoised per path for the session on top of the Rust-side
 * SQLite cache: loading the same track onto both decks, or cueing back to
 * a track played earlier, should not cross the IPC bridge again.
 *
 * Analysis is genuinely slow on first pass (a full decode plus two DSP
 * passes, on the order of a second), so `loading` is exposed for the UI
 * to show a pending state instead of an empty one — a BPM tag that
 * silently appears a second late reads as a glitch.
 */
export function useTrackAnalysis(track: AudioTrack | null): TrackAnalysisState {
  const [state, setState] = useState<TrackAnalysisState>({ analysis: null, loading: false, error: null })
  const cacheRef = useRef<Map<string, TrackAnalysis>>(new Map())

  useEffect(() => {
    const path = track?.path
    if (!path) {
      setState({ analysis: null, loading: false, error: null })
      return
    }

    const cached = cacheRef.current.get(path)
    if (cached) {
      setState({ analysis: cached, loading: false, error: null })
      return
    }

    // Guards against a slow analysis for a track the user has already
    // swapped away from landing on top of the current one's result.
    let cancelled = false
    setState({ analysis: null, loading: true, error: null })

    analyzeTrack(path)
      .then((result) => {
        cacheRef.current.set(path, result)
        if (!cancelled) setState({ analysis: result, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        console.error(`Analysis failed for ${path}:`, err)
        setState({ analysis: null, loading: false, error: message })
      })

    return () => {
      cancelled = true
    }
  }, [track?.path])

  return state
}

/**
 * Whether two Camelot keys mix harmonically.
 *
 * The Camelot wheel encodes the circle of fifths as 1-12 around a ring,
 * with an inner "A" ring (minor) and outer "B" ring (major). Two tracks
 * are considered compatible when they are the same position, one step
 * around the ring, or the same number on the opposite ring (relative
 * major/minor) — the three standard harmonic-mixing moves.
 */
export function keysAreCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const parsed = [a, b].map(parseCamelot)
  if (parsed.some((p) => p === null)) return false
  const [x, y] = parsed as [CamelotKey, CamelotKey]

  if (x.number === y.number && x.ring === y.ring) return true
  // Relative major/minor: same number, opposite ring.
  if (x.number === y.number) return true
  // Adjacent on the wheel, wrapping 12 back to 1.
  if (x.ring !== y.ring) return false
  const diff = Math.abs(x.number - y.number)
  return diff === 1 || diff === 11
}

interface CamelotKey {
  number: number
  ring: 'A' | 'B'
}

function parseCamelot(key: string): CamelotKey | null {
  const match = /^(\d{1,2})([AB])$/i.exec(key.trim())
  if (!match) return null
  const number = Number(match[1])
  if (number < 1 || number > 12) return null
  return { number, ring: match[2].toUpperCase() as 'A' | 'B' }
}

/** Percentage Deck B must shift to match Deck A's tempo, or null when
 * either tempo is unknown. Clamped to the ±15% the pitch fader allows —
 * beyond that a match is not reachable and reporting a number implies it
 * is. */
export function tempoMatchPercent(fromBpm: number | null, toBpm: number | null): number | null {
  if (!fromBpm || !toBpm || fromBpm <= 0 || toBpm <= 0) return null
  const percent = (toBpm / fromBpm - 1) * 100
  if (Math.abs(percent) > 15) return null
  return percent
}
