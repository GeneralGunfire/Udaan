import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { ChevronRightIcon, CalendarIcon, PlusIcon } from '@/shared/icons'
import {
  getEventsForDate,
  getUpcomingEvents,
  type EventCategory,
} from '@/integrations/schedule/scheduleStore'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MINI_WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const CATEGORY_TAGS: { id: EventCategory; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'creativity', label: 'Creativity' },
  { id: 'school', label: 'School' },
]

function toISO(y: number, m: number, d: number) {
  const mm = String(m + 1).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

function categoryAccentVar(category: EventCategory) {
  return `--color-accent-${category}`
}

const GRID_CELL_COUNT = 42 // fixed 6 rows × 7 cols — keeps grid height constant across all months

function buildMonthCells(year: number, month: number) {
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: { day: number | null; iso: string | null }[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, iso: null })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: toISO(year, month, d) })
  }
  while (cells.length < GRID_CELL_COUNT) cells.push({ day: null, iso: null })
  return cells
}

export function CalendarView() {
  const today = useMemo(() => new Date(), [])
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate())

  // Two independent cursors: right-side big grid, left-side mini nav —
  // both step by month via arrows only, never a scroll gesture.
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  )
  const [selectedDate, setSelectedDate] = useState<string>(todayISO)
  const [activeTags, setActiveTags] = useState<Set<EventCategory>>(
    new Set(CATEGORY_TAGS.map((t) => t.id)),
  )

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long' })

  const cells = useMemo(() => buildMonthCells(year, month), [year, month])

  const upcoming = getUpcomingEvents(todayISO, 5)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const yesterdayISO = toISO(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  )
  const yesterdayEvents = getEventsForDate(yesterdayISO)

  function goMonth(delta: number) {
    setCursor(new Date(year, month + delta, 1))
  }

  function toggleTag(id: EventCategory) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="grid w-full max-w-6xl grid-cols-[280px_1fr] gap-4">
      {/* Left column — mini calendar, category tags, event lists */}
      <div className="flex flex-col gap-4">
        <GlassPanel className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-text-primary text-[14px] font-semibold">
              {monthLabel} {year}
            </h2>
            <div className="flex items-center gap-1">
              <motion.button
                type="button"
                aria-label="Previous month"
                onClick={() => goMonth(-1)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-150"
              >
                <motion.span
                  animate={{ rotate: 180 }}
                  className="flex"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <ChevronRightIcon width={11} height={11} />
                </motion.span>
              </motion.button>
              <motion.button
                type="button"
                aria-label="Next month"
                onClick={() => goMonth(1)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-150"
              >
                <ChevronRightIcon width={11} height={11} />
              </motion.button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-y-1.5 text-center">
            {MINI_WEEKDAY_LABELS.map((wd, i) => (
              <div
                key={`${wd}-${i}`}
                className="text-text-tertiary text-[10px] font-semibold tracking-wide uppercase"
              >
                {wd}
              </div>
            ))}
            {cells.map((cell, i) => {
              if (cell.day === null || cell.iso === null) {
                return <div key={`empty-${i}`} className="h-6 w-6" />
              }
              const events = getEventsForDate(cell.iso)
              const isToday = cell.iso === todayISO
              const isSelected = cell.iso === selectedDate

              return (
                <motion.button
                  key={cell.iso}
                  type="button"
                  onClick={() => setSelectedDate(cell.iso!)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className={`relative mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium transition-colors duration-150 ${
                    isSelected
                      ? 'text-white'
                      : isToday
                        ? 'text-brand-teal font-semibold'
                        : 'text-text-secondary hover:bg-glass-hover'
                  }`}
                  style={
                    isSelected ? { background: 'var(--gradient-brand)' } : undefined
                  }
                >
                  {cell.day}
                  {events.length > 0 && !isSelected && (
                    <span
                      className="absolute bottom-0 h-1 w-1 rounded-full"
                      style={{
                        backgroundColor: `var(${categoryAccentVar(events[0].category)})`,
                      }}
                    />
                  )}
                </motion.button>
              )
            })}
          </div>

          <div className="border-glass-border flex flex-wrap gap-1.5 border-t pt-3">
            {CATEGORY_TAGS.map((tag) => {
              const active = activeTags.has(tag.id)
              return (
                <motion.button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-150"
                  style={{
                    backgroundColor: active
                      ? `color-mix(in srgb, var(${categoryAccentVar(tag.id)}) 16%, transparent)`
                      : 'transparent',
                    color: active
                      ? `var(${categoryAccentVar(tag.id)})`
                      : 'var(--color-text-tertiary)',
                    border: `1px solid ${active ? `color-mix(in srgb, var(${categoryAccentVar(tag.id)}) 30%, transparent)` : 'var(--color-glass-border)'}`,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full transition-opacity duration-150"
                    style={{
                      backgroundColor: `var(${categoryAccentVar(tag.id)})`,
                      opacity: active ? 1 : 0.45,
                    }}
                  />
                  {tag.label}
                </motion.button>
              )
            })}
          </div>
        </GlassPanel>

        <GlassPanel className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <CalendarIcon width={14} height={14} className="text-brand-teal" />
            <h2 className="text-text-primary text-[11px] font-semibold tracking-wide uppercase">
              Today's Events
            </h2>
          </div>
          <div className="flex flex-col gap-2">
            {upcoming.filter((e) => activeTags.has(e.category)).length === 0 ? (
              <p className="text-text-tertiary text-[12px]">
                Nothing coming up.
              </p>
            ) : (
              upcoming
                .filter((e) => activeTags.has(e.category))
                .map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedDate(event.date)}
                    className="hover:bg-glass-hover flex items-start gap-2 rounded-[8px] px-1.5 py-1 text-left transition-colors duration-150"
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: `var(${categoryAccentVar(event.category)})`,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-text-primary truncate text-[13px] font-medium">
                        {event.title}
                      </div>
                      <div className="text-text-tertiary text-[11px]">
                        {new Date(`${event.date}T00:00:00`).toLocaleDateString(
                          'en-US',
                          { month: 'short', day: 'numeric' },
                        )}
                        {event.startTime ? ` · ${event.startTime}` : ''}
                      </div>
                    </div>
                  </button>
                ))
            )}
          </div>
        </GlassPanel>

        <GlassPanel className="flex flex-col gap-2.5">
          <h2 className="text-text-primary text-[11px] font-semibold tracking-wide uppercase">
            Yesterday's Events
          </h2>
          {yesterdayEvents.length === 0 ? (
            <p className="text-text-tertiary text-[12px]">No events.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {yesterdayEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: `var(${categoryAccentVar(event.category)})`,
                    }}
                  />
                  <span className="text-text-secondary truncate text-[12.5px]">
                    {event.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>

      {/* Right column — big month grid, arrow-only navigation */}
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-text-primary text-[20px] font-semibold">
              {monthLabel} {year}
            </h1>
            <div className="flex items-center gap-1">
              <motion.button
                type="button"
                aria-label="Previous month"
                onClick={() => goMonth(-1)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150"
              >
                <motion.span
                  animate={{ rotate: 180 }}
                  className="flex"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <ChevronRightIcon width={13} height={13} />
                </motion.span>
              </motion.button>
              <motion.button
                type="button"
                aria-label="Next month"
                onClick={() => goMonth(1)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150"
              >
                <ChevronRightIcon width={13} height={13} />
              </motion.button>
            </div>
          </div>

          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold text-white"
            style={{ background: 'var(--gradient-brand)' }}
          >
            <PlusIcon width={13} height={13} />
            New Event
          </motion.button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((wd) => (
            <div
              key={wd}
              className="text-text-tertiary py-1 text-center text-[11px] font-semibold tracking-wide uppercase"
            >
              {wd}
            </div>
          ))}

          {cells.map((cell, i) => {
            if (cell.day === null || cell.iso === null) {
              return <div key={`empty-${i}`} className="h-14" />
            }
            const events = getEventsForDate(cell.iso).filter((e) =>
              activeTags.has(e.category),
            )
            const isToday = cell.iso === todayISO
            const isSelected = cell.iso === selectedDate
            const visible = events.slice(0, 2)
            const overflow = events.length - visible.length

            return (
              <motion.button
                key={cell.iso}
                type="button"
                onClick={() => setSelectedDate(cell.iso!)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                className={`relative flex h-16 flex-col items-start gap-1 rounded-[10px] p-1.5 text-[12.5px] font-medium transition-colors duration-150 ${
                  isSelected
                    ? 'bg-glass-hover text-text-primary'
                    : 'text-text-secondary hover:bg-glass'
                } ${isToday ? 'ring-brand-teal/60 ring-1' : ''}`}
              >
                <span
                  className={isToday ? 'text-brand-teal font-semibold' : ''}
                >
                  {cell.day}
                </span>
                <div className="flex w-full flex-1 flex-col gap-0.5 overflow-hidden">
                  {visible.map((e) => (
                    <span
                      key={e.id}
                      className="truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight font-semibold"
                      style={{
                        backgroundColor: `color-mix(in srgb, var(${categoryAccentVar(e.category)}) 20%, transparent)`,
                        color: `var(${categoryAccentVar(e.category)})`,
                      }}
                    >
                      {e.title}
                    </span>
                  ))}
                  {overflow > 0 && (
                    <span className="text-text-tertiary px-1 text-[9.5px] font-medium">
                      +{overflow} more
                    </span>
                  )}
                </div>
              </motion.button>
            )
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="border-glass-border flex flex-col gap-2 border-t pt-3"
          >
            <h3 className="text-text-tertiary text-[11px] font-semibold tracking-wide uppercase">
              {new Date(`${selectedDate}T00:00:00`).toLocaleDateString(
                'en-US',
                { weekday: 'long', month: 'long', day: 'numeric' },
              )}
            </h3>
            {getEventsForDate(selectedDate).filter((e) => activeTags.has(e.category))
              .length === 0 ? (
              <p className="text-text-tertiary text-[12.5px]">
                No events this day.
              </p>
            ) : (
              getEventsForDate(selectedDate)
                .filter((e) => activeTags.has(e.category))
                .map((event) => (
                  <div
                    key={event.id}
                    className="hover:bg-glass-hover flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors duration-150"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: `var(${categoryAccentVar(event.category)})`,
                      }}
                    />
                    <span className="text-text-primary flex-1 text-[13px] font-medium">
                      {event.title}
                    </span>
                    <span className="text-text-tertiary text-[11.5px] font-medium tabular-nums">
                      {event.startTime
                        ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}`
                        : 'All day'}
                    </span>
                  </div>
                ))
            )}
          </motion.div>
        </AnimatePresence>
      </GlassPanel>
    </div>
  )
}
