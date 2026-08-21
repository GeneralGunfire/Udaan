import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { AudioTrack } from './types'

/** Raw shape returned by the Rust `audio_library_scan_folder` command (serde snake_case). */
interface RawAudioTrackEntry {
  path: string
  file_name: string
  size_bytes: number
}

/** Opens the native folder picker and returns the chosen path, or null if cancelled. */
export async function pickLibraryFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false })
  if (typeof result === 'string') return result
  return null
}

/** Non-recursive scan of a folder for supported audio files (mp3/wav/ogg/flac/m4a/aac). */
export async function scanAudioFolder(folderPath: string): Promise<AudioTrack[]> {
  const raw = await invoke<RawAudioTrackEntry[]>('audio_library_scan_folder', {
    folderPath,
  })
  return raw.map((entry) => ({
    path: entry.path,
    fileName: entry.file_name,
    sizeBytes: entry.size_bytes,
  }))
}

/** Reads a track's raw bytes for local decode via the Web Audio API. */
export async function readAudioFileBytes(filePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('audio_library_read_file', {
    filePath,
  })
  return new Uint8Array(bytes)
}
