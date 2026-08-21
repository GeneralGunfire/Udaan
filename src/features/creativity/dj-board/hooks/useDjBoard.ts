import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioTrack } from '@/integrations/audio-library'
import { readAudioFileBytes } from '@/integrations/audio-library'
import { DeckAudioEngine, MixerEngine, defaultEffectsRack } from '../lib/audioEngine'
import type { EffectsRackState, EffectKind } from '../lib/audioEngine'
import { defaultDeckState, type DeckId, type DeckState, type CuePoint } from '../lib/types'

let cueIdCounter = 0
function nextCueId() {
  cueIdCounter += 1
  return `cue-${cueIdCounter}`
}

export function useDjBoard() {
  const mixerRef = useRef<MixerEngine | null>(null)
  const deckEnginesRef = useRef<Record<DeckId, DeckAudioEngine | null>>({
    A: null,
    B: null,
  })

  const [deckA, setDeckA] = useState<DeckState>(defaultDeckState())
  const [deckB, setDeckB] = useState<DeckState>(defaultDeckState())
  const [crossfade, setCrossfadeValue] = useState(0)
  const [masterVolume, setMasterVolumeValue] = useState(0.9)
  const [effects, setEffects] = useState<EffectsRackState>(defaultEffectsRack())

  useEffect(() => {
    const mixer = new MixerEngine()
    const engineA = new DeckAudioEngine()
    const engineB = new DeckAudioEngine()
    mixer.connectDeckA(engineA.output)
    mixer.connectDeckB(engineB.output)
    mixerRef.current = mixer
    deckEnginesRef.current = { A: engineA, B: engineB }

    return () => {
      engineA.dispose()
      engineB.dispose()
    }
  }, [])

  // Playback-position ticker — real time from the audio graph, not simulated.
  useEffect(() => {
    const id = window.setInterval(() => {
      const engineA = deckEnginesRef.current.A
      const engineB = deckEnginesRef.current.B
      if (engineA) {
        setDeckA((prev) =>
          prev.track ? { ...prev, currentTime: engineA.currentTime() } : prev,
        )
      }
      if (engineB) {
        setDeckB((prev) =>
          prev.track ? { ...prev, currentTime: engineB.currentTime() } : prev,
        )
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  const setDeckState = useCallback((deck: DeckId, updater: (prev: DeckState) => DeckState) => {
    if (deck === 'A') setDeckA(updater)
    else setDeckB(updater)
  }, [])

  const loadTrack = useCallback(
    async (deck: DeckId, track: AudioTrack) => {
      const engine = deckEnginesRef.current[deck]
      if (!engine) return
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
        }))
      } catch (err) {
        console.error('Failed to load track', err)
        setDeckState(deck, (prev) => ({ ...prev, isLoading: false }))
      }
    },
    [setDeckState],
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

  const setTempoPercent = useCallback(
    (deck: DeckId, percent: number) => {
      // TODO(real audio engine): tempo/pitch shifting needs a time-stretch
      // algorithm (e.g. phase vocoder or WSOLA); native playbackRate would
      // change pitch too, which real DJ software avoids. Tracked as a mock
      // control until the real engine choice is made — see NOTES.md.
      setDeckState(deck, (prev) => ({ ...prev, tempoPercent: percent }))
    },
    [setDeckState],
  )

  const tapBpm = useCallback(
    (deck: DeckId, bpm: number) => {
      setDeckState(deck, (prev) => ({ ...prev, bpm }))
    },
    [setDeckState],
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

  const setCrossfade = useCallback((position: number) => {
    mixerRef.current?.setCrossfade(position)
    setCrossfadeValue(position)
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

  return {
    deckA,
    deckB,
    crossfade,
    masterVolume,
    effects,
    loadTrack,
    togglePlay,
    seek,
    setVolume,
    setEqBand,
    setBass,
    setTempoPercent,
    tapBpm,
    addCuePoint,
    jumpToCue,
    removeCuePoint,
    setCrossfade,
    setMasterVolume,
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
