import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type RecorderState = 'idle' | 'recording'
export type StopReason = 'manual' | 'silence'

export interface RecorderStatus {
  state: RecorderState
  elapsedSeconds: number
}

export type RecorderEvent =
  | { kind: 'started'; path: string }
  | { kind: 'progress'; elapsedSeconds: number; levelDbfs: number }
  | { kind: 'stopped'; path: string; reason: StopReason }
  | { kind: 'error'; message: string }

interface RawRecorderEvent {
  kind: 'started' | 'progress' | 'stopped' | 'error'
  path?: string
  elapsed_seconds?: number
  level_dbfs?: number
  reason?: StopReason
  message?: string
}

const EVENT_NAME = 'audio-recorder:event'

function normalizeEvent(raw: RawRecorderEvent): RecorderEvent {
  switch (raw.kind) {
    case 'started':
      return { kind: 'started', path: raw.path ?? '' }
    case 'progress':
      return { kind: 'progress', elapsedSeconds: raw.elapsed_seconds ?? 0, levelDbfs: raw.level_dbfs ?? -120 }
    case 'stopped':
      return { kind: 'stopped', path: raw.path ?? '', reason: raw.reason ?? 'manual' }
    case 'error':
      return { kind: 'error', message: raw.message ?? 'Unknown recorder error' }
  }
}

export function getStatus(): Promise<RecorderStatus> {
  return invoke('audio_recorder_status')
}

export function startRecording(): Promise<RecorderStatus> {
  return invoke('audio_recorder_start')
}

export function stopRecording(): Promise<RecorderStatus> {
  return invoke('audio_recorder_stop')
}

export function openDownloadsFolder(): Promise<void> {
  return invoke('audio_recorder_open_downloads')
}

/** Renames a just-finished recording (plain filesystem rename, same
 * directory, instant regardless of length) and returns the resulting
 * path — collides-safe, appends " (1)" etc. rather than overwriting. */
export function renameRecording(oldPath: string, newName: string): Promise<string> {
  return invoke('audio_recorder_rename', { oldPath, newName })
}

/** Subscribes to recorder lifecycle events (started/progress/stopped/error)
 * — broadcast via app.emit so both the main window's Launchpad overlay and
 * the separate taskbar window can each listen and stay in sync without
 * polling invoke() on a timer. */
export async function onRecorderEvent(callback: (event: RecorderEvent) => void): Promise<() => void> {
  return listen<RawRecorderEvent>(EVENT_NAME, (event) => callback(normalizeEvent(event.payload)))
}
