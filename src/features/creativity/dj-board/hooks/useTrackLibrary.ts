import { useCallback, useEffect, useState } from 'react'
import { pickLibraryFolder, scanAudioFolder, type AudioTrack } from '@/integrations/audio-library'

const STORAGE_KEY = 'udaan.dj-board.library-folder'

/** Local audio library backed by a user-chosen folder — real filesystem scan, no bundled/web content. */
export function useTrackLibrary() {
  const [folderPath, setFolderPath] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  )
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [loading, setLoading] = useState(false)

  const rescan = useCallback(async (path: string) => {
    setLoading(true)
    try {
      const found = await scanAudioFolder(path)
      setTracks(found)
    } catch (err) {
      console.error('Failed to scan audio folder', err)
      setTracks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (folderPath) rescan(folderPath)
  }, [folderPath, rescan])

  const pickFolder = useCallback(async () => {
    const chosen = await pickLibraryFolder()
    if (!chosen) return
    localStorage.setItem(STORAGE_KEY, chosen)
    setFolderPath(chosen)
  }, [])

  return { folderPath, tracks, loading, pickFolder }
}
