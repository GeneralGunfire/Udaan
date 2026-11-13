/**
 * Fuzzy matching of a spoken reference ("the dentist thing", "my meeting
 * with sarah") against real events — token overlap + substring + a real
 * edit-distance pass, so close-but-imperfect phrasing still resolves
 * without needing the LLM. Scored, not boolean, so the caller can tell a
 * clean single match from a genuine tie needing clarification.
 */
import type { CalendarEvent } from '../types'

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Classic Levenshtein distance — small strings only (event titles), so O(n*m) is fine. */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const distance = editDistance(a, b)
  return 1 - distance / Math.max(a.length, b.length)
}

export interface ScoredMatch {
  event: CalendarEvent
  score: number
}

/**
 * Scores every event against `reference` on three signals — exact/
 * substring containment (strongest), token overlap, and whole-string
 * similarity (typo tolerance) — and returns them sorted best-first.
 */
export function scoreMatches(reference: string, events: CalendarEvent[]): ScoredMatch[] {
  const ref = normalize(reference)
  if (!ref) return []
  const refWords = new Set(ref.split(' ').filter((w) => w.length > 2))

  return events
    .map((event) => {
      const title = normalize(event.title)
      let score = 0

      if (title === ref) score = 1
      else if (title.includes(ref) || ref.includes(title)) score = 0.85

      const titleWords = title.split(' ').filter((w) => w.length > 2)
      const overlap = titleWords.filter((w) => refWords.has(w)).length
      if (titleWords.length > 0) {
        score = Math.max(score, (overlap / titleWords.length) * 0.75)
      }

      score = Math.max(score, similarity(title, ref) * 0.6)

      return { event, score }
    })
    .filter((m) => m.score > 0.3)
    .sort((a, b) => b.score - a.score)
}

/**
 * Resolves a reference to zero, one, or many candidate events. "Confident"
 * means the top match clearly beats the runner-up (or there's only one
 * candidate) — otherwise it's a genuine tie the caller should ask about.
 */
export function resolveReference(
  reference: string,
  events: CalendarEvent[],
): { confident: CalendarEvent | null; candidates: ScoredMatch[] } {
  const scored = scoreMatches(reference, events)
  if (scored.length === 0) return { confident: null, candidates: [] }
  if (scored.length === 1) return { confident: scored[0].event, candidates: scored }

  const [top, runnerUp] = scored
  const clearWinner = top.score - runnerUp.score > 0.2 || top.score >= 0.95
  return { confident: clearWinner ? top.event : null, candidates: scored.slice(0, 5) }
}
