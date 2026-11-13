import type { AudioTrack } from '@/integrations/audio-library/client'

export type { AudioTrack }

export interface Playlist {
  id: string
  name: string
  trackPaths: string[]
  createdAt: number
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--'
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
