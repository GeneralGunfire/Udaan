import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { DAY_NAMES, getMonthGrid, isSameDay, toISODate } from '../lib/dateUtils'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import type { CalendarEvent } from '../lib/types'

export interface BigMonthGridProps {
  year: number
  month: number
  today: Date
  eventsByDate: Map<string, CalendarEvent[]>
  onSelectDate: (date: Date) => void
  onSelectEvent: (event: CalendarEvent) => void
}

const MAX_VISIBLE_PER_CELL = 3

/**
 * The main month surface, modeled on the "Cal." reference: a real data
 * grid where each day cell shows its own event rows (title + tag colour)
 * rather than a single dot standing in for "something happened here." The
 * compact dot-only `MonthGrid` stays as-is for the sidebar mini-picker and
 * EventModal's date step, where cell space can't fit event text — this is
 * the large primary view's own grid.
 */
export function BigMonthGrid({ year, month, today, eventsByDate, onSelectDate, onSelectEvent }: BigMonthGridProps) {
  // Only the weeks this month actually touches (5 for most months, not always 6).
  const all = getMonthGrid(year, month)
  const weeks = Math.ceil((all.findLastIndex((c) => c.inCurrentMonth) + 1) / 7)
  const cells = all.slice(0, weeks * 7)
  const reduced = prefersReducedMotion()

  const rowCount = cells.length / 7

  return (
    <div
      className="border-hairline flex flex-col overflow-hidden rounded-2xl border"
      // A genuine floating card, not a flat panel: --shadow-overlay is the
      // same weight the OS gives a real elevated surface (a popover, a
      // context menu) — enough presence to read as "above the page"
      // without tipping into a modal's heaviness.
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-overlay)' }}
    >
      <div className="border-hairline text-text-tertiary grid shrink-0 grid-cols-7 border-b text-center text-2xs font-semibold tracking-wide uppercase">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-2.5">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7" style={{ gridTemplateRows: `repeat(${rowCount}, 104px)` }}>
        {cells.map(({ date, inCurrentMonth }, i) => {
          const iso = toISODate(date)
          const isToday = isSameDay(date, today)
          const dayEvents = eventsByDate.get(iso) ?? []
          const overflow = dayEvents.length - MAX_VISIBLE_PER_CELL

          return (
            <motion.button
              key={date.toISOString()}
              type="button"
              onClick={() => onSelectDate(date)}
              initial={reduced ? undefined : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.22, delay: Math.min(i * 0.008, 0.3), ease: [0.2, 0, 0, 1] }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                'border-hairline group relative flex h-full min-h-0 flex-col items-stretch gap-1 overflow-hidden border-r border-b p-2 text-left transition-colors duration-150 hover:bg-surface-hover',
                (i + 1) % 7 === 0 && 'border-r-0',
                isToday && 'bg-accent/[0.08]',
                i >= cells.length - 7 && 'border-b-0',
              )}
            >
              <span
                className={cn(
                  'flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                  !inCurrentMonth && 'text-text-tertiary/40',
                  inCurrentMonth && !isToday && 'text-text-primary',
                )}
              >
                {isToday ? (
                  <motion.span
                    initial={reduced ? undefined : { scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={reduced ? { duration: 0 } : spring.emphasis}
                    className="bg-accent text-accent-contrast flex h-5.5 w-5.5 items-center justify-center rounded-full"
                  >
                    {date.getDate()}
                  </motion.span>
                ) : (
                  date.getDate()
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {dayEvents.slice(0, MAX_VISIBLE_PER_CELL).map((event) => (
                  <span
                    key={event.id}
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectEvent(event)
                    }}
                    className={cn(
                      'flex min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 py-[3px] text-left text-[11.5px] font-medium leading-tight transition-[filter] duration-150 hover:brightness-125',
                      'bg-[var(--os-menu-item-hover)] text-[var(--color-text-primary)]',
                      event.done && 'opacity-60',
                    )}
                  >
                    {!event.allDay && event.time && <span className="shrink-0 tabular-nums opacity-70">{event.time}</span>}
                    <span className="truncate">{event.title}</span>
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="text-text-secondary text-2xs font-semibold">+{overflow} more</span>
                )}
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
