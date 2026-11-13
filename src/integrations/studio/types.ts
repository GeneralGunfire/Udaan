/**
 * Shared types for Studio's native audio engine, mirroring the Rust
 * definitions in `src-tauri/src/studio/`.
 *
 * Time is expressed in **frames** wherever it crosses into the engine.
 * Musical time (bars, beats) is the UI's concern and is converted here,
 * never inside the audio thread — see the engine's `messages.rs` for why
 * the callback must not do tempo arithmetic.
 */

/** Which audio backend a device is reached through. */
export type DriverKind = 'wasapiShared' | 'wasapiExclusive' | 'asio'

export type DeviceDirection = 'output' | 'input'

export interface AudioDevice {
  /** Stable id used to re-select this device across restarts. */
  id: string
  /** Human label; not guaranteed unique across identical interfaces. */
  name: string
  direction: DeviceDirection
  driver: DriverKind
  isDefault: boolean
  sampleRates: number[]
  maxChannels: number
}

/** A latency figure broken into its parts, so the UI can explain it. */
export interface LatencyEstimate {
  bufferFrames: number
  sampleRate: number
  outputMs: number
  inputMs: number
  /** Output + input — what a performer actually feels when monitoring. */
  roundTripMs: number
  /** True once a stream is open and these are the granted values. */
  isMeasured: boolean
  rating: 'good' | 'ok' | 'high'
}

export interface AudioConfig {
  driver: DriverKind
  /** null means "use the system default output". */
  outputDeviceId: string | null
  /** null disables input entirely (playback only, no recording). */
  inputDeviceId: string | null
  sampleRate: number
  bufferFrames: number
}

export interface DriverOption {
  kind: DriverKind
  label: string
  /** Plain-language explanation for the setup wizard. */
  description: string
}

export interface AudioOptions {
  drivers: DriverOption[]
  devices: AudioDevice[]
  bufferSizes: number[]
  sampleRates: number[]
}

export interface EngineStatus {
  running: boolean
  config: AudioConfig | null
  latency: LatencyEstimate | null
  /** Cumulative audio dropouts. Nonzero means "raise your buffer size". */
  xruns: number
  /** Commands dropped because the queue was full. */
  droppedCommands: number
}

export interface RecordingStatus {
  recording: boolean
  seconds: number
  /** Input peak since the last poll, 0-1, for the level meter. */
  peak: number
  path: string | null
}

export type TrackKind = 'instrument' | 'audio'

/** A note resolved to absolute frame positions, ready for the engine. */
export interface EngineNote {
  start: number
  end: number
  pitch: number
  /** 0-1. */
  velocity: number
  /** Index into the engine's sample pool. */
  sample: number
}

/** Events pushed from the audio thread, via the Rust event pump. */
export type EngineEvent =
  | { type: 'position'; frames: number }
  | { type: 'looped' }
  | { type: 'levels'; masterLeft: number; masterRight: number }
  | { type: 'xrun'; count: number }
  | { type: 'load'; value: number }

export interface SampleRequest {
  /** Stable key, doubling as the cache-relative path (e.g. "piano/C4.mp3"). */
  key: string
  url: string
}

export interface SampleResult {
  key: string
  /** Absolute local path, ready for the decoder. */
  path: string
  /** False when already cached — lets the UI show progress only when real. */
  downloaded: boolean
}

export interface SampleCacheInfo {
  path: string
  fileCount: number
  bytes: number
}
