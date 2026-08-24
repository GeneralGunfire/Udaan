import { useEffect, useMemo, useRef } from 'react'
import { PdfPageRenderer } from './PdfPageRenderer'
import type { ParsedDocument, Sentence } from '../lib/types'

interface ReadingPaneProps {
  document: ParsedDocument
  currentSentence: Sentence | null
  onSeekToParagraph: (paragraphIndex: number) => void
  scrollPositionRef: React.MutableRefObject<number>
  initialScrollPosition: number
}

/**
 * The main reading pane — renders the document with its real formatting
 * (docx/md as formatted HTML, PDF as native canvas pages, txt as plain
 * text), highlights the paragraph currently being read, and turns a click
 * anywhere in the text into a seek to that paragraph's first sentence.
 *
 * The "page" itself is dark (not a light page-on-dark-chrome look) —
 * formatted text (docx/md/txt) gets a dark background + white foreground
 * regardless of the source document's own colors, since headings/bold/etc.
 * are just DOM structure at that point and easy to recolor. PDF pages are
 * literal rendered pixels (baked-in white background), so those get a CSS
 * invert+hue-rotate filter instead — the standard "dark mode PDF viewer"
 * trick that flips luminance (white page → dark, black text → light) while
 * roughly preserving photo/image colors.
 */
export function ReadingPane({
  document: parsedDocument,
  currentSentence,
  onSeekToParagraph,
  scrollPositionRef,
  initialScrollPosition,
}: ReadingPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const appliedInitialScroll = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onScroll() {
      if (el) scrollPositionRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollPositionRef])

  useEffect(() => {
    if (appliedInitialScroll.current) return
    if (scrollRef.current && initialScrollPosition > 0) {
      scrollRef.current.scrollTop = initialScrollPosition
    }
    appliedInitialScroll.current = true
  }, [initialScrollPosition])

  // Keep the highlighted paragraph in view as playback advances, without
  // fighting a user who's manually scrolled elsewhere to read ahead —
  // only auto-scroll when the highlighted node isn't already visible.
  useEffect(() => {
    if (currentSentence == null) return
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector(`[data-para-index="${currentSentence.paragraphIndex}"]`)
    if (!target) return
    const targetRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const isVisible = targetRect.top >= containerRect.top && targetRect.bottom <= containerRect.bottom
    if (!isVisible) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentSentence])

  function handleClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest('[data-para-index]')
    if (!target) return
    const index = Number(target.getAttribute('data-para-index'))
    if (!Number.isNaN(index)) onSeekToParagraph(index)
  }

  const highlightIndex = currentSentence?.paragraphIndex ?? -1

  return (
    <div
      ref={scrollRef}
      className="doc-reader-scroll h-full w-full overflow-y-auto px-6 py-10 md:px-16"
      style={{ backgroundColor: 'var(--color-bg-base)' }}
    >
      <div
        className="mx-auto max-w-3xl rounded-xl px-10 py-12 shadow-2xl"
        style={{
          backgroundColor: '#1c2029',
          color: '#f2f3f5',
          minHeight: '60vh',
          border: '1px solid rgb(255 255 255 / 8%)',
        }}
        onClick={handleClick}
      >
        {parsedDocument.format === 'pdf' && parsedDocument.pdfBytes ? (
          <PdfPageRenderer
            pdfBytes={parsedDocument.pdfBytes}
            paragraphs={parsedDocument.paragraphs}
            highlightParagraphIndex={highlightIndex}
            onSeekToParagraph={onSeekToParagraph}
          />
        ) : parsedDocument.renderedHtml ? (
          <FormattedHtml html={parsedDocument.renderedHtml} highlightIndex={highlightIndex} />
        ) : (
          <PlainText paragraphs={parsedDocument.paragraphs} highlightIndex={highlightIndex} />
        )}
      </div>
    </div>
  )
}

function FormattedHtml({ html, highlightIndex }: { html: string; highlightIndex: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current
    if (!container) return
    for (const el of Array.from(container.querySelectorAll('[data-para-index]'))) {
      const isCurrent = el.getAttribute('data-para-index') === String(highlightIndex)
      el.classList.toggle('doc-reader-highlight', isCurrent)
    }
  }, [highlightIndex])

  return <div ref={ref} className="doc-reader-content" dangerouslySetInnerHTML={{ __html: html }} />
}

function PlainText({ paragraphs, highlightIndex }: { paragraphs: string[]; highlightIndex: number }) {
  const items = useMemo(() => paragraphs, [paragraphs])
  return (
    <div className="doc-reader-content">
      {items.map((p, i) => (
        <p
          key={i}
          data-para-index={i}
          className={i === highlightIndex ? 'doc-reader-highlight' : undefined}
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {p}
        </p>
      ))}
    </div>
  )
}
