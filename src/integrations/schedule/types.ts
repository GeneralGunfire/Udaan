export type EventCategory = 'school' | 'work' | 'creativity' | 'general' | 'personal'

/**
 * unplanned — no fixed date/time yet (a loose todo-style item)
 * planned   — has a date (and optionally a time)
 * done      — completed, regardless of how it was scheduled
 */
export type EventStatus = 'unplanned' | 'planned' | 'done'

export interface ScheduleEvent {
  id: string
  title: string
  /** ISO date (YYYY-MM-DD). Empty string for unplanned items with no date. */
  date: string
  /** 24h "HH:mm", omitted for all-day/undated items. */
  startTime?: string
  endTime?: string
  description?: string
  category: EventCategory
  status: EventStatus
  createdAt: string
  /** True for a Calendar all-day event. */
  allDay?: boolean
  /** Calendar event duration in minutes, when known. */
  durationMinutes?: number
}

export interface NewScheduleEvent {
  title: string
  /** ISO date (YYYY-MM-DD), or omitted for an unplanned/undated todo. */
  date?: string
  startTime?: string
  endTime?: string
  description?: string
  category: EventCategory
  allDay?: boolean
  durationMinutes?: number
}
