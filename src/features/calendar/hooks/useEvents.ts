import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProfile } from '@/os/kernel/profile'
import {
  listEvents as dbListEvents,
  createEvent as dbCreateEvent,
  updateEvent as dbUpdateEvent,
  deleteEvent as dbDeleteEvent,
  setEventStatus as dbSetEventStatus,
} from '@/integrations/schedule/client'
import { hydrateScheduleCache, isScheduleCacheHydrated } from '@/integrations/schedule/scheduleStore'
import type { ScheduleEvent as DbScheduleEvent } from '@/integrations/schedule/types'
import type { CalendarEvent, EventDraft, EventTag } from '../lib/types'

const LEGACY_STORAGE_KEY = 'udaan.calendar.events'
const MIGRATION_FLAG_KEY = 'udaan.calendar.migratedToSqlite'

function calendarEventFromDb(e: DbScheduleEvent): CalendarEvent {
  return {
    id: e.id,
    date: e.date,
    time: e.allDay ? '00:00' : (e.startTime ?? '00:00'),
    durationMinutes: e.allDay ? 24 * 60 : (e.durationMinutes ?? 30),
    allDay: !!e.allDay,
    tag: (e.category as EventTag) ?? 'personal',
    title: e.title,
    notes: e.description ?? '',
    done: e.status === 'done',
    createdAt: Date.parse(e.createdAt) || Date.now(),
    updatedAt: Date.parse(e.createdAt) || Date.now(),
  }
}

function draftToDbInput(draft: EventDraft) {
  return {
    title: draft.title,
    date: draft.date,
    startTime: draft.allDay ? undefined : draft.time,
    category: draft.tag,
    description: draft.notes || undefined,
    allDay: draft.allDay,
    durationMinutes: draft.durationMinutes,
  }
}

/** Reads any pre-migration events sitting in localStorage, without touching them. */
function readLegacyLocalStorageEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * One-time migration of legacy localStorage calendar events into the SQLite
 * schedule store. Idempotent via a localStorage flag — safe to call on
 * every startup. Never deletes the original localStorage data; just stops
 * reading it once migrated. Logs a verifiable summary to the console.
 */
async function migrateLegacyEventsIfNeeded(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === '1') return

  const legacyEvents = readLegacyLocalStorageEvents()
  if (legacyEvents.length === 0) {
    localStorage.setItem(MIGRATION_FLAG_KEY, '1')
    return
  }

  let migrated = 0
  const failures: { id: string; title: string; reason: string }[] = []

  for (const e of legacyEvents) {
    try {
      await dbCreateEvent({
        title: e.title,
        date: e.date,
        startTime: e.allDay ? undefined : e.time,
        category: e.tag,
        description: e.notes || undefined,
        allDay: e.allDay,
        durationMinutes: e.durationMinutes,
      })
      migrated++
    } catch (err) {
      failures.push({ id: e.id, title: e.title, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  localStorage.setItem(MIGRATION_FLAG_KEY, '1')

  if (failures.length > 0) {
    console.error(
      `[calendar migration] Migrated ${migrated}/${legacyEvents.length} events to SQLite. ${failures.length} failed:`,
      failures,
    )
  } else {
    console.info(`[calendar migration] Migrated ${migrated} event(s) from localStorage to SQLite.`)
  }
}

export interface UseEventsResult {
  events: CalendarEvent[]
  addEvent: (draft: EventDraft) => void
  updateEvent: (id: string, draft: EventDraft) => void
  deleteEvent: (id: string) => void
  toggleEventDone: (id: string) => void
  eventsByDate: (isoDate: string) => CalendarEvent[]
  /** True once the initial SQLite load (and any migration) has completed. */
  isLoaded: boolean
  /** Set when the initial load or a mutation fails — distinct from "genuinely zero events". */
  loadError: string | null
}

/**
 * SQLite-backed event store (see src-tauri/src/schedule + integrations/schedule).
 * Presents the same synchronous-looking `events` array and callback shape the
 * UI has always consumed; SQLite reads/writes happen underneath via an
 * in-memory mirror that's refreshed after every mutation, so callers don't
 * need to await anything or handle loading states beyond `isLoaded`/`loadError`.
 */
export function useEvents(): UseEventsResult {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Work keeps to events tagged "work"; Personal leaves them out. The stored events are never touched.
  const profile = useProfile()
  const visible = useMemo(() => events.filter((e) => (e.tag === 'work') === (profile === 'work')), [events, profile])
  const eventsRef = useRef(events)
  eventsRef.current = events

  const refresh = useCallback(async () => {
    try {
      const raw = await dbListEvents()
      setEvents(raw.map(calendarEventFromDb))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load calendar events.')
    } finally {
      setIsLoaded(true)
    }

    // Keep General Chat's schedule-assistant cache in sync — Calendar and
    // the schedule assistant now share the same schedule_events table.
    if (isScheduleCacheHydrated()) {
      hydrateScheduleCache().catch(() => {
        // Non-fatal: the assistant's cache just stays one write behind until its next own mutation.
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await migrateLegacyEventsIfNeeded()
      if (cancelled) return
      await refresh()
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const addEvent = useCallback(
    (given: EventDraft) => {
      const draft: EventDraft = profile === 'work' ? { ...given, tag: 'work' } : given
      const tempId = crypto.randomUUID()
      const now = Date.now()
      // `done` is omitted from EventDraft by design (see types.ts) — a
      // newly-created event has never been completed, so it starts false.
      const optimisticEvent: CalendarEvent = { ...draft, id: tempId, createdAt: now, updatedAt: now, done: false }
      setEvents((prev) => [...prev, optimisticEvent])

      dbCreateEvent(draftToDbInput(draft))
        .then(() => refresh())
        .catch((err) => {
          setEvents((prev) => prev.filter((e) => e.id !== tempId))
          setLoadError(err instanceof Error ? err.message : 'Failed to save the new event.')
        })

      return optimisticEvent
    },
    [refresh, profile],
  )

  const updateEvent = useCallback(
    (id: string, draft: EventDraft) => {
      const previous = eventsRef.current
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...draft, updatedAt: Date.now() } : e)))

      const existing = previous.find((e) => e.id === id)
      dbUpdateEvent({
        id,
        title: draft.title,
        date: draft.date,
        startTime: draft.allDay ? undefined : draft.time,
        endTime: undefined,
        category: draft.tag,
        // Editing an event's schedule details shouldn't silently un-complete
        // it — preserve whatever status it already had (this hardcoded
        // 'planned' previously reset a done event back to not-done on any edit).
        status: existing?.done ? 'done' : 'planned',
        description: draft.notes || undefined,
        createdAt: existing ? new Date(existing.createdAt).toISOString() : new Date().toISOString(),
        allDay: draft.allDay,
        durationMinutes: draft.durationMinutes,
      })
        .then(() => refresh())
        .catch((err) => {
          setEvents(previous)
          setLoadError(err instanceof Error ? err.message : 'Failed to update the event.')
        })
    },
    [refresh],
  )

  const toggleEventDone = useCallback(
    (id: string) => {
      const previous = eventsRef.current
      const existing = previous.find((e) => e.id === id)
      if (!existing) return
      const nextDone = !existing.done

      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, done: nextDone, updatedAt: Date.now() } : e)))

      dbSetEventStatus(id, nextDone ? 'done' : 'planned')
        .then(() => refresh())
        .catch((err) => {
          setEvents(previous)
          setLoadError(err instanceof Error ? err.message : 'Failed to update the event.')
        })
    },
    [refresh],
  )

  const deleteEvent = useCallback(
    (id: string) => {
      const previous = eventsRef.current
      setEvents((prev) => prev.filter((e) => e.id !== id))

      dbDeleteEvent(id)
        .then(() => refresh())
        .catch((err) => {
          setEvents(previous)
          setLoadError(err instanceof Error ? err.message : 'Failed to delete the event.')
        })
    },
    [refresh],
  )

  const eventsByDate = useCallback(
    (isoDate: string) =>
      visible.filter((e) => e.date === isoDate).sort((a, b) => a.time.localeCompare(b.time)),
    [visible],
  )

  return { events: visible, addEvent, updateEvent, deleteEvent, toggleEventDone, eventsByDate, isLoaded, loadError }
}
