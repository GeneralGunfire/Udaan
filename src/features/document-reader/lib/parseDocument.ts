import mammoth from 'mammoth'
import { marked } from 'marked'
import { readFile } from '@tauri-apps/plugin-fs'
import { extractDocument } from '@/integrations/document-reader/client'
import { splitIntoSentences } from './splitSentences'
import type { DocumentFormat, ParsedDocument } from './types'

export class UnsupportedFormatError extends Error {}
export class ScannedPdfError extends Error {}

export function detectFormat(filePath: string): DocumentFormat {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'txt') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  throw new UnsupportedFormatError(`Unsupported file type: .${ext || '(none)'}. Document Reader supports .txt, .md, .pdf, and .docx.`)
}

/** Strips HTML down to clean paragraph text for TTS, collapsing whitespace. Table cells are summarized as "Table" rather than read verbatim — reading raw cell-by-cell text aloud produces nonsense word salad for anything but the simplest tables. */
function htmlToTtsParagraphs(html: string): { paragraphs: string[]; sawTable: boolean } {
  const container = document.createElement('div')
  container.innerHTML = html

  let sawTable = false
  const paragraphs: string[] = []

  for (const table of Array.from(container.querySelectorAll('table'))) {
    sawTable = true
    table.replaceWith(document.createTextNode(' Table. '))
  }

  for (const el of Array.from(container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li'))) {
    const text = el.textContent?.replace(/\s+/g, ' ').trim()
    if (text) paragraphs.push(text)
  }

  // Fallback for content that didn't land in a recognized block element.
  if (paragraphs.length === 0) {
    const text = container.textContent?.replace(/\s+/g, ' ').trim()
    if (text) paragraphs.push(text)
  }

  return { paragraphs, sawTable }
}

/** Annotates each top-level renderable block in `html` with a `data-para-index` matching its position in the returned paragraph array, so the highlight-sync/click-to-seek logic can look up DOM nodes by index in O(1) rather than fuzzy text matching. Must run AFTER htmlToTtsParagraphs would see the same content, using the same block selector, so indices line up 1:1. */
function annotateParagraphIndices(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html

  for (const table of Array.from(container.querySelectorAll('table'))) {
    table.setAttribute('data-doc-table', 'true')
  }

  let index = 0
  for (const el of Array.from(container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li'))) {
    if (el.textContent?.trim()) {
      el.setAttribute('data-para-index', String(index))
      index += 1
    }
  }

  return container.innerHTML
}

async function parseTxt(filePath: string): Promise<ParsedDocument> {
  const extracted = await extractDocument(filePath)
  return {
    format: 'txt',
    paragraphs: extracted.paragraphs,
    sentences: splitIntoSentences(extracted.paragraphs),
    warning: extracted.warning,
  }
}

async function parseMarkdown(filePath: string): Promise<ParsedDocument> {
  const bytes = await readFile(filePath)
  const raw = new TextDecoder('utf-8').decode(bytes)
  const rawHtml = await marked.parse(raw, { async: true })

  const { paragraphs, sawTable } = htmlToTtsParagraphs(rawHtml)
  if (paragraphs.length === 0) {
    throw new Error('This file appears to be empty.')
  }

  return {
    format: 'md',
    paragraphs,
    sentences: splitIntoSentences(paragraphs),
    renderedHtml: annotateParagraphIndices(rawHtml),
    warning: sawTable ? 'Table contents are announced as "Table" rather than read cell-by-cell.' : undefined,
  }
}

async function parseDocx(filePath: string): Promise<ParsedDocument> {
  const bytes = await readFile(filePath)
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer as ArrayBuffer })
  const rawHtml = result.value

  const { paragraphs, sawTable } = htmlToTtsParagraphs(rawHtml)
  if (paragraphs.length === 0) {
    throw new Error(
      'Could not extract any readable content from this document — it may be empty, corrupted, or use an unsupported .docx feature.',
    )
  }

  return {
    format: 'docx',
    paragraphs,
    sentences: splitIntoSentences(paragraphs),
    renderedHtml: annotateParagraphIndices(rawHtml),
    warning: sawTable ? 'Table contents are announced as "Table" rather than read cell-by-cell.' : undefined,
  }
}

async function parsePdf(filePath: string): Promise<ParsedDocument> {
  let extracted: Awaited<ReturnType<typeof extractDocument>>
  try {
    extracted = await extractDocument(filePath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('NO_EXTRACTABLE_TEXT')) {
      throw new ScannedPdfError(
        'This looks like a scanned/image-only PDF with no extractable text. OCR isn’t supported yet, so it can’t be read aloud — this is a known limitation.',
      )
    }
    throw err
  }

  const bytes = await readFile(filePath)

  return {
    format: 'pdf',
    paragraphs: extracted.paragraphs,
    sentences: splitIntoSentences(extracted.paragraphs),
    pdfBytes: bytes.buffer as ArrayBuffer,
    warning: extracted.warning,
  }
}

/** Parses a document at `filePath` into TTS-ready sentences plus enough rendering info for the reading pane to show real formatting. Throws `UnsupportedFormatError` for unhandled extensions, `ScannedPdfError` for image-only PDFs, or a plain `Error` with a user-facing message for any other parse failure (corrupt file, empty file, etc.) — callers should catch and display these rather than letting them propagate as a crash. */
export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const format = detectFormat(filePath)
  switch (format) {
    case 'txt':
      return parseTxt(filePath)
    case 'md':
      return parseMarkdown(filePath)
    case 'docx':
      return parseDocx(filePath)
    case 'pdf':
      return parsePdf(filePath)
  }
}
