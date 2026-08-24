import { invoke } from '@tauri-apps/api/core'

export interface ExtractedDocument {
  paragraphs: string[]
  warning?: string
}

/** Extracts clean, TTS-ready paragraphs from a .txt or .pdf file via the Rust backend (lopdf for PDF). For .docx/.md, extraction happens on the frontend instead (mammoth/marked already parse those into HTML there — see lib/parseDocument.ts). Throws with a message prefixed "NO_EXTRACTABLE_TEXT:" for scanned/image-only PDFs. */
export function extractDocument(filePath: string): Promise<ExtractedDocument> {
  return invoke('document_reader_extract', { filePath })
}

export interface ReadingPosition {
  paragraphIndex: number
  sentenceIndex: number
  scrollPosition: number
}

/** Reads the saved resume position for a document, keyed by its file path. Null if never read before. */
export function getReadingPosition(documentKey: string): Promise<ReadingPosition | null> {
  return invoke('document_reader_get_position', { documentKey })
}

/** Persists the current resume position for a document. Called periodically during playback and on close/unmount — not just periodically, since losing the very last position on a crash-free close would be a regression. */
export function saveReadingPosition(
  documentKey: string,
  paragraphIndex: number,
  sentenceIndex: number,
  scrollPosition: number,
): Promise<void> {
  return invoke('document_reader_save_position', {
    documentKey,
    paragraphIndex,
    sentenceIndex,
    scrollPosition,
  })
}
