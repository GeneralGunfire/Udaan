export {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  setEventStatus,
} from './client'
export type { EventCategory, EventStatus, NewScheduleEvent, ScheduleEvent } from './types'

export {
  hydrateScheduleCache,
  isScheduleCacheHydrated,
  onScheduleChange,
  createScheduleEvent,
  updateScheduleEvent,
  deleteScheduleEvent,
  setTodoDone,
  getWeekDates,
  getEventsForDate,
  getEventsInRange,
  getUpcomingEvents,
  getTodosForDate,
  summarizeRange,
  SCHEDULE_EVENTS,
  TODO_ITEMS,
} from './scheduleStore'

export {
  isScheduleQuery,
  resolveScheduleQuery,
  buildScheduleContextMessage,
  SCHEDULE_QUERY_TEMPERATURE,
} from './localModelQuery'

export {
  tryExecuteBulkScheduleAction,
  isScheduleActionRequest,
  SCHEDULE_TOOLS,
  executeScheduleToolCall,
  buildEventIdReference,
  type BulkActionResult,
  type OllamaToolCall,
} from './scheduleActions'
