import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface PdfPageRendererProps {
  pdfBytes: ArrayBuffer
  /** One paragraph per extracted PDF page (see extract_pdf in Rust — one page's text becomes one paragraph), so `paragraphs[i]` corresponds 1:1 to rendered page `i + 1`. */
  paragraphs: string[]
  highlightParagraphIndex: number
  onSeekToParagraph: (paragraphIndex: number) => void
}

/**
 * Renders actual PDF pages to canvas (native visual fidelity — images,
 * layout, fonts exactly as the source PDF has them) with page breaks
 * naturally preserved between pages, rather than reflowing extracted text.
 * The highlighted "paragraph" (== one full PDF page, since lopdf extracts
 * page-by-page rather than at finer granularity) gets an outline; clicking
 * anywhere on a page seeks playback to that page's text.
 */
export function PdfPageRenderer({
  pdfBytes,
  paragraphs,
  highlightParagraphIndex,
  onSeekToParagraph,
}: PdfPageRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let doc: pdfjsLib.PDFDocumentProxy | null = null

    async function render() {
      try {
        // pdfjs takes ownership of the buffer it's given (detaches it) — pass
        // a copy since `pdfBytes` may still be referenced elsewhere.
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) })
        doc = await loadingTask.promise
        if (cancelled) return
        setPageCount(doc.numPages)

        const container = containerRef.current
        if (!container) return
        container.innerHTML = ''

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          const page = await doc.getPage(pageNum)
          const viewport = page.getViewport({ scale: 1.5 })

          const pageWrapper = window.document.createElement('div')
          pageWrapper.setAttribute('data-para-index', String(pageNum - 1))
          pageWrapper.className = 'doc-reader-pdf-page'
          pageWrapper.style.position = 'relative'
          pageWrapper.style.marginBottom = '24px'
          pageWrapper.style.cursor = 'pointer'

          const surface = window.document.createElement('div')
          surface.className = 'doc-reader-pdf-page-surface'

          const canvas = window.document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.display = 'block'
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          surface.appendChild(canvas)
          pageWrapper.appendChild(surface)

          const ctx = canvas.getContext('2d')
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport, canvas }).promise
          }

          if (cancelled) return
          container.appendChild(pageWrapper)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render this PDF.')
        }
      }
    }

    void render()
    return () => {
      cancelled = true
      doc?.cleanup()
    }
  }, [pdfBytes])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    for (const el of Array.from(container.querySelectorAll('[data-para-index]'))) {
      const isCurrent = el.getAttribute('data-para-index') === String(highlightParagraphIndex)
      el.classList.toggle('doc-reader-pdf-page-active', isCurrent)
    }
  }, [highlightParagraphIndex, pageCount])

  function handleClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest('[data-para-index]')
    if (!target) return
    const index = Number(target.getAttribute('data-para-index'))
    if (!Number.isNaN(index) && paragraphs[index] !== undefined) onSeekToParagraph(index)
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm" style={{ color: 'var(--color-danger)' }}>
        {error}
      </div>
    )
  }

  return <div ref={containerRef} onClick={handleClick} />
}
