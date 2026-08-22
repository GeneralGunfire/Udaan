/**
 * Local-model WRITE access to schedule data — the action counterpart to
 * localModelQuery.ts's read-only summaries. Two distinct paths, chosen
 * deliberately after testing qwen2.5:1.5b's real tool-calling directly:
 *
 * 1. BULK actions ("move all today's events to tomorrow", "mark everything
 *    today as done") are detected and resolved entirely in code, then
 *    executed for real — a 1.5B model reliably emits ONE correct tool call
 *    for an unambiguous single target, but for a batch it either emits
 *    only one call or invents placeholder arguments like event_id="today"
 *    instead of resolving which events that means (verified directly
 *    against the real Ollama endpoint). Code does the resolution; the
 *    model is only asked to phrase the confirmation afterward.
 *
 * 2. SINGLE actions ("move event X to Friday", "delete my dentist
 *    appointment") go through real Ollama tool-calling (see
 *    SCHEDULE_TOOLS / executeScheduleToolCall) — this reliably works for
 *    one clear target per turn.
 */
import {
  SCHEDULE_EVENTS,
  getEventsForDate,
  updateScheduleEvent,
  deleteScheduleEvent,
  setTodoDone,
  createScheduleEvent,
  type EventCategory,
} from './scheduleStore'

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Every recognized way a user might spell each relative-day/weekday word,
 * including common typos ("tommorrow", "tommorow", "tomorow" for
 * "tomorrow" — the single most common one, verified against a real user
 * message) — matched with a tolerant regex per word rather than an exact
 * list, so we're not chasing every possible misspelling by hand.
 */
const DATE_WORD_PATTERNS: { canonical: string; pattern: RegExp }[] = [
  { canonical: 'today', pattern: /\btoday\b/ },
  { canonical: 'tomorrow', pattern: /\btom+orr?ow\b/ }, // tolerates tommorrow/tommorow/tomorow/tommorrow
  { canonical: 'yesterday', pattern: /\byesterday\b/ },
  ...WEEKDAYS.map((w) => ({ canonical: w, pattern: new RegExp(`\\b${w}\\b`) })),
]

/** Resolves a canonical date word ("today", "tomorrow", "friday", ...) to an ISO date. */
function resolveDateWord(canonical: string): string {
  const today = todayISO()
  if (canonical === 'today') return today
  if (canonical === 'tomorrow') return addDays(today, 1)
  if (canonical === 'yesterday') return addDays(today, -1)

  const idx = WEEKDAYS.indexOf(canonical)
  if (idx !== -1) {
    const base = new Date(`${today}T00:00:00`)
    const todayIdx = base.getDay()
    let delta = idx - todayIdx
    if (delta <= 0) delta += 7 // next occurrence, not today/past
    return addDays(today, delta)
  }
  return today
}

/** Finds every date-word occurrence in the prompt, in the order they appear, with typo tolerance. */
function findDateWordsInOrder(prompt: string): { canonical: string; index: number }[] {
  const found: { canonical: string; index: number }[] = []
  for (const { canonical, pattern } of DATE_WORD_PATTERNS) {
    const match = prompt.match(pattern)
    if (match && match.index !== undefined) {
      found.push({ canonical, index: match.index })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

/**
 * Infers (source, target) dates for a "move X to Y" bulk request from
 * whatever date words appear in the prompt, in whatever order/phrasing:
 * - Exactly one date word ("move all my events to tomorrow") → source is
 *   today, target is that word.
 * - Two or more ("...for today, Friday, for tommorrow" or "move all today's
 *   events to tomorrow") → first occurrence is the source, last is the
 *   target. Real phrasing is rarely stricter than "earliest mentioned date
 *   is what's being moved FROM, latest mentioned is what's being moved TO".
 */
function inferSourceAndTarget(prompt: string): { source: string; target: string } | null {
  const words = findDateWordsInOrder(prompt)
  if (words.length === 0) return null
  if (words.length === 1) {
    return { source: todayISO(), target: resolveDateWord(words[0].canonical) }
  }
  const first = words[0]
  const last = words[words.length - 1]
  return { source: resolveDateWord(first.canonical), target: resolveDateWord(last.canonical) }
}

export interface BulkActionResult {
  handled: boolean
  summary: string
  affectedCount: number
}

const NOT_HANDLED: BulkActionResult = { handled: false, summary: '', affectedCount: 0 }

const MOVE_VERB = /\b(move|reschedule|shift|push)\b/
const DELETE_VERB = /\b(delete|remove|clear|cancel)\b/
const DONE_VERB = /\bmark\b.*\b(done|complete|completed|finished)\b/
const ALL_SCOPE = /\b(all|everything|every\s+event|every\s+thing)\b/

const ACTION_VERB_SIGNAL =
  /\b(move|reschedule|shift|push|delete|remove|clear|cancel|add|create|schedule|mark)\b/i

/**
 * True if the prompt looks like it's asking to DO something to the
 * schedule (not just read it) — used to decide whether to offer the model
 * tool-calling for a single-target action, separate from the bulk-pattern
 * fast path above.
 */
export function isScheduleActionRequest(prompt: string): boolean {
  return ACTION_VERB_SIGNAL.test(prompt)
}

/**
 * Detects and executes bulk schedule commands directly against the real
 * store. Deliberately decomposed rather than one rigid whole-sentence
 * regex — matches verb intent + "all/everything" scope + any date words
 * present anywhere in the sentence, independently, since real phrasing
 * varies a lot more than a single fixed pattern can capture (verified
 * against real failing user messages: comma-separated clauses, trailing
 * "and move it to X", common typos like "tommorrow"). Returns
 * `{ handled: false }` if the prompt doesn't look like a bulk command at
 * all, so the caller falls through to normal chat/tool-calling.
 */
export async function tryExecuteBulkScheduleAction(prompt: string): Promise<BulkActionResult> {
  const p = prompt.trim().toLowerCase()
  if (!ALL_SCOPE.test(p)) return NOT_HANDLED

  if (MOVE_VERB.test(p)) {
    const range = inferSourceAndTarget(p)
    if (!range) return NOT_HANDLED
    const { source, target } = range
    const events = getEventsForDate(source)
    if (events.length === 0) {
      return { handled: true, affectedCount: 0, summary: `No events found on ${source} to move.` }
    }
    for (const e of events) {
      await updateScheduleEvent(e.id, { date: target })
    }
    return {
      handled: true,
      affectedCount: events.length,
      summary: `Moved ${events.length} event(s) from ${source} to ${target}: ${events.map((e) => e.title).join(', ')}.`,
    }
  }

  if (DELETE_VERB.test(p)) {
    const words = findDateWordsInOrder(p)
    const source = words.length > 0 ? resolveDateWord(words[0].canonical) : todayISO()
    const events = getEventsForDate(source)
    if (events.length === 0) {
      return { handled: true, affectedCount: 0, summary: `No events found on ${source} to delete.` }
    }
    for (const e of events) {
      await deleteScheduleEvent(e.id)
    }
    return {
      handled: true,
      affectedCount: events.length,
      summary: `Deleted ${events.length} event(s) from ${source}: ${events.map((e) => e.title).join(', ')}.`,
    }
  }

  if (DONE_VERB.test(p)) {
    const words = findDateWordsInOrder(p)
    const source = words.length > 0 ? resolveDateWord(words[0].canonical) : todayISO()
    const events = getEventsForDate(source)
    if (events.length === 0) {
      return { handled: true, affectedCount: 0, summary: `No events found on ${source} to mark done.` }
    }
    for (const e of events) {
      await setTodoDone(e.id, true)
    }
    return {
      handled: true,
      affectedCount: events.length,
      summary: `Marked ${events.length} event(s) on ${source} as done: ${events.map((e) => e.title).join(', ')}.`,
    }
  }

  return NOT_HANDLED
}

// ---- Single-action tool-calling (real Ollama tools) ----

export const SCHEDULE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'move_event',
      description: "Moves an existing schedule event/todo to a new date. Use the event's exact id from the schedule data provided.",
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'The id of the event to move' },
          new_date: { type: 'string', description: 'New date in YYYY-MM-DD format' },
        },
        required: ['event_id', 'new_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_event',
      description: "Deletes an existing schedule event/todo. Use the event's exact id from the schedule data provided.",
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'The id of the event to delete' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_event_done',
      description: "Marks an existing schedule event/todo as done or not done. Use the event's exact id from the schedule data provided.",
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'The id of the event' },
          done: { type: 'boolean', description: 'true to mark done, false to mark not done' },
        },
        required: ['event_id', 'done'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Creates a new schedule event or todo.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'ISO date YYYY-MM-DD, omit for an unplanned todo' },
          start_time: { type: 'string', description: 'HH:mm, optional' },
          category: { type: 'string', enum: ['school', 'work', 'creativity', 'general'] },
        },
        required: ['title', 'category'],
      },
    },
  },
] as const

export interface OllamaToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

/** Executes one tool call the model emitted against the real store. Returns a plain-text result for the model/user to see. */
export async function executeScheduleToolCall(call: OllamaToolCall): Promise<string> {
  const { name, arguments: args } = call.function

  switch (name) {
    case 'move_event': {
      const eventId = String(args.event_id ?? '')
      const newDate = String(args.new_date ?? '')
      const event = SCHEDULE_EVENTS.find((e) => e.id === eventId)
      if (!event) return `No event found with id "${eventId}".`
      await updateScheduleEvent(eventId, { date: newDate })
      return `Moved "${event.title}" to ${newDate}.`
    }
    case 'delete_event': {
      const eventId = String(args.event_id ?? '')
      const event = SCHEDULE_EVENTS.find((e) => e.id === eventId)
      if (!event) return `No event found with id "${eventId}".`
      await deleteScheduleEvent(eventId)
      return `Deleted "${event.title}".`
    }
    case 'mark_event_done': {
      const eventId = String(args.event_id ?? '')
      const done = Boolean(args.done)
      const event = SCHEDULE_EVENTS.find((e) => e.id === eventId)
      if (!event) return `No event found with id "${eventId}".`
      await setTodoDone(eventId, done)
      return `Marked "${event.title}" as ${done ? 'done' : 'not done'}.`
    }
    case 'create_event': {
      const title = String(args.title ?? '').trim()
      if (!title) return 'Could not create event: no title given.'
      const category = (['school', 'work', 'creativity', 'general'] as const).includes(
        args.category as EventCategory,
      )
        ? (args.category as EventCategory)
        : 'general'
      const created = await createScheduleEvent({
        title,
        date: args.date ? String(args.date) : undefined,
        startTime: args.start_time ? String(args.start_time) : undefined,
        category,
      })
      return `Created "${created.title}"${created.date ? ` on ${created.date}` : ' (unplanned)'}.`
    }
    default:
      return `Unknown tool "${name}".`
  }
}

/** Plain-text listing of real event ids/titles/dates for the current context — lets the model reference exact ids in a tool call instead of guessing. */
export function buildEventIdReference(events: typeof SCHEDULE_EVENTS): string {
  if (events.length === 0) return 'No events currently stored.'
  return events
    .map((e) => `id=${e.id} title="${e.title}" date=${e.date || 'unplanned'}${e.startTime ? ` time=${e.startTime}` : ''}`)
    .join('\n')
}
