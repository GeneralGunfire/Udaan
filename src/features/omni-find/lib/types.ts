import type { SearchResult, PageContent } from '@/integrations/omni-find/client'

/**
 * The shape of a research run.
 *
 * A run is modelled as an explicit sequence of stages rather than a
 * single promise because the whole value of deep research is being able
 * to watch it happen — which sub-questions it chose, which sources it
 * read, what it could not verify. A spinner that resolves into a wall of
 * text asks the user to trust a process they never saw.
 */

export type RunPhase =
  | 'planning'
  | 'searching'
  | 'reading'
  | 'drafting'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled'

/** One angle the planner decided the question needs covering from. */
export interface SubQuestion {
  id: string
  text: string
  /** Search query derived from it — often narrower than the question. */
  query: string
  status: 'pending' | 'searching' | 'reading' | 'done' | 'failed'
  results: SearchResult[]
  /** Pages actually fetched and read, keyed by URL. */
  sources: PageContent[]
  /** Why this angle produced nothing, when it did. */
  note?: string
}

/**
 * A claim extracted from the draft and checked against the sources.
 *
 * `unsupported` is deliberately distinct from `contradicted`: the first
 * means the sources are silent, which is common and often fine; the
 * second means they disagree, which is a real problem. Collapsing them
 * into one "failed" state would bury the difference that matters.
 */
export interface Claim {
  id: string
  text: string
  verdict: 'supported' | 'unsupported' | 'contradicted'
  /** URLs of the sources that back or contradict it. */
  citations: string[]
  /** The checker's one-line reasoning, shown on the flagged ones. */
  reasoning?: string
}

export interface ResearchRun {
  id: string
  question: string
  phase: RunPhase
  startedAt: number
  finishedAt?: number
  /** What the planner decided to investigate. */
  subQuestions: SubQuestion[]
  /** The synthesised answer, in markdown. Present from 'drafting' on. */
  draft?: string
  /** Verification results. Present from 'verifying' on. */
  claims: Claim[]
  /** Human-readable failure, when phase is 'failed'. */
  error?: string
  /** Live status line, so the UI always has something specific to show
   * rather than a generic "working…". */
  status: string
}

export interface RunSettings {
  /** How many angles to break the question into. More is slower and
   * costs more model calls; three covers most questions. */
  breadth: number
  /** How many pages to actually read per angle. */
  depth: number
  /** Whether to run the verification pass at all. Off makes a run
   * roughly twice as fast, at the cost of the thing that distinguishes
   * this from a chat reply. */
  factCheck: boolean
  braveKey: string
  tavilyKey: string
}

export const DEFAULT_SETTINGS: RunSettings = {
  breadth: 3,
  depth: 3,
  factCheck: true,
  braveKey: '',
  tavilyKey: '',
}

/** Sources across every sub-question, deduplicated — what the report
 * actually cites. */
export function allSources(run: ResearchRun): PageContent[] {
  const seen = new Set<string>()
  const out: PageContent[] = []
  for (const sub of run.subQuestions) {
    for (const source of sub.sources) {
      if (seen.has(source.url)) continue
      seen.add(source.url)
      out.push(source)
    }
  }
  return out
}

/** Claims the reader should look at: everything the sources did not
 * back up. */
export function flaggedClaims(run: ResearchRun): Claim[] {
  return run.claims.filter((c) => c.verdict !== 'supported')
}
