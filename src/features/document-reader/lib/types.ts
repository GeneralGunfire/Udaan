export type DocumentFormat = 'txt' | 'md' | 'pdf' | 'docx'

export interface Sentence {
  paragraphIndex: number
  sentenceIndex: number
  text: string
}

/** A parsed, ready-to-read document: TTS-ready sentence stream plus enough info for the rendered view to map highlight-sync/click-to-seek back onto real DOM/PDF positions. */
export interface ParsedDocument {
  format: DocumentFormat
  /** Clean paragraphs, extracted per-format (stripped of markup/table noise) — the TTS source of truth. */
  paragraphs: string[]
  /** Paragraphs split into sentences, flattened — this is the actual playback queue. */
  sentences: Sentence[]
  /** Rendered HTML for docx/md (mammoth/marked output, each paragraph wrapped with data-para-index). Undefined for pdf (rendered via canvas instead) and txt (rendered as plain text directly from `paragraphs`). */
  renderedHtml?: string
  /** Raw PDF bytes for pdfjs-dist to render page-by-page. Only set for format 'pdf'. */
  pdfBytes?: ArrayBuffer
  warning?: string
}
