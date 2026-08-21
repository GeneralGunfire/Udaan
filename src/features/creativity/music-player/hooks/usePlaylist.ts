import { useCallback, useEffect, useState } from 'react'
import {
  pickLibraryFolder,
  pickLibraryFiles,
  scanAudioFolder,
  type AudioTrack,
} from '@/integrations/audio-library'

const FOLDER_STORAGE_KEY = 'udaan.music-player.library-folder'
const TRACKS_STORAGE_KEY = 'udaan.music-player.tracks'

function loadStoredTracks(): AudioTrack[] {
  try {
    const raw = localStorage.getItem(TRACKS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function dedupeByPath(tracks: AudioTrack[]): AudioTrack[] {
  const seen = new Map<string, AudioTrack>()
  for (const t of tracks) seen.set(t.path, t)
  return Array.from(seen.values())
}

/**
 * Local music library — a persistent, growing list of tracks, added to
 * by folder scan or individual/multi-file pick (reuses
 * integrations/audio-library, same as the DJ Board). No hardcoded track
 * list, no catalog reconstruction from any external source.
 */
export function usePlaylistLibrary() {
  const [folderPath, setFolderPath] = useState<string | null>(() =>
    localStorage.getItem(FOLDER_STORAGE_KEY),
  )
  const [tracks, setTracks] = useState<AudioTrack[]>(() => loadStoredTracks())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(tracks))
  }, [tracks])

  const addTracks = useCallback((found: AudioTrack[]) => {
    setTracks((prev) => dedupeByPath([...prev, ...found]))
  }, [])

  const pickFolder = useCallback(async () => {
    const chosen = await pickLibraryFolder()
    if (!chosen) return
    localStorage.setItem(FOLDER_STORAGE_KEY, chosen)
    setFolderPath(chosen)
    setLoading(true)
    try {
      const found = await scanAudioFolder(chosen)
      addTracks(found)
    } catch (err) {
      console.error('Failed to scan music folder', err)
    } finally {
      setLoading(false)
    }
  }, [addTracks])

  const pickFiles = useCallback(
    async (multiple: boolean) => {
      setLoading(true)
      try {
        const found = await pickLibraryFiles(multiple)
        addTracks(found)
      } catch (err) {
        console.error('Failed to pick music file(s)', err)
      } finally {
        setLoading(false)
      }
    },
    [addTracks],
  )

  return { folderPath, tracks, loading, pickFolder, pickFiles }
}
