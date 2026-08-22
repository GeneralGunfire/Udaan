import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { QuickEditEvent } from '@/shared/components/QuickEditEvent'
import { spring, pressableIcon, prefersReducedMotion } from '@/shared/lib/motion'
import { CalendarIcon, ChevronRightIcon } from '@/shared/icons'
import {
  TODO_ITEMS,
  getEventsForDate,
  getUpcomingEvents,
  getWeekDates,
  type EventCategory,
} from '@/integrations/schedule/scheduleStore'
import { WeatherWidget } from './components/WeatherWidget'

type FilterId = 'all' | 'planned' | 'unplanned'

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'planned', label: 'Planned' },
  { id: 'unplanned', label: 'Unplanned' },
]

function categoryDotVar(category: EventCategory) {
  return `--color-accent-${category}`
}

function todayISO() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Schedule page. Top row: today-at-a-glance + weather, evenly matched
 * heights. Below: weekly day-by-day breakdown with a planned/unplanned/all
 * filter, alongside a clock widget and a grouped todo panel — planner-style
 * layout, dark glass, consistent card alignment throughout.
 */
export function ScheduleView() {
  const today = todayISO()
  const upcoming = getUpcomingEvents(today, 5)
  const weekDates = useMemo(() => getWeekDates(today), [today])
  const [filter, setFilter] = useState<FilterId>('all')

  const todayCount = getEventsForDate(today).length
  const doneTodos = TODO_ITEMS.filter((t) => t.done)
  const pendingTodos = TODO_ITEMS.filter((t) => !t.done)
  const reduced = prefersReducedMotion()

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4 overflow-y-auto py-4">
      {/* Top — today at a glance + weather, matched heights */}
      <div className="grid grid-cols-[1fr_280px] items-stretch gap-4">
        <GlassPanel className="flex flex-col justify-between gap-4">
          <div className="flex items-center gap-2">
            <CalendarIcon width={16} height={16} className="text-brand-teal" />
            <h1 className="font-display text-text-primary text-[16px] font-semibold">
              Schedule
            </h1>
          </div>
          <div className="flex items-end gap-6">
            <div>
              <div className="text-text-primary text-[26px] leading-none font-semibold tabular-nums">
                {todayCount}
              </div>
              <div className="text-text-tertiary mt-1 text-[11px]">
                event{todayCount === 1 ? '' : 's'} today
              </div>
            </div>
            <div>
              <div className="text-text-primary text-[26px] leading-none font-semibold tabular-nums">
                {upcoming.length}
              </div>
              <div className="text-text-tertiary mt-1 text-[11px]">
                coming up this week
              </div>
            </div>
            <div>
              <div className="text-text-primary text-[26px] leading-none font-semibold tabular-nums">
                {pendingTodos.length}
              </div>
              <div className="text-text-tertiary mt-1 text-[11px]">
                todos pending
              </div>
            </div>
          </div>
        </GlassPanel>

        <WeatherWidget />
      </div>

      {/* Below — weekly breakdown */}
      <div className="grid grid-cols-[1fr_240px] items-start gap-4">
        <GlassPanel className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-text-primary text-[14px] font-medium">
              This Week
            </h2>
            <div className="glass-surface flex shrink-0 items-center gap-0.5 rounded-full p-1">
              {FILTERS.map((f) => {
                const isActive = f.id === filter
                return (
                  <motion.button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    whileTap={reduced ? undefined : pressableIcon.whileTap}
                    transition={pressableIcon.transition}
                    className="focus-visible:ring-brand-cyan/60 relative rounded-full px-2.5 py-1 text-[10.5px] font-medium outline-none focus-visible:ring-2"
                  >
                    {isActive && (
                      <motion.div
                        layoutId="schedule-filter-pill"
                        transition={spring.standard}
                        className="bg-glass-hover absolute inset-0 rounded-full"
                      />
                    )}
                    <span
                      className={`relative ${isActive ? 'text-text-primary' : 'text-text-tertiary'}`}
                    >
                      {f.label}
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </div>

          <div className="divide-glass-border flex flex-col divide-y">
            {weekDates.map((dateISO) => {
              const events = getEventsForDate(dateISO)
              const filtered =
                filter === 'planned'
                  ? events.filter((e) => !e.unplanned)
                  : filter === 'unplanned'
                    ? events.filter((e) => e.unplanned)
                    : events
              const isToday = dateISO === today
              const dayLabel = new Date(
                `${dateISO}T00:00:00`,
              ).toLocaleDateString('en-US', { weekday: 'short' })
              const dateLabel = new Date(
                `${dateISO}T00:00:00`,
              ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

              return (
                <div
                  key={dateISO}
                  className={`flex items-start gap-3 rounded-[10px] px-2.5 py-2.5 first:pt-1 last:pb-1 ${
                    isToday ? 'bg-glass-hover' : ''
                  }`}
                >
                  <div className="w-16 shrink-0 pt-0.5">
                    <div
                      className={`text-[12px] font-medium ${isToday ? 'text-brand-teal' : 'text-text-primary'}`}
                    >
                      {dayLabel}
                    </div>
                    <div className="text-text-tertiary text-[10.5px]">
                      {dateLabel}
                    </div>
                  </div>
                  <div className="flex min-h-6 flex-1 flex-col gap-1">
                    {filtered.length === 0 ? (
                      <span className="text-text-tertiary py-0.5 text-[11.5px]">
                        {filter === 'unplanned' ? 'Free' : 'No events'}
                      </span>
                    ) : (
                      filtered.map((event) => (
                        <QuickEditEvent key={event.id} event={event} side="bottom">
                          <button
                            type="button"
                            className="hover:bg-glass-hover focus-visible:ring-brand-cyan/60 -mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-left text-[12px] outline-none transition-colors duration-150 focus-visible:ring-2"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: `var(${categoryDotVar(event.category)})`,
                              }}
                            />
                            <span className="text-text-secondary truncate">
                              {event.title}
                            </span>
                            {event.startTime && (
                              <span className="text-text-tertiary shrink-0 tabular-nums">
                                {event.startTime}
                              </span>
                            )}
                          </button>
                        </QuickEditEvent>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </GlassPanel>

        <div className="flex flex-col gap-4">
          <ClockWidget />

          <GlassPanel className="flex flex-col gap-3">
            <TodoSection
              label="Unplanned"
              items={pendingTodos.filter((t) => !t.date)}
            />
            <TodoSection
              label="Scheduled"
              items={pendingTodos.filter((t) => !!t.date)}
            />
            <TodoSection label="Done" items={doneTodos} defaultCollapsed />
          </GlassPanel>
        </div>
      </div>
    </div>
  )
}

function TodoSection({
  label,
  items,
  defaultCollapsed = false,
}: {
  label: string
  items: (typeof TODO_ITEMS)[number][]
  defaultCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="text-text-secondary hover:text-text-primary focus-visible:ring-brand-cyan/60 flex items-center gap-1.5 rounded-md text-[12px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2"
      >
        <motion.span
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={spring.micro}
          className="flex"
        >
          <ChevronRightIcon width={10} height={10} />
        </motion.span>
        {label}
        <span className="text-text-tertiary font-normal tabular-nums">
          {items.length}
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-1 pl-4">
          {items.length === 0 ? (
            <span className="text-text-tertiary text-[11px]">Nothing here.</span>
          ) : (
            items.map((todo) => (
              <div key={todo.id} className="flex items-center gap-2">
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border ${
                    todo.done
                      ? 'bg-brand-cyan/30 border-brand-cyan'
                      : 'border-glass-border'
                  }`}
                >
                  {todo.done && (
                    <svg width={8} height={8} viewBox="0 0 20 20" fill="none">
                      <path
                        d="M4 10.5l4 4 8-9"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-text-primary"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className={`truncate text-[12px] ${
                    todo.done
                      ? 'text-text-tertiary line-through'
                      : 'text-text-secondary'
                  }`}
                >
                  {todo.label}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ClockWidget() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <GlassPanel className="flex flex-col items-center gap-1 py-5">
      <div className="font-display text-text-primary text-[28px] font-semibold tabular-nums">
        {now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
      <div className="text-text-tertiary text-[11px]">
        {now.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </div>
    </GlassPanel>
  )
}
