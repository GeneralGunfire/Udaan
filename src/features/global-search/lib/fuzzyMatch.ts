/**
 * Simple subsequence-based fuzzy match: every character of `query` must appear in `text`, in
 * order, allowing gaps. Returns a score (higher = better) or null for no match — contiguous
 * and early matches score higher, same heuristic most lightweight fuzzy-finders use. Not a
 * full search index; scoped as explicitly allowed by the brief ("simple fuzzy-match over
 * titles/content is fine for now").
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim()
  const t = text.toLowerCase()
  if (!q) return 0
  if (t.includes(q)) {
    // Substring match — strongly prefer this, and prefer it appearing earlier.
    return 1000 - t.indexOf(q)
  }

  let qi = 0
  let score = 0
  let lastMatchIndex = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastMatchIndex === ti - 1 ? 5 : 1 // reward contiguous runs
      lastMatchIndex = ti
      qi++
    }
  }
  return qi === q.length ? score : null
}
