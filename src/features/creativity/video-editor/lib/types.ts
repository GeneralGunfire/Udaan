export interface TimelineClip {
  id: string
  assetPath: string
  fileName: string
  /** Seconds — placeholder duration, not read from the real file. TODO: real media probing. */
  durationSeconds: number
  track: number
}

export type ExportFormat = 'mp4' | 'webm' | 'mov'
export type ExportResolution = '720p' | '1080p' | '4k'

export interface ExportSettings {
  format: ExportFormat
  resolution: ExportResolution
}

export function defaultExportSettings(): ExportSettings {
  return { format: 'mp4', resolution: '1080p' }
}
