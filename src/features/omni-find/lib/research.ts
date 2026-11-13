import { chat } from '@/integrations/omniroute/client'
import { search, fetchPage, type PageContent } from '@/integrations/omni-find/client'
import type { Claim, ResearchRun, RunSettings, SubQuestion } from './types'

/**
 * The research pipeline: question in, verified report out.
 *
 * ## Five stages, each observable
 * plan → search → read → draft → verify. Every stage reports progress
 * through `onUpdate` so the UI can show what is happening rather than a
 * spinner. That is not decoration: the point of deep research over a
 * chat reply is that you can see which angles it chose and which sources
 * it actually read, and judge the answer accordingly.
 *
 * ## Why verification is a separate pass over the draft
 * Asking one model to write with citations produces confident text with
 * plausible-looking references, because the same generation that invents
 * a fact will invent its source. Extracting claims *after* drafting and
 * checking each against the fetched text is a different question —
 * "does this document say this" — which is far harder to get wrong, and
 * it is answered with the source text in front of it rather than from
 * memory.
 *
 * ## Failure is partial, never total
 * A dead search backend, a paywalled page, an unparseable model reply:
 * each removes one contribution and the run continues. A research tool
 * that abandons twenty seconds of work because the fourth of nine pages
 * was a login wall is useless in practice.
 */

/** Model calls are given room but not unlimited: a hung request would
 * otherwise leave a run stuck in a phase forever. */
const STAGE_TIMEOUT_MS = 90_000

export interface RunCallbacks {
  onUpdate: (run: ResearchRun) => void
  signal: AbortSignal
}

export async function runResearch(
  question: string,
  settings: RunSettings,
  { onUpdate, signal }: RunCallbacks,
): Promise<ResearchRun> {
  const run: ResearchRun = {
    id: `r-${Date.now().toString(36)}`,
    question,
    phase: 'planning',
    startedAt: Date.now(),
    subQuestions: [],
    claims: [],
    status: 'Working out what to investigate',
  }
  const push = () => onUpdate({ ...run, subQuestions: [...run.subQuestions] })
  push()

  try {
    // --- Plan -------------------------------------------------------
    run.subQuestions = await planSubQuestions(question, settings.breadth, signal)
    run.phase = 'searching'
    run.status = `Searching ${run.subQuestions.length} angles`
    push()

    // --- Search and read --------------------------------------------
    // Sequential rather than parallel: the free search backends are
    // scraped endpoints that rate-limit aggressively, and firing three
    // simultaneous queries is the reliable way to get blocked.
    for (const sub of run.subQuestions) {
      throwIfAborted(signal)
      sub.status = 'searching'
      run.status = `Searching: ${sub.text}`
      push()

      try {
        sub.results = await search(sub.query, Math.max(5, settings.depth + 3), {
          brave: settings.braveKey || null,
          tavily: settings.tavilyKey || null,
        })
      } catch (err) {
        sub.status = 'failed'
        sub.note = err instanceof Error ? err.message : 'Search failed.'
        push()
        continue
      }

      sub.status = 'reading'
      run.phase = 'reading'
      push()

      // Pages are fetched in parallel — unlike search, these hit
      // unrelated hosts, so concurrency is both safe and much faster.
      const targets = sub.results.slice(0, settings.depth)
      const settled = await Promise.allSettled(targets.map((r) => fetchPage(r.url)))
      sub.sources = settled
        .filter((s): s is PromiseFulfilledResult<PageContent> => s.status === 'fulfilled')
        .map((s) => s.value)

      const failed = settled.length - sub.sources.length
      if (sub.sources.length === 0) {
        sub.status = 'failed'
        sub.note =
          failed > 0
            ? `All ${failed} pages were unreadable — paywalls or script-rendered sites.`
            : 'No pages could be read.'
      } else {
        sub.status = 'done'
        if (failed > 0) sub.note = `${failed} of ${settled.length} pages could not be read.`
      }
      run.status = `Read ${sub.sources.length} sources for: ${sub.text}`
      push()
    }

    const sources = run.subQuestions.flatMap((s) => s.sources)
    if (sources.length === 0) {
      run.phase = 'failed'
      run.error =
        'No sources could be read for any angle. Check your connection, or add a search API key in settings for better results.'
      run.finishedAt = Date.now()
      push()
      return run
    }

    // --- Draft ------------------------------------------------------
    throwIfAborted(signal)
    run.phase = 'drafting'
    run.status = `Writing from ${sources.length} sources`
    push()
    run.draft = await draftReport(question, run.subQuestions, signal)
    push()

    // --- Verify -----------------------------------------------------
    if (settings.factCheck) {
      throwIfAborted(signal)
      run.phase = 'verifying'
      run.status = 'Checking each claim against the sources'
      push()
      run.claims = await verifyClaims(run.draft, sources, signal)
    }

    run.phase = 'done'
    run.finishedAt = Date.now()
    run.status = summarise(run)
    push()
    return run
  } catch (err) {
    run.phase = signal.aborted ? 'cancelled' : 'failed'
    run.error = signal.aborted
      ? undefined
      : err instanceof Error
        ? err.message
        : 'Research failed.'
    run.status = signal.aborted ? 'Stopped' : (run.error ?? 'Failed')
    run.finishedAt = Date.now()
    push()
    return run
  }
}

function summarise(run: ResearchRun): string {
  const sources = new Set(run.subQuestions.flatMap((s) => s.sources.map((x) => x.url))).size
  if (run.claims.length === 0) return `Done — ${sources} sources`
  const flagged = run.claims.filter((c) => c.verdict !== 'supported').length
  return flagged === 0
    ? `Done — ${run.claims.length} claims verified against ${sources} sources`
    : `Done — ${flagged} of ${run.claims.length} claims could not be verified`
}

/**
 * Breaks a question into the angles it actually needs.
 *
 * A single search for the user's exact wording finds the obvious page and
 * stops. Splitting into sub-questions is most of what separates research
 * from lookup — it is what surfaces the counterargument, the timeline,
 * and the numbers, rather than three restatements of the first result.
 */
async function planSubQuestions(
  question: string,
  breadth: number,
  signal: AbortSignal,
): Promise<SubQuestion[]> {
  const result = await withTimeout(
    chat(
      [
        {
          role: 'system',
          content: [
            'You plan research. Break the question into distinct angles that together answer it well.',
            'Cover different ground with each: background, current state, evidence or data, and disagreement or criticism where relevant.',
            'Return ONLY a JSON array, no prose, no code fence. Each item: {"question": "...", "query": "..."}',
            'The "query" is what to type into a search engine — keywords, not a sentence.',
          ].join(' '),
        },
        { role: 'user', content: `Question: ${question}\n\nGive exactly ${breadth} angles.` },
      ],
      signal,
      { temperature: 0.4 },
    ),
    signal,
  )

  const parsed = parseJsonArray(result.content)
  const angles = parsed
    .map((item, index): SubQuestion | null => {
      const record = item as Record<string, unknown>
      const text = typeof record.question === 'string' ? record.question : ''
      const query = typeof record.query === 'string' ? record.query : text
      if (!text.trim() || !query.trim()) return null
      return {
        id: `sq-${index}`,
        text: text.trim(),
        query: query.trim(),
        status: 'pending' as const,
        results: [],
        sources: [],
      }
    })
    .filter((s: SubQuestion | null): s is SubQuestion => s !== null)

  // A model that returns prose instead of JSON must not sink the run.
  // Searching the question as asked is a worse plan, not no plan.
  if (angles.length === 0) {
    return [
      {
        id: 'sq-0',
        text: question,
        query: question,
        status: 'pending',
        results: [],
        sources: [],
      },
    ]
  }
  return angles.slice(0, breadth)
}

/**
 * Writes the report from the gathered sources.
 *
 * Sources are numbered and the model is told to cite by number, which
 * makes citations checkable: a number either points at a real source in
 * the list or it does not, whereas a model writing free-form URLs will
 * produce ones that look right and go nowhere.
 */
async function draftReport(
  question: string,
  subQuestions: SubQuestion[],
  signal: AbortSignal,
): Promise<string> {
  const sources = subQuestions.flatMap((s) => s.sources)
  const numbered = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title || source.url}\nURL: ${source.url}\n${
          source.published ? `Published: ${source.published}\n` : ''
        }${source.text.slice(0, 6000)}`,
    )
    .join('\n\n---\n\n')

  const result = await withTimeout(
    chat(
      [
        {
          role: 'system',
          content: [
            'You write research reports from provided sources.',
            'Use ONLY the sources given. If they do not answer part of the question, say so plainly rather than filling the gap from memory.',
            'Cite with bracketed numbers matching the source list, e.g. [2]. Every factual sentence needs one.',
            'Where sources disagree, say so and cite both.',
            'Write in markdown with short sections. No preamble, no "based on the sources provided" throat-clearing.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nAngles investigated:\n${subQuestions
            .map((s) => `- ${s.text}`)
            .join('\n')}\n\nSources:\n\n${numbered}`,
        },
      ],
      signal,
      { temperature: 0.3 },
    ),
    signal,
  )

  return result.content.trim()
}

/**
 * Extracts each factual claim from the draft and checks it against the
 * source text.
 *
 * Done in one call rather than one per claim: a dozen round trips would
 * make verification slower than everything before it combined, and the
 * checker needs to see all the sources anyway.
 */
async function verifyClaims(
  draft: string,
  sources: PageContent[],
  signal: AbortSignal,
): Promise<Claim[]> {
  const numbered = sources
    .map((s, i) => `[${i + 1}] ${s.title || s.url}\nURL: ${s.url}\n${s.text.slice(0, 5000)}`)
    .join('\n\n---\n\n')

  const result = await withTimeout(
    chat(
      [
        {
          role: 'system',
          content: [
            'You fact-check a draft against its sources. You did not write the draft and have no stake in it.',
            'Extract every specific factual claim — figures, dates, causal statements, attributed quotes. Skip opinions and generalities.',
            'For each, decide against the SOURCE TEXT ONLY, never your own knowledge:',
            '"supported" — a source states it. "contradicted" — a source states otherwise. "unsupported" — no source addresses it.',
            'Return ONLY a JSON array, no prose, no code fence.',
            'Each item: {"claim": "...", "verdict": "supported|unsupported|contradicted", "sources": [1,3], "why": "one short sentence"}',
            'Include "why" only for unsupported and contradicted.',
          ].join(' '),
        },
        { role: 'user', content: `Draft:\n\n${draft}\n\nSources:\n\n${numbered}` },
      ],
      signal,
      { temperature: 0 },
    ),
    signal,
  )

  return parseJsonArray(result.content)
    .map((item, index): Claim | null => {
      const record = item as Record<string, unknown>
      const text = typeof record.claim === 'string' ? record.claim : ''
      if (!text.trim()) return null

      const rawVerdict = String(record.verdict ?? '').toLowerCase()
      const verdict: Claim['verdict'] =
        rawVerdict === 'supported' || rawVerdict === 'contradicted'
          ? rawVerdict
          : // Anything unrecognised is treated as unsupported rather than
            // supported: a checker that fails should not silently bless a
            // claim it never actually evaluated.
            'unsupported'

      const indices = Array.isArray(record.sources) ? record.sources : []
      const citations = indices
        .map((n) => sources[Number(n) - 1]?.url)
        .filter((url): url is string => typeof url === 'string')

      return {
        id: `c-${index}`,
        text: text.trim(),
        verdict,
        citations,
        reasoning: typeof record.why === 'string' ? record.why : undefined,
      }
    })
    .filter((c: Claim | null): c is Claim => c !== null)
}

/**
 * Pulls a JSON array out of a model reply.
 *
 * Models wrap JSON in code fences, prefix it with "Here is the array:",
 * or add a trailing note, whatever the instructions say. Slicing from the
 * first bracket to the last recovers all of those; returning an empty
 * array on genuine failure lets callers fall back rather than throw.
 */
function parseJsonArray(content: string): unknown[] {
  const start = content.indexOf('[')
  const end = content.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(content.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('cancelled')
}

/** Caps a model call so a hung request cannot strand a run in one phase. */
function withTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('The model took too long to respond.')),
      STAGE_TIMEOUT_MS,
    )
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new Error('cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => {
        window.clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      })
  })
}
