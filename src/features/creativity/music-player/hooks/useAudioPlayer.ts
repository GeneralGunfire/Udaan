import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioTrack } from '@/integrations/audio-library'
import { readAudioFileBytes } from '@/integrations/audio-library'

export type RepeatMode = 'off' | 'all' | 'one'

/**
 * Real single-track Web Audio playback engine for the sequential music
 * player — separate AudioContext graph from the DJ Board's dual-deck
 * mixer (this is play/pause/next/prev, not a mixing console).
 */
export function useAudioPlayer(tracks: AudioTrack[]) {
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const startedAtContextTimeRef = useRef(0)
  const startedAtOffsetRef = useRef(0)

  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(0.85)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [error, setError] = useState<string | null>(null)

  function getContext(): AudioContext {
    if (!contextRef.current) {
      contextRef.current = new AudioContext()
      gainRef.current = contextRef.current.createGain()
      gainRef.current.connect(contextRef.current.destination)
      gainRef.current.gain.value = volume
    }
    return contextRef.current
  }

  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null
      try {
        sourceRef.current.stop()
      } catch {
        // already stopped
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
  }, [])

  const advance = useCallback(
    (direction: 1 | -1) => {
      if (tracks.length === 0) return
      setCurrentIndex((prev) => {
        const cur = prev ?? 0
        if (shuffle) {
          if (tracks.length === 1) return 0
          let next = cur
          while (next === cur) next = Math.floor(Math.random() * tracks.length)
          return next
        }
        const next = cur + direction
        if (next < 0) return repeat === 'all' ? tracks.length - 1 : 0
        if (next >= tracks.length) return repeat === 'all' ? 0 : cur
        return next
      })
    },
    [tracks.length, shuffle, repeat],
  )

  const loadAndPlay = useCallback(
    async (index: number) => {
      const track = tracks[index]
      if (!track) return
      setIsLoading(true)
      setError(null)
      stopSource()
      try {
        const ctx = getContext()
        if (ctx.state === 'suspended') await ctx.resume()
        const bytes = await readAudioFileBytes(track.path)
        const arrayBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer
        const buffer = await ctx.decodeAudioData(arrayBuffer)
        bufferRef.current = buffer
        setDuration(buffer.duration)

        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.connect(gainRef.current!)
        src.start(0)
        sourceRef.current = src
        startedAtContextTimeRef.current = ctx.currentTime
        startedAtOffsetRef.current = 0
        setCurrentTime(0)
        setIsPlaying(true)

        src.onended = () => {
          if (sourceRef.current !== src) return
          if (repeat === 'one') {
            loadAndPlay(index)
          } else {
            advance(1)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setIsPlaying(false)
      } finally {
        setIsLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, repeat, advance, stopSource],
  )

  // Auto-advance load: whenever currentIndex changes (via next/prev/select), load it.
  const pendingIndexRef = useRef<number | null>(null)
  useEffect(() => {
    if (currentIndex === null) return
    if (pendingIndexRef.current === currentIndex) return
    pendingIndexRef.current = currentIndex
    loadAndPlay(currentIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex])

  const selectTrack = useCallback((index: number) => {
    setCurrentIndex(index)
  }, [])

  const togglePlay = useCallback(async () => {
    const ctx = contextRef.current
    if (!ctx || !bufferRef.current) {
      if (tracks.length > 0) selectTrack(currentIndex ?? 0)
      return
    }
    if (isPlaying) {
      startedAtOffsetRef.current += ctx.currentTime - startedAtContextTimeRef.current
      stopSource()
      setIsPlaying(false)
    } else {
      await ctx.resume()
      const src = ctx.createBufferSource()
      src.buffer = bufferRef.current
      src.connect(gainRef.current!)
      src.start(0, startedAtOffsetRef.current)
      sourceRef.current = src
      startedAtContextTimeRef.current = ctx.currentTime
      setIsPlaying(true)
      src.onended = () => {
        if (sourceRef.current !== src) return
        if (repeat === 'one') {
          if (currentIndex !== null) loadAndPlay(currentIndex)
        } else {
          advance(1)
        }
      }
    }
  }, [isPlaying, tracks.length, currentIndex, selectTrack, stopSource, repeat, advance, loadAndPlay])

  const seek = useCallback(
    (seconds: number) => {
      const ctx = contextRef.current
      if (!ctx || !bufferRef.current) return
      const clamped = Math.max(0, Math.min(seconds, bufferRef.current.duration))
      stopSource()
      const src = ctx.createBufferSource()
      src.buffer = bufferRef.current
      src.connect(gainRef.current!)
      src.start(0, clamped)
      sourceRef.current = src
      startedAtContextTimeRef.current = ctx.currentTime
      startedAtOffsetRef.current = clamped
      setCurrentTime(clamped)
      if (isPlaying) {
        src.onended = () => {
          if (sourceRef.current !== src) return
          if (repeat === 'one') {
            if (currentIndex !== null) loadAndPlay(currentIndex)
          } else {
            advance(1)
          }
        }
      }
    },
    [isPlaying, stopSource, repeat, currentIndex, loadAndPlay, advance],
  )

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    if (gainRef.current) gainRef.current.gain.value = clamped
  }, [])

  // Live playhead ticker
  useEffect(() => {
    const id = window.setInterval(() => {
      const ctx = contextRef.current
      if (!ctx || !isPlaying) return
      setCurrentTime(startedAtOffsetRef.current + (ctx.currentTime - startedAtContextTimeRef.current))
    }, 200)
    return () => window.clearInterval(id)
  }, [isPlaying])

  useEffect(() => {
    return () => {
      stopSource()
      contextRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    currentIndex,
    currentTrack: currentIndex !== null ? (tracks[currentIndex] ?? null) : null,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    shuffle,
    repeat,
    error,
    selectTrack,
    togglePlay,
    next: () => advance(1),
    prev: () => advance(-1),
    seek,
    setVolume,
    setShuffle,
    setRepeat,
  }
}
