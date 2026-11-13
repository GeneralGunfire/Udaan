import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { NowPlaying } from './MediaPanel'

export interface NowPlayingState {
  media: NowPlaying | null
  /** False until the first answer arrives, so "nothing playing" doesn't flash. */
  loaded: boolean
  /** Playback position in ms, advanced locally between polls. */
  positionMs: number | null
  /** Optimistically pins the position after a seek until the next poll. */
  pin: (ms: number) => void
}

/**
 * Polls the system's media session and keeps a smooth playback position in
 * between polls (the OS only reports a snapshot), so a progress bar can
 * move every frame without hammering the shell command.
 */
export function useNowPlaying(pollMs: number, tickMs = 250): NowPlayingState {
  const [media, setMedia] = useState<NowPlaying | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [positionMs, setPositionMs] = useState<number | null>(null)
  const anchor = useRef<{ pos: number; at: number } | null>(null)
  const mediaRef = useRef<NowPlaying | null>(null)

  useEffect(() => {
    let stopped = false
    let t: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const m = await invoke<NowPlaying | null>('shell_now_playing')
        if (stopped) return
        mediaRef.current = m
        setMedia(m)
        anchor.current = m?.positionMs != null ? { pos: m.positionMs, at: performance.now() } : null
        setPositionMs(m?.positionMs ?? null)
      } catch {
        if (!stopped) {
          mediaRef.current = null
          setMedia(null)
        }
      }
      if (!stopped) {
        setLoaded(true)
        t = setTimeout(poll, pollMs)
      }
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(t)
    }
  }, [pollMs])

  useEffect(() => {
    const id = setInterval(() => {
      const a = anchor.current
      const m = mediaRef.current
      if (!a || !m || m.durationMs == null) return
      const pos = m.playing ? a.pos + (performance.now() - a.at) : a.pos
      setPositionMs(Math.min(m.durationMs, pos))
    }, tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  const pin = (ms: number) => {
    anchor.current = { pos: ms, at: performance.now() }
    setPositionMs(ms)
  }

  return { media, loaded, positionMs, pin }
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
