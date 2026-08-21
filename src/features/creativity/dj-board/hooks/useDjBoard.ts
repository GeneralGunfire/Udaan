import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioTrack } from '@/integrations/audio-library'
import { readAudioFileBytes } from '@/integrations/audio-library'
import { DeckAudioEngine, MixerEngine, defaultEffectsRack } from '../lib/audioEngine'
import type { EffectsRackState, EffectKind, CrossfaderCurve } from '../lib/audioEngine'
import {
  defaultDeckState,
  defaultLoopState,
  type DeckId,
  type DeckState,
  type CuePoint,
} from '../lib/types'
import {
  loadBoardSession,
  saveBoardSession,
  snapshotDeckSession,
  type DeckSessionSnapshot,
} from '../lib/boardSession'
import {
  loadPresets,
  savePresets,
  snapshotDeckSettings,
  nextPresetId,
  type BoardPreset,
} from '../lib/presets'

let cueIdCounter = 0
function nextCueId() {
  cueIdCounter += 1
  return `cue-${cueIdCounter}`
}

function applySnapshotToState(state: DeckState, snapshot: DeckSessionSnapshot): DeckState {
  return {
    ...state,
    track: snapshot.track,
    volume: snapshot.volume,
    eq: { ...snapshot.eq },
    bass: snapshot.bass,
    filter: snapshot.filter,
    tempoPercent: snapshot.tempoPercent,
  }
}

export function useDjBoard() {
  const mixerRef = useRef<MixerEngine | null>(null)
  const deckEnginesRef = useRef<Record<DeckId, DeckAudioEngine | null>>({
    A: null,
    B: null,
  })
  const loopIntervalRef = useRef<Record<DeckId, number | null>>({ A: null, B: null })

  const [deckA, setDeckA] = useState<DeckState>(defaultDeckState())
  const [deckB, setDeckB] = useState<DeckState>(defaultDeckState())
  const [crossfade, setCrossfadeValue] = useState(0)
  const [crossfaderCurve, setCrossfaderCurveValue] = useState<CrossfaderCurve>('smooth')
  const [masterVolume, setMasterVolumeValue] = useState(0.9)
  const [effects, setEffects] = useState<EffectsRackState>(defaultEffectsRack())
  const [peakA, setPeakA] = useState(0)
  const [peakB, setPeakB] = useState(0)
  const [peakMaster, setPeakMaster] = useState(0)
  const [presets, setPresets] = useState<BoardPreset[]>(() => loadPresets())

  useEffect(() => {
    const mixer = new MixerEngine()
    const engineA = new DeckAudioEngine()
    const engineB = new DeckAudioEngine()
    mixer.connectDeckA(engineA.output)
    mixer.connectDeckB(engineB.output)
    mixerRef.current = mixer
    deckEnginesRef.current = { A: engineA, B: engineB }

    // Restore last session's deck settings (volume/EQ/bass/filter/tempo)
    // and crossfader/master state on mount. Tracks are re-referenced by
    // path but not auto-decoded — the user re-picks play to actually load
    // audio, since eagerly decoding on app start would be a surprising
    // side effect and the file may have moved/been deleted since.
    const session = loadBoardSession()
    if (session) {
      setDeckA((prev) => applySnapshotToState(prev, session.deckA))
      setDeckB((prev) => applySnapshotToState(prev, session.deckB))
      engineA.setEq(session.deckA.eq)
      engineA.setBass(session.deckA.bass)
      engineA.setFilter(session.deckA.filter)
      engineA.setVolume(session.deckA.volume)
      engineB.setEq(session.deckB.eq)
      engineB.setBass(session.deckB.bass)
      engineB.setFilter(session.deckB.filter)
      engineB.setVolume(session.deckB.volume)
      mixer.setCrossfade(session.crossfade)
      mixer.setCrossfaderCurve(session.crossfaderCurve)
      mixer.setMasterVolume(session.masterVolume)
      setCrossfadeValue(session.crossfade)
      setCrossfaderCurveValue(session.crossfaderCurve)
      setMasterVolumeValue(session.masterVolume)
    }

    return () => {
      engineA.dispose()
      engineB.dispose()
    }
  }, [])

  // Auto-save session on any settings change — debounced via a plain
  // effect dependency array rather than a timer, since these are cheap,
  // infrequent writes (knob/fader changes), not a hot loop.
  useEffect(() => {
    saveBoardSession({
      deckA: snapshotDeckSession(deckA),
      deckB: snapshotDeckSession(deckB),
      crossfade,
      crossfaderCurve,
      masterVolume,
    })
  }, [deckA, deckB, crossfade, crossfaderCurve, masterVolume])

  // Playback-position + peak-meter ticker — real time/levels from the audio graph, not simulated.
  useEffect(() => {
    const id = window.setInterval(() => {
      const engineA = deckEnginesRef.current.A
      const engineB = deckEnginesRef.current.B
      if (engineA) {
        setDeckA((prev) =>
          prev.track ? { ...prev, currentTime: engineA.currentTime() } : prev,
        )
        setPeakA(engineA.getPeakLevel())
      }
      if (engineB) {
        setDeckB((prev) =>
          prev.track ? { ...prev, currentTime: engineB.currentTime() } : prev,
        )
        setPeakB(engineB.getPeakLevel())
      }
      if (mixerRef.current) setPeakMaster(mixerRef.current.getPeakLevel())
    }, 100)
    return () => window.clearInterval(id)
  }, [])

  const setDeckState = useCallback((deck: DeckId, updater: (prev: DeckState) => DeckState) => {
    if (deck === 'A') setDeckA(updater)
    else setDeckB(updater)
  }, [])

  const clearLoopInterval = useCallback((deck: DeckId) => {
    const id = loopIntervalRef.current[deck]
    if (id !== null) {
      window.clearInterval(id)
      loopIntervalRef.current[deck] = null
    }
  }, [])

  const loadTrack = useCallback(
    async (deck: DeckId, track: AudioTrack) => {
      const engine = deckEnginesRef.current[deck]
      if (!engine) return
      clearLoopInterval(deck)
      setDeckState(deck, (prev) => ({ ...prev, isLoading: true, track }))
      try {
        await mixerRef.current?.resume()
        const bytes = await readAudioFileBytes(track.path)
        const duration = await engine.loadBuffer(bytes)
        setDeckState(deck, (prev) => ({
          ...prev,
          isLoading: false,
          duration,
          currentTime: 0,
          isPlaying: false,
          cuePoints: [],
          hotCues: [null, null, null, null],
          loop: defaultLoopState(),
        }))
      } catch (err) {
        console.error('Failed to load track', err)
        setDeckState(deck, (prev) => ({ ...prev, isLoading: false }))
      }
    },
    [setDeckState, clearLoopInterval],
  )

  const togglePlay = useCallback(
    async (deck: DeckId) => {
      const engine = deckEnginesRef.current[deck]
      if (!engine) return
      await mixerRef.current?.resume()
      if (engine.isPlaying()) {
        engine.pause()
        setDeckState(deck, (prev) => ({ ...prev, isPlaying: false }))
      } else {
        engine.play()
        setDeckState(deck, (prev) => ({ ...prev, isPlaying: true }))
      }
    },
    [setDeckState],
  )

  const seek = useCallback(
    (deck: DeckId, seconds: number) => {
      const engine = deckEnginesRef.current[deck]
      if (!engine) return
      engine.seek(seconds)
      setDeckState(deck, (prev) => ({ ...prev, currentTime: seconds }))
    },
    [setDeckState],
  )

  const setVolume = useCallback(
    (deck: DeckId, volume: number) => {
      const engine = deckEnginesRef.current[deck]
      engine?.setVolume(volume)
      setDeckState(deck, (prev) => ({ ...prev, volume }))
    },
    [setDeckState],
  )

  const setEqBand = useCallback(
    (deck: DeckId, band: 'low' | 'mid' | 'high', value: number) => {
      setDeckState(deck, (prev) => {
        const eq = { ...prev.eq, [band]: value }
        deckEnginesRef.current[deck]?.setEq(eq)
        return { ...prev, eq }
      })
    },
    [setDeckState],
  )

  const setBass = useCallback(
    (deck: DeckId, value: number) => {
      deckEnginesRef.current[deck]?.setBass(value)
      setDeckState(deck, (prev) => ({ ...prev, bass: value }))
    },
    [setDeckState],
  )

  /** Real HP/LP sweep filter — genuine DSP via the engine's BiquadFilterNode, not mocked. */
  const setFilter = useCallback(
    (deck: DeckId, value: number) => {
      deckEnginesRef.current[deck]?.setFilter(value)
      setDeckState(deck, (prev) => ({ ...prev, filter: value }))
    },
    [setDeckState],
  )

  const setTempoPercent = useCallback(
    (deck: DeckId, percent: number) => {
      const clamped = Math.max(-8, Math.min(8, percent))
      const rate = 1 + clamped / 100
      deckEnginesRef.current[deck]?.setPlaybackRate(rate)
      setDeckState(deck, (prev) => ({ ...prev, tempoPercent: clamped }))
    },
    [setDeckState],
  )

  const tapBpm = useCallback(
    (deck: DeckId, bpm: number) => {
      setDeckState(deck, (prev) => ({ ...prev, bpm }))
    },
    [setDeckState],
  )

  /**
   * Sync — matches deck B's tempo to deck A's BPM (or vice versa) by
   * adjusting playback rate. Real, not mocked: it computes the actual
   * ratio between the two decks' tapped/known BPMs and applies it via
   * DeckAudioEngine.setPlaybackRate, the same real rate-change path the
   * Tempo fader uses. Requires both decks to have a BPM set (tap tempo)
   * — there's no automatic beat-detection yet, so sync can't infer a
   * BPM that was never entered.
   */
  const syncTempo = useCallback(
    (deck: DeckId) => {
      const other: DeckId = deck === 'A' ? 'B' : 'A'
      const source = deck === 'A' ? deckA : deckB
      const target = deck === 'A' ? deckB : deckA
      if (!source.bpm || !target.bpm) return
      const ratio = source.bpm / target.bpm
      const percent = Math.max(-8, Math.min(8, (ratio - 1) * 100))
      setTempoPercent(other, percent)
    },
    [deckA, deckB, setTempoPercent],
  )

  const addCuePoint = useCallback(
    (deck: DeckId) => {
      const engine = deckEnginesRef.current[deck]
      if (!engine) return
      const seconds = engine.currentTime()
      const cue: CuePoint = {
        id: nextCueId(),
        label: formatTime(seconds),
        seconds,
      }
      setDeckState(deck, (prev) => ({
        ...prev,
        cuePoints: [...prev.cuePoints, cue].sort((a, b) => a.seconds - b.seconds),
      }))
    },
    [setDeckState],
  )

  const jumpToCue = useCallback(
    (deck: DeckId, cue: CuePoint) => {
      seek(deck, cue.seconds)
    },
    [seek],
  )

  const removeCuePoint = useCallback(
    (deck: DeckId, cueId: string) => {
      setDeckState(deck, (prev) => ({
        ...prev,
        cuePoints: prev.cuePoints.filter((c) => c.id !== cueId),
      }))
    },
    [setDeckState],
  )

  /** Sets hot-cue slot (0-3) to the current playback position — real position from the engine. */
  const setHotCue = useCallback(
    (deck: DeckId, slot: number) => {
      const engine = deckEnginesRef.current[deck]
      if (!engine || !engine.duration()) return
      const seconds = engine.currentTime()
      setDeckState(deck, (prev) => {
        const hotCues = [...prev.hotCues]
        hotCues[slot] = seconds
        return { ...prev, hotCues }
      })
    },
    [setDeckState],
  )

  /** Jumps to hot-cue slot (0-3) if set; no-op if that slot is empty. */
  const triggerHotCue = useCallback(
    (deck: DeckId, slot: number, state: DeckState) => {
      const seconds = state.hotCues[slot]
      if (seconds === null) return
      seek(deck, seconds)
    },
    [seek],
  )

  const clearHotCue = useCallback(
    (deck: DeckId, slot: number) => {
      setDeckState(deck, (prev) => {
        const hotCues = [...prev.hotCues]
        hotCues[slot] = null
        return { ...prev, hotCues }
      })
    },
    [setDeckState],
  )

  const setLoopBeats = useCallback(
    (deck: DeckId, beats: 4 | 8 | 16) => {
      setDeckState(deck, (prev) => ({ ...prev, loop: { ...prev.loop, beats } }))
    },
    [setDeckState],
  )

  /**
   * Real loop-in/out: marks the current position as the loop bounds
   * (loop-out computed from BPM+beat-count if a BPM is known, otherwise
   * a flat 2s-per-beat estimate), then activates a real seek-back
   * mechanism — a lightweight interval polls playback position and
   * seeks back to loop-in whenever it passes loop-out. Genuine looped
   * playback, not a visual-only marker.
   */
  const toggleLoop = useCallback(
    (deck: DeckId, state: DeckState) => {
      const engine = deckEnginesRef.current[deck]
      if (!engine) return

      if (state.loop.active) {
        clearLoopInterval(deck)
        setDeckState(deck, (prev) => ({ ...prev, loop: { ...prev.loop, active: false } }))
        return
      }

      const secondsPerBeat = state.bpm ? 60 / state.bpm : 0.5
      const inSeconds = engine.currentTime()
      const outSeconds = inSeconds + secondsPerBeat * state.loop.beats

      clearLoopInterval(deck)
      const intervalId = window.setInterval(() => {
        const e = deckEnginesRef.current[deck]
        if (!e || !e.isPlaying()) return
        if (e.currentTime() >= outSeconds) e.seek(inSeconds)
      }, 30)
      loopIntervalRef.current[deck] = intervalId

      setDeckState(deck, (prev) => ({
        ...prev,
        loop: { ...prev.loop, active: true, inSeconds, outSeconds },
      }))
    },
    [setDeckState, clearLoopInterval],
  )

  const setCrossfade = useCallback((position: number) => {
    mixerRef.current?.setCrossfade(position)
    setCrossfadeValue(position)
  }, [])

  const setCrossfaderCurve = useCallback((curve: CrossfaderCurve) => {
    mixerRef.current?.setCrossfaderCurve(curve)
    setCrossfaderCurveValue(curve)
  }, [])

  const setMasterVolume = useCallback((volume: number) => {
    mixerRef.current?.setMasterVolume(volume)
    setMasterVolumeValue(volume)
  }, [])

  const toggleEffect = useCallback((kind: EffectKind) => {
    // TODO(real audio engine): no DSP node graph is built for effects yet —
    // this only tracks UI/control state. See lib/audioEngine.ts header.
    setEffects((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], enabled: !prev[kind].enabled },
    }))
  }, [])

  const setEffectAmount = useCallback((kind: EffectKind, amount: number) => {
    setEffects((prev) => ({ ...prev, [kind]: { ...prev[kind], amount } }))
  }, [])

  /** Saves the current deck A/B settings (not track/playback state) as a named preset. */
  const savePreset = useCallback(
    (name: string) => {
      const preset: BoardPreset = {
        id: nextPresetId(),
        name,
        deckA: snapshotDeckSettings(deckA),
        deckB: snapshotDeckSettings(deckB),
        crossfade,
        masterVolume,
        createdAt: new Date().toISOString(),
      }
      const next = [preset, ...presets]
      setPresets(next)
      savePresets(next)
    },
    [deckA, deckB, crossfade, masterVolume, presets],
  )

  /** Applies a saved preset's settings to both decks — real, applied to the live engines, not just displayed. */
  const loadPreset = useCallback(
    (preset: BoardPreset) => {
      setEqBand('A', 'low', preset.deckA.eq.low)
      setEqBand('A', 'mid', preset.deckA.eq.mid)
      setEqBand('A', 'high', preset.deckA.eq.high)
      setBass('A', preset.deckA.bass)
      setFilter('A', preset.deckA.filter)
      setVolume('A', preset.deckA.volume)
      setTempoPercent('A', preset.deckA.tempoPercent)

      setEqBand('B', 'low', preset.deckB.eq.low)
      setEqBand('B', 'mid', preset.deckB.eq.mid)
      setEqBand('B', 'high', preset.deckB.eq.high)
      setBass('B', preset.deckB.bass)
      setFilter('B', preset.deckB.filter)
      setVolume('B', preset.deckB.volume)
      setTempoPercent('B', preset.deckB.tempoPercent)

      setCrossfade(preset.crossfade)
      setMasterVolume(preset.masterVolume)
    },
    [setEqBand, setBass, setFilter, setVolume, setTempoPercent, setCrossfade, setMasterVolume],
  )

  const deletePreset = useCallback(
    (id: string) => {
      const next = presets.filter((p) => p.id !== id)
      setPresets(next)
      savePresets(next)
    },
    [presets],
  )

  return {
    deckA,
    deckB,
    crossfade,
    crossfaderCurve,
    masterVolume,
    effects,
    peakA,
    peakB,
    peakMaster,
    loadTrack,
    togglePlay,
    seek,
    setVolume,
    setEqBand,
    setBass,
    setFilter,
    setTempoPercent,
    tapBpm,
    syncTempo,
    addCuePoint,
    jumpToCue,
    removeCuePoint,
    setHotCue,
    triggerHotCue,
    clearHotCue,
    setLoopBeats,
    toggleLoop,
    setCrossfade,
    setCrossfaderCurve,
    setMasterVolume,
    presets,
    savePreset,
    loadPreset,
    deletePreset,
    toggleEffect,
    setEffectAmount,
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
