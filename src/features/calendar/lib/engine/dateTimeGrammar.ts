/**
 * Deterministic date/time grammar for the calendar command engine.
 *
 * Everything here is code, not LLM inference — Ollama on this hardware
 * (qwen2.5:1.5b, no GPU) is too slow and too unreliable at date arithmetic
 * to be in the hot path for something as mechanical as "next friday" or
 * "in 3 days". This grammar aims to cover the actual long tail of how
 * people phrase dates/times in speech, not just the easy cases:
 *
 *   - relative offsets: "in 3 days", "in 2 weeks", "3 days from now"
 *   - weekday references: "friday", "next friday", "last monday", "this tuesday"
 *   - relative day words: "today", "tomorrow", "yesterday" (typo-tolerant)
 *   - numeric dates: "12/25", "12/25/2026", "2026-12-25", "Dec 25", "25th of December"
 *   - clock times: "3pm", "3:30pm", "15:30", "at 9", "noon", "midnight"
 *   - time ranges: "3 to 5pm", "from 3pm to 5pm", "3-4:30pm"
 *   - durations: "for 2 hours", "for 90 minutes", "for an hour"
 *   - recurrence: "every monday", "every day", "weekly", "daily"
 *
 * Every extractor returns both a value AND a confidence + the matched span,
 * so the caller can strip matched text from the string to isolate the
 * remaining free-text title, and so low-confidence parses can be flagged
 * for clarification instead of silently guessed.
 */

export interface Span {
  start: number
  end: number
}

export interface DateMatch {
  iso: string
  confidence: number
  span: Span
  /** Human-readable description of what was matched, for confirmation UI. */
  label: string
}

export interface TimeMatch {
  hhmm: string
  confidence: number
  span: Span
  label: string
}

export interface TimeRangeMatch {
  startHHMM: string
  endHHMM: string
  confidence: number
  span: Span
}

export interface DurationMatch {
  minutes: number
  confidence: number
  span: Span
}

export interface RecurrenceMatch {
  /** 'daily' | 'weekly' | a specific weekday index (0=Sun) for "every friday" */
  kind: 'daily' | 'weekly'
  weekday?: number
  confidence: number
  span: Span
  label: string
}

const MONTH_NAMES_FULL = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const MONTH_NAMES_ABBR = MONTH_NAMES_FULL.map((m) => m.slice(0, 3))
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  return d
}

// ---- Relative day words (typo-tolerant) ----

const RELATIVE_DAY_PATTERNS: { canonical: 'today' | 'tomorrow' | 'yesterday'; pattern: RegExp }[] = [
  { canonical: 'today', pattern: /\btoday\b/i },
  { canonical: 'tomorrow', pattern: /\btom+orr?ow\b/i }, // tolerates tommorrow/tommorow/tomorow
  { canonical: 'yesterday', pattern: /\byesterda?y\b/i },
]

// ---- Relative offsets: "in 3 days", "in 2 weeks", "3 days from now" ----

const OFFSET_PATTERN =
  /\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b|\b(\d+)\s+(day|days|week|weeks|month|months)\s+from\s+now\b/i

// ---- Weekday references: "friday", "next friday", "last friday", "this friday" ----

const WEEKDAY_PATTERN = new RegExp(
  `\\b(next|last|this)?\\s*(${WEEKDAYS.join('|')})\\b`,
  'i',
)

// ---- Numeric dates: "12/25", "12/25/2026", "2026-12-25" ----

const SLASH_DATE_PATTERN = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/
const ISO_DATE_PATTERN = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/

// ---- Month-name dates: "Dec 25", "December 25th", "25th of December" ----

const MONTH_DAY_PATTERN = new RegExp(
  `\\b(${MONTH_NAMES_FULL.join('|')}|${MONTH_NAMES_ABBR.join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
  'i',
)
const DAY_MONTH_PATTERN = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(${MONTH_NAMES_FULL.join('|')}|${MONTH_NAMES_ABBR.join('|')})\\b`,
  'i',
)

function monthIndexFromName(name: string): number {
  const lower = name.toLowerCase()
  const full = MONTH_NAMES_FULL.indexOf(lower)
  if (full !== -1) return full
  return MONTH_NAMES_ABBR.indexOf(lower.slice(0, 3))
}

/**
 * Finds the single best date reference in `text`. Tries every pattern and
 * returns the highest-confidence match (explicit numeric/named dates score
 * higher than bare weekday references, which score higher than nothing).
 */
export function findDate(text: string, today: Date): DateMatch | null {
  const candidates: DateMatch[] = []

  for (const { canonical, pattern } of RELATIVE_DAY_PATTERNS) {
    const m = text.match(pattern)
    if (m && m.index !== undefined) {
      const offset = canonical === 'tomorrow' ? 1 : canonical === 'yesterday' ? -1 : 0
      const date = addDays(today, offset)
      candidates.push({
        iso: toISO(date),
        confidence: 0.95,
        span: { start: m.index, end: m.index + m[0].length },
        label: canonical,
      })
    }
  }

  const offsetMatch = text.match(OFFSET_PATTERN)
  if (offsetMatch && offsetMatch.index !== undefined) {
    const amount = Number(offsetMatch[1] ?? offsetMatch[3])
    const unit = (offsetMatch[2] ?? offsetMatch[4]).toLowerCase()
    const days = unit.startsWith('week') ? amount * 7 : unit.startsWith('month') ? amount * 30 : amount
    const date = addDays(today, days)
    candidates.push({
      iso: toISO(date),
      confidence: 0.9,
      span: { start: offsetMatch.index, end: offsetMatch.index + offsetMatch[0].length },
      label: `in ${amount} ${unit}`,
    })
  }

  const weekdayMatch = text.match(WEEKDAY_PATTERN)
  if (weekdayMatch && weekdayMatch.index !== undefined) {
    const modifier = weekdayMatch[1]?.toLowerCase()
    const targetIdx = WEEKDAYS.indexOf(weekdayMatch[2].toLowerCase())
    const todayIdx = today.getDay()
    let delta = targetIdx - todayIdx

    if (modifier === 'last') {
      delta = delta >= 0 ? delta - 7 : delta
    } else if (modifier === 'next') {
      // "next friday" always means the FOLLOWING week's friday, even if
      // today is earlier in the week than friday — distinct from bare
      // "friday" which means the nearest upcoming one.
      delta = delta <= 0 ? delta + 7 : delta
      delta += 7
    } else {
      // bare weekday or "this weekday": nearest occurrence, today counts
      if (delta < 0) delta += 7
    }

    const date = addDays(today, delta)
    candidates.push({
      iso: toISO(date),
      confidence: modifier ? 0.92 : 0.85,
      span: { start: weekdayMatch.index, end: weekdayMatch.index + weekdayMatch[0].length },
      label: weekdayMatch[0].trim(),
    })
  }

  const slashMatch = text.match(SLASH_DATE_PATTERN)
  if (slashMatch && slashMatch.index !== undefined) {
    const month = Number(slashMatch[1]) - 1
    const day = Number(slashMatch[2])
    let year = slashMatch[3] ? Number(slashMatch[3]) : today.getFullYear()
    if (year < 100) year += 2000
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let date = new Date(year, month, day)
      // No explicit year and the date already passed this year → assume next year.
      if (!slashMatch[3] && date < today) date = new Date(year + 1, month, day)
      candidates.push({
        iso: toISO(date),
        confidence: 0.97,
        span: { start: slashMatch.index, end: slashMatch.index + slashMatch[0].length },
        label: slashMatch[0],
      })
    }
  }

  const isoMatch = text.match(ISO_DATE_PATTERN)
  if (isoMatch && isoMatch.index !== undefined) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    candidates.push({
      iso: toISO(date),
      confidence: 0.98,
      span: { start: isoMatch.index, end: isoMatch.index + isoMatch[0].length },
      label: isoMatch[0],
    })
  }

  const monthDayMatch = text.match(MONTH_DAY_PATTERN)
  if (monthDayMatch && monthDayMatch.index !== undefined) {
    const month = monthIndexFromName(monthDayMatch[1])
    const day = Number(monthDayMatch[2])
    if (month !== -1 && day >= 1 && day <= 31) {
      let date = new Date(today.getFullYear(), month, day)
      if (date < today) date = new Date(today.getFullYear() + 1, month, day)
      candidates.push({
        iso: toISO(date),
        confidence: 0.94,
        span: { start: monthDayMatch.index, end: monthDayMatch.index + monthDayMatch[0].length },
        label: monthDayMatch[0],
      })
    }
  }

  const dayMonthMatch = text.match(DAY_MONTH_PATTERN)
  if (dayMonthMatch && dayMonthMatch.index !== undefined) {
    const day = Number(dayMonthMatch[1])
    const month = monthIndexFromName(dayMonthMatch[2])
    if (month !== -1 && day >= 1 && day <= 31) {
      let date = new Date(today.getFullYear(), month, day)
      if (date < today) date = new Date(today.getFullYear() + 1, month, day)
      candidates.push({
        iso: toISO(date),
        confidence: 0.94,
        span: { start: dayMonthMatch.index, end: dayMonthMatch.index + dayMonthMatch[0].length },
        label: dayMonthMatch[0],
      })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.confidence - a.confidence)
  return candidates[0]
}

// ---- Clock times ----

const NAMED_TIME_PATTERN = /\b(noon|midnight)\b/i
const CLOCK_TIME_PATTERN = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i

/** Finds a single clock time, distinct from any date/duration numbers already matched (pass `excludeSpans` to skip them). */
export function findTime(text: string, excludeSpans: Span[] = []): TimeMatch | null {
  const named = text.match(NAMED_TIME_PATTERN)
  if (named && named.index !== undefined && !overlapsAny(named.index, named[0].length, excludeSpans)) {
    const hhmm = named[1].toLowerCase() === 'noon' ? '12:00' : '00:00'
    return {
      hhmm,
      confidence: 0.97,
      span: { start: named.index, end: named.index + named[0].length },
      label: named[1],
    }
  }

  // Scan all matches, skip any overlapping an excluded span (e.g. a date's "25" in "Dec 25").
  const re = new RegExp(CLOCK_TIME_PATTERN, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (overlapsAny(match.index, match[0].length, excludeSpans)) continue
    let hour = Number(match[1])
    const minute = match[2] ? Number(match[2]) : 0
    const meridiem = match[3]?.toLowerCase()
    if (hour > 23 || minute > 59) continue

    // Bare 1-2 digit numbers with no am/pm and no colon are too ambiguous
    // to treat as a time unless they're plausible hours with an "at" cue.
    const hasExplicitCue = /^at\s/i.test(match[0]) || meridiem || match[2]
    if (!hasExplicitCue) continue

    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    if (!meridiem && hour < 8) hour += 12 // bare "at 9" → treat as 9pm-ish daytime default

    return {
      hhmm: `${pad2(hour)}:${pad2(minute)}`,
      confidence: meridiem ? 0.95 : 0.75,
      span: { start: match.index, end: match.index + match[0].length },
      label: match[0].trim(),
    }
  }
  return null
}

function overlapsAny(start: number, length: number, spans: Span[]): boolean {
  const end = start + length
  return spans.some((s) => start < s.end && end > s.start)
}

// ---- Time ranges: "3 to 5pm", "from 3pm to 5pm", "3-4:30pm" ----

const TIME_RANGE_PATTERN =
  /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i

export function findTimeRange(text: string): TimeRangeMatch | null {
  const m = text.match(TIME_RANGE_PATTERN)
  if (!m || m.index === undefined) return null

  let startHour = Number(m[1])
  const startMinute = m[2] ? Number(m[2]) : 0
  let startMeridiem = m[3]?.toLowerCase()
  let endHour = Number(m[4])
  const endMinute = m[5] ? Number(m[5]) : 0
  const endMeridiem = m[6]?.toLowerCase()

  if (startHour > 23 || endHour > 23) return null

  // "3 to 5pm" — infer the start meridiem from the end when the start omits it.
  if (!startMeridiem && endMeridiem) startMeridiem = endMeridiem

  if (startMeridiem === 'pm' && startHour < 12) startHour += 12
  if (startMeridiem === 'am' && startHour === 12) startHour = 0
  if (endMeridiem === 'pm' && endHour < 12) endHour += 12
  if (endMeridiem === 'am' && endHour === 12) endHour = 0

  return {
    startHHMM: `${pad2(startHour)}:${pad2(startMinute)}`,
    endHHMM: `${pad2(endHour)}:${pad2(endMinute)}`,
    confidence: 0.93,
    span: { start: m.index, end: m.index + m[0].length },
  }
}

// ---- Durations: "for 2 hours", "for 90 minutes", "for an hour", "for half an hour" ----

const DURATION_PATTERN =
  /\bfor\s+(?:(an?|half\s+an?)\s+hour|(\d+)\s*(?:hour|hours|hr|hrs)|(\d+)\s*(?:minute|minutes|min|mins))\b/i

export function findDuration(text: string): DurationMatch | null {
  const m = text.match(DURATION_PATTERN)
  if (!m || m.index === undefined) return null

  let minutes: number
  if (m[1]) {
    minutes = /half/i.test(m[1]) ? 30 : 60
  } else if (m[2]) {
    minutes = Number(m[2]) * 60
  } else {
    minutes = Number(m[3])
  }

  return {
    minutes,
    confidence: 0.9,
    span: { start: m.index, end: m.index + m[0].length },
  }
}

// ---- Recurrence: "every monday", "every day", "daily", "weekly" ----

const EVERY_WEEKDAY_PATTERN = new RegExp(`\\bevery\\s+(${WEEKDAYS.join('|')})\\b`, 'i')
const EVERY_DAY_PATTERN = /\bevery\s+day\b|\bdaily\b/i
const WEEKLY_PATTERN = /\bevery\s+week\b|\bweekly\b/i

export function findRecurrence(text: string): RecurrenceMatch | null {
  const weekdayMatch = text.match(EVERY_WEEKDAY_PATTERN)
  if (weekdayMatch && weekdayMatch.index !== undefined) {
    return {
      kind: 'weekly',
      weekday: WEEKDAYS.indexOf(weekdayMatch[1].toLowerCase()),
      confidence: 0.95,
      span: { start: weekdayMatch.index, end: weekdayMatch.index + weekdayMatch[0].length },
      label: weekdayMatch[0],
    }
  }
  const dailyMatch = text.match(EVERY_DAY_PATTERN)
  if (dailyMatch && dailyMatch.index !== undefined) {
    return {
      kind: 'daily',
      confidence: 0.92,
      span: { start: dailyMatch.index, end: dailyMatch.index + dailyMatch[0].length },
      label: dailyMatch[0],
    }
  }
  const weeklyMatch = text.match(WEEKLY_PATTERN)
  if (weeklyMatch && weeklyMatch.index !== undefined) {
    return {
      kind: 'weekly',
      confidence: 0.85,
      span: { start: weeklyMatch.index, end: weeklyMatch.index + weeklyMatch[0].length },
      label: weeklyMatch[0],
    }
  }
  return null
}
