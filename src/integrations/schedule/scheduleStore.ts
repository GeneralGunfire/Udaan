/**
 * Shared data layer for Calendar and Schedule. Real SQLite-backed store
 * (see integrations/schedule/client.ts + src-tauri/src/schedule) — no
 * hardcoded data. CalendarView.tsx and ScheduleView.tsx read this module's
 * synchronous getters/arrays exactly as before; the async round trip to
 * SQLite is hidden behind an in-memory cache that's hydrated on load and
 * refreshed after every CRUD write, so the view files don't need to change
 * to accommodate async access. A local-model integration reads through the
 * same module via `summarizeRange`.
 */
import {
  listEvents as dbListEvents,
  createEvent as dbCreateEvent,
  updateEvent as dbUpdateEvent,
  deleteEvent as dbDeleteEvent,
  setEventStatus as dbSetEventStatus,
} from './client'
import type {
  EventCategory as DbEventCategory,
  EventStatus,
  NewScheduleEvent,
  ScheduleEvent as DbScheduleEvent,
} from './types'

export type EventCategory = DbEventCategory

/** View-facing shape — same fields CalendarView.tsx/ScheduleView.tsx have always consumed. */
export interface ScheduleEvent {
  id: string
  title: string
  /** ISO date, e.g. "2026-08-20" */
  date: string
  /** 24h "HH:mm", omitted for all-day events */
  startTime?: string
  endTime?: string
  category: EventCategory
  description?: string
  /** True when this item has no fixed date/time yet (a loose todo-style entry). */
  unplanned?: boolean
}

export interface TodoItem {
  id: string
  label: string
  done: boolean
  /** ISO date this todo is associated with, if any */
  date?: string
}

const CHANGE_EVENT = 'udaan:schedule-changed'

function dbToViewEvent(e: DbScheduleEvent): ScheduleEvent {
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    category: e.category,
    description: e.description,
    unplanned: e.status === 'unplanned',
  }
}

function dbToTodo(e: DbScheduleEvent): TodoItem {
  return {
    id: e.id,
    label: e.title,
    done: e.status === 'done',
    date: e.date || undefined,
  }
}

// In-memory cache — the synchronous source CalendarView.tsx/ScheduleView.tsx
// read from. Populated by `hydrateScheduleCache()` (called once from
// App.tsx on startup) and refreshed after every mutation below.
let cache: DbScheduleEvent[] = []
let hydrated = false

export const SCHEDULE_EVENTS: ScheduleEvent[] = []
export const TODO_ITEMS: TodoItem[] = []

function rebuildViewArrays() {
  SCHEDULE_EVENTS.length = 0
  SCHEDULE_EVENTS.push(...cache.map(dbToViewEvent))
  TODO_ITEMS.length = 0
  TODO_ITEMS.push(...cache.map(dbToTodo))
}

/**
 * Loads all events from SQLite into the in-memory cache. Call once at app
 * startup (see App.tsx). Safe to call again to force a refresh.
 */
export async function hydrateScheduleCache(): Promise<void> {
  cache = await dbListEvents()
  hydrated = true
  rebuildViewArrays()
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

/** True once the cache has been populated from SQLite at least once. */
export function isScheduleCacheHydrated(): boolean {
  return hydrated
}

/**
 * Subscribes to cache changes (create/update/delete/status/hydrate).
 * Returns an unsubscribe function. Used by App.tsx to bump a remount key
 * so Calendar/Schedule pick up fresh data without those files needing
 * their own subscription logic.
 */
export function onScheduleChange(handler: () => void): () => void {
  const listener = () => handler()
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

async function refreshAndNotify() {
  cache = await dbListEvents()
  rebuildViewArrays()
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export async function createScheduleEvent(
  input: NewScheduleEvent,
): Promise<ScheduleEvent> {
  const created = await dbCreateEvent(input)
  await refreshAndNotify()
  return dbToViewEvent(created)
}

export async function updateScheduleEvent(
  id: string,
  patch: Partial<NewScheduleEvent> & { status?: EventStatus },
): Promise<void> {
  const existing = cache.find((e) => e.id === id)
  if (!existing) throw new Error(`Schedule event ${id} not found in cache`)
  const updated: DbScheduleEvent = {
    ...existing,
    ...patch,
    date: patch.date ?? existing.date,
    status:
      patch.status ??
      (patch.date !== undefined ? 'planned' : existing.status),
  }
  await dbUpdateEvent(updated)
  await refreshAndNotify()
}

export async function deleteScheduleEvent(id: string): Promise<void> {
  await dbDeleteEvent(id)
  await refreshAndNotify()
}

export async function setTodoDone(id: string, done: boolean): Promise<void> {
  await dbSetEventStatus(id, done ? 'done' : 'planned')
  await refreshAndNotify()
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

export function getEventsForDate(dateISO: string): ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter((e) => e.date === dateISO)
}

export function getEventsInRange(
  startISO: string,
  endISO: string,
): ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter(
    (e) => e.date && e.date >= startISO && e.date <= endISO,
  )
}

export function getUpcomingEvents(fromISO: string, limit = 5): ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter((e) => e.date && e.date >= fromISO)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
}

export function getTodosForDate(dateISO: string): TodoItem[] {
  return TODO_ITEMS.filter((t) => t.date === dateISO)
}

/**
 * Flat, model-readable summary for a date range — the shape a local-model
 * "what's on my schedule" query or morning debrief should consume.
 * Structured data, not prose — the model does the phrasing.
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
