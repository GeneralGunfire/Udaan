import type { Sentence } from './types'

/**
 * Splits paragraphs into sentences for chunk-level TTS queueing. Uses
 * `Intl.Segmenter` (built into the Tauri/Chromium webview, no extra
 * dependency) rather than a hand-rolled regex — handles abbreviations
 * ("Mr.", "e.g.") far more reliably than a naive `/[.!?]+\s/` split.
 */
export function splitIntoSentences(paragraphs: string[]): Sentence[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const sentences: Sentence[] = []

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const trimmed = paragraph.trim()
    if (!trimmed) return

    let sentenceIndex = 0
    for (const { segment } of segmenter.segment(trimmed)) {
      const text = segment.trim()
      if (!text) continue
      sentences.push({ paragraphIndex, sentenceIndex, text })
      sentenceIndex += 1
    }
  })

  return sentences
}
