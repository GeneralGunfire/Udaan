import { invoke } from '@tauri-apps/api/core'

export interface AudioTrack {
  path: string
  fileName: string
  title: string
  artist: string
  album: string
  durationSeconds: number | null
  hasCoverArt: boolean
}

export interface PlayerSettings {
  musicFolder: string | null
  lastTrackPath: string | null
  lastPositionSeconds: number
  volume: number
  shuffle: boolean
  repeat: boolean
}

export interface StoredPlaylist {
  id: string
  name: string
  trackPaths: string[]
  createdAt: number
}

export interface DjPreset {
  id: string
  name: string
  settings: unknown
  createdAt: number
}

export function scanFolder(folderPath: string): Promise<AudioTrack[]> {
  return invoke('audio_library_scan_folder', { folderPath })
}

/** Returns [mimeType, bytes] for a track's embedded cover art, or null if it has none. */
export function readCover(filePath: string): Promise<[string, number[]] | null> {
  return invoke('audio_library_read_cover', { filePath })
}

export function getSettings(): Promise<PlayerSettings> {
  return invoke('audio_library_get_settings')
}

export function saveSettings(settings: PlayerSettings): Promise<void> {
  return invoke('audio_library_save_settings', { settings })
}

export function listPlaylists(): Promise<StoredPlaylist[]> {
  return invoke('audio_library_list_playlists')
}

export function savePlaylist(playlist: StoredPlaylist): Promise<void> {
  return invoke('audio_library_save_playlist', { playlist })
}

export function deletePlaylist(id: string): Promise<void> {
  return invoke('audio_library_delete_playlist', { id })
}

export function listFavorites(): Promise<string[]> {
  return invoke('audio_library_list_favorites')
}

export function setFavorite(trackPath: string, favorite: boolean): Promise<void> {
  return invoke('audio_library_set_favorite', { trackPath, favorite })
}

/** Copies a picked file into the music folder permanently and returns its
 * scanned AudioTrack — the file lives in the library from then on, no
 * re-picking needed on future launches. */
export function importFile(sourcePath: string, musicFolder: string): Promise<AudioTrack> {
  return invoke('audio_library_import_file', { sourcePath, musicFolder })
}

export function listDjPresets(): Promise<DjPreset[]> {
  return invoke('audio_library_list_dj_presets')
}

export function saveDjPreset(preset: DjPreset): Promise<void> {
  return invoke('audio_library_save_dj_preset', { preset })
}

export function deleteDjPreset(id: string): Promise<void> {
  return invoke('audio_library_delete_dj_preset', { id })
}

/** Musical analysis of one track — tempo, key, beatgrid anchor and
 * loudness. Computed in Rust (audio_library/analysis.rs) and cached in
 * SQLite, so the first call for a track costs a decode plus two DSP
 * passes and every later call is a lookup. */
export interface TrackAnalysis {
  bpm: number | null
  bpmConfidence: number
  /** Camelot wheel notation, e.g. "8A" — what DJs actually mix by. */
  camelotKey: string | null
  /** Musical spelling of the same key, e.g. "Am". */
  musicalKey: string | null
  keyConfidence: number
  firstBeatSeconds: number | null
  peak: number
  rms: number
}

/** Analyses a track, returning the cached result when one exists. Pass
 * `force` to recompute (e.g. after the file itself changed). */
export function analyzeTrack(trackPath: string, force = false): Promise<TrackAnalysis> {
  return invoke('audio_library_analyze_track', { trackPath, force })
}

/** Paths that already have cached analysis — lets the UI show coverage
 * across a library without one call per track. */
export function listAnalyzedPaths(): Promise<string[]> {
  return invoke('audio_library_list_analyzed')
}

export interface StemPaths {
  vocals: string
  drums: string
  bass: string
  other: string
}

/** What can be done with a track's stems right now. Discriminated on
 * `kind` so the UI must handle the model-missing case explicitly rather
 * than treating it as a generic failure. */
export type StemStatus =
  | { kind: 'ready'; paths: StemPaths }
  | { kind: 'notSeparated' }
  | { kind: 'modelMissing'; approxDownloadMb: number }
  | { kind: 'separating'; progress: number }
  | { kind: 'failed'; reason: string }

export function stemStatus(trackPath: string): Promise<StemStatus> {
  return invoke('audio_library_stem_status', { trackPath })
}

/** Starts separation. Currently always rejects — the playback path is
 * built but the model is not shipped; see src-tauri stems.rs. */
export function separateStems(trackPath: string): Promise<StemPaths> {
  return invoke('audio_library_separate_stems', { trackPath })
}

export function clearStems(trackPath: string): Promise<void> {
  return invoke('audio_library_clear_stems', { trackPath })
}

/** Bytes used by separated stems across the whole library. */
export function stemsDiskUsage(): Promise<number> {
  return invoke('audio_library_stems_disk_usage')
}
