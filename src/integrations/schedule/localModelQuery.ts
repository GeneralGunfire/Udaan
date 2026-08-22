/**
 * Local-model read access to schedule data. Detects schedule-shaped
 * questions ("what's on my schedule today", "what do I have this week")
 * and resolves the date range they're asking about, returning the
 * structured `summarizeRange` payload for the caller and a plain-text
 * grounding block for the model.
 *
 * A 1.5B model reasoning over raw JSON is unreliable — verified directly:
 * given real data (2 events on one day, nothing on others) it reported
 * "nothing scheduled" on one call and invented extra events/times on
 * another, despite an explicit "do not invent events" instruction. Small
 * models follow a flat enumerated list much more reliably than JSON, so
 * the context block below is plain lines, not JSON, plus a low sampling
 * temperature (see `SCHEDULE_QUERY_TEMPERATURE`) to suppress improvisation.
 */
import { getWeekDates, summarizeRange } from './scheduleStore'

const SCHEDULE_SIGNAL =
  /\b(schedule|calendar|agenda|todo|to-do|to do|events?|plans?|appointments?)\b/i

/** Low temperature for schedule lookups — this is a factual reporting task, not creative writing. */
export const SCHEDULE_QUERY_TEMPERATURE = 0.1

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** True if the prompt looks like it's asking about schedule/calendar/todo data. */
export function isScheduleQuery(prompt: string): boolean {
  return SCHEDULE_SIGNAL.test(prompt)
}

/**
 * Resolves the date range implied by a schedule-shaped prompt and returns
 * the structured summary for it. Defaults to "today" unless the prompt
 * mentions "week".
 */
export function resolveScheduleQuery(prompt: string) {
  const today = todayISO()
  const asksWeek = /\bweek\b/i.test(prompt)

  if (asksWeek) {
    const week = getWeekDates(today)
    return summarizeRange(week[0], week[6])
  }
  return summarizeRange(today, today)
}

function formatDateLabel(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

/**
 * Renders the schedule summary as a flat, unambiguous line list — one
 * fact per line, no nesting, no JSON — the format small models track
 * most reliably. Every line is a literal fact; there is nothing to infer.
 */
function renderFactLines(summary: ReturnType<typeof resolveScheduleQuery>): string[] {
  const lines: string[] = []

  if (summary.events.length === 0) {
    lines.push('EVENTS: none')
  } else {
    for (const e of summary.events) {
      lines.push(
        `EVENT: "${e.title}" on ${formatDateLabel(e.date)}, time: ${e.time}, category: ${e.category}`,
      )
    }
  }

  const relevantTodos = summary.todos.filter(
    (t) => !t.date || (t.date >= summary.range.start && t.date <= summary.range.end),
  )
  if (relevantTodos.length === 0) {
    lines.push('TODOS: none')
  } else {
    for (const t of relevantTodos) {
      lines.push(`TODO: "${t.label}", done: ${t.done ? 'yes' : 'no'}, date: ${t.date ?? 'unscheduled'}`)
    }
  }

  return lines
}

/**
 * Builds a system-message string with the structured schedule data for a
 * query, to prepend to a local-model chat call. Plain enumerated facts,
 * not JSON — the model's only job is to read these lines back in natural
 * language, never to add, remove, or reinterpret them.
 */
export function buildScheduleContextMessage(prompt: string): string {
  const summary = resolveScheduleQuery(prompt)
  const facts = renderFactLines(summary)

  return [
    'You are answering a question about the user\'s real schedule.',
    'Below is the COMPLETE and ONLY list of real facts for the requested date range. There is no other data.',
    '',
    ...facts,
    '',
    'Rules:',
    '- Use ONLY the facts listed above. Every event/todo you mention must be copied from a line above, unchanged.',
    '- Do NOT invent, guess, merge, or reassign any title, date, time, or category not shown above.',
    '- If a line says "none", say plainly that nothing is scheduled for that — do not list anything.',
    '- If unsure whether a detail was given, omit it rather than guessing.',
    '- Keep the answer short and organized by date if multiple days are involved.',
  ].join('\n')
}
