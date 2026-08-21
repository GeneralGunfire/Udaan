import { useCallback, useEffect, useState } from 'react'
import {
  pickLibraryFolder,
  pickLibraryFiles,
  scanAudioFolder,
  type AudioTrack,
} from '@/integrations/audio-library'

const FOLDER_STORAGE_KEY = 'udaan.dj-board.library-folder'
const TRACKS_STORAGE_KEY = 'udaan.dj-board.library-tracks'

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
 * Local audio library — a persistent, growing list of tracks (real
 * filesystem metadata, no bundled/web content) that either a folder scan
 * or an individual/multi-file pick adds into, deduped by path. Persists
 * to localStorage so the library survives an app restart, per the
 * session-persistence request.
 */
export function useTrackLibrary() {
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
      console.error('Failed to scan audio folder', err)
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
        console.error('Failed to pick audio file(s)', err)
      } finally {
        setLoading(false)
      }
    },
    [addTracks],
  )

  const removeTrack = useCallback((path: string) => {
    setTracks((prev) => prev.filter((t) => t.path !== path))
  }, [])

  return { folderPath, tracks, loading, pickFolder, pickFiles, removeTrack }
}
