import { invoke } from '@tauri-apps/api/core'
import type { EventCategory, EventStatus, NewScheduleEvent, ScheduleEvent } from './types'

interface RawScheduleEvent {
  id: string
  title: string
  date: string
  start_time: string | null
  end_time: string | null
  description: string | null
  category: string
  status: string
  created_at: string
  all_day: boolean
  duration_minutes: number | null
}

function eventFromRaw(raw: RawScheduleEvent): ScheduleEvent {
  return {
    id: raw.id,
    title: raw.title,
    date: raw.date,
    startTime: raw.start_time ?? undefined,
    endTime: raw.end_time ?? undefined,
    description: raw.description ?? undefined,
    category: raw.category as EventCategory,
    status: raw.status as EventStatus,
    createdAt: raw.created_at,
    allDay: raw.all_day,
    durationMinutes: raw.duration_minutes ?? undefined,
  }
}

function eventToRaw(event: ScheduleEvent): RawScheduleEvent {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    start_time: event.startTime ?? null,
    end_time: event.endTime ?? null,
    description: event.description ?? null,
    category: event.category,
    status: event.status,
    created_at: event.createdAt,
    all_day: event.allDay ?? false,
    duration_minutes: event.durationMinutes ?? null,
  }
}

/** Lists every stored schedule event/todo, ordered by date then start time. */
export async function listEvents(): Promise<ScheduleEvent[]> {
  const raw = await invoke<RawScheduleEvent[]>('schedule_list_events')
  return raw.map(eventFromRaw)
}

/** Creates a new event/todo. A missing `date` produces an "unplanned" item. */
export async function createEvent(input: NewScheduleEvent): Promise<ScheduleEvent> {
  const event: ScheduleEvent = {
    id: crypto.randomUUID(),
    title: input.title,
    date: input.date ?? '',
    startTime: input.startTime,
    endTime: input.endTime,
    description: input.description,
    category: input.category,
    status: input.date ? 'planned' : 'unplanned',
    createdAt: new Date().toISOString(),
    allDay: input.allDay,
    durationMinutes: input.durationMinutes,
  }
  await invoke('schedule_create_event', { event: eventToRaw(event) })
  return event
}

/** Replaces an existing event's fields (title/date/time/description/category/status). */
export async function updateEvent(event: ScheduleEvent): Promise<void> {
  await invoke('schedule_update_event', { event: eventToRaw(event) })
}

export async function deleteEvent(id: string): Promise<void> {
  await invoke('schedule_delete_event', { id })
}

export async function setEventStatus(id: string, status: EventStatus): Promise<void> {
  await invoke('schedule_set_status', { id, status })
}
