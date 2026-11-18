import { invoke } from '@tauri-apps/api/core'

/**
 * A research SESSION is a conversation with the evidence: the first question runs a full investigation,
 * and every follow-up either answers from what was already read or goes and reads more. Sources belong to
 * the session (one list, no duplicates); each TURN says which of them it cites, in citation order, so
 * "[2]" always means the second entry of that turn's list.
 */

export type Phase = 'planning' | 'review' | 'searching' | 'reading' | 'drafting' | 'verifying' | 'done' | 'failed' | 'cancelled'
export type Mode = 'quick' | 'standard' | 'deep'

export interface Angle {
  id: string
  text: string
  /** What is typed into the search engine: keywords, not a sentence. */
  query: string
  status: 'pending' | 'searching' | 'reading' | 'done' | 'failed'
  note?: string
  /** How many pages were read for this angle. */
  read: number
}

export interface Source {
  id: string
  url: string
  title: string
  /** The page text (cut), used for writing and for checking quotes. */
  text: string
  published: string | null
  truncated: boolean
  angleId?: string
  /** Added by the user, not found by the search. */
  manual?: boolean
  /** Left out of the report on request. */
  excluded?: boolean
  addedMs: number
}

export type Verdict = 'supported' | 'unsupported' | 'contradicted'

export interface Claim {
  id: string
  text: string
  verdict: Verdict
  /** Source ids the checker pointed to. */
  sources: string[]
  /** Words the checker says the source contains. */
  quote?: string
  /** Whether those words really are in the source text (checked by code, not by the model). */
  quoteFound?: boolean
  reasoning?: string
}

export interface Turn {
  id: string
  question: string
  kind: 'research' | 'followup'
  mode: Mode
  /** A follow-up either reuses what was read or searches again. */
  searchedMore: boolean
  phase: Phase
  status: string
  createdMs: number
  finishedMs?: number
  angles: Angle[]
  /** Source ids this report cites, in order: [1] is cites[0]. */
  cites: string[]
  report: string
  claims: Claim[]
  factChecked: boolean
  /** Citations in the report that point at no source. */
  brokenCites: number[]
  /** The source ids the current report was written from; when `cites` (minus excluded) differs, the report is out of date. */
  draftedWith?: string[]
  suggestions?: string[]
  error?: string
}

export interface Session {
  id: string
  title: string
  pinned?: boolean
  createdMs: number
  updatedMs: number
  turns: Turn[]
  sources: Source[]
}

export interface SessionMeta {
  id: string
  title: string
  pinned: boolean
  createdMs: number
  updatedMs: number
  turns: number
  sources: number
}

export interface Settings {
  mode: Mode
  /** Pause after planning so the angles can be edited. */
  reviewPlan: boolean
  factCheck: boolean
  braveKey: string
  tavilyKey: string
}

export const MODES: Record<Mode, { label: string; blurb: string; breadth: number; depth: number; check: boolean }> = {
  quick: { label: 'Quick', blurb: '2 angles, 2 pages each. Fast, no fact-check.', breadth: 2, depth: 2, check: false },
  standard: { label: 'Standard', blurb: '3 angles, 3 pages each, checked.', breadth: 3, depth: 3, check: true },
  deep: { label: 'Deep', blurb: '5 angles, 4 pages each, checked. Takes a few minutes.', breadth: 5, depth: 4, check: true },
}

export const DEFAULT_SETTINGS: Settings = { mode: 'standard', reviewPlan: false, factCheck: true, braveKey: '', tavilyKey: '' }

const SETTINGS_KEY = 'udaan.omnifind.settings'
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    const mode = raw.mode === 'quick' || raw.mode === 'deep' || raw.mode === 'standard' ? raw.mode : DEFAULT_SETTINGS.mode
    return { ...DEFAULT_SETTINGS, ...raw, mode }
  } catch {
    return DEFAULT_SETTINGS
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* not saved */
  }
}

export const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9-]/g, '')

export const newSession = (): Session => ({ id: uid(), title: 'New research', createdMs: Date.now(), updatedMs: Date.now(), turns: [], sources: [] })

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
export const faviconOf = (url: string) => `https://www.google.com/s2/favicons?domain=${domainOf(url)}&sz=64`

/** The sources a turn cites, in citation order (a source removed from the session is skipped). */
export function citedSources(session: Session, turn: Turn): Source[] {
  return turn.cites.map((id) => session.sources.find((s) => s.id === id)).filter((s): s is Source => !!s)
}

/** True when sources were excluded, added or removed since the report was written. */
export function isStale(session: Session, turn: Turn): boolean {
  if (turn.phase !== 'done' || !turn.draftedWith) return false
  const now = turn.cites.filter((id) => session.sources.some((s) => s.id === id && !s.excluded))
  return now.length !== turn.draftedWith.length || now.some((id, i) => id !== turn.draftedWith![i])
}

export const isBusy = (t?: Turn) => !!t && !['done', 'failed', 'cancelled'].includes(t.phase)

/** The report as Markdown with a numbered source list, for exporting or copying. */
export function toMarkdown(session: Session): string {
  const out = [`# ${session.title}`, '', `_Researched ${new Date(session.createdMs).toLocaleString()}_`, '']
  for (const t of session.turns) {
    out.push(`## ${t.question}`, '', t.report || '_No report._', '')
    const src = citedSources(session, t)
    if (src.length) out.push('### Sources', '', ...src.map((s, i) => `${i + 1}. [${s.title || domainOf(s.url)}](${s.url})${s.published ? ` (${s.published})` : ''}`), '')
    const flagged = t.claims.filter((c) => c.verdict !== 'supported')
    if (t.factChecked) out.push(`### Fact-check`, '', `${t.claims.length - flagged.length} of ${t.claims.length} claims verified against the sources.`, ...flagged.map((c) => `- **${c.verdict}**: ${c.text}${c.reasoning ? ` (${c.reasoning})` : ''}`), '')
  }
  return out.join('\n')
}

export const store = {
  list: () => invoke<SessionMeta[]>('research_list'),
  get: (id: string) => invoke<Session>('research_get', { id }),
  save: (session: Session) => invoke<void>('research_save', { session }),
  remove: (id: string) => invoke<void>('research_delete', { id }),
  search: (query: string) => invoke<{ id: string; title: string; snippet: string; updatedMs: number }[]>('research_search', { query }),
  writeText: (path: string, text: string) => invoke<void>('chat_write_text', { path, text }),
}

/** One-time import of the old OmniFind history (it lived in localStorage), so earlier reports aren't lost. */
export async function importOldHistory(): Promise<number> {
  try {
    if (localStorage.getItem('research2.imported') === '1') return 0
    const old = JSON.parse(localStorage.getItem('omnifind.history.v1') ?? '[]') as {
      id: string
      question: string
      startedAt: number
      finishedAt?: number
      draft?: string
      claims?: { id: string; text: string; verdict: Verdict; citations: string[]; reasoning?: string }[]
      subQuestions: { id: string; text: string; query: string; sources: { url: string; title: string; text: string; published: string | null; truncated: boolean }[] }[]
    }[]
    let n = 0
    for (const r of old) {
      if (!r.draft) continue
      const sources: Source[] = []
      const angles: Angle[] = []
      for (const q of r.subQuestions) {
        angles.push({ id: q.id, text: q.text, query: q.query, status: 'done', read: q.sources.length })
        for (const s of q.sources) if (!sources.some((x) => x.url === s.url)) sources.push({ id: uid(), url: s.url, title: s.title, text: s.text, published: s.published, truncated: s.truncated, angleId: q.id, addedMs: r.startedAt })
      }
      const idOf = (url: string) => sources.find((s) => s.url === url)?.id
      const turn: Turn = {
        id: uid(),
        question: r.question,
        kind: 'research',
        mode: 'standard',
        searchedMore: true,
        phase: 'done',
        status: 'Imported',
        createdMs: r.startedAt,
        finishedMs: r.finishedAt,
        angles,
        cites: sources.map((s) => s.id),
        report: r.draft,
        claims: (r.claims ?? []).map((c) => ({ id: c.id, text: c.text, verdict: c.verdict, sources: c.citations.map(idOf).filter((x): x is string => !!x), reasoning: c.reasoning })),
        factChecked: !!r.claims?.length,
        brokenCites: [],
      }
      await store.save({ id: uid(), title: r.question.slice(0, 70), createdMs: r.startedAt, updatedMs: r.finishedAt ?? r.startedAt, turns: [turn], sources })
      n++
    }
    localStorage.setItem('research2.imported', '1')
    return n
  } catch {
    return 0
  }
}
