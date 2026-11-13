import { useCallback, useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getSettings, saveSettings, listFavorites, setFavorite as setFavoriteApi } from '@/integrations/audio-library/client'
import { createDeckChain, DECK_DEFAULTS, type EffectChain, type ParamValues } from '../lib/dsp'
import { ensureMasterBus } from '../lib/audioGraph'
import type { AudioTrack } from '../lib/types'

/** Debounce for persisting playback position — matches Notes' autosave debounce style rather than writing to SQLite on every `timeupdate`. */
const POSITION_SAVE_DEBOUNCE_MS = 2000

export interface PlayerEngine {
  queue: AudioTrack[]
  currentIndex: number
  current: AudioTrack | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: boolean
  isLoading: boolean
  settingsLoaded: boolean
  favorites: Set<string>
  toggleFavorite: (trackPath: string) => void
  /** Live FFT analyser tapped off the shared audio element — null until the
   * first user-gesture play call creates the AudioContext (browsers refuse
   * to start one before a real interaction), and shared by every visualizer
   * consumer rather than each creating its own. */
  analyser: AnalyserNode | null
  /** Single-deck DJ effects rack — 3-band EQ, enhancer, muffle filter. See lib/djEffects.ts. */
  djEffects: ParamValues
  setDjEffects: (patch: Partial<ParamValues>) => void
  resetDjEffects: () => void
  loadDjEffects: (settings: ParamValues) => void
  /** Hot cues: up to 4 instant-jump timestamps on the CURRENTLY playing
   * track, keyed by slot 0-3 — session-only (not persisted), matching a
   * real DJ controller's momentary cue pads rather than a saved-per-track
   * library feature. Cleared automatically when the track changes. */
  hotCues: (number | null)[]
  setHotCue: (slot: number) => void
  jumpToHotCue: (slot: number) => void
  clearHotCue: (slot: number) => void
  seekToSeconds: (seconds: number) => void
  /** 0.85..1.15 (±15%), 1 = normal speed. Plain HTMLMediaElement.playbackRate
   * — genuinely user-intentional, not an ambient always-on effect, so it
   * doesn't carry the "quietly degrades default playback" risk the DJ
   * effects chain's earlier bugs did. */
  playbackRate: number
  setPlaybackRate: (rate: number) => void
  /** Vinyl "brake" — ramps playback speed down to a stop over ~900ms (like
   * lifting the needle on a physical turntable), then ramps back up to the
   * user's chosen playbackRate on release. Purely transient/user-triggered,
   * never an always-on chain component. */
  brakeActive: boolean
  triggerBrake: () => void
  releaseBrake: () => void
  setQueue: (tracks: AudioTrack[], startIndex?: number, opts?: { autoplay?: boolean; startAtSeconds?: number }) => void
  /** Updates the queue array/current-index without touching the audio
   * element — for reorder/remove operations that shouldn't interrupt
   * whatever is already playing. */
  updateQueueOrder: (tracks: AudioTrack[], currentTrackPath: string | null) => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  seek: (fractionalPercent: number) => void
  setVolume: (v: number) => void
  /** Multiplies the audio element's ACTUAL output volume by `factor`
   * without touching the user's stored `volume` preference or persisting
   * anything — purely transient, for the DJ board's crossfader to pull
   * Deck A down/up as the fader moves without silently overwriting
   * whatever volume the user had set before opening the DJ board. Pass
   * `1` to fully restore the real volume (done automatically whenever the
   * crossfader returns to dead-center or the DJ board closes). */
  setOutputMultiplier: (factor: number) => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  playAt: (index: number) => void
}

/**
 * Direct port of Private Player's playback engine (single HTMLAudioElement,
 * modulo-wrapped queue, random-pick shuffle, single-track repeat) onto
 * Udaan's Tauri asset protocol instead of Next.js static file serving, plus
 * SQLite persistence of volume/shuffle/repeat/last-track (the original had
 * none of that — no localStorage anywhere).
 */
export function usePlayerEngine(): PlayerEngine {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  if (!audioRef.current && typeof window !== 'undefined') {
    audioRef.current = new Audio()
    // Required for createMediaElementSource() (used by the analyser/DJ
    // effects graph below) to actually produce audible output. Confirmed
    // safe: Tauri's asset:// protocol sends a matching
    // Access-Control-Allow-Origin header (tauri/src/protocol/asset.rs),
    // so this doesn't risk a load failure — without it, routing an
    // asset://-sourced element through Web Audio taints the graph as
    // cross-origin and the browser silently mutes it entirely
    // (isPlaying/duration/timeupdate all still behave normally, there's
    // just zero sound), which is exactly what "no audio" looked like once
    // the effects chain was wired in. The original app set this for the
    // same CORS reason.
    audioRef.current.crossOrigin = 'anonymous'
  }

  const [queue, setQueueState] = useState<AudioTrack[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(0.8)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [djEffects, setDjEffectsState] = useState<ParamValues>(DECK_DEFAULTS)
  const [hotCues, setHotCues] = useState<(number | null)[]>([null, null, null, null])
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [brakeActive, setBrakeActive] = useState(false)
  const brakeRafRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const djChainRef = useRef<EffectChain | null>(null)
  /** Deck A's own gain node, between its effects chain and the shared
   * master bus. The crossfader drives this rather than the <audio>
   * element's `.volume`, so it can pull the deck down without touching
   * (or persisting over) the user's stored volume preference. */
  const deckGainRef = useRef<GainNode | null>(null)
  const djEffectsRef = useRef<ParamValues>(DECK_DEFAULTS)
  djEffectsRef.current = djEffects

  const queueRef = useRef<AudioTrack[]>([])
  queueRef.current = queue
  const currentIndexRef = useRef(-1)
  currentIndexRef.current = currentIndex
  const repeatRef = useRef(false)
  repeatRef.current = repeat
  const shuffleRef = useRef(false)
  shuffleRef.current = shuffle
  const positionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSeekSecondsRef = useRef<number | null>(null)

  const persistSettings = useCallback(
    (patch: Partial<{ lastTrackPath: string | null; lastPositionSeconds: number; volume: number; shuffle: boolean; repeat: boolean }>) => {
      getSettings()
        .then((current) => saveSettings({ ...current, ...patch }))
        .catch((err) => console.error('Failed to save player settings:', err))
    },
    [],
  )

  // Web Audio setup is deferred to the first real play — browsers refuse to
  // start an AudioContext before a user gesture, and `createMediaElementSource`
  // can only ever be called ONCE per <audio> element for its whole lifetime
  // (a second call throws), so this must run exactly once for the shared
  // element's entire lifetime, not per track.
  const ensureAnalyser = useCallback(() => {
    if (audioContextRef.current) return
    const a = audioRef.current
    if (!a) return
    try {
      // Both decks now share ONE AudioContext and sum into one master bus
      // (see lib/audioGraph.ts). Deck A no longer owns a context of its
      // own, and no longer connects to ctx.destination directly — it
      // connects to the master bus input, which is what makes a real
      // master EQ/limiter across A+B possible at all.
      const bus = ensureMasterBus()
      if (!bus) return
      const ctx = bus.ctx
      const source = ctx.createMediaElementSource(a)
      const djChain = createDeckChain(ctx)
      djChain.apply(djEffectsRef.current, ctx.currentTime)
      const node = ctx.createAnalyser()
      node.fftSize = 256
      // Lowered from 0.75 — the analyser's own built-in smoothing was
      // compounding with EdgeGlow's per-frame smoothing to make the
      // visualizer feel sluggish/damped rather than responsive to the
      // actual music.
      node.smoothingTimeConstant = 0.55
      // source → DJ effects chain (EQ/enhancer/muffle) → analyser → deck
      // gain → master bus. EQ ahead of the analyser means the visualizer
      // reacts to the POST-effects signal — what's actually audible —
      // not the raw file. This analyser stays Deck-A-only (EdgeGlow and
      // the now-playing visualizers want THIS deck, not the mix); the
      // master bus carries its own separate analyser for a mix meter.
      const deckGain = ctx.createGain()
      deckGain.gain.value = 1
      source.connect(djChain.input)
      djChain.output.connect(node)
      node.connect(deckGain)
      deckGain.connect(bus.input)
      audioContextRef.current = ctx
      djChainRef.current = djChain
      deckGainRef.current = deckGain
      setAnalyser(node)
    } catch (err) {
      console.error('Failed to set up audio analyser:', err)
    }
  }, [])

  const loadAndPlay = useCallback((track: AudioTrack, opts?: { startAtSeconds?: number; autoplay?: boolean }) => {
    const a = audioRef.current
    if (!a) return
    const autoplay = opts?.autoplay ?? true
    setIsLoading(autoplay)
    a.src = convertFileSrc(track.path)
    if (opts?.startAtSeconds) pendingSeekSecondsRef.current = opts.startAtSeconds
    a.load()
    if (!autoplay) return
    const tryPlay = () => {
      ensureAnalyser()
      if (audioContextRef.current?.state === 'suspended') void audioContextRef.current.resume()
      a.play().catch((err) => {
        if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
          console.error('Playback failed:', err)
        }
      })
    }
    if (a.readyState >= 3) {
      tryPlay()
    } else {
      a.addEventListener('canplay', tryPlay, { once: true })
    }
  }, [])

  const playAt = useCallback(
    (index: number) => {
      const q = queueRef.current
      if (index < 0 || index >= q.length) return
      setCurrentIndex(index)
      setHotCues([null, null, null, null])
      loadAndPlay(q[index])
      persistSettings({ lastTrackPath: q[index].path, lastPositionSeconds: 0 })
    },
    [loadAndPlay, persistSettings],
  )

  const setQueue = useCallback(
    (tracks: AudioTrack[], startIndex = 0, opts?: { autoplay?: boolean; startAtSeconds?: number }) => {
      setQueueState(tracks)
      queueRef.current = tracks
      if (tracks.length === 0) return
      setCurrentIndex(startIndex)
      setHotCues([null, null, null, null])
      loadAndPlay(tracks[startIndex], opts)
      if (opts?.autoplay === false) return
      persistSettings({ lastTrackPath: tracks[startIndex].path, lastPositionSeconds: 0 })
    },
    [loadAndPlay, persistSettings],
  )

  const updateQueueOrder = useCallback((tracks: AudioTrack[], currentTrackPath: string | null) => {
    setQueueState(tracks)
    queueRef.current = tracks
    const newIndex = currentTrackPath ? tracks.findIndex((t) => t.path === currentTrackPath) : -1
    setCurrentIndex(newIndex)
  }, [])

  const advanceQueue = useCallback(
    (dir: 1 | -1) => {
      const q = queueRef.current
      if (q.length === 0) return
      let nextIndex: number
      if (dir === 1 && shuffleRef.current) {
        nextIndex = Math.floor(Math.random() * q.length)
      } else {
        nextIndex = (currentIndexRef.current + dir + q.length) % q.length
      }
      playAt(nextIndex)
    },
    [playAt],
  )

  const next = useCallback(() => advanceQueue(1), [advanceQueue])

  const prev = useCallback(() => {
    const a = audioRef.current
    if (a && a.currentTime > 3) {
      a.currentTime = 0
      return
    }
    advanceQueue(-1)
  }, [advanceQueue])

  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a || !a.src) return
    if (a.paused) {
      ensureAnalyser()
      if (audioContextRef.current?.state === 'suspended') void audioContextRef.current.resume()
      a.play().catch((err) => console.error('Playback failed:', err))
    } else {
      a.pause()
    }
  }, [ensureAnalyser])

  const seek = useCallback((percent: number) => {
    const a = audioRef.current
    if (!a || !Number.isFinite(a.duration)) return
    a.currentTime = (percent / 100) * a.duration
  }, [])

  const seekToSeconds = useCallback((seconds: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = seconds
  }, [])

  const setHotCue = useCallback((slot: number) => {
    const a = audioRef.current
    if (!a) return
    setHotCues((prev) => {
      const next = [...prev]
      next[slot] = a.currentTime
      return next
    })
  }, [])

  const jumpToHotCue = useCallback(
    (slot: number) => {
      const cue = hotCues[slot]
      if (cue === null || cue === undefined) return
      seekToSeconds(cue)
    },
    [hotCues, seekToSeconds],
  )

  const clearHotCue = useCallback((slot: number) => {
    setHotCues((prev) => {
      const next = [...prev]
      next[slot] = null
      return next
    })
  }, [])

  const setPlaybackRate = useCallback((rate: number) => {
    const clamped = Math.min(1.15, Math.max(0.85, rate))
    const a = audioRef.current
    // Never touch a.playbackRate while the brake is mid-ramp — the brake
    // owns the rate during that window and restores it to the LATEST
    // requested rate (via this same state) when released.
    if (a && !brakeActive) a.playbackRate = clamped
    setPlaybackRateState(clamped)
  }, [brakeActive])

  const triggerBrake = useCallback(() => {
    const el = audioRef.current
    if (!el || el.paused) return
    // Bound to a separate const so the nested `step` closure below keeps
    // the non-null narrowing — TypeScript discards narrowing on a captured
    // binding inside a function declaration, even one that can only run
    // after the guard above.
    const a: HTMLAudioElement = el
    if (brakeRafRef.current !== null) cancelAnimationFrame(brakeRafRef.current)
    setBrakeActive(true)
    const startRate = a.playbackRate
    const startTime = performance.now()
    const BRAKE_DURATION_MS = 900
    function step(now: number) {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / BRAKE_DURATION_MS)
      // Ease-out — a real turntable slows fastest right after power is
      // cut, then trails off, not a linear ramp to zero.
      const eased = 1 - Math.pow(1 - t, 2)
      a.playbackRate = Math.max(0.01, startRate * (1 - eased))
      if (t < 1) {
        brakeRafRef.current = requestAnimationFrame(step)
      } else {
        a.playbackRate = 0.01
        brakeRafRef.current = null
      }
    }
    brakeRafRef.current = requestAnimationFrame(step)
  }, [])

  const releaseBrake = useCallback(() => {
    const el = audioRef.current
    if (brakeRafRef.current !== null) {
      cancelAnimationFrame(brakeRafRef.current)
      brakeRafRef.current = null
    }
    if (!el) {
      setBrakeActive(false)
      return
    }
    // Same narrowing-through-closure reason as triggerBrake above.
    const a: HTMLAudioElement = el
    const startRate = a.playbackRate
    const targetRate = playbackRate
    const startTime = performance.now()
    const SPINUP_DURATION_MS = 500
    function step(now: number) {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / SPINUP_DURATION_MS)
      a.playbackRate = startRate + (targetRate - startRate) * t
      if (t < 1) {
        brakeRafRef.current = requestAnimationFrame(step)
      } else {
        a.playbackRate = targetRate
        brakeRafRef.current = null
        setBrakeActive(false)
      }
    }
    brakeRafRef.current = requestAnimationFrame(step)
  }, [playbackRate])

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.min(1, Math.max(0, v))
      const a = audioRef.current
      if (a) a.volume = clamped
      setVolumeState(clamped)
      persistSettings({ volume: clamped })
    },
    [persistSettings],
  )

  const setOutputMultiplier = useCallback((factor: number) => {
    const clamped = Math.min(1, Math.max(0, factor))
    // Now that Deck A has a real gain node feeding the shared master bus,
    // the crossfader rides THAT instead of the <audio> element's `.volume`.
    // Two concrete wins over the old approach: the fade is a smoothly
    // ramped AudioParam (no zipper noise on a fast crossfade), and the
    // user's stored `volume` preference is never even read here, so a
    // crossfade can't interact with volume persistence at all. Falls back
    // to the element while the graph doesn't exist yet (before the first
    // user-gesture play).
    const node = deckGainRef.current
    const ctx = audioContextRef.current
    if (node && ctx) {
      node.gain.setTargetAtTime(clamped, ctx.currentTime, 0.02)
      return
    }
    const a = audioRef.current
    if (a) a.volume = Math.min(1, Math.max(0, volume * clamped))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume])

  const toggleShuffle = useCallback(() => {
    setShuffle((prevVal) => {
      const next = !prevVal
      persistSettings({ shuffle: next })
      return next
    })
  }, [persistSettings])

  const toggleRepeat = useCallback(() => {
    setRepeat((prevVal) => {
      const next = !prevVal
      persistSettings({ repeat: next })
      return next
    })
  }, [persistSettings])

  // Wire audio element events once.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return

    let lastUpdate = 0
    const onTimeUpdate = () => {
      const now = performance.now()
      if (now - lastUpdate < 100) return
      lastUpdate = now
      setCurrentTime(a.currentTime)

      if (positionSaveTimerRef.current) clearTimeout(positionSaveTimerRef.current)
      positionSaveTimerRef.current = setTimeout(() => {
        persistSettings({ lastPositionSeconds: a.currentTime })
      }, POSITION_SAVE_DEBOUNCE_MS)
    }
    const onLoadedMetadata = () => {
      setDuration(a.duration || 0)
      if (pendingSeekSecondsRef.current !== null) {
        a.currentTime = pendingSeekSecondsRef.current
        pendingSeekSecondsRef.current = null
      }
    }
    const onPlaying = () => {
      setIsPlaying(true)
      setIsLoading(false)
    }
    const onPause = () => setIsPlaying(false)
    const onWaiting = () => setIsLoading(true)
    const onEnded = () => {
      if (repeatRef.current) {
        a.currentTime = 0
        a.play().catch(() => {})
      } else {
        advanceQueue(1)
      }
    }
    const onError = () => setIsLoading(false)

    a.addEventListener('timeupdate', onTimeUpdate)
    a.addEventListener('loadedmetadata', onLoadedMetadata)
    a.addEventListener('playing', onPlaying)
    a.addEventListener('pause', onPause)
    a.addEventListener('waiting', onWaiting)
    a.addEventListener('ended', onEnded)
    a.addEventListener('error', onError)

    return () => {
      a.removeEventListener('timeupdate', onTimeUpdate)
      a.removeEventListener('loadedmetadata', onLoadedMetadata)
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('waiting', onWaiting)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('error', onError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Media Session — same rationale as the original: stops mobile/OS from
  // treating an inactive tab/window as suspendable during playback.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const current = queue[currentIndex]
    if (!current) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
    })
    navigator.mediaSession.setActionHandler('play', togglePlay)
    navigator.mediaSession.setActionHandler('pause', togglePlay)
    navigator.mediaSession.setActionHandler('previoustrack', prev)
    navigator.mediaSession.setActionHandler('nexttrack', next)
  }, [queue, currentIndex, togglePlay, prev, next])

  useEffect(() => {
    navigator.mediaSession && (navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused')
  }, [isPlaying])

  // Keyboard shortcuts, ignored while typing in an input.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowRight') {
        const a = audioRef.current
        if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + 5)
      } else if (e.code === 'ArrowLeft') {
        const a = audioRef.current
        if (a) a.currentTime = Math.max(0, a.currentTime - 5)
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setVolume(Math.min(1, (audioRef.current?.volume ?? 0.8) + 0.1))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setVolume(Math.max(0, (audioRef.current?.volume ?? 0.8) - 0.1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePlay, setVolume])

  // Load persisted settings once on mount.
  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((s) => {
        if (cancelled) return
        setVolumeState(s.volume)
        setShuffle(s.shuffle)
        setRepeat(s.repeat)
        if (audioRef.current) audioRef.current.volume = s.volume
      })
      .catch((err) => console.error('Failed to load player settings:', err))
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load favorite track paths once on mount.
  useEffect(() => {
    let cancelled = false
    listFavorites()
      .then((paths) => {
        if (!cancelled) setFavorites(new Set(paths))
      })
      .catch((err) => console.error('Failed to load favorites:', err))
    return () => {
      cancelled = true
    }
  }, [])

  const toggleFavorite = useCallback((trackPath: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      const willFavorite = !next.has(trackPath)
      if (willFavorite) next.add(trackPath)
      else next.delete(trackPath)
      setFavoriteApi(trackPath, willFavorite).catch((err) => console.error('Failed to save favorite:', err))
      return next
    })
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

  const loadDjEffects = useCallback((settings: ParamValues) => {
    setDjEffectsState(settings)
    const chain = djChainRef.current
    const ctx = audioContextRef.current
    if (chain && ctx) chain.apply(settings, ctx.currentTime)
  }, [])

  return {
    queue,
    currentIndex,
    current: queue[currentIndex] ?? null,
    isPlaying,
    currentTime,
    duration,
    volume,
    shuffle,
    repeat,
    isLoading,
    settingsLoaded,
    favorites,
    toggleFavorite,
    analyser,
    djEffects,
    setDjEffects,
    resetDjEffects,
    loadDjEffects,
    hotCues,
    setHotCue,
    jumpToHotCue,
    clearHotCue,
    seekToSeconds,
    playbackRate,
    setPlaybackRate,
    brakeActive,
    triggerBrake,
    releaseBrake,
    setQueue,
    updateQueueOrder,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    setOutputMultiplier,
    toggleShuffle,
    toggleRepeat,
    playAt,
  }
}
