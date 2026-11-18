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
import { fmtDay, occurrenceDays, parseDay, parseRule, ruleToJson } from '../lib/recurrence'

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
    recurrence: parseRule(e.recurrence),
    reminderMinutes: e.reminderMinutes ?? null,
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
    recurrence: ruleToJson(draft.recurrence),
    reminderMinutes: draft.reminderMinutes ?? null,
  }
}

/** Which single days of a repeating event were ticked off (the stored event is shared by every day, so this is kept apart). */
const OCC_DONE_KEY = 'udaan.calendar.occDone'
function readOccDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OCC_DONE_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** "abc@2026-03-09" -> the stored event's id and the day. */
const splitId = (id: string) => {
  const i = id.indexOf('@')
  return i < 0 ? { id, day: null as string | null } : { id: id.slice(0, i), day: id.slice(i + 1) }
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
  const [occDone, setOccDone] = useState<Set<string>>(readOccDone)
  // A repeating event is stored once; the days it falls on (from last year to two years ahead) are made from its rule.
  const visible = useMemo(() => {
    const mine = events.filter((e) => (e.tag === 'work') === (profile === 'work'))
    const now = new Date()
    const from = fmtDay(new Date(now.getFullYear() - 1, now.getMonth(), 1))
    const to = fmtDay(new Date(now.getFullYear() + 2, 11, 31))
    const out: CalendarEvent[] = []
    for (const e of mine) {
      if (!e.recurrence) {
        out.push(e)
        continue
      }
      for (const d of occurrenceDays(e.date, e.recurrence, from, to)) out.push({ ...e, id: `${e.id}@${d}`, seriesId: e.id, date: d, done: occDone.has(`${e.id}@${d}`) })
    }
    return out
  }, [events, profile, occDone])
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

  // An import (or anything else outside this hook) changed the calendar.
  useEffect(() => {
    const again = () => void refresh()
    window.addEventListener('udaan:calendar-changed', again)
    return () => window.removeEventListener('udaan:calendar-changed', again)
  }, [refresh])

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
    (given: string, draftIn: EventDraft) => {
      const previous = eventsRef.current
      const { id, day } = splitId(given)
      const existing = previous.find((e) => e.id === id)
      let draft = draftIn
      if (day && existing) {
        // One day of a series was changed: the change applies to the whole series, and moving the day moves the series by as much.
        const shift = Math.round((parseDay(draftIn.date).getTime() - parseDay(day).getTime()) / 86_400_000)
        const start = new Date(parseDay(existing.date).getFullYear(), parseDay(existing.date).getMonth(), parseDay(existing.date).getDate() + shift, 12)
        draft = { ...draftIn, date: fmtDay(start), recurrence: draftIn.recurrence ?? existing.recurrence }
      }
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...draft, updatedAt: Date.now() } : e)))

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
        recurrence: ruleToJson(draft.recurrence),
        reminderMinutes: draft.reminderMinutes ?? null,
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
    (given: string) => {
      if (given.includes('@')) {
        // One day of a repeating event.
        setOccDone((cur) => {
          const next = new Set(cur)
          if (next.has(given)) next.delete(given)
          else next.add(given)
          try {
            localStorage.setItem(OCC_DONE_KEY, JSON.stringify([...next].slice(-2000)))
          } catch {
            /* not remembered */
          }
          return next
        })
        return
      }
      const id = given
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
    (given: string) => {
      const previous = eventsRef.current
      // Deleting one day of a repeating event deletes the whole series.
      const id = splitId(given).id
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
