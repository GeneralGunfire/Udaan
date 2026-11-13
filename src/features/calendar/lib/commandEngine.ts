/**
 * Deterministic-first natural-language command engine for the Calendar.
 * Modeled directly on `src/integrations/schedule/scheduleActions.ts` +
 * `localModelQuery.ts` — that engine was already built and verified against
 * this exact hardware constraint (qwen2.5:1.5b on a 4-core/no-GPU/8GB
 * machine): a small model reliably emits ONE correct tool call for an
 * unambiguous single target, but is unreliable at resolving dates, bulk
 * scope, or reading back structured data without inventing facts. So:
 *
 * 1. ADD, LIST/QUERY, and DELETE/RESCHEDULE-BY-CLEAR-MATCH are all resolved
 *    entirely in code — regex intent + date-word + clock-time parsing, then
 *    a direct match against real events. Zero LLM calls, zero latency, works
 *    even if Ollama isn't running.
 * 2. Only a genuinely ambiguous single-target reference (the user names an
 *    event that fuzzy-matches more than one, or doesn't fuzzy-match cleanly
 *    at all) falls back to asking the model to disambiguate — never to
 *    invent a date or title.
 */
import { toISODate } from './dateUtils'
import type { CalendarEvent, EventDraft, EventTag } from './types'

// ---- Date-word parsing (tolerant of common typos, same list as scheduleActions.ts) ----

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const DATE_WORD_PATTERNS: { canonical: string; pattern: RegExp }[] = [
  { canonical: 'today', pattern: /\btoday\b/ },
  { canonical: 'tomorrow', pattern: /\btom+orr?ow\b/ },
  { canonical: 'yesterday', pattern: /\byesterday\b/ },
  ...WEEKDAYS.map((w) => ({ canonical: w, pattern: new RegExp(`\\b${w}\\b`) })),
]

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

function resolveDateWord(canonical: string, todayISO: string): string {
  if (canonical === 'today') return todayISO
  if (canonical === 'tomorrow') return addDays(todayISO, 1)
  if (canonical === 'yesterday') return addDays(todayISO, -1)

  const idx = WEEKDAYS.indexOf(canonical)
  if (idx !== -1) {
    const base = new Date(`${todayISO}T00:00:00`)
    let delta = idx - base.getDay()
    if (delta <= 0) delta += 7
    return addDays(todayISO, delta)
  }
  return todayISO
}

/** First date word found in the prompt, resolved to an ISO date, or null if none present. */
function findDate(prompt: string, todayISO: string): string | null {
  for (const { canonical, pattern } of DATE_WORD_PATTERNS) {
    if (pattern.test(prompt)) return resolveDateWord(canonical, todayISO)
  }
  // "on the 15th", "on 12/25" style are out of scope for v1 — explicit
  // date words cover the overwhelming majority of real phrasing and keep
  // this a small, auditable regex set rather than a full date grammar.
  return null
}

// ---- Clock-time parsing ("3pm", "3:30pm", "15:00", "at 9") ----

const TIME_PATTERN = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i

function findTime(prompt: string): string | null {
  const match = prompt.match(TIME_PATTERN)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const meridiem = match[3]?.toLowerCase()

  if (hour > 23 || minute > 59) return null
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  // Bare "at 9" with no am/pm defaults to the more common daytime reading.
  if (!meridiem && hour < 8) hour += 12

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// ---- Tag inference ----

const TAG_SIGNAL: { tag: EventTag; pattern: RegExp }[] = [
  { tag: 'school', pattern: /\b(school|class|exam|homework|lecture|study)\b/i },
  { tag: 'work', pattern: /\b(work|meeting|client|deadline|standup|call)\b/i },
]

function findTag(prompt: string): EventTag {
  for (const { tag, pattern } of TAG_SIGNAL) {
    if (pattern.test(prompt)) return tag
  }
  return 'personal'
}

// ---- Title extraction: strip the recognized verb/date/time tokens, keep what's left ----

const ADD_VERB = /\b(add|create|schedule|book|set up|make)\b/i
const ALL_DAY_SIGNAL = /\ball[\s-]?day\b/i

function extractTitle(rawPrompt: string, matchedDateWord: RegExp | null): string {
  let cleaned = rawPrompt
    .replace(ADD_VERB, '')
    .replace(TIME_PATTERN, '')
    .replace(ALL_DAY_SIGNAL, '')
    .replace(/\b(an?|the|my|event|appointment|reminder)\b/gi, '')

  if (matchedDateWord) cleaned = cleaned.replace(matchedDateWord, '')
  for (const { pattern } of DATE_WORD_PATTERNS) cleaned = cleaned.replace(pattern, '')

  cleaned = cleaned
    .replace(/\bat\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')

  return cleaned || 'Untitled event'
}

// ---- Intent detection ----

const DELETE_VERB = /\b(delete|remove|cancel)\b/i
const RESCHEDULE_VERB = /\b(reschedule|postpone|push back|move|shift)\b/i
const QUERY_VERB = /\b(what|show|list|do i have|is there|anything)\b/i
const SCHEDULE_NOUN = /\b(schedule|calendar|agenda|events?|plans?|appointments?)\b/i

export type CommandIntent = 'add' | 'delete' | 'reschedule' | 'query' | 'unknown'

export function detectIntent(prompt: string): CommandIntent {
  if (RESCHEDULE_VERB.test(prompt)) return 'reschedule'
  if (DELETE_VERB.test(prompt)) return 'delete'
  if (ADD_VERB.test(prompt)) return 'add'
  if (QUERY_VERB.test(prompt) && SCHEDULE_NOUN.test(prompt)) return 'query'
  if (SCHEDULE_NOUN.test(prompt)) return 'query'
  return 'unknown'
}

// ---- Fuzzy title matching for delete/reschedule targets ----

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
}

/** Matches a spoken reference against real events by substring/word-overlap — no LLM needed for a clear match. */
export function findMatchingEvents(reference: string, events: CalendarEvent[]): CalendarEvent[] {
  const ref = normalize(reference)
  if (!ref) return []
  const refWords = new Set(ref.split(/\s+/).filter((w) => w.length > 2))

  return events.filter((e) => {
    const title = normalize(e.title)
    if (title.includes(ref) || ref.includes(title)) return true
    const titleWords = title.split(/\s+/)
    return titleWords.some((w) => refWords.has(w))
  })
}

// ---- Command results ----

export interface AddCommandResult {
  intent: 'add'
  draft: EventDraft
}

export interface QueryCommandResult {
  intent: 'query'
  rangeStart: string
  rangeEnd: string
  events: CalendarEvent[]
}

export interface DeleteCommandResult {
  intent: 'delete'
  matches: CalendarEvent[]
  reference: string
}

export interface RescheduleCommandResult {
  intent: 'reschedule'
  matches: CalendarEvent[]
  reference: string
  newDate: string | null
  newTime: string | null
}

export interface UnknownCommandResult {
  intent: 'unknown'
}

export type CommandResult =
  | AddCommandResult
  | QueryCommandResult
  | DeleteCommandResult
  | RescheduleCommandResult
  | UnknownCommandResult

/**
 * Parses a natural-language calendar command entirely in code. Returns the
 * resolved intent plus everything needed to execute it (or, for delete/
 * reschedule, the candidate matches for the caller to confirm/disambiguate
 * before acting — never auto-deletes on a fuzzy match).
 */
export function parseCommand(
  rawPrompt: string,
  events: CalendarEvent[],
  today: Date,
): CommandResult {
  const prompt = rawPrompt.trim()
  const todayISO = toISODate(today)
  const intent = detectIntent(prompt)

  if (intent === 'add') {
    const dateWordEntry = DATE_WORD_PATTERNS.find(({ pattern }) => pattern.test(prompt))
    const date = findDate(prompt, todayISO) ?? todayISO
    const allDay = ALL_DAY_SIGNAL.test(prompt)
    const time = allDay ? '00:00' : (findTime(prompt) ?? '09:00')
    const title = extractTitle(prompt, dateWordEntry?.pattern ?? null)

    return {
      intent: 'add',
      draft: {
        date,
        time,
        durationMinutes: allDay ? 24 * 60 : 30,
        allDay,
        tag: findTag(prompt),
        title,
        notes: '',
      },
    }
  }

  if (intent === 'query') {
    const asksWeek = /\bweek\b/i.test(prompt)
    const date = findDate(prompt, todayISO) ?? todayISO
    if (asksWeek) {
      const d = new Date(`${todayISO}T00:00:00`)
      const weekStart = addDays(todayISO, -d.getDay())
      const weekEnd = addDays(weekStart, 6)
      return {
        intent: 'query',
        rangeStart: weekStart,
        rangeEnd: weekEnd,
        events: events.filter((e) => e.date >= weekStart && e.date <= weekEnd),
      }
    }
    return {
      intent: 'query',
      rangeStart: date,
      rangeEnd: date,
      events: events.filter((e) => e.date === date),
    }
  }

  if (intent === 'delete') {
    const reference = prompt
      .replace(DELETE_VERB, '')
      .replace(/\b(the|my|event|appointment)\b/gi, '')
      .trim()
    return { intent: 'delete', matches: findMatchingEvents(reference, events), reference }
  }

  if (intent === 'reschedule') {
    const dateWordEntry = DATE_WORD_PATTERNS.find(({ pattern }) => pattern.test(prompt))
    const newDate = findDate(prompt, todayISO)
    const newTime = findTime(prompt)
    const reference = prompt
      .replace(RESCHEDULE_VERB, '')
      .replace(TIME_PATTERN, '')
      .replace(/\bto\b/gi, '')
      .replace(dateWordEntry?.pattern ?? /(?:)/, '')
      .replace(/\b(the|my|event|appointment)\b/gi, '')
      .trim()
    return {
      intent: 'reschedule',
      matches: findMatchingEvents(reference, events),
      reference,
      newDate,
      newTime,
    }
  }

  return { intent: 'unknown' }
}
