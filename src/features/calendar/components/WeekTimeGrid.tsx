import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { formatTime12h, isSameDay, toISODate } from '../lib/dateUtils'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import type { CalendarEvent } from '../lib/types'

/**
 * A real week grid: hours down the side, days across the top, events
 * drawn at the position and height their actual time implies.
 *
 * ## Why this replaces a list per day
 * The previous week view stacked each day's events as chips. That answers
 * "what is on Tuesday" but not the questions a week view exists for: how
 * long is this meeting, do these two overlap, and where is my free
 * afternoon. Those are all spatial, and a list cannot express any of
 * them — a 20-minute call and a four-hour block were the same size, and
 * a 9am and a 6pm sat adjacent with nothing between them.
 *
 * ## Overlaps are laid out side by side
 * Two events at the same hour split the column's width rather than
 * stacking, because a hidden event is worse than a narrow one — the
 * entire reason to look at a calendar is to find the clash.
 *
 * ## The visible range adapts to the events
 * Showing all 24 hours means most of the grid is empty night. The grid
 * spans the hours actually in use, padded by one on each side, with a
 * sensible default when the week is empty. Anything outside that window
 * still appears — the range is computed from the events, so it cannot
 * exclude one.
 */

/** Pixel height of one hour row. Tall enough that a 30-minute event is a
 * readable block rather than a sliver. */
const HOUR_HEIGHT = 56

/** Shortest block that still fits its title. A 10-minute event drawn to
 * scale would be 9px tall and unreadable, so blocks have a floor and
 * simply overlap slightly when they are that short. */
const MIN_BLOCK_HEIGHT = 22

interface WeekTimeGridProps {
  weekDates: Date[]
  today: Date
  events: CalendarEvent[]
  onSelectDate: (date: Date) => void
  onSelectEvent?: (event: CalendarEvent) => void
  /** Called with a date and "HH:MM" when an empty slot is clicked, so a
   * new event can be created at exactly that time. */
  onCreateAt?: (date: Date, time: string) => void
}

export function WeekTimeGrid({
  weekDates,
  today,
  events,
  onSelectDate,
  onSelectEvent,
  onCreateAt,
}: WeekTimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())

  // The "now" line only needs minute resolution; a per-second timer would
  // re-render the whole grid sixty times more often for no visible gain.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const timed = useMemo(() => events.filter((e) => !e.allDay), [events])
  const allDay = useMemo(() => events.filter((e) => e.allDay), [events])

  const { startHour, endHour } = useMemo(() => {
    if (timed.length === 0) return { startHour: 8, endHour: 20 }
    let min = 23
    let max = 0
    for (const event of timed) {
      const startMinutes = toMinutes(event.time)
      const endMinutes = startMinutes + Math.max(15, event.durationMinutes)
      min = Math.min(min, Math.floor(startMinutes / 60))
      max = Math.max(max, Math.ceil(endMinutes / 60))
    }
    // One hour of padding either side gives events room to breathe and
    // somewhere to click to add something just before or after.
    // Always at least a full waking day (6am–11pm), widened for earlier/later events.
    return { startHour: Math.max(0, Math.min(6, min - 1)), endHour: Math.min(24, Math.max(23, max + 1)) }
  }, [timed])

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  )

  const byDay = useMemo(() => {
    const map = new Map<string, LaidOutEvent[]>()
    for (const date of weekDates) {
      const iso = toISODate(date)
      map.set(iso, layOutDay(timed.filter((e) => e.date === iso)))
    }
    return map
  }, [timed, weekDates])

  // Open on the current hour rather than at the top: a week grid scrolled
  // to 6am on a Tuesday afternoon shows nothing you need.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = (now.getHours() - startHour - 1) * HOUR_HEIGHT
    el.scrollTop = Math.max(0, target)
    // Only on mount and when the visible range changes — re-running every
    // minute would yank the view back while the user is scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHour])

  const nowOffset =
    now.getHours() >= startHour && now.getHours() < endHour
      ? (now.getHours() - startHour) * HOUR_HEIGHT + (now.getMinutes() / 60) * HOUR_HEIGHT
      : null

  const reduced = prefersReducedMotion()

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Day headers, outside the scroll area so they stay put. */}
      <div className="flex shrink-0 border-b border-(--border-hairline) pb-2">
        <div className="w-14 shrink-0" />
        {weekDates.map((date) => {
          const isToday = isSameDay(date, today)
          return (
            <button
              key={toISODate(date)}
              type="button"
              onClick={() => onSelectDate(date)}
              className="group hover:bg-surface-hover flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-1 transition-colors"
            >
              <span className="text-text-secondary text-2xs font-semibold tracking-wide uppercase">
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium">
                {isToday ? (
                  <motion.span
                    initial={reduced ? undefined : { scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={reduced ? { duration: 0 } : spring.emphasis}
                    className="bg-accent text-accent-contrast flex h-7 w-7 items-center justify-center rounded-full font-semibold"
                  >
                    {date.getDate()}
                  </motion.span>
                ) : (
                  <span className="text-text-primary">{date.getDate()}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* All-day band. Only rendered when something is in it — an empty
          reserved strip is permanent chrome for an occasional case. */}
      {allDay.length > 0 && (
        <div className="flex shrink-0 border-b border-(--border-hairline) py-1.5">
          <div className="text-text-secondary flex w-14 shrink-0 items-center justify-end pr-2 text-2xs font-medium">
            All day
          </div>
          {weekDates.map((date) => {
            const iso = toISODate(date)
            const items = allDay.filter((e) => e.date === iso)
            return (
              <div key={iso} className="flex min-w-0 flex-1 flex-col gap-0.5 px-0.5">
                {items.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelectEvent?.(event)}
                    className={cn(
                      'block min-w-0 truncate text-left text-2xs font-semibold transition-opacity duration-150 hover:opacity-70',
                      event.done ? 'text-text-tertiary line-through' : 'text-text-primary',
                    )}
                  >
                    {event.title}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Time grid */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: hours.length * HOUR_HEIGHT }}>
          {/* Hour gutter */}
          <div className="relative w-14 shrink-0">
            {hours.map((hour, index) => (
              <span
                key={hour}
                className="text-text-secondary absolute right-2 -translate-y-1/2 text-2xs font-medium tabular-nums"
                style={{ top: index * HOUR_HEIGHT }}
              >
                {index === 0 ? '' : formatHour(hour)}
              </span>
            ))}
          </div>

          {/* Day columns */}
          {weekDates.map((date) => {
            const iso = toISODate(date)
            const isToday = isSameDay(date, today)
            const laidOut = byDay.get(iso) ?? []

            return (
              <div
                key={iso}
                className={cn(
                  'relative min-w-0 flex-1 border-l border-(--border-hairline)',
                  isToday && 'bg-[var(--surface-raised)]',
                )}
              >
                {/* Hour lines, and the click targets for creating events. */}
                {hours.map((hour, index) => (
                  <button
                    key={hour}
                    type="button"
                    aria-label={`Add an event at ${formatHour(hour)} on ${date.toLocaleDateString()}`}
                    onClick={() => onCreateAt?.(date, `${String(hour).padStart(2, '0')}:00`)}
                    className="absolute inset-x-0 border-t border-(--border-hairline) transition-colors hover:bg-(--os-hover)"
                    style={{ top: index * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  />
                ))}

                {laidOut.map(({ event, column, columns }) => {
                  const startMinutes = toMinutes(event.time)
                  const top = ((startMinutes - startHour * 60) / 60) * HOUR_HEIGHT
                  const height = Math.max(
                    MIN_BLOCK_HEIGHT,
                    (Math.max(15, event.durationMinutes) / 60) * HOUR_HEIGHT,
                  )
                  const width = 100 / columns

                  return (
                    <motion.button
                      key={event.id}
                      type="button"
                      onClick={() => onSelectEvent?.(event)}
                      title={`${formatTime12h(event.time)} · ${event.title}`}
                      initial={reduced ? undefined : { opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={reduced ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0, 0, 1] }}
                      style={{
                        top,
                        height: height - 2,
                        left: `calc(${column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      className={cn(
                        'absolute z-10 flex flex-col items-start gap-0.5 overflow-hidden rounded-md px-1 py-1 text-left',
                        'transition-opacity duration-100 hover:z-20 hover:opacity-70',
                        event.done && 'line-through opacity-55',
                      )}
                    >
                      <span className="text-text-primary w-full truncate text-2xs-alt leading-tight font-semibold">
                        {event.title}
                      </span>
                      {height > 34 && (
                        <span className="text-text-secondary w-full truncate text-3xs tabular-nums">
                          {formatTime12h(event.time)}
                        </span>
                      )}
                    </motion.button>
                  )
                })}

                {/* Current-time line, on today's column only. */}
                {isToday && nowOffset !== null && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-30"
                    style={{ top: nowOffset }}
                  >
                    <div className="bg-danger h-px w-full" />
                    <div className="bg-danger absolute -top-[3px] left-0 h-1.5 w-1.5 rounded-full" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface LaidOutEvent {
  event: CalendarEvent
  /** Which sub-column this event occupies within its overlap group. */
  column: number
  /** How many sub-columns that group needs. */
  columns: number
}

/**
 * Assigns overlapping events to side-by-side columns.
 *
 * Events are swept in start order; each is placed in the first column
 * whose last event has already ended. A group of mutually overlapping
 * events all share the same column count so they line up as a block
 * rather than each being sized independently — which is what makes a
 * clash read as one thing to resolve rather than several unrelated ones.
 */
function layOutDay(events: CalendarEvent[]): LaidOutEvent[] {
  const sorted = [...events].sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
  const result: LaidOutEvent[] = []

  let group: CalendarEvent[] = []
  let groupEnd = -1

  function flush() {
    if (group.length === 0) return
    const columnEnds: number[] = []
    const placed: { event: CalendarEvent; column: number }[] = []

    for (const event of group) {
      const start = toMinutes(event.time)
      const end = start + Math.max(15, event.durationMinutes)
      let column = columnEnds.findIndex((columnEnd) => columnEnd <= start)
      if (column === -1) {
        column = columnEnds.length
        columnEnds.push(end)
      } else {
        columnEnds[column] = end
      }
      placed.push({ event, column })
    }

    for (const item of placed) {
      result.push({ ...item, columns: columnEnds.length })
    }
    group = []
    groupEnd = -1
  }

  for (const event of sorted) {
    const start = toMinutes(event.time)
    const end = start + Math.max(15, event.durationMinutes)
    // A new group starts as soon as an event begins after everything in
    // the current one has finished.
    if (group.length > 0 && start >= groupEnd) flush()
    group.push(event)
    groupEnd = Math.max(groupEnd, end)
  }
  flush()

  return result
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours || 0) * 60 + (minutes || 0)
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return 'Noon'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}
