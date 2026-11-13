import { useCallback, useEffect, useState } from 'react'
import {
  getStatus,
  startRecording,
  stopRecording,
  openDownloadsFolder,
  renameRecording,
  onRecorderEvent,
  type RecorderState,
  type StopReason,
} from '@/integrations/audio-recorder/client'

export interface RecorderNotice {
  path: string
  reason: StopReason
}

/** Shown right after a recording stops, before the final save notice —
 * lets the user replace the default timestamp filename with a real name.
 * `defaultName` is the timestamp name with its extension stripped, ready
 * to drop straight into a text field. */
export interface RenamePrompt {
  path: string
  defaultName: string
  reason: StopReason
}

function fileStem(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path
  return fileName.replace(/\.mp3$/i, '')
}

/**
 * Shared recorder state, subscribed to the backend's broadcast events
 * (audio-recorder:event) rather than polling — the same hook is used by
 * both the Launchpad overlay and the taskbar toggle so they always agree
 * on whether a recording is in progress, since the Rust side is the single
 * source of truth (one recording can be running at a time, started from
 * either surface).
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [levelDbfs, setLevelDbfs] = useState(-120)
  const [error, setError] = useState<string | null>(null)
  const [renamePrompt, setRenamePrompt] = useState<RenamePrompt | null>(null)
  const [notice, setNotice] = useState<RecorderNotice | null>(null)
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    getStatus()
      .then((status) => {
        if (cancelled) return
        setState(status.state)
        setElapsedSeconds(status.elapsedSeconds)
      })
      .catch((err) => console.error('Failed to read recorder status:', err))

    onRecorderEvent((event) => {
      switch (event.kind) {
        case 'started':
          setState('recording')
          setElapsedSeconds(0)
          setError(null)
          setNotice(null)
          setRenamePrompt(null)
          break
        case 'progress':
          setElapsedSeconds(event.elapsedSeconds)
          setLevelDbfs(event.levelDbfs)
          break
        case 'stopped':
          setState('idle')
          setLevelDbfs(-120)
          // Ask for a name before showing the final "saved" confirmation —
          // per the request, naming should happen right after stop rather
          // than only offering an after-the-fact rename option.
          setRenamePrompt({ path: event.path, defaultName: fileStem(event.path), reason: event.reason })
          break
        case 'error':
          setState('idle')
          setLevelDbfs(-120)
          setError(event.message)
          break
      }
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setNotice(null)
    setRenamePrompt(null)
    try {
      const status = await startRecording()
      setState(status.state)
      setElapsedSeconds(status.elapsedSeconds)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const stop = useCallback(async () => {
    try {
      await stopRecording()
      // The real state transition arrives via the "stopped" event once the
      // capture thread finishes flushing/finalizing the file — this call
      // only requests the stop, it doesn't mean the file is done yet.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const confirmRename = useCallback(
    async (name: string) => {
      if (!renamePrompt) return
      setRenaming(true)
      try {
        const finalPath = await renameRecording(renamePrompt.path, name)
        setNotice({ path: finalPath, reason: renamePrompt.reason })
      } catch (err) {
        // Renaming failing (e.g. an invalid name) shouldn't lose the
        // recording — fall back to showing it saved under its original
        // timestamp name rather than leaving the user stuck.
        console.error('Failed to rename recording:', err)
        setNotice({ path: renamePrompt.path, reason: renamePrompt.reason })
      } finally {
        setRenaming(false)
        setRenamePrompt(null)
      }
    },
    [renamePrompt],
  )

  const skipRename = useCallback(() => {
    if (!renamePrompt) return
    setNotice({ path: renamePrompt.path, reason: renamePrompt.reason })
    setRenamePrompt(null)
  }, [renamePrompt])

  const openDownloads = useCallback(() => {
    openDownloadsFolder().catch((err) => console.error('Failed to open Downloads folder:', err))
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])
  const dismissError = useCallback(() => setError(null), [])

  return {
    state,
    elapsedSeconds,
    levelDbfs,
    error,
    renamePrompt,
    renaming,
    notice,
    start,
    stop,
    confirmRename,
    skipRename,
    openDownloads,
    dismissNotice,
    dismissError,
  }
}
