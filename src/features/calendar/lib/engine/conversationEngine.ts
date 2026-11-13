/**
 * Multi-turn orchestrator: takes one user message at a time, holds
 * conversation state across turns (a pending draft awaiting clarification,
 * or a pending destructive action awaiting confirmation), and decides
 * per-turn whether to act deterministically, ask a clarifying question, or
 * escalate to the LLM.
 *
 * State machine, not a single parse-and-go function — this is what makes
 * "add a meeting tomorrow" → "actually make it 4pm" work: the second turn
 * doesn't re-parse from scratch, it patches the pending draft from the
 * first turn.
 */
import { parseCommand, type ParsedCommand } from './intentParser'
import { resolveReference } from './fuzzyMatch'
import { disambiguateReference, interpretFreeformCreate } from './llmFallback'
import { formatTime12h, formatWeekdayMonthDay, toISODate } from '../dateUtils'
import type { CalendarEvent, EventDraft, EventTag } from '../types'

export interface PendingDraft {
  kind: 'create'
  draft: Partial<EventDraft> & { title: string }
  missing: ('date' | 'time')[]
}

export interface PendingConfirmation {
  kind: 'delete' | 'reschedule'
  event: CalendarEvent
  newDate?: string
  newTime?: string
}

export interface PendingClarification {
  kind: 'disambiguate'
  reference: string
  candidates: CalendarEvent[]
  followUp: 'delete' | 'reschedule'
  newDate?: string
  newTime?: string
}

export type EngineState = PendingDraft | PendingConfirmation | PendingClarification | null

export type EngineAction =
  | { type: 'created'; event: EventDraft }
  | { type: 'deleted'; event: CalendarEvent }
  | { type: 'rescheduled'; event: CalendarEvent; newDate: string; newTime: string | null }
  | { type: 'query'; rangeLabel: string; events: CalendarEvent[] }
  | { type: 'ask'; question: string }
  | { type: 'confirm_needed'; question: string }
  | { type: 'choices_needed'; question: string; candidates: CalendarEvent[] }
  | { type: 'error'; message: string }
  | { type: 'noop'; message: string }

export interface EngineResult {
  action: EngineAction
  nextState: EngineState
  /** True if this turn required a network round-trip to Ollama — surfaced so the UI can show a spinner honestly. */
  usedLLM: boolean
}

function defaultDraftFromParsed(parsed: ParsedCommand): PendingDraft {
  const draft: Partial<EventDraft> & { title: string } = {
    title: parsed.title ?? 'Untitled event',
    tag: parsed.tag ?? 'personal',
    notes: '',
  }
  const missing: ('date' | 'time')[] = []

  if (parsed.date) draft.date = parsed.date.iso
  else missing.push('date')

  if (parsed.allDay) {
    draft.allDay = true
    draft.time = '00:00'
    draft.durationMinutes = 24 * 60
  } else if (parsed.timeRange) {
    draft.allDay = false
    draft.time = parsed.timeRange.startHHMM
    draft.durationMinutes = minutesBetween(parsed.timeRange.startHHMM, parsed.timeRange.endHHMM)
  } else if (parsed.time) {
    draft.allDay = false
    draft.time = parsed.time.hhmm
    draft.durationMinutes = parsed.duration?.minutes ?? 30
  } else {
    missing.push('time')
  }

  if (parsed.duration && !parsed.timeRange) draft.durationMinutes = parsed.duration.minutes

  return { kind: 'create', draft, missing }
}

function minutesBetween(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(':').map(Number)
  const [eh, em] = endHHMM.split(':').map(Number)
  const diff = eh * 60 + em - (sh * 60 + sm)
  return diff > 0 ? diff : diff + 24 * 60
}

function completeDraft(draft: PendingDraft['draft']): EventDraft {
  return {
    title: draft.title,
    date: draft.date!,
    time: draft.time ?? '09:00',
    durationMinutes: draft.durationMinutes ?? 30,
    allDay: draft.allDay ?? false,
    tag: draft.tag ?? 'personal',
    notes: draft.notes ?? '',
  }
}

/**
 * Processes one turn. `state` is whatever this function returned as
 * `nextState` last time (null for a fresh conversation). Never mutates the
 * event list directly — the caller (React layer) applies `EngineAction` to
 * `useEvents` so the engine stays a pure-ish orchestrator, easy to reason
 * about and test independent of storage.
 */
export async function processTurn(
  rawInput: string,
  state: EngineState,
  events: CalendarEvent[],
  today: Date,
  signal?: AbortSignal,
): Promise<EngineResult> {
  const input = rawInput.trim()
  if (!input) return { action: { type: 'noop', message: '' }, nextState: state, usedLLM: false }

  // ---- Continue a pending draft (multi-turn: "actually make it 4pm") ----
  if (state?.kind === 'create') {
    return continuePendingDraft(input, state, today)
  }

  // ---- Continue a pending yes/no confirmation ----
  if (state?.kind === 'delete' || state?.kind === 'reschedule') {
    return continuePendingConfirmation(input, state)
  }

  // ---- Continue a pending disambiguation ("did you mean X or Y?") ----
  if (state?.kind === 'disambiguate') {
    return continuePendingDisambiguation(input, state)
  }

  // ---- Fresh turn: parse from scratch ----
  const parsed = parseCommand(input, today)

  if (parsed.intent === 'query') {
    return runQuery(parsed, events, today)
  }

  if (parsed.intent === 'create') {
    const pending = defaultDraftFromParsed(parsed)
    if (pending.missing.length === 0) {
      return {
        action: { type: 'created', event: completeDraft(pending.draft) },
        nextState: null,
        usedLLM: false,
      }
    }
    return { action: { type: 'ask', question: askForMissing(pending) }, nextState: pending, usedLLM: false }
  }

  if (parsed.intent === 'delete' || parsed.intent === 'reschedule') {
    return resolveTargetingIntent(parsed, events, today, signal)
  }

  // ---- Unknown intent: if it's schedule-shaped, try the LLM once; otherwise bail cleanly ----
  if (/\b(calendar|schedule|event|appointment|meeting|remind)\b/i.test(input)) {
    try {
      const interpreted = await interpretFreeformCreate(input, today, signal)
      if (interpreted) {
        return {
          action: {
            type: 'created',
            event: {
              title: interpreted.title,
              date: interpreted.date,
              time: interpreted.time ?? '09:00',
              durationMinutes: 30,
              allDay: interpreted.allDay ?? false,
              tag: 'personal',
              notes: '',
            },
          },
          nextState: null,
          usedLLM: true,
        }
      }
    } catch {
      // fall through to the generic "didn't understand" below
    }
  }

  return {
    action: {
      type: 'error',
      message: "I didn't catch that. Try something like \"add dentist tomorrow at 3pm\" or \"what's on my schedule today\".",
    },
    nextState: null,
    usedLLM: false,
  }
}

function askForMissing(pending: PendingDraft): string {
  if (pending.missing.includes('date') && pending.missing.includes('time')) {
    return `When should "${pending.draft.title}" be, and at what time?`
  }
  if (pending.missing.includes('date')) {
    return `What date is "${pending.draft.title}" on?`
  }
  return `What time is "${pending.draft.title}"? (Say "all day" if it has none.)`
}

function continuePendingDraft(input: string, state: PendingDraft, today: Date): EngineResult {
  const parsed = parseCommand(input, today)
  const draft = { ...state.draft }

  if (parsed.date) draft.date = parsed.date.iso
  if (parsed.allDay) {
    draft.allDay = true
    draft.time = '00:00'
    draft.durationMinutes = 24 * 60
  } else if (parsed.timeRange) {
    draft.allDay = false
    draft.time = parsed.timeRange.startHHMM
    draft.durationMinutes = minutesBetween(parsed.timeRange.startHHMM, parsed.timeRange.endHHMM)
  } else if (parsed.time) {
    draft.allDay = false
    draft.time = parsed.time.hhmm
  }
  if (parsed.duration) draft.durationMinutes = parsed.duration.minutes
  if (parsed.tag) draft.tag = parsed.tag
  // A follow-up with no recognizable grammar at all but real content might
  // be a corrected/expanded title ("actually call it Dentist checkup").
  if (!parsed.date && !parsed.time && !parsed.timeRange && parsed.title) {
    draft.title = parsed.title
  }

  const missing: ('date' | 'time')[] = []
  if (!draft.date) missing.push('date')
  if (!draft.allDay && !draft.time) missing.push('time')

  if (missing.length === 0) {
    return {
      action: { type: 'created', event: completeDraft(draft) },
      nextState: null,
      usedLLM: false,
    }
  }
  const nextPending: PendingDraft = { kind: 'create', draft, missing }
  return { action: { type: 'ask', question: askForMissing(nextPending) }, nextState: nextPending, usedLLM: false }
}

function runQuery(parsed: ParsedCommand, events: CalendarEvent[], today: Date): EngineResult {
  const todayISO = toISODate(today)
  // Date-range (week) queries are handled visually by the week view already;
  // chat queries stay single-day for a clean, readable reply.
  const date = parsed.date?.iso ?? todayISO

  const dayEvents = events.filter((e) => e.date === date).sort((a, b) => a.time.localeCompare(b.time))
  const rangeLabel =
    date === todayISO ? 'today' : formatWeekdayMonthDay(new Date(`${date}T00:00:00`))

  return {
    action: { type: 'query', rangeLabel, events: dayEvents },
    nextState: null,
    usedLLM: false,
  }
}

async function resolveTargetingIntent(
  parsed: ParsedCommand,
  events: CalendarEvent[],
  // Targeting resolves against existing events by reference text, not
  // against the current date — kept in the signature so every intent
  // resolver shares one call shape.
  _today: Date,
  signal?: AbortSignal,
): Promise<EngineResult> {
  const reference = parsed.targetReference ?? ''
  const { confident, candidates } = resolveReference(reference, events)

  const followUp = parsed.intent === 'delete' ? 'delete' : 'reschedule'
  const newDate = parsed.date?.iso
  const newTime = parsed.timeRange?.startHHMM ?? parsed.time?.hhmm

  if (!reference || candidates.length === 0) {
    return {
      action: {
        type: 'error',
        message: `I couldn't find an event matching "${reference || 'that'}".`,
      },
      nextState: null,
      usedLLM: false,
    }
  }

  let target = confident
  let usedLLM = false

  if (!target && candidates.length > 1) {
    // Genuine ambiguity — try the LLM once on the narrowed candidate set
    // before falling back to asking the user directly.
    try {
      target = await disambiguateReference(
        reference,
        candidates.map((c) => c.event),
        signal,
      )
      usedLLM = true
    } catch {
      target = null
    }
  }

  if (!target) {
    return {
      action: {
        type: 'choices_needed',
        question: `I found a few events matching "${reference}" — which one did you mean?`,
        candidates: candidates.map((c) => c.event),
      },
      nextState: {
        kind: 'disambiguate',
        reference,
        candidates: candidates.map((c) => c.event),
        followUp,
        newDate,
        newTime,
      },
      usedLLM,
    }
  }

  return confirmAction(followUp, target, newDate, newTime, usedLLM)
}

function confirmAction(
  followUp: 'delete' | 'reschedule',
  event: CalendarEvent,
  newDate: string | undefined,
  newTime: string | undefined,
  usedLLM: boolean,
): EngineResult {
  if (followUp === 'delete') {
    return {
      action: {
        type: 'confirm_needed',
        question: `Delete "${event.title}" on ${formatWeekdayMonthDay(new Date(`${event.date}T00:00:00`))}? This can't be undone.`,
      },
      nextState: { kind: 'delete', event },
      usedLLM,
    }
  }

  const resolvedDate = newDate ?? event.date
  const resolvedTime = newTime ?? event.time
  const when =
    resolvedDate === event.date
      ? `${formatTime12h(resolvedTime)}`
      : `${formatWeekdayMonthDay(new Date(`${resolvedDate}T00:00:00`))} at ${formatTime12h(resolvedTime)}`

  return {
    action: {
      type: 'confirm_needed',
      question: `Move "${event.title}" to ${when}?`,
    },
    nextState: { kind: 'reschedule', event, newDate: resolvedDate, newTime: resolvedTime },
    usedLLM,
  }
}

function continuePendingConfirmation(input: string, state: PendingConfirmation): EngineResult {
  const affirmative = /^\s*(y|yes|yeah|yep|confirm|do it|sure|ok|okay)\b/i.test(input)
  const negative = /^\s*(n|no|nope|cancel|nevermind|never mind)\b/i.test(input)

  if (affirmative) {
    if (state.kind === 'delete') {
      return { action: { type: 'deleted', event: state.event }, nextState: null, usedLLM: false }
    }
    return {
      action: {
        type: 'rescheduled',
        event: state.event,
        newDate: state.newDate ?? state.event.date,
        newTime: state.newTime ?? null,
      },
      nextState: null,
      usedLLM: false,
    }
  }
  if (negative) {
    return { action: { type: 'noop', message: 'Okay, no changes made.' }, nextState: null, usedLLM: false }
  }
  return {
    action: { type: 'ask', question: 'Sorry, just to confirm — yes or no?' },
    nextState: state,
    usedLLM: false,
  }
}

function continuePendingDisambiguation(input: string, state: PendingClarification): EngineResult {
  const normalized = input.trim().toLowerCase()

  // Accept a number ("2"), an ordinal ("the second one"), or a title fragment.
  const numberMatch = normalized.match(/\b(\d+)\b/)
  let picked: CalendarEvent | null = null
  if (numberMatch) {
    const idx = Number(numberMatch[1]) - 1
    picked = state.candidates[idx] ?? null
  }
  if (!picked) {
    const { confident } = resolveReference(input, state.candidates)
    picked = confident
  }

  if (!picked) {
    return {
      action: {
        type: 'choices_needed',
        question: "I'm still not sure which one — could you say the exact title, or a number from the list?",
        candidates: state.candidates,
      },
      nextState: state,
      usedLLM: false,
    }
  }

  return confirmAction(state.followUp, picked, state.newDate, state.newTime, false)
}

export type { EventTag }
