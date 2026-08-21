/**
 * Reliability layer: parses inline reliability tags out of generated
 * output and renders them as flagged spans. The model is instructed (see
 * promptBuilder.ts) to wrap text in these tags when relevant; anything
 * not wrapped is treated as grounded in the knowledge base / the source
 * material provided, the default/unflagged case.
 *
 *   [[uncertain: some claim the model isn't confident about]]
 *   [[external: some fact that came from general knowledge, not the
 *              provided source material or knowledge base]]
 */

export type MarkerKind = 'uncertain' | 'external'

export interface ParsedSegment {
  text: string
  marker: MarkerKind | null
}

const MARKER_PATTERN = /\[\[(uncertain|external):\s*([^\]]+?)\]\]/g

export function parseReliabilityMarkers(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(MARKER_PATTERN)) {
    const [full, kind, content] = match
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), marker: null })
    }
    segments.push({ text: content, marker: kind as MarkerKind })
    lastIndex = index + full.length
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), marker: null })
  }

  return segments
}

export const MARKER_LABEL: Record<MarkerKind, string> = {
  uncertain: 'Model expressed uncertainty about this',
  external: 'From general knowledge, not the provided source material or knowledge base',
}

/** Counts flagged segments by kind — used for a summary strip above the output. */
export function countMarkers(segments: ParsedSegment[]): Record<MarkerKind, number> {
  const counts: Record<MarkerKind, number> = { uncertain: 0, external: 0 }
  for (const seg of segments) {
    if (seg.marker) counts[seg.marker] += 1
  }
  return counts
}
