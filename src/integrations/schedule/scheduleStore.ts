/**
 * Shared data layer for Calendar and Schedule. Plain typed data + query
 * functions, no rendering — both the UI and a local-model integration read
 * through this same module, so "what's on my schedule" or a morning debrief
 * can call `getEventsForDate` / `getEventsInRange` directly instead of
 * scraping rendered UI.
 */

export type EventCategory = 'school' | 'work' | 'creativity' | 'general'

export interface ScheduleEvent {
  id: string
  title: string
  /** ISO date, e.g. "2026-08-20" */
  date: string
  /** 24h "HH:mm", omitted for all-day events */
  startTime?: string
  endTime?: string
  category: EventCategory
  location?: string
  notes?: string
}

export interface TodoItem {
  id: string
  label: string
  done: boolean
  /** ISO date this todo is associated with, if any */
  date?: string
}

/** Monday-start ISO week days for the week containing `dateISO`. */
export function getWeekDates(dateISO: string): string[] {
  const d = new Date(`${dateISO}T00:00:00`)
  const day = d.getDay() // 0 = Sunday
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + mondayOffset)

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  })
}

// Placeholder data — not real data, swap for a real store once persistence exists.
export const SCHEDULE_EVENTS: ScheduleEvent[] = [
  {
    id: 'evt-1',
    title: 'Calculus Study Group',
    date: '2026-08-20',
    startTime: '09:00',
    endTime: '10:30',
    category: 'school',
  },
  {
    id: 'evt-2',
    title: 'Client Call — Portfolio Review',
    date: '2026-08-20',
    startTime: '14:00',
    endTime: '15:00',
    category: 'work',
  },
  {
    id: 'evt-3',
    title: 'Quiz Generator Demo',
    date: '2026-08-21',
    startTime: '11:00',
    endTime: '12:00',
    category: 'school',
  },
  {
    id: 'evt-4',
    title: 'DJ Set Prep',
    date: '2026-08-22',
    startTime: '18:00',
    endTime: '20:00',
    category: 'creativity',
  },
  {
    id: 'evt-5',
    title: 'Proposal Deadline',
    date: '2026-08-25',
    category: 'work',
  },
  {
    id: 'evt-6',
    title: 'Reading Summary Due',
    date: '2026-08-27',
    category: 'school',
  },
]

export const TODO_ITEMS: TodoItem[] = [
  {
    id: 'todo-1',
    label: 'Finish past-paper set 3',
    done: false,
    date: '2026-08-20',
  },
  { id: 'todo-2', label: 'Send client quote', done: false, date: '2026-08-20' },
  {
    id: 'todo-3',
    label: 'Export DJ set stems',
    done: true,
    date: '2026-08-22',
  },
  { id: 'todo-4', label: 'Review portfolio copy', done: false },
]

export function getEventsForDate(dateISO: string): ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter((e) => e.date === dateISO)
}

export function getEventsInRange(
  startISO: string,
  endISO: string,
): ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter((e) => e.date >= startISO && e.date <= endISO)
}

export function getUpcomingEvents(fromISO: string, limit = 5): ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter((e) => e.date >= fromISO)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
}

export function getTodosForDate(dateISO: string): TodoItem[] {
  return TODO_ITEMS.filter((t) => t.date === dateISO)
}

/**
 * Flat, model-readable summary for a date range — the shape a local-model
 * "what's on my schedule" query or morning debrief should consume.
 */
export function summarizeRange(startISO: string, endISO: string) {
  return {
    range: { start: startISO, end: endISO },
    events: getEventsInRange(startISO, endISO).map((e) => ({
      title: e.title,
      date: e.date,
      time: e.startTime ? `${e.startTime}–${e.endTime ?? ''}` : 'all day',
      category: e.category,
    })),
    todos: TODO_ITEMS.filter(
      (t) => !t.date || (t.date >= startISO && t.date <= endISO),
    ).map((t) => ({ label: t.label, done: t.done, date: t.date ?? null })),
  }
}
