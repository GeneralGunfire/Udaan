import { useCallback, useEffect, useRef, useState } from 'react'
import { PlaybackEngine, type PlaybackStatus } from '../lib/playbackEngine'
import { saveReadingPosition } from '@/integrations/document-reader/client'
import type { ParsedDocument } from '../lib/types'

const SAVE_INTERVAL_MS = 5000

export interface UseDocumentPlaybackOptions {
  document: ParsedDocument | null
  documentKey: string | null
  initialSentenceIndex?: number
  scrollPositionRef: React.MutableRefObject<number>
}

export function useDocumentPlayback({
  document: parsedDocument,
  documentKey,
  initialSentenceIndex = 0,
  scrollPositionRef,
}: UseDocumentPlaybackOptions) {
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [sentenceIndex, setSentenceIndex] = useState(initialSentenceIndex)
  const [voiceId, setVoiceIdState] = useState('en_US-lessac-medium')
  const [speed, setSpeedState] = useState(1)
  const [volume, setVolumeState] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const engineRef = useRef<PlaybackEngine | null>(null)

  // Engine is created once and kept for the component's lifetime; document
  // loads/voice/speed/volume changes all mutate it in place rather than
  // recreating it, so in-flight synthesis/playback state isn't discarded.
  if (!engineRef.current) {
    engineRef.current = new PlaybackEngine(
      {
        onStatusChange: setStatus,
        onSentenceChange: setSentenceIndex,
        onError: setError,
      },
      voiceId,
      speed,
      volume,
    )
  }

  useEffect(() => {
    return () => engineRef.current?.destroy()
  }, [])

  useEffect(() => {
    if (!parsedDocument) return
    engineRef.current?.load(parsedDocument.sentences, initialSentenceIndex)
    setSentenceIndex(initialSentenceIndex)
    setStatus('idle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedDocument])

  // Periodic + on-unmount resume-position save. Saving on unmount alone
  // would lose the position on a crash or hard app-close (not just a
  // graceful component unmount), so this also fires on an interval —
  // belt-and-suspenders per the "don't lose position on close" requirement.
  useEffect(() => {
    if (!documentKey) return
    const interval = setInterval(() => {
      const sentence = parsedDocument?.sentences[sentenceIndex]
      if (!sentence) return
      void saveReadingPosition(documentKey, sentence.paragraphIndex, sentence.sentenceIndex, scrollPositionRef.current)
    }, SAVE_INTERVAL_MS)
    return () => {
      clearInterval(interval)
      const sentence = parsedDocument?.sentences[sentenceIndex]
      if (sentence) {
        void saveReadingPosition(documentKey, sentence.paragraphIndex, sentence.sentenceIndex, scrollPositionRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, parsedDocument, sentenceIndex])

  const play = useCallback(() => {
    setError(null)
    void engineRef.current?.play()
  }, [])

  const pause = useCallback(() => engineRef.current?.pause(), [])
  const resume = useCallback(() => void engineRef.current?.resume(), [])
  const stop = useCallback(() => engineRef.current?.stop(), [])
  const togglePlayPause = useCallback(() => {
    if (status === 'playing' || status === 'buffering') {
      pause()
    } else if (status === 'paused') {
      resume()
    } else {
      play()
    }
  }, [status, pause, resume, play])

  const skipForwardSentence = useCallback(() => void engineRef.current?.skipForwardSentence(), [])
  const skipBackSentence = useCallback(() => void engineRef.current?.skipBackSentence(), [])
  const skipForwardParagraph = useCallback(() => void engineRef.current?.skipForwardParagraph(), [])
  const skipBackParagraph = useCallback(() => void engineRef.current?.skipBackParagraph(), [])
  const seekToSentence = useCallback((index: number) => void engineRef.current?.skipToSentence(index), [])

  const setVoiceId = useCallback((id: string) => {
    setVoiceIdState(id)
    engineRef.current?.setVoice(id)
  }, [])

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s)
    engineRef.current?.setSpeed(s)
  }, [])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    engineRef.current?.setVolume(v)
  }, [])

  return {
    status,
    sentenceIndex,
    voiceId,
    speed,
    volume,
    error,
    togglePlayPause,
    stop,
    skipForwardSentence,
    skipBackSentence,
    skipForwardParagraph,
    skipBackParagraph,
    seekToSentence,
    setVoiceId,
    setSpeed,
    setVolume,
  }
}
