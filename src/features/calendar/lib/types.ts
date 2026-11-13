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
}

/** `done` is intentionally excluded — it's a separate completion toggle, not part of an event's schedule details, and every add/edit flow shouldn't have to carry it around. */
export type EventDraft = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'done'>
