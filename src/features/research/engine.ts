import { chat } from '@/integrations/omniroute/client'
import { fetchPage, search } from '@/integrations/omni-find/client'
import { MODES, domainOf, uid, type Angle, type Claim, type Mode, type Session, type Settings, type Source, type Turn } from './model'

/**
 * The research pipeline. plan, search, read, draft, then a SEPARATE pass that checks the draft.
 *
 * Why the check is its own pass: one model asked to write with citations will invent a plausible source
 * for a made-up fact, because the same generation does both. Checking afterwards is a different question,
 * "does this document say this", answered with the document in front of it.
 *
 * What is new here is that the checker must QUOTE the words it relied on, and this file then looks for
 * those words in the source text itself. A "supported" verdict whose quote is not on the page is demoted
 * to unsupported. So a claim only counts as verified when the evidence is really there, not because a
 * model said so.
 *
 * Failure is partial, never total: a dead search backend, a paywalled page, a model that returns prose
 * instead of JSON each remove one contribution and the run goes on.
 */

const STAGE_TIMEOUT_MS = 120_000
/** Total page text sent to the model in one call, split across the sources. */
const SOURCE_BUDGET_CHARS = 40_000

export interface Work {
  turn: Turn
  sources: Source[]
}

export interface Hooks {
  signal: AbortSignal
  /** Called whenever anything changed; receives copies it may keep. */
  onUpdate: (turn: Turn, sources: Source[]) => void
  /** Called after planning when the user asked to review the plan. Resolve with the final angles, or null to cancel. */
  reviewPlan?: (angles: Angle[]) => Promise<Angle[] | null>
}

const cancelled = () => new Error('cancelled')
const check = (s: AbortSignal) => {
  if (s.aborted) throw cancelled()
}

export function newTurn(question: string, kind: Turn['kind'], mode: Mode, searchedMore: boolean, factCheck: boolean): Turn {
  return { id: uid(), question, kind, mode, searchedMore, phase: 'planning', status: 'Working out what to investigate', createdMs: Date.now(), angles: [], cites: [], report: '', claims: [], factChecked: factCheck, brokenCites: [] }
}

/** What earlier turns said, so a follow-up is written as a continuation and not from nothing. */
function history(session: Session): string {
  const done = session.turns.filter((t) => t.phase === 'done' && t.report)
  if (!done.length) return ''
  return done
    .slice(-3)
    .map((t) => `Earlier question: ${t.question}\nEarlier answer (summary): ${t.report.replace(/\s+/g, ' ').slice(0, 1200)}`)
    .join('\n\n')
}

/** Runs a whole turn (investigate if needed, write, check). Never throws: the outcome is on `work.turn`. */
export async function runTurn(work: Work, session: Session, settings: Settings, hooks: Hooks): Promise<void> {
  const { turn } = work
  const cfg = MODES[turn.mode]
  const emit = () => hooks.onUpdate({ ...turn, angles: turn.angles.map((a) => ({ ...a })), claims: [...turn.claims] }, [...work.sources])
  const fail = (e: unknown) => {
    const aborted = hooks.signal.aborted || (e as Error)?.message === 'cancelled'
    turn.phase = aborted ? 'cancelled' : 'failed'
    turn.error = aborted ? undefined : e instanceof Error ? e.message : typeof e === 'string' ? e : 'Research failed.'
    turn.status = aborted ? 'Stopped' : (turn.error ?? 'Failed')
    turn.finishedMs = Date.now()
    emit()
  }

  try {
    emit()
    if (turn.searchedMore) {
      // 1. plan
      let angles = await plan(turn.question, cfg.breadth, history(session), hooks.signal)
      if (hooks.reviewPlan) {
        turn.phase = 'review'
        turn.status = 'Review the plan, then start'
        turn.angles = angles
        emit()
        const edited = await hooks.reviewPlan(angles)
        if (!edited) throw cancelled()
        angles = edited
      }
      turn.angles = angles
      turn.phase = 'searching'
      turn.status = `Searching ${angles.length} angle${angles.length === 1 ? '' : 's'}`
      emit()

      // 2. search and read. Searches go one at a time (the free backends rate-limit hard); pages in parallel.
      for (const angle of turn.angles) {
        check(hooks.signal)
        angle.status = 'searching'
        turn.status = `Searching: ${angle.text}`
        emit()
        let results
        try {
          results = await search(angle.query, Math.max(5, cfg.depth + 3), { brave: settings.braveKey || null, tavily: settings.tavilyKey || null })
        } catch (e) {
          angle.status = 'failed'
          angle.note = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Search failed.'
          emit()
          continue
        }
        angle.status = 'reading'
        turn.phase = 'reading'
        emit()
        // Skip pages this session already read; they are reused, not fetched twice.
        const fresh = results.filter((r) => !work.sources.some((s) => s.url === r.url)).slice(0, cfg.depth)
        const reused = results.filter((r) => work.sources.some((s) => s.url === r.url)).slice(0, cfg.depth)
        const settled = await Promise.allSettled(fresh.map((r) => fetchPage(r.url)))
        let read = 0
        settled.forEach((s, i) => {
          if (s.status !== 'fulfilled') return
          if (work.sources.some((x) => x.url === s.value.url)) return
          work.sources.push({ id: uid(), url: s.value.url, title: s.value.title || fresh[i].title, text: s.value.text.slice(0, 9000), published: s.value.published, truncated: s.value.truncated, angleId: angle.id, addedMs: Date.now() })
          read++
        })
        for (const r of reused) {
          const s = work.sources.find((x) => x.url === r.url)
          if (s && !turn.cites.includes(s.id)) turn.cites.push(s.id)
        }
        // Everything read for this angle is cited by this turn.
        work.sources.filter((s) => s.angleId === angle.id && !turn.cites.includes(s.id)).forEach((s) => turn.cites.push(s.id))
        angle.read = read
        const failed = settled.length - settled.filter((s) => s.status === 'fulfilled').length
        angle.status = read + reused.length === 0 ? 'failed' : 'done'
        if (read + reused.length === 0) angle.note = failed ? `All ${failed} pages were unreadable (paywalls or script-rendered sites).` : 'No pages could be read.'
        else if (failed) angle.note = `${failed} of ${settled.length} pages could not be read.`
        turn.status = `Read ${read + reused.length} source${read + reused.length === 1 ? '' : 's'} for: ${angle.text}`
        emit()
      }
    }

    // A follow-up that did not search leans on the best of what the session already holds.
    if (!turn.searchedMore) {
      turn.cites = work.sources.filter((s) => !s.excluded).slice(0, 10).map((s) => s.id)
    } else if (turn.kind === 'followup') {
      const extra = work.sources.filter((s) => !s.excluded && !turn.cites.includes(s.id)).slice(0, Math.max(0, 10 - turn.cites.length))
      extra.forEach((s) => turn.cites.push(s.id))
    }
    const usable = usableSources(work, turn)
    if (!usable.length) {
      turn.phase = 'failed'
      turn.error = 'No sources could be read for any angle. Check your connection, or add a search API key in OmniFind settings for better results.'
      turn.status = 'No sources'
      turn.finishedMs = Date.now()
      emit()
      return
    }

    await writeAndCheck(work, session, hooks, emit, fail)
  } catch (e) {
    fail(e)
  }
}

/** The sources this turn may cite: its list, minus any the user excluded, in order. */
export const usableSources = (work: Work, turn: Turn) => turn.cites.map((id) => work.sources.find((s) => s.id === id)).filter((s): s is Source => !!s && !s.excluded)

/** Writes the report again from the current (included) sources, then checks it. Used after excluding a source or adding one. */
export async function redraft(work: Work, session: Session, hooks: Hooks): Promise<void> {
  const { turn } = work
  const emit = () => hooks.onUpdate({ ...turn, angles: turn.angles.map((a) => ({ ...a })), claims: [...turn.claims] }, [...work.sources])
  turn.error = undefined
  turn.finishedMs = undefined
  turn.report = ''
  turn.claims = []
  turn.brokenCites = []
  const fail = (e: unknown) => {
    const aborted = hooks.signal.aborted || (e as Error)?.message === 'cancelled'
    turn.phase = aborted ? 'cancelled' : 'failed'
    turn.error = aborted ? undefined : e instanceof Error ? e.message : typeof e === 'string' ? e : 'Writing failed.'
    turn.status = aborted ? 'Stopped' : (turn.error ?? 'Failed')
    turn.finishedMs = Date.now()
    emit()
  }
  // Newly added manual sources join the list.
  work.sources.filter((s) => s.manual && !s.excluded && !turn.cites.includes(s.id)).forEach((s) => turn.cites.push(s.id))
  if (!usableSources(work, turn).length) return fail('Every source is excluded. Include at least one.')
  try {
    await writeAndCheck(work, session, hooks, emit, fail)
  } catch (e) {
    fail(e)
  }
}

async function writeAndCheck(work: Work, session: Session, hooks: Hooks, emit: () => void, fail: (e: unknown) => void) {
  const { turn } = work
  const sources = usableSources(work, turn)
  turn.cites = sources.map((s) => s.id)
  turn.draftedWith = [...turn.cites]

  // 3. write, live
  check(hooks.signal)
  turn.phase = 'drafting'
  turn.status = `Writing from ${sources.length} source${sources.length === 1 ? '' : 's'}`
  turn.report = ''
  emit()
  let last = 0
  try {
    turn.report = await draft(turn.question, turn.angles, sources, turn.kind === 'followup' ? history({ ...session, turns: session.turns.filter((t) => t.id !== turn.id) }) : '', hooks.signal, (text) => {
      turn.report = text
      const now = Date.now()
      if (now - last > 90) ((last = now), emit())
    })
  } catch (e) {
    return fail(e)
  }
  turn.brokenCites = brokenCitations(turn.report, sources.length)
  emit()

  // 4. check
  if (turn.factChecked) {
    check(hooks.signal)
    turn.phase = 'verifying'
    turn.status = 'Checking each claim against the sources'
    emit()
    try {
      turn.claims = await verify(turn.report, sources, hooks.signal)
    } catch (e) {
      if (hooks.signal.aborted) return fail(e)
      // The report is still good; say that the check did not run instead of failing the turn.
      turn.claims = []
      turn.status = 'The fact-check could not run'
    }
  }
  turn.phase = 'done'
  turn.finishedMs = Date.now()
  turn.status = summary(turn, sources)
  emit()
  // Follow-up ideas are a bonus: never block or fail on them.
  void suggest(turn.question, turn.report).then((s) => {
    if (s.length) {
      turn.suggestions = s
      emit()
    }
  })
}

function summary(turn: Turn, sources: Source[]): string {
  const n = new Set(sources.map((s) => domainOf(s.url))).size
  if (!turn.factChecked || !turn.claims.length) return `Done. ${sources.length} sources from ${n} sites`
  const ok = turn.claims.filter((c) => c.verdict === 'supported').length
  return `Done. ${ok} of ${turn.claims.length} claims verified against ${sources.length} sources`
}

/* ── stages ──────────────────────────────────────────────────────── */

async function plan(question: string, breadth: number, context: string, signal: AbortSignal): Promise<Angle[]> {
  const r = await timed(
    chat(
      [
        {
          role: 'system',
          content: [
            'You plan research. Break the question into distinct angles that together answer it well.',
            'Cover different ground with each: background, current state, evidence or data, and disagreement or criticism where relevant.',
            context ? 'There is earlier research in this session; plan angles for what is NEW in this question, not what is already covered.' : '',
            'Return ONLY a JSON array, no prose, no code fence. Each item: {"question": "...", "query": "..."}',
            'The "query" is what to type into a search engine: keywords, not a sentence.',
          ]
            .filter(Boolean)
            .join(' '),
        },
        { role: 'user', content: `${context ? `${context}\n\n` : ''}Question: ${question}\n\nGive exactly ${breadth} angles.` },
      ],
      signal,
      { temperature: 0.4 },
    ),
    signal,
  )
  const angles = parseArray(r.content)
    .map((item, i): Angle | null => {
      const rec = item as Record<string, unknown>
      const text = typeof rec.question === 'string' ? rec.question.trim() : ''
      const query = typeof rec.query === 'string' ? rec.query.trim() : text
      return text && query ? { id: `a${i}-${uid().slice(0, 4)}`, text, query, status: 'pending', read: 0 } : null
    })
    .filter((a): a is Angle => a !== null)
  // A model that returns prose must not sink the run: searching the question as asked is a worse plan, not no plan.
  return angles.length ? angles.slice(0, breadth) : [{ id: `a0-${uid().slice(0, 4)}`, text: question, query: question, status: 'pending', read: 0 }]
}

function numbered(sources: Source[], budget: number) {
  const each = Math.max(1500, Math.min(6000, Math.floor(budget / Math.max(1, sources.length))))
  return sources.map((s, i) => `[${i + 1}] ${s.title || s.url}\nURL: ${s.url}\n${s.published ? `Published: ${s.published}\n` : ''}${s.text.slice(0, each)}`).join('\n\n---\n\n')
}

async function draft(question: string, angles: Angle[], sources: Source[], context: string, signal: AbortSignal, onText: (t: string) => void): Promise<string> {
  let seen = ''
  const r = await timed(
    chat(
      [
        {
          role: 'system',
          content: [
            'You write research reports from provided sources.',
            'Use ONLY the sources given. If they do not answer part of the question, say so plainly instead of filling the gap from memory.',
            'Cite with bracketed numbers matching the source list, like [2]. Every factual sentence needs one. Never cite a number that is not in the list.',
            'Where sources disagree, say so and cite both.',
            'Begin with a short summary of 2 to 3 sentences that answers the question directly, then use short Markdown sections. No preamble.',
            context ? 'This continues earlier research in the same session; answer the new question and do not repeat the earlier answer.' : '',
          ]
            .filter(Boolean)
            .join(' '),
        },
        {
          role: 'user',
          content: `${context ? `${context}\n\n` : ''}Question: ${question}\n${angles.length ? `\nAngles investigated:\n${angles.map((a) => `- ${a.text}`).join('\n')}\n` : ''}\nSources:\n\n${numbered(sources, SOURCE_BUDGET_CHARS)}`,
        },
      ],
      signal,
      { temperature: 0.3, onDelta: (d) => onText((seen += d)) },
    ),
    signal,
  )
  return (r.content || seen).trim()
}

async function verify(report: string, sources: Source[], signal: AbortSignal): Promise<Claim[]> {
  const r = await timed(
    chat(
      [
        {
          role: 'system',
          content: [
            'You fact-check a report against its sources. You did not write it and have no stake in it.',
            'Extract every specific factual claim: figures, dates, causal statements, attributed quotes. Skip opinions and generalities.',
            'Decide each against the SOURCE TEXT ONLY, never your own knowledge:',
            '"supported": a source states it. "contradicted": a source states otherwise. "unsupported": no source addresses it.',
            'For supported and contradicted you MUST give "quote": the exact words copied from the source that decide it (under 200 characters, no paraphrase).',
            'Return ONLY a JSON array, no prose, no code fence.',
            'Each item: {"claim": "...", "verdict": "supported|unsupported|contradicted", "sources": [1,3], "quote": "...", "why": "one short sentence"}',
            'Include "why" only for unsupported and contradicted.',
          ].join(' '),
        },
        { role: 'user', content: `Report:\n\n${report}\n\nSources:\n\n${numbered(sources, 36_000)}` },
      ],
      signal,
      { temperature: 0 },
    ),
    signal,
  )
  return parseArray(r.content)
    .map((item, i): Claim | null => {
      const rec = item as Record<string, unknown>
      const text = typeof rec.claim === 'string' ? rec.claim.trim() : ''
      if (!text) return null
      const raw = String(rec.verdict ?? '').toLowerCase()
      // An unrecognised verdict counts as unsupported: a checker that fails must not bless a claim it never evaluated.
      let verdict: Claim['verdict'] = raw === 'supported' || raw === 'contradicted' ? raw : 'unsupported'
      const ids = (Array.isArray(rec.sources) ? rec.sources : []).map((n) => sources[Number(n) - 1]?.id).filter((x): x is string => typeof x === 'string')
      const quote = typeof rec.quote === 'string' ? rec.quote.trim() : undefined
      let reasoning = typeof rec.why === 'string' ? rec.why : undefined
      let quoteFound: boolean | undefined
      if (verdict !== 'unsupported') {
        // Look for the quote in the cited sources (or in all of them if none were named).
        const pool = (ids.length ? ids : sources.map((s) => s.id)).map((id) => sources.find((s) => s.id === id)).filter((s): s is Source => !!s)
        quoteFound = !!quote && pool.some((s) => quoteIn(quote, s.text))
        if (!quoteFound) {
          verdict = 'unsupported'
          reasoning = quote ? 'The quoted evidence was not found in the cited source.' : 'No evidence was quoted for this claim.'
        }
      }
      return { id: `c${i}`, text, verdict, sources: ids, quote, quoteFound, reasoning }
    })
    .filter((c): c is Claim => c !== null)
}

async function suggest(question: string, report: string): Promise<string[]> {
  try {
    const r = await chat(
      [
        { role: 'system', content: 'Suggest 3 short follow-up questions a curious reader would ask next. Return ONLY a JSON array of 3 strings.' },
        { role: 'user', content: `Question: ${question}\n\nReport:\n${report.slice(0, 2500)}` },
      ],
      AbortSignal.timeout(30_000),
      { temperature: 0.6, maxTokens: 200, timeoutSecs: 30 },
    )
    return parseArray(r.content)
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 6)
      .slice(0, 3)
  } catch {
    return []
  }
}

export async function titleFor(question: string): Promise<string> {
  const fallback = question.replace(/\s+/g, ' ').trim().slice(0, 70) || 'New research'
  try {
    const r = await chat(
      [
        { role: 'system', content: 'Write a 3 to 7 word title for this research question. Reply with the title only, no quotes, no trailing punctuation.' },
        { role: 'user', content: question.slice(0, 500) },
      ],
      AbortSignal.timeout(20_000),
      { temperature: 0.2, maxTokens: 24, timeoutSecs: 20 },
    )
    return r.content.replace(/^["'#\s]+|["'.\s]+$/g, '').split('\n')[0].slice(0, 80) || fallback
  } catch {
    return fallback
  }
}

/* ── checks and helpers ──────────────────────────────────────────── */

/** Every [n] in the report that points at no source. */
export function brokenCitations(report: string, count: number): number[] {
  const bad = new Set<number>()
  for (const m of report.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1])
    if (n < 1 || n > count) bad.add(n)
  }
  return [...bad].sort((a, b) => a - b)
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Whether `quote` really is on the page: an exact match after ignoring case and punctuation, or a near match
 *  (90% of its words in a window just a little longer than the quote) to forgive a changed comma or dash. */
export function quoteIn(quote: string, text: string): boolean {
  const q = norm(quote)
  const t = norm(text)
  if (q.length < 12) return false
  if (t.includes(q)) return true
  const qw = q.split(' ').filter((w) => w.length > 2)
  if (qw.length < 5) return false
  const need = Math.ceil(qw.length * 0.9)
  const span = Math.ceil(qw.length * 1.5)
  const want = new Set(qw)
  const tw = t.split(' ')
  for (let i = 0; i + 1 < tw.length; i++) {
    const seen = new Set<string>()
    for (let j = i; j < Math.min(tw.length, i + span); j++) if (want.has(tw[j])) seen.add(tw[j])
    if (seen.size >= Math.min(need, want.size)) return true
  }
  return false
}

function parseArray(content: string): unknown[] {
  const a = content.indexOf('[')
  const b = content.lastIndexOf(']')
  if (a === -1 || b <= a) return []
  try {
    const v = JSON.parse(content.slice(a, b + 1))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function timed<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The model took too long to respond.')), STAGE_TIMEOUT_MS)
    const onAbort = () => (window.clearTimeout(timer), reject(cancelled()))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/** Fetches one page the user pasted in and adds it as a source. */
export async function addManualSource(url: string): Promise<Source> {
  const clean = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
  const p = await fetchPage(clean)
  return { id: uid(), url: p.url || clean, title: p.title || domainOf(clean), text: p.text.slice(0, 9000), published: p.published, truncated: p.truncated, manual: true, addedMs: Date.now() }
}
