import type { Rule } from './recurrence'
export type EventTag = 'school' | 'work' | 'personal'

export interface CalendarEvent {
  id: string
  /** ISO date (YYYY-MM-DD), local calendar day the event lives on. */
  date: string
  /** 24h "HH:MM", 15-minute increments. Ignored when `allDay` is true. */
  time: string
  /** Minutes from `time` to the event's end. Ignored when `allDay` is true. */
  durationMinutes: number
  allDay: boolean
  tag: EventTag
  title: string
  notes: string
  /** Mirrors the schedule store's `status === 'done'` — completed regardless of date/time. */
  done: boolean
  createdAt: number
  updatedAt: number
  /** Repeats on this rule (the stored event is the first day; the others are expanded from it). */
  recurrence?: Rule | null
  /** Minutes before the start to remind. */
  reminderMinutes?: number | null
  /** For one day of a repeating event: the stored event it comes from. */
  seriesId?: string
}

/** `done` is intentionally excluded — it's a separate completion toggle, not part of an event's schedule details, and every add/edit flow shouldn't have to carry it around. */
export type EventDraft = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'done' | 'seriesId'>
