import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AudioConfig,
  AudioOptions,
  DriverKind,
  EngineEvent,
  EngineNote,
  EngineStatus,
  LatencyEstimate,
  RecordingStatus,
  SampleCacheInfo,
  SampleRequest,
  SampleResult,
  TrackKind,
} from './types'

/**
 * Typed client for Studio's native audio engine.
 *
 * Every function here is a thin wrapper over one Tauri command. The
 * reason this file exists rather than components calling `invoke`
 * directly is that command names and argument shapes are a contract with
 * Rust: keeping them in one place means a rename is one edit, and means
 * no component can accidentally pass beats where the engine expects
 * frames.
 */

const EVENT_NAME = 'studio:engine'

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

/** Starts the audio engine. Safe to call repeatedly; restarts if running. */
export async function startEngine(config?: AudioConfig): Promise<EngineStatus> {
  return invoke<EngineStatus>('studio_start_engine', { config: config ?? null })
}

/** Stops the engine and releases the audio device. */
export async function stopEngine(): Promise<void> {
  return invoke('studio_stop_engine')
}

export async function engineStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>('studio_engine_status')
}

/**
 * Subscribes to engine events (playhead, meters, dropouts).
 *
 * The Rust side already collapses bursts to the newest value per pump
 * tick, so this fires at roughly display rate rather than per audio block.
 */
export async function onEngineEvent(
  handler: (event: EngineEvent) => void,
): Promise<UnlistenFn> {
  return listen<EngineEvent>(EVENT_NAME, (e) => handler(e.payload))
}

// ---------------------------------------------------------------------
// Devices & settings
// ---------------------------------------------------------------------

export async function audioOptions(driver?: DriverKind): Promise<AudioOptions> {
  return invoke<AudioOptions>('studio_audio_options', { driver: driver ?? null })
}

/** Predicts latency without opening the device — for live slider feedback. */
export async function estimateLatency(
  bufferFrames: number,
  sampleRate: number,
  duplex: boolean,
): Promise<LatencyEstimate> {
  return invoke<LatencyEstimate>('studio_estimate_latency', {
    bufferFrames,
    sampleRate,
    duplex,
  })
}

/** Applies a new configuration. Audio stops briefly while the stream reopens. */
export async function applyAudioConfig(config: AudioConfig): Promise<EngineStatus> {
  return invoke<EngineStatus>('studio_apply_audio_config', { config })
}

// ---------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------

export const transport = {
  play: () => invoke<void>('studio_play'),
  stop: () => invoke<void>('studio_stop'),
  stopAndRewind: () => invoke<void>('studio_stop_and_rewind'),
  seek: (frames: number) =>
    invoke<void>('studio_seek', { frames: Math.max(0, Math.round(frames)) }),
  setLoop: (start: number | null, end: number | null) =>
    invoke<void>('studio_set_loop', {
      start: start === null ? null : Math.max(0, Math.round(start)),
      end: end === null ? null : Math.max(0, Math.round(end)),
    }),
  /** Tempo reaches the engine as frames-per-beat, not BPM — see framesPerBeat. */
  setTempo: (framesPerBeatValue: number) =>
    invoke<void>('studio_set_tempo', { framesPerBeat: framesPerBeatValue }),
  setMetronome: (enabled: boolean) => invoke<void>('studio_set_metronome', { enabled }),
}

// ---------------------------------------------------------------------
// Tracks & mixing
// ---------------------------------------------------------------------

export interface MixerValues {
  /** Linear gain, not dB — the UI owns the curve. */
  gain: number
  /** -1 (hard left) to 1 (hard right). */
  pan: number
  muted: boolean
  soloed: boolean
}

export const tracks = {
  upsert: (slot: number, kind: TrackKind, mixer: MixerValues) =>
    invoke<void>('studio_upsert_track', { slot, kind, ...mixer }),
  remove: (slot: number) => invoke<void>('studio_remove_track', { slot }),
  setMixer: (slot: number, mixer: MixerValues) =>
    invoke<void>('studio_set_mixer', { slot, ...mixer }),
  setMasterGain: (gain: number) => invoke<void>('studio_set_master_gain', { gain }),
  /** Replaces this track's scheduled notes wholesale. */
  setNotes: (slot: number, notes: EngineNote[]) =>
    invoke<void>('studio_set_notes', { slot, notes }),
}

// ---------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------

/**
 * Ensures sample files exist on local disk, downloading any that are
 * missing, and returns their paths. Must run before `loadSample`.
 */
export async function ensureSamples(requests: SampleRequest[]): Promise<SampleResult[]> {
  return invoke<SampleResult[]>('studio_ensure_samples', { requests })
}

/** Decodes a local file and installs it in the engine's sample pool. */
export async function loadSample(id: number, path: string): Promise<void> {
  return invoke('studio_load_sample', { id, path })
}

export async function unloadSample(id: number): Promise<void> {
  return invoke('studio_unload_sample', { id })
}

export async function sampleCacheInfo(): Promise<SampleCacheInfo> {
  return invoke<SampleCacheInfo>('studio_sample_cache_info')
}

export async function clearSampleCache(): Promise<void> {
  return invoke('studio_clear_sample_cache')
}

// ---------------------------------------------------------------------
// Live playing
// ---------------------------------------------------------------------

export const live = {
  noteOn: (slot: number, pitch: number, velocity: number, sample: number) =>
    invoke<void>('studio_note_on', { slot, pitch, velocity, sample }),
  noteOff: (slot: number, pitch: number) => invoke<void>('studio_note_off', { slot, pitch }),
  setSustain: (slot: number, held: boolean) =>
    invoke<void>('studio_set_sustain', { slot, held }),
  allNotesOff: () => invoke<void>('studio_all_notes_off'),
}

// ---------------------------------------------------------------------
// Recording & export
// ---------------------------------------------------------------------

export const recording = {
  start: (path: string) => invoke<void>('studio_start_recording', { path }),
  stop: () => invoke<string | null>('studio_stop_recording'),
  status: () => invoke<RecordingStatus>('studio_recording_status'),
}

export async function exportWav(
  path: string,
  samples: Float32Array,
  sampleRate: number,
  channels: number,
): Promise<void> {
  return invoke('studio_export_wav', {
    path,
    samples: Array.from(samples),
    sampleRate,
    channels,
  })
}

// ---------------------------------------------------------------------
// Time conversion
// ---------------------------------------------------------------------

/**
 * Converts BPM to the frames-per-beat figure the engine wants.
 *
 * The engine deliberately knows nothing about BPM: it counts whole frames
 * so the playhead cannot drift, and every musical value is resolved here
 * before it crosses over.
 */
export function framesPerBeat(bpm: number, sampleRate: number): number {
  if (bpm <= 0) return 0
  return (60 / bpm) * sampleRate
}

/** Beats to absolute frames at a given tempo. */
export function beatsToFrames(beats: number, bpm: number, sampleRate: number): number {
  return Math.round(beats * framesPerBeat(bpm, sampleRate))
}

/** Frames back to beats — for placing the playhead on the timeline. */
export function framesToBeats(frames: number, bpm: number, sampleRate: number): number {
  const fpb = framesPerBeat(bpm, sampleRate)
  return fpb === 0 ? 0 : frames / fpb
}

/**
 * Formats a frame position as bars:beats:ticks for the transport display.
 * Bars and beats are 1-based, matching every DAW's convention (the start
 * of a song reads "001:1:000", not "000:0:000").
 */
export function formatPosition(
  frames: number,
  bpm: number,
  sampleRate: number,
  beatsPerBar = 4,
): string {
  const totalBeats = framesToBeats(frames, bpm, sampleRate)
  const bar = Math.floor(totalBeats / beatsPerBar) + 1
  const beat = Math.floor(totalBeats % beatsPerBar) + 1
  const ticks = Math.floor((totalBeats % 1) * 960)
  return `${String(bar).padStart(3, '0')}:${beat}:${String(ticks).padStart(3, '0')}`
}

/**
 * Linear gain from a dB value, for faders labelled in dB.
 * -60dB and below is treated as silence, which is where a fader's
 * bottom detent sits in practice.
 */
export function dbToGain(db: number): number {
  return db <= -60 ? 0 : Math.pow(10, db / 20)
}

/** dB from linear gain, for meter and fader readouts. */
export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain)
}
