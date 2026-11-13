import { useCallback, useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { createDeckChain, DECK_DEFAULTS, type EffectChain, type ParamValues } from '../lib/dsp'
import { ensureMasterBus } from '../lib/audioGraph'
import type { AudioTrack } from '../lib/types'

export interface DeckBEngine {
  track: AudioTrack | null
  isPlaying: boolean
  currentTime: number
  duration: number
  isLoading: boolean
  analyser: AnalyserNode | null
  djEffects: ParamValues
  setDjEffects: (patch: Partial<ParamValues>) => void
  resetDjEffects: () => void
  /** Deck B's own output level, 0-1 — separate from Deck A's. The
   * crossfader UI (owned by DjEffectsPanel, not this hook) drives BOTH
   * this and Deck A's output multiplier together so a single slider blends
   * the two. Each deck still has its own independent gain node, so neither
   * can perturb the other's signal; both now feed the same master bus. */
  gain: number
  setGain: (v: number) => void
  loadTrack: (track: AudioTrack) => void
  togglePlay: () => void
  seek: (fractionalPercent: number) => void
  unload: () => void
}

/**
 * A second playback engine for the DJ board's Deck B, with its own
 * `<audio>` element, its own DJ effects chain, and its own gain node —
 * deliberately NOT sharing `usePlayerEngine`'s. Deck A is the app-wide
 * "now playing" concept every other surface (mini player, taskbar Now
 * Playing chip, queue) depends on; wiring a second track into that same
 * engine would mean either replacing what's "now playing" (breaking those
 * surfaces while DJ-mixing) or a much larger rearchitecture.
 *
 * What Deck B DOES share with Deck A is the AudioContext and the master
 * bus (lib/audioGraph.ts). It originally had its own `new AudioContext()`,
 * which sounded fine — both contexts reach the same output device — but
 * left the app with no node carrying the summed A+B signal, so a master
 * EQ/limiter had nowhere to attach, and with two independent clocks that
 * drift, so nothing sample-accurate across decks (beatmatching, phase
 * sync) was buildable. Sharing the context costs none of the isolation
 * that motivated the original split: the per-deck chains and gain nodes
 * still keep the two signals fully independent right up to the sum.
 *
 * Deck B is intentionally simpler than Deck A: no queue/shuffle/repeat/
 * favorites/hot-cues/persistence — it's a single loaded track for mixing
 * against Deck A, not a second instance of the whole player.
 */
export function useDeckB(): DeckBEngine {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  if (!audioRef.current && typeof window !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.crossOrigin = 'anonymous'
  }

  const [track, setTrack] = useState<AudioTrack | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [djEffects, setDjEffectsState] = useState<ParamValues>(DECK_DEFAULTS)
  const [gain, setGainState] = useState(1)
  /** Mirrors `gain` for ensureGraph: the crossfader can be moved before
   * Deck B has ever played, and the gain node is only created on first
   * play — without this the node would be born at 1.0 and audibly jump
   * the deck to full volume regardless of where the fader actually sits. */
  const gainRef = useRef(1)

  const audioContextRef = useRef<AudioContext | null>(null)
  const djChainRef = useRef<EffectChain | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const djEffectsRef = useRef<ParamValues>(DECK_DEFAULTS)
  djEffectsRef.current = djEffects
  gainRef.current = gain

  const ensureGraph = useCallback(() => {
    if (audioContextRef.current) return
    const a = audioRef.current
    if (!a) return
    try {
      // Joins the SHARED context/master bus rather than creating a second
      // AudioContext (see lib/audioGraph.ts for the full rationale). Deck
      // B keeps its own effects chain and its own gain node — the
      // isolation from Deck A that motivated the original split — and now
      // additionally shares a clock and a summing point with it.
      const bus = ensureMasterBus()
      if (!bus) return
      const ctx = bus.ctx
      const source = ctx.createMediaElementSource(a)
      const djChain = createDeckChain(ctx)
      djChain.apply(djEffectsRef.current, ctx.currentTime)
      const node = ctx.createAnalyser()
      node.fftSize = 256
      node.smoothingTimeConstant = 0.55
      const deckGain = ctx.createGain()
      deckGain.gain.value = gainRef.current
      source.connect(djChain.input)
      djChain.output.connect(node)
      node.connect(deckGain)
      deckGain.connect(bus.input)
      audioContextRef.current = ctx
      djChainRef.current = djChain
      gainNodeRef.current = deckGain
      setAnalyser(node)
    } catch (err) {
      console.error('Deck B: failed to set up audio graph:', err)
    }
  }, [])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTimeUpdate = () => setCurrentTime(a.currentTime)
    const onDurationChange = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)
    const onCanPlay = () => setIsLoading(false)
    a.addEventListener('timeupdate', onTimeUpdate)
    a.addEventListener('durationchange', onDurationChange)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', onEnded)
    a.addEventListener('canplay', onCanPlay)
    return () => {
      a.removeEventListener('timeupdate', onTimeUpdate)
      a.removeEventListener('durationchange', onDurationChange)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('canplay', onCanPlay)
    }
  }, [])

  // Tear down Deck B's contribution on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      // Deliberately does NOT close the AudioContext any more: it is now
      // the SHARED context that Deck A (the app-wide now-playing engine)
      // is also running on, so closing it here would kill all audio the
      // moment the DJ board unmounted. Disconnecting Deck B's gain node is
      // the correct scoped teardown — it removes Deck B from the master
      // bus sum while leaving the context and Deck A untouched.
      try {
        gainNodeRef.current?.disconnect()
      } catch {
        // Already disconnected — nothing to undo.
      }
    }
  }, [])

  const loadTrack = useCallback(
    (t: AudioTrack) => {
      const a = audioRef.current
      if (!a) return
      setTrack(t)
      setIsLoading(true)
      a.src = convertFileSrc(t.path)
      a.load()
      const tryPlay = () => {
        ensureGraph()
        if (audioContextRef.current?.state === 'suspended') void audioContextRef.current.resume()
        a.play().catch((err) => {
          if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
            console.error('Deck B playback failed:', err)
          }
        })
      }
      if (a.readyState >= 3) tryPlay()
      else a.addEventListener('canplay', tryPlay, { once: true })
    },
    [ensureGraph],
  )

  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a || !track) return
    if (a.paused) {
      ensureGraph()
      if (audioContextRef.current?.state === 'suspended') void audioContextRef.current.resume()
      a.play().catch((err) => {
        if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') console.error('Deck B playback failed:', err)
      })
    } else {
      a.pause()
    }
  }, [track, ensureGraph])

  const seek = useCallback((fractionalPercent: number) => {
    const a = audioRef.current
    if (!a || !Number.isFinite(a.duration)) return
    a.currentTime = (fractionalPercent / 100) * a.duration
  }, [])

  const unload = useCallback(() => {
    const a = audioRef.current
    if (a) {
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
    setTrack(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [])

  const setDjEffects = useCallback((patch: Partial<ParamValues>) => {
    setDjEffectsState((prev) => {
      // Spreading a Partial<ParamValues> widens every value to include
      // undefined, and an explicit `undefined` in the patch would blank a
      // knob rather than leave it alone. Drop those keys so `next` stays
      // a complete ParamValues and an absent key means "unchanged".
      const next: ParamValues = { ...prev }
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) next[key] = value
      }
      const chain = djChainRef.current
      const ctx = audioContextRef.current
      if (chain && ctx) chain.apply(next, ctx.currentTime)
      return next
    })
  }, [])

  const resetDjEffects = useCallback(() => {
    setDjEffectsState(DECK_DEFAULTS)
    const chain = djChainRef.current
    const ctx = audioContextRef.current
    if (chain && ctx) chain.apply(DECK_DEFAULTS, ctx.currentTime)
  }, [])

  const setGain = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v))
    setGainState(clamped)
    gainRef.current = clamped
    const node = gainNodeRef.current
    const ctx = audioContextRef.current
    if (node && ctx) node.gain.setTargetAtTime(clamped, ctx.currentTime, 0.02)
  }, [])

  return {
    track,
    isPlaying,
    currentTime,
    duration,
    isLoading,
    analyser,
    djEffects,
    setDjEffects,
    resetDjEffects,
    gain,
    setGain,
    loadTrack,
    togglePlay,
    seek,
    unload,
  }
}
