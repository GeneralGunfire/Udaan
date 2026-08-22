/**
 * Module-level singleton holding the DJ Board's live audio engines and
 * state — same pattern as notifications/lib/notificationStore.ts. Lives
 * outside React's component tree entirely, so playback survives
 * navigating away from the DJ Board view: DjBoardView (and the
 * always-mounted MiniPlayer in the app shell) both just subscribe to
 * this store rather than owning the engines themselves. Previously the
 * engines were created/disposed in a DjBoardView useEffect, which tore
 * down playback the moment the view unmounted — that's the bug this
 * fixes.
 */
import type { AudioTrack } from '@/integrations/audio-library'
import { readAudioFileBytes } from '@/integrations/audio-library'
import { DeckAudioEngine, MixerEngine, defaultEffectsRack } from './audioEngine'
import type { EffectsRackState, EffectKind, CrossfaderCurve } from './audioEngine'
import { defaultDeckState, defaultLoopState, type DeckId, type DeckState, type CuePoint } from './types'
import {
  loadBoardSession,
  saveBoardSession,
  snapshotDeckSession,
  type DeckSessionSnapshot,
} from './boardSession'
import { loadPresets, savePresets, snapshotDeckSettings, nextPresetId, type BoardPreset } from './presets'

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

export interface BoardSnapshot {
  deckA: DeckState
  deckB: DeckState
  crossfade: number
  crossfaderCurve: CrossfaderCurve
  masterVolume: number
  effects: EffectsRackState
  peakA: number
  peakB: number
  peakMaster: number
  presets: BoardPreset[]
}

type Listener = () => void
const listeners = new Set<Listener>()
function notify() {
  for (const l of listeners) l()
}

let deckA: DeckState = defaultDeckState()
let deckB: DeckState = defaultDeckState()
let crossfade = 0
let crossfaderCurve: CrossfaderCurve = 'smooth'
let masterVolume = 0.9
let effects: EffectsRackState = defaultEffectsRack()
let peakA = 0
let peakB = 0
let peakMaster = 0
let presets: BoardPreset[] = []

let mixer: MixerEngine | null = null
const deckEngines: Record<DeckId, DeckAudioEngine | null> = { A: null, B: null }
const loopIntervals: Record<DeckId, number | null> = { A: null, B: null }
let started = false

function getSnapshot(): BoardSnapshot {
  return { deckA, deckB, crossfade, crossfaderCurve, masterVolume, effects, peakA, peakB, peakMaster, presets }
}

function setDeck(id: DeckId, updater: (prev: DeckState) => DeckState) {
  if (id === 'A') deckA = updater(deckA)
  else deckB = updater(deckB)
  notify()
}

function clearLoopInterval(deck: DeckId) {
  const id = loopIntervals[deck]
  if (id !== null) {
    window.clearInterval(id)
    loopIntervals[deck] = null
  }
}

/** Starts the engines + session restore + peak-meter ticker exactly once, no matter how many views subscribe. */
function ensureStarted() {
  if (started) return
  started = true
  presets = loadPresets()

  const m = new MixerEngine()
  const engineA = new DeckAudioEngine()
  const engineB = new DeckAudioEngine()
  m.connectDeckA(engineA.output)
  m.connectDeckB(engineB.output)
  mixer = m
  deckEngines.A = engineA
  deckEngines.B = engineB

  const session = loadBoardSession()
  if (session) {
    deckA = applySnapshotToState(deckA, session.deckA)
    deckB = applySnapshotToState(deckB, session.deckB)
    engineA.setEq(session.deckA.eq)
    engineA.setBass(session.deckA.bass)
    engineA.setFilter(session.deckA.filter)
    engineA.setVolume(session.deckA.volume)
    engineB.setEq(session.deckB.eq)
    engineB.setBass(session.deckB.bass)
    engineB.setFilter(session.deckB.filter)
    engineB.setVolume(session.deckB.volume)
    m.setCrossfade(session.crossfade)
    m.setCrossfaderCurve(session.crossfaderCurve)
    m.setMasterVolume(session.masterVolume)
    crossfade = session.crossfade
    crossfaderCurve = session.crossfaderCurve
    masterVolume = session.masterVolume
  }

  window.setInterval(() => {
    let changed = false
    if (deckEngines.A && deckA.track) {
      deckA = { ...deckA, currentTime: deckEngines.A.currentTime() }
      changed = true
    }
    if (deckEngines.A) peakA = deckEngines.A.getPeakLevel()
    if (deckEngines.B && deckB.track) {
      deckB = { ...deckB, currentTime: deckEngines.B.currentTime() }
      changed = true
    }
    if (deckEngines.B) peakB = deckEngines.B.getPeakLevel()
    if (mixer) peakMaster = mixer.getPeakLevel()
    notify()
    if (changed) persistSession()
  }, 100)
}

function persistSession() {
  saveBoardSession({
    deckA: snapshotDeckSession(deckA),
    deckB: snapshotDeckSession(deckB),
    crossfade,
    crossfaderCurve,
    masterVolume,
  })
}

export function subscribeBoardEngine(listener: Listener): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBoardSnapshot(): BoardSnapshot {
  ensureStarted()
  return getSnapshot()
}

export async function loadTrack(deck: DeckId, track: AudioTrack) {
  ensureStarted()
  const engine = deckEngines[deck]
  if (!engine) return
  clearLoopInterval(deck)
  setDeck(deck, (prev) => ({ ...prev, isLoading: true, track }))
  try {
    await mixer?.resume()
    const bytes = await readAudioFileBytes(track.path)
    const duration = await engine.loadBuffer(bytes)
    setDeck(deck, (prev) => ({
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
    setDeck(deck, (prev) => ({ ...prev, isLoading: false }))
  }
  persistSession()
}

export async function togglePlay(deck: DeckId) {
  ensureStarted()
  const engine = deckEngines[deck]
  if (!engine) return
  await mixer?.resume()
  if (engine.isPlaying()) {
    engine.pause()
    setDeck(deck, (prev) => ({ ...prev, isPlaying: false }))
  } else {
    engine.play()
    setDeck(deck, (prev) => ({ ...prev, isPlaying: true }))
  }
}

export function seek(deck: DeckId, seconds: number) {
  ensureStarted()
  deckEngines[deck]?.seek(seconds)
  setDeck(deck, (prev) => ({ ...prev, currentTime: seconds }))
}

export function setVolume(deck: DeckId, volume: number) {
  ensureStarted()
  deckEngines[deck]?.setVolume(volume)
  setDeck(deck, (prev) => ({ ...prev, volume }))
  persistSession()
}

export function setEqBand(deck: DeckId, band: 'low' | 'mid' | 'high', value: number) {
  ensureStarted()
  setDeck(deck, (prev) => {
    const eq = { ...prev.eq, [band]: value }
    deckEngines[deck]?.setEq(eq)
    return { ...prev, eq }
  })
  persistSession()
}

export function setBass(deck: DeckId, value: number) {
  ensureStarted()
  deckEngines[deck]?.setBass(value)
  setDeck(deck, (prev) => ({ ...prev, bass: value }))
  persistSession()
}

export function setFilter(deck: DeckId, value: number) {
  ensureStarted()
  deckEngines[deck]?.setFilter(value)
  setDeck(deck, (prev) => ({ ...prev, filter: value }))
  persistSession()
}

/** Real click-to-toggle lowpass (phone-in-pocket effect), separate from the hold-to-apply rack Filter. */
export function toggleMuffle(deck: DeckId) {
  ensureStarted()
  const engine = deckEngines[deck]
  if (!engine) return
  const muffled = engine.toggleMuffle()
  setDeck(deck, (prev) => ({ ...prev, muffled }))
}

/** Real click-to-toggle instant low-band mute — independent of the Bass knob's own value. */
export function toggleBassKill(deck: DeckId) {
  ensureStarted()
  const engine = deckEngines[deck]
  if (!engine) return
  const bassKilled = engine.toggleBassKill()
  setDeck(deck, (prev) => ({ ...prev, bassKilled }))
}

/** Real one-shot fading-repeat effect, fired on click — no persistent state to track, the decay is audio feedback settling to silence. */
export function triggerEchoOut(deck: DeckId) {
  ensureStarted()
  deckEngines[deck]?.triggerEchoOut()
}

export function setTempoPercent(deck: DeckId, percent: number) {
  ensureStarted()
  const clamped = Math.max(-8, Math.min(8, percent))
  deckEngines[deck]?.setPlaybackRate(1 + clamped / 100)
  setDeck(deck, (prev) => ({ ...prev, tempoPercent: clamped }))
  persistSession()
}

export function tapBpm(deck: DeckId, bpm: number) {
  ensureStarted()
  setDeck(deck, (prev) => ({ ...prev, bpm }))
}

export function syncTempo(deck: DeckId) {
  ensureStarted()
  const other: DeckId = deck === 'A' ? 'B' : 'A'
  const source = deck === 'A' ? deckA : deckB
  const target = deck === 'A' ? deckB : deckA
  if (!source.bpm || !target.bpm) return
  const ratio = source.bpm / target.bpm
  setTempoPercent(other, Math.max(-8, Math.min(8, (ratio - 1) * 100)))
}

export function addCuePoint(deck: DeckId) {
  ensureStarted()
  const engine = deckEngines[deck]
  if (!engine) return
  const seconds = engine.currentTime()
  const cue: CuePoint = { id: nextCueId(), label: formatTime(seconds), seconds }
  setDeck(deck, (prev) => ({
    ...prev,
    cuePoints: [...prev.cuePoints, cue].sort((a, b) => a.seconds - b.seconds),
  }))
}

export function jumpToCue(deck: DeckId, cue: CuePoint) {
  seek(deck, cue.seconds)
}

export function removeCuePoint(deck: DeckId, cueId: string) {
  ensureStarted()
  setDeck(deck, (prev) => ({ ...prev, cuePoints: prev.cuePoints.filter((c) => c.id !== cueId) }))
}

export function setHotCue(deck: DeckId, slot: number) {
  ensureStarted()
  const engine = deckEngines[deck]
  if (!engine || !engine.duration()) return
  const seconds = engine.currentTime()
  setDeck(deck, (prev) => {
    const hotCues = [...prev.hotCues]
    hotCues[slot] = seconds
    return { ...prev, hotCues }
  })
}

export function triggerHotCue(deck: DeckId, slot: number, state: DeckState) {
  const seconds = state.hotCues[slot]
  if (seconds === null) return
  seek(deck, seconds)
}

export function clearHotCue(deck: DeckId, slot: number) {
  ensureStarted()
  setDeck(deck, (prev) => {
    const hotCues = [...prev.hotCues]
    hotCues[slot] = null
    return { ...prev, hotCues }
  })
}

export function setLoopBeats(deck: DeckId, beats: 4 | 8 | 16) {
  ensureStarted()
  setDeck(deck, (prev) => ({ ...prev, loop: { ...prev.loop, beats } }))
}

export function toggleLoop(deck: DeckId, state: DeckState) {
  ensureStarted()
  const engine = deckEngines[deck]
  if (!engine) return

  if (state.loop.active) {
    clearLoopInterval(deck)
    setDeck(deck, (prev) => ({ ...prev, loop: { ...prev.loop, active: false } }))
    return
  }

  const secondsPerBeat = state.bpm ? 60 / state.bpm : 0.5
  const inSeconds = engine.currentTime()
  const outSeconds = inSeconds + secondsPerBeat * state.loop.beats

  clearLoopInterval(deck)
  const intervalId = window.setInterval(() => {
    const e = deckEngines[deck]
    if (!e || !e.isPlaying()) return
    if (e.currentTime() >= outSeconds) e.seek(inSeconds)
  }, 30)
  loopIntervals[deck] = intervalId

  setDeck(deck, (prev) => ({ ...prev, loop: { ...prev.loop, active: true, inSeconds, outSeconds } }))
}

export function setCrossfade(position: number) {
  ensureStarted()
  mixer?.setCrossfade(position)
  crossfade = position
  notify()
  persistSession()
}

export function setCrossfaderCurve(curve: CrossfaderCurve) {
  ensureStarted()
  mixer?.setCrossfaderCurve(curve)
  crossfaderCurve = curve
  notify()
  persistSession()
}

export function setMasterVolume(volume: number) {
  ensureStarted()
  mixer?.setMasterVolume(volume)
  masterVolume = volume
  notify()
  persistSession()
}

export function engageEffect(kind: EffectKind) {
  ensureStarted()
  const amount = effects[kind].amount
  deckEngines.A?.engageEffect(kind, amount)
  deckEngines.B?.engageEffect(kind, amount)
  effects = { ...effects, [kind]: { ...effects[kind], engaged: true } }
  notify()
}

export function releaseEffect(kind: EffectKind) {
  ensureStarted()
  deckEngines.A?.releaseEffect(kind)
  deckEngines.B?.releaseEffect(kind)
  effects = { ...effects, [kind]: { ...effects[kind], engaged: false } }
  notify()
}

export function setEffectAmount(kind: EffectKind, amount: number) {
  ensureStarted()
  if (effects[kind].engaged) {
    deckEngines.A?.engageEffect(kind, amount)
    deckEngines.B?.engageEffect(kind, amount)
  }
  effects = { ...effects, [kind]: { ...effects[kind], amount } }
  notify()
}

export function savePreset(name: string) {
  ensureStarted()
  const preset: BoardPreset = {
    id: nextPresetId(),
    name,
    deckA: snapshotDeckSettings(deckA),
    deckB: snapshotDeckSettings(deckB),
    crossfade,
    masterVolume,
    createdAt: new Date().toISOString(),
  }
  presets = [preset, ...presets]
  savePresets(presets)
  notify()
}

export function loadPreset(preset: BoardPreset) {
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
}

export function deletePreset(id: string) {
  ensureStarted()
  presets = presets.filter((p) => p.id !== id)
  savePresets(presets)
  notify()
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
