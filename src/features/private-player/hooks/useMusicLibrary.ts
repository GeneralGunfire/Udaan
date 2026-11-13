import { useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { scanFolder, getSettings, saveSettings, importFile } from '@/integrations/audio-library/client'
import type { AudioTrack } from '../lib/types'
import type { PlayerEngine } from './usePlayerEngine'

/** Points at Private Player's original on-disk library by default, per the
 * agreed integration approach — files stay in place, Udaan reads them
 * directly rather than copying ~1.3GB into app_data_dir(). The user can
 * change this via the folder-picker button at any time; the chosen path is
 * then what's persisted. */
const DEFAULT_MUSIC_FOLDER = 'C:\\CODING\\Finished\\PrivatePlayer\\public\\music'

export interface MusicLibrary {
  tracks: AudioTrack[]
  musicFolder: string | null
  loading: boolean
  chooseFolder: () => Promise<void>
  /** Picks one or more audio files, copies each into the music folder
   * permanently (via the backend's audio_library_import_file), and adds
   * them to the in-memory track list without a full re-scan. */
  addFiles: () => Promise<void>
  importing: boolean
}

/**
 * Library scan + folder selection, lifted to provider scope (mounted once,
 * at app startup) alongside the playback engine rather than inside
 * PrivatePlayerView — the resume-last-track logic needs the scanned track
 * list to exist exactly once for the whole session, not re-run every time
 * the overlay is opened/closed.
 */
export function useMusicLibrary(engine: PlayerEngine): MusicLibrary {
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [musicFolder, setMusicFolder] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const initedRef = useRef(false)
  const musicFolderRef = useRef<string | null>(null)
  musicFolderRef.current = musicFolder

  async function loadFolder(folderPath: string): Promise<AudioTrack[]> {
    setLoading(true)
    try {
      const scanned = await scanFolder(folderPath)
      setTracks(scanned)
      setMusicFolder(folderPath)
      return scanned
    } catch (err) {
      console.error('Failed to scan music folder:', err)
      return []
    } finally {
      setLoading(false)
    }
  }

  async function chooseFolder() {
    const folder = await open({ directory: true, multiple: false, title: 'Choose Music Folder' })
    if (!folder || Array.isArray(folder)) return
    const scanned = await loadFolder(folder)
    const current = await getSettings()
    await saveSettings({ ...current, musicFolder: folder })
    if (scanned.length > 0) engine.setQueue(scanned, 0)
  }

  async function addFiles() {
    const folder = musicFolderRef.current
    if (!folder) return
    const picked = await open({
      multiple: true,
      title: 'Add Songs',
      // Two filter entries (not one with every extension merged) so
      // Windows' native picker shows an "Audio Files" option AND exposes
      // Windows' own "All Files" entry — without a second, broader filter
      // some Windows configurations only ever show the OS default filter
      // regardless of what's requested, silently hiding files whose
      // extension doesn't exactly case-match one of ours (e.g. a
      // downloaded .MP3, or one with an unlisted extension).
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'MP3', 'WAV', 'OGG', 'FLAC', 'M4A', 'AAC'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!picked) return
    const paths = Array.isArray(picked) ? picked : [picked]
    if (paths.length === 0) return

    setImporting(true)
    try {
      const imported: AudioTrack[] = []
      for (const path of paths) {
        try {
          imported.push(await importFile(path, folder))
        } catch (err) {
          console.error(`Failed to import ${path}:`, err)
        }
      }
      if (imported.length > 0) {
        setTracks((prev) => [...prev, ...imported].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())))
      }
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true

    async function init() {
      const settings = await getSettings()
      const folder = settings.musicFolder ?? DEFAULT_MUSIC_FOLDER
      const scanned = await loadFolder(folder)
      if (!settings.musicFolder) {
        await saveSettings({ ...settings, musicFolder: folder })
      }
      if (scanned.length === 0) return

      const lastIndex = settings.lastTrackPath ? scanned.findIndex((t) => t.path === settings.lastTrackPath) : -1
      const startIndex = lastIndex >= 0 ? lastIndex : 0
      // Resume loaded but paused — the app starting up shouldn't blast
      // audio immediately; the user presses play deliberately.
      engine.setQueue(scanned, startIndex, { autoplay: false, startAtSeconds: settings.lastPositionSeconds })
    }
    init().catch((err) => console.error('Failed to initialize Private Player library:', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { tracks, musicFolder, loading, chooseFolder, addFiles, importing }
}
