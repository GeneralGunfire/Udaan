import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './documentReader.css'
import { ReadingPane } from './components/ReadingPane'
import { PlaybackControls } from './components/PlaybackControls'
import { EmptyState } from './components/EmptyState'
import { ResumePrompt } from './components/ResumePrompt'
import { useDocumentPlayback } from './hooks/useDocumentPlayback'
import { parseDocument, UnsupportedFormatError, ScannedPdfError } from './lib/parseDocument'
import { getReadingPosition } from '@/integrations/document-reader/client'
import { listTtsVoices, type TtsVoice } from '@/integrations/local-model/client'
import type { ParsedDocument } from './lib/types'
import { ViewShell } from '@/shared/components/ui/view'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

interface DocumentReaderViewProps {
  /** Part of BaseAppProps (AppHost always passes it) — unused here now
   *  that AppTitleBar is the one shared close affordance every app view
   *  uses, kept for contract consistency. */
  onClose: () => void
  /** Set when opened via File Explorer's "Read Aloud" action — loads this document immediately instead of showing the empty state. */
  initialFilePath?: string
}

type LoadState = 'empty' | 'loading' | 'ready' | 'error'

export function DocumentReaderView({ initialFilePath }: DocumentReaderViewProps) {
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

  // Keyboard: Space play/pause, arrows by sentence, Shift+arrows by paragraph.
  useEffect(() => {
    if (!document) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === ' ') playback.togglePlayPause()
      else if (e.key === 'ArrowRight') (e.shiftKey ? playback.skipForwardParagraph : playback.skipForwardSentence)()
      else if (e.key === 'ArrowLeft') (e.shiftKey ? playback.skipBackParagraph : playback.skipBackSentence)()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [document, playback])

  const pickFile = async () => {
    const selected = await openDialog({ multiple: false, filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }] })
    if (typeof selected === 'string') void loadDocument(selected)
  }

  return (
    <ViewShell className="bg-[#1c1d21]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">{filePath ? filePath.split(/[/\\]/).pop() : 'Reader'}</p>
          <p className="text-[11.5px] text-white/45">
            {document
              ? `${document.format.toUpperCase()} · ${document.sentences.length} sentences · about ${Math.max(1, Math.round(((document.sentences.length - playback.sentenceIndex) * 4.5) / 60 / playback.speed))} min left`
              : 'Open a PDF, Word, text or Markdown file to have it read aloud'}
          </p>
        </div>
        <button type="button" onClick={() => void pickFile()} className="h-9 rounded-[9px] bg-white/[0.08] px-4 text-[13px] font-medium text-white hover:bg-white/[0.14]">
          Open…
        </button>
      </header>
      {document && (
        <div className="h-[3px] shrink-0 bg-white/[0.04]">
          <div className="h-full bg-[var(--color-accent)] transition-[width] duration-500 ease-out" style={{ width: `${((playback.sentenceIndex + 1) / Math.max(1, document.sentences.length)) * 100}%` }} />
        </div>
      )}

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

        {/* Floating rather than an inline flex sibling below this pane, so
            a playback failure is never squeezed out of view regardless of
            document length or viewport height — this is what hid the CSP
            media-src bug for as long as it went unnoticed. */}
        {playback.error && (
          <div className="absolute inset-x-0 bottom-0 z-10 border-t border-danger-border bg-danger-surface px-5 py-2 text-sm text-danger shadow-lg">
            {playback.error}
          </div>
        )}
      </div>

      {loadState === 'ready' && document && voices.length > 0 && (
        <PlaybackControls
          status={playback.status}
          voices={voices}
          voiceId={playback.voiceId}
          speed={playback.speed}
          volume={playback.volume}
          progressLabel={progressLabel}
          sentenceIndex={playback.sentenceIndex}
          sentenceCount={document.sentences.length}
          onSeek={playback.seekToSentence}
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
    </ViewShell>
  )
}
