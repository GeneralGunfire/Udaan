import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './documentReader.css'
import { WindowCloseIcon } from '@/shared/icons'
import { ReadingPane } from './components/ReadingPane'
import { PlaybackControls } from './components/PlaybackControls'
import { EmptyState } from './components/EmptyState'
import { ResumePrompt } from './components/ResumePrompt'
import { useDocumentPlayback } from './hooks/useDocumentPlayback'
import { parseDocument, UnsupportedFormatError, ScannedPdfError } from './lib/parseDocument'
import { getReadingPosition } from '@/integrations/document-reader/client'
import { listTtsVoices, type TtsVoice } from '@/integrations/local-model/client'
import type { ParsedDocument } from './lib/types'

interface DocumentReaderViewProps {
  onClose: () => void
  /** Set when opened via File Explorer's "Read Aloud" action — loads this document immediately instead of showing the empty state. */
  initialFilePath?: string
}

type LoadState = 'empty' | 'loading' | 'ready' | 'error'

export function DocumentReaderView({ onClose, initialFilePath }: DocumentReaderViewProps) {
  const [filePath, setFilePath] = useState<string | null>(initialFilePath ?? null)
  const [loadState, setLoadState] = useState<LoadState>(initialFilePath ? 'loading' : 'empty')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [document, setDocument] = useState<ParsedDocument | null>(null)
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [resumePosition, setResumePosition] = useState<{ paragraphIndex: number; sentenceIndex: number; scrollPosition: number } | null>(null)
  const [pendingResumeChoice, setPendingResumeChoice] = useState(false)
  const [startSentenceIndex, setStartSentenceIndex] = useState(0)

  const scrollPositionRef = useRef(0)
  const [initialScrollPosition, setInitialScrollPosition] = useState(0)

  useEffect(() => {
    listTtsVoices()
      .then(setVoices)
      .catch((err) => console.error('Failed to list TTS voices:', err))
  }, [])

  const loadDocument = useCallback(async (path: string) => {
    setFilePath(path)
    setLoadState('loading')
    setErrorMessage(null)
    setDocument(null)
    setPendingResumeChoice(false)

    try {
      const [parsed, savedPosition] = await Promise.all([
        parseDocument(path),
        getReadingPosition(path).catch(() => null),
      ])
      setDocument(parsed)
      setLoadState('ready')

      if (savedPosition) {
        setResumePosition(savedPosition)
        setPendingResumeChoice(true)
      } else {
        setStartSentenceIndex(0)
        setInitialScrollPosition(0)
      }
    } catch (err) {
      setLoadState('error')
      if (err instanceof ScannedPdfError || err instanceof UnsupportedFormatError) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage(
          `Couldn't open this document: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }, [])

  useEffect(() => {
    if (initialFilePath) void loadDocument(initialFilePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilePath])

  function findSentenceIndexForPosition(doc: ParsedDocument, paragraphIndex: number, sentenceIndex: number) {
    const idx = doc.sentences.findIndex(
      (s) => s.paragraphIndex === paragraphIndex && s.sentenceIndex === sentenceIndex,
    )
    return idx === -1 ? 0 : idx
  }

  function handleResume() {
    if (document && resumePosition) {
      setStartSentenceIndex(findSentenceIndexForPosition(document, resumePosition.paragraphIndex, resumePosition.sentenceIndex))
      setInitialScrollPosition(resumePosition.scrollPosition)
    }
    setPendingResumeChoice(false)
  }

  function handleStartOver() {
    setStartSentenceIndex(0)
    setInitialScrollPosition(0)
    setPendingResumeChoice(false)
  }

  const playback = useDocumentPlayback({
    document,
    documentKey: filePath,
    initialSentenceIndex: startSentenceIndex,
    scrollPositionRef,
  })

  const currentSentence = document?.sentences[playback.sentenceIndex] ?? null

  const progressLabel = useMemo(() => {
    if (!document || document.sentences.length === 0) return ''
    return `${playback.sentenceIndex + 1} / ${document.sentences.length}`
  }, [document, playback.sentenceIndex])

  const handleSeekToParagraph = useCallback(
    (paragraphIndex: number) => {
      if (!document) return
      const idx = document.sentences.findIndex((s) => s.paragraphIndex === paragraphIndex)
      if (idx !== -1) playback.seekToSentence(idx)
    },
    [document, playback],
  )

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: 'var(--color-bg-base)' }}>
      <div className="border-glass-border flex items-center justify-between border-b px-5 py-3">
        <h1 className="text-text-primary text-sm font-medium">
          {filePath ? filePath.split(/[/\\]/).pop() : 'Document Reader'}
        </h1>
        <button
          type="button"
          onClick={onClose}
          className="text-text-secondary hover:text-text-primary rounded-md p-1.5 transition-colors"
        >
          <WindowCloseIcon width={16} height={16} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {loadState === 'empty' && <EmptyState onFileSelected={loadDocument} />}

        {loadState === 'loading' && (
          <div className="flex h-full items-center justify-center">
            <span className="text-text-tertiary text-sm">Opening document…</span>
          </div>
        )}

        {loadState === 'error' && <EmptyState onFileSelected={loadDocument} errorMessage={errorMessage} />}

        {loadState === 'ready' && document && (
          <>
            {pendingResumeChoice && <ResumePrompt onResume={handleResume} onStartOver={handleStartOver} />}
            <ReadingPane
              document={document}
              currentSentence={currentSentence}
              onSeekToParagraph={handleSeekToParagraph}
              scrollPositionRef={scrollPositionRef}
              initialScrollPosition={initialScrollPosition}
            />
          </>
        )}
      </div>

      {playback.error && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-5 py-2 text-sm text-red-300">
          {playback.error}
        </div>
      )}

      {loadState === 'ready' && document && voices.length > 0 && (
        <PlaybackControls
          status={playback.status}
          voices={voices}
          voiceId={playback.voiceId}
          speed={playback.speed}
          volume={playback.volume}
          progressLabel={progressLabel}
          onTogglePlayPause={playback.togglePlayPause}
          onStop={playback.stop}
          onSkipForwardSentence={playback.skipForwardSentence}
          onSkipBackSentence={playback.skipBackSentence}
          onSkipForwardParagraph={playback.skipForwardParagraph}
          onSkipBackParagraph={playback.skipBackParagraph}
          onVoiceChange={playback.setVoiceId}
          onSpeedChange={playback.setSpeed}
          onVolumeChange={playback.setVolume}
        />
      )}
    </div>
  )
}
