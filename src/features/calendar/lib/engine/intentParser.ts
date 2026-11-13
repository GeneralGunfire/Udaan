/**
 * Intent + slot extraction on top of `dateTimeGrammar.ts`. Builds a
 * `ParsedCommand` with per-slot confidence so the conversation engine can
 * decide, per turn, whether it has enough to act or needs to ask.
 *
 * Title extraction works by SPAN REMOVAL rather than strip-and-hope regex:
 * every grammar match (date, time, duration, recurrence) records its exact
 * character span in the original string; we remove those spans plus known
 * verb/filler words, and whatever survives contiguous is the title. This is
 * far more robust than chained `.replace()` calls, which corrupt titles
 * that happen to contain a stray "at" or a number.
 */
import {
  findDate,
  findDuration,
  findRecurrence,
  findTime,
  findTimeRange,
  type DateMatch,
  type DurationMatch,
  type RecurrenceMatch,
  type Span,
  type TimeMatch,
  type TimeRangeMatch,
} from './dateTimeGrammar'
import type { EventTag } from '../types'

export type CommandIntent =
  | 'create'
  | 'query'
  | 'delete'
  | 'reschedule'
  | 'update_details'
  | 'complete'
  | 'unknown'

export interface ParsedCommand {
  intent: CommandIntent
  intentConfidence: number
  title: string | null
  titleConfidence: number
  date: DateMatch | null
  time: TimeMatch | null
  timeRange: TimeRangeMatch | null
  duration: DurationMatch | null
  recurrence: RecurrenceMatch | null
  allDay: boolean
  tag: EventTag | null
  /** For delete/reschedule/update: the free-text the user used to refer to an existing event. */
  targetReference: string | null
  /** Overall confidence this parse should be acted on without clarification. */
  overallConfidence: number
}

// ---- Verb signals, ranked by specificity ----

const INTENT_PATTERNS: { intent: CommandIntent; pattern: RegExp; weight: number }[] = [
  { intent: 'delete', pattern: /\b(delete|remove|cancel|clear|scrap)\b/i, weight: 0.95 },
  {
    intent: 'reschedule',
    pattern: /\b(reschedule|postpone|push back|move|shift|bump|delay)\b/i,
    weight: 0.9,
  },
  { intent: 'complete', pattern: /\b(mark|complete|finished?|done with)\b.*\b(done|complete|finished)\b/i, weight: 0.85 },
  {
    intent: 'update_details',
    pattern: /\b(rename|change the title|update|edit)\b/i,
    weight: 0.8,
  },
  {
    intent: 'create',
    pattern: /\b(add|create|schedule|book|set up|make|plan)\b/i,
    weight: 0.85,
  },
  {
    intent: 'query',
    pattern:
      /\b(what'?s|whats|what is|show|list|do i have|is there|am i free|anything|when is|when'?s)\b/i,
    weight: 0.75,
  },
]

const SCHEDULE_NOUN = /\b(schedule|calendar|agenda|events?|plans?|appointments?|day|week)\b/i

const ALL_DAY_SIGNAL = /\ball[\s-]?day\b/i

const TAG_SIGNAL: { tag: EventTag; pattern: RegExp }[] = [
  { tag: 'school', pattern: /\b(school|class|exam|homework|lecture|study|assignment|professor|lab)\b/i },
  { tag: 'work', pattern: /\b(work|meeting|client|deadline|standup|call|project|office|boss|interview)\b/i },
]

/** Fillers/verbs/possessives that never belong in an event title, stripped after span removal. */
const FILLER_WORDS =
  /\b(a|an|the|my|event|appointment|reminder|for|to|at|on|of|please|can you|could you)\b/gi

function detectIntent(prompt: string): { intent: CommandIntent; confidence: number } {
  const scored = INTENT_PATTERNS.filter(({ pattern }) => pattern.test(prompt)).map(
    ({ intent, weight }) => ({ intent, confidence: weight }),
  )
  if (scored.length === 0) {
    // Bare schedule-noun mention with no verb reads as an implicit query
    // ("my day?", "today's schedule") — lower confidence than an explicit verb.
    if (SCHEDULE_NOUN.test(prompt)) return { intent: 'query', confidence: 0.55 }
    return { intent: 'unknown', confidence: 0 }
  }
  // Prefer the highest-weighted match; ties broken by earliest occurrence.
  scored.sort((a, b) => b.confidence - a.confidence)
  return scored[0]
}

function detectTag(prompt: string): EventTag | null {
  for (const { tag, pattern } of TAG_SIGNAL) {
    if (pattern.test(prompt)) return tag
  }
  return null
}

function removeSpans(text: string, spans: Span[]): string {
  const sorted = [...spans].sort((a, b) => b.start - a.start)
  let result = text
  for (const span of sorted) {
    result = result.slice(0, span.start) + ' ' + result.slice(span.end)
  }
  return result
}

/** Removes matched grammar spans + verb/filler words to isolate the event title. Returns null (not empty string) when nothing meaningful survives. */
function extractTitle(prompt: string, consumedSpans: Span[]): { title: string | null; confidence: number } {
  let remaining = removeSpans(prompt, consumedSpans)

  for (const { pattern } of INTENT_PATTERNS) {
    remaining = remaining.replace(pattern, ' ')
  }
  remaining = remaining.replace(ALL_DAY_SIGNAL, ' ')
  remaining = remaining.replace(FILLER_WORDS, ' ')
  remaining = remaining.replace(/\s{2,}/g, ' ').trim()
  remaining = remaining.replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, '')

  if (!remaining) return { title: null, confidence: 0 }

  // Very short leftovers ("it", "that") aren't real titles — likely a
  // reference to an existing event instead (handled via targetReference).
  const wordCount = remaining.split(/\s+/).length
  const confidence = wordCount >= 2 ? 0.9 : remaining.length >= 4 ? 0.7 : 0.4

  return { title: capitalizeFirst(remaining), confidence }
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Parses one natural-language turn into a structured command with
 * per-field confidence. Does not touch the event store or the LLM — pure
 * function, fully unit-testable, zero latency.
 */
export function parseCommand(rawPrompt: string, today: Date): ParsedCommand {
  const prompt = rawPrompt.trim()
  const { intent, confidence: intentConfidence } = detectIntent(prompt)

  const date = findDate(prompt, today)
  const timeRange = findTimeRange(prompt)
  // Only look for a standalone time if no range matched (the range already covers both endpoints).
  const time = timeRange ? null : findTime(prompt, date ? [date.span] : [])
  const duration = findDuration(prompt)
  const recurrence = findRecurrence(prompt)
  const allDay = ALL_DAY_SIGNAL.test(prompt)
  const tag = detectTag(prompt)

  const consumedSpans: Span[] = [
    date?.span,
    time?.span,
    timeRange?.span,
    duration?.span,
    recurrence?.span,
  ].filter((s): s is Span => !!s)

  const { title, confidence: titleConfidence } = extractTitle(prompt, consumedSpans)

  // For delete/reschedule/update/complete, the "title" IS the reference to
  // an existing event — same extraction, different field name for clarity
  // at the call site.
  const isTargetingIntent =
    intent === 'delete' || intent === 'reschedule' || intent === 'update_details' || intent === 'complete'

  const overallConfidence = computeOverallConfidence({
    intent,
    intentConfidence,
    isTargetingIntent,
    hasTitle: !!title,
    titleConfidence,
    hasDate: !!date,
  })

  return {
    intent,
    intentConfidence,
    title: isTargetingIntent ? null : title,
    titleConfidence: isTargetingIntent ? 0 : titleConfidence,
    date,
    time,
    timeRange,
    duration,
    recurrence,
    allDay,
    tag,
    targetReference: isTargetingIntent ? title : null,
    overallConfidence,
  }
}

function computeOverallConfidence(params: {
  intent: CommandIntent
  intentConfidence: number
  isTargetingIntent: boolean
  hasTitle: boolean
  titleConfidence: number
  hasDate: boolean
}): number {
  if (params.intent === 'unknown') return 0
  if (params.intent === 'query') return params.intentConfidence

  if (params.isTargetingIntent) {
    // Reference-based commands are confident once we have SOME reference text.
    return params.intentConfidence * (params.hasTitle ? 1 : 0.3)
  }

  // 'create' needs a title to be actionable without asking.
  let score = params.intentConfidence
  score *= params.hasTitle ? 0.5 + params.titleConfidence * 0.5 : 0.2
  return score
}
