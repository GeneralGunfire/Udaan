import { useCallback, useState } from 'react'
import type { AssetEntry } from '@/integrations/asset-library'
import { defaultExportSettings, type ExportSettings, type TimelineClip } from './types'

let clipIdCounter = 0
function nextClipId() {
  clipIdCounter += 1
  return `clip-${clipIdCounter}`
}

/**
 * Timeline/state scaffold only — no real media decode or rendering.
 * TODO(real video engine): clip duration is a placeholder (60s) since
 * nothing here probes the actual file; timeline math, trimming, and
 * export are all UI-only until a real engine choice is made (see
 * NOTES.md — this needs direct hardware input before it can be built).
 */
export function useVideoEditorState() {
  const [clips, setClips] = useState<TimelineClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playheadSeconds, setPlayheadSeconds] = useState(0)
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExportSettings())

  const addClip = useCallback((asset: AssetEntry, track = 0) => {
    const clip: TimelineClip = {
      id: nextClipId(),
      assetPath: asset.path,
      fileName: asset.fileName,
      durationSeconds: 60, // TODO: real media probing (ffprobe or similar) for actual duration
      track,
    }
    setClips((prev) => [...prev, clip])
  }, [])

  const removeClip = useCallback((clipId: string) => {
    setClips((prev) => prev.filter((c) => c.id !== clipId))
    setSelectedClipId((prev) => (prev === clipId ? null : prev))
  }, [])

  const totalDuration = clips.reduce((max, c) => Math.max(max, c.durationSeconds), 0)

  return {
    clips,
    selectedClipId,
    setSelectedClipId,
    playheadSeconds,
    setPlayheadSeconds,
    exportSettings,
    setExportSettings,
    addClip,
    removeClip,
    totalDuration,
  }
}
