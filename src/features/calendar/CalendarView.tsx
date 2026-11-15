import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { WeekView } from './components/WeekView'
import { BigMonthGrid } from './components/BigMonthGrid'
import type { CalendarViewMode } from './components/ViewToggle'
import { AgendaView } from './components/AgendaView'
import { Segmented } from '@/os/ui/controls'
import { TAG_CONFIG } from './lib/tags'
import { EventModal } from './components/EventModal'
import { DayEventsPanel } from './components/DayEventsPanel'
import { CommandBar } from './components/CommandBar'
import { useEvents } from './hooks/useEvents'
import { getWeekDates, toISODate, formatMonthYear } from './lib/dateUtils'
import { TAG_ORDER } from './lib/tags'
import type { CalendarEvent, EventDraft, EventTag } from './lib/types'
import { pageEnter, spring, prefersReducedMotion } from '@/shared/lib/motion'
import { Button } from '@/shared/components/ui/button'
import { ChevronRightIcon, PlusIcon } from '@/shared/icons'
import { cn } from '@/shared/lib/cn'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { getWallpaper } from '@/app/wallpapers'

/**
 * Calendar — a single full-width surface built entirely on the app's real
 * design tokens (--surface-*, --color-accent, --border-hairline,
 * --shadow-raised) rather than a hand-picked hex palette. The previous
 * version's sub-components (DayEventsPanel, ViewToggle, BigMonthGrid) were
 * already token-based; only this top-level shell hardcoded its own
 * competing hardcoded hex colours, which is what made the view read as
 * visually inconsistent with the rest of Udaan — half of it followed the
 * theme, half of it didn't.
 */
export function CalendarView() {
  const today = useMemo(() => new Date(), [])

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month')
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [weekAnchor, setWeekAnchor] = useState(today)
  const [activeTags, setActiveTags] = useState<Set<EventTag>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('udaan.calendar.tags') ?? 'null') as EventTag[] | null
      return new Set(v && v.length ? v.filter((t) => TAG_ORDER.includes(t)) : TAG_ORDER)
    } catch {
      return new Set(TAG_ORDER)
    }
  })
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const toggleTag = (t: EventTag) =>
    setActiveTags((cur) => {
      const next = new Set(cur)
      if (!next.delete(t)) next.add(t)
      if (next.size === 0) TAG_ORDER.forEach((x) => next.add(x))
      try {
        localStorage.setItem('udaan.calendar.tags', JSON.stringify([...next]))
      } catch {
        /* not remembered */
      }
      return next
    })

  const [dayPanelDate, setDayPanelDate] = useState<Date | null>(null)
  const [eventModalDate, setEventModalDate] = useState<Date | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [prefillTime, setPrefillTime] = useState<string | null>(null)
  const [commandBarOpen, setCommandBarOpen] = useState(false)

  const { addEvent, updateEvent, deleteEvent, toggleEventDone, eventsByDate, events, loadError } = useEvents()

  const visibleEvents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => activeTags.has(e.tag) && (!q || e.title.toLowerCase().includes(q) || e.notes.toLowerCase().includes(q)))
  }, [events, activeTags, search])
  const tagCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of events) m[e.tag] = (m[e.tag] ?? 0) + 1
    return m
  }, [events])

  const datesWithEvents = useMemo(() => {
    const set = new Set<string>()
    for (const e of visibleEvents) set.add(e.date)
    return set
  }, [visibleEvents])

  const eventsByDateSorted = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of visibleEvents) {
      const list = map.get(e.date)
      if (list) list.push(e)
      else map.set(e.date, [e])
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time))
    return map
  }, [visibleEvents])

  const weekDates = useMemo(() => getWeekDates(weekAnchor), [weekAnchor])

  function goPrevMonth() {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function goNextMonth() {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function goPrevWeek() {
    setWeekAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7))
  }

  function goNextWeek() {
    setWeekAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7))
  }

  function goPrevDay() {
    setWeekAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1))
  }

  function goNextDay() {
    setWeekAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1))
  }

  const goPrev = () => (viewMode === 'month' ? goPrevMonth() : viewMode === 'week' ? goPrevWeek() : viewMode === 'day' ? goPrevDay() : undefined)
  const goNext = () => (viewMode === 'month' ? goNextMonth() : viewMode === 'week' ? goNextWeek() : viewMode === 'day' ? goNextDay() : undefined)

  function handleSelectDate(date: Date) {
    const iso = toISODate(date)
    if (datesWithEvents.has(iso)) {
      setDayPanelDate(date)
    } else {
      setEditingEvent(null)
      setEventModalDate(date)
    }
  }

  function handleAddFromDayPanel() {
    if (!dayPanelDate) return
    setEditingEvent(null)
    setEventModalDate(dayPanelDate)
    setDayPanelDate(null)
  }

  function handleEditFromDayPanel(event: CalendarEvent) {
    setEditingEvent(event)
    setEventModalDate(new Date(`${event.date}T00:00:00`))
    setDayPanelDate(null)
  }

  function openEventFromList(event: CalendarEvent) {
    setEditingEvent(event)
    setPrefillTime(null)
    setEventModalDate(new Date(`${event.date}T00:00:00`))
  }

  function createAtSlot(date: Date, time: string) {
    setEditingEvent(null)
    setPrefillTime(time)
    setEventModalDate(date)
  }

  function handleSaveEvent(draft: EventDraft, editingId?: string) {
    if (editingId) {
      updateEvent(editingId, draft)
    } else {
      addEvent(draft)
    }
  }

  function handleCommandReschedule(id: string, date: string, time: string | null) {
    const target = events.find((e) => e.id === id)
    if (!target) return
    updateEvent(id, { ...target, date, time: time ?? target.time })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandBarOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const reducedMotion = prefersReducedMotion()

  // The one deliberate depth/image moment: a heavily blurred, low-opacity
  // wash of the user's own desktop wallpaper behind the whole view — the
  // same technique macOS System Settings and visionOS panels use (the
  // surface reads as "floating over your desktop," not "decorated with a
  // stock photo"). Everything else in the view stays flat; this is the one
  // place depth is spent, not a background pasted behind everything.
  const { wallpaperId } = useWallpaper()
  const wallpaper = useMemo(() => getWallpaper(wallpaperId), [wallpaperId])

  const upcoming = useMemo(() => {
    const now = new Date()
    const nowIso = toISODate(now)
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    return visibleEvents
      .filter((e) => !e.done && (e.date > nowIso || (e.date === nowIso && (e.allDay || e.time >= hm))))
      .sort((x, y) => x.date.localeCompare(y.date) || x.time.localeCompare(y.time))
      .slice(0, 6)
  }, [visibleEvents])

  function goToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    setWeekAnchor(today)
  }

  function jumpTo(date: Date) {
    setViewYear(date.getFullYear())
    setViewMonth(date.getMonth())
    setWeekAnchor(date)
  }

  // Keyboard, like Apple Calendar: T is today, the arrows step a month or week, M and W switch view.
  // The handler is re-pointed on every render so it always sees the current view.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
    if (e.key === 'ArrowLeft') goPrev()
    else if (e.key === 'ArrowRight') goNext()
    else if (e.key.toLowerCase() === 't') goToday()
    else if (e.key.toLowerCase() === 'd') setViewMode('day')
    else if (e.key.toLowerCase() === 'w') setViewMode('week')
    else if (e.key.toLowerCase() === 'm') setViewMode('month')
    else if (e.key.toLowerCase() === 'a') setViewMode('agenda')
    else if (e.key === '/') {
      e.preventDefault()
      searchRef.current?.focus()
    } else if (e.key.toLowerCase() === 'n') {
      setEditingEvent(null)
      setPrefillTime(null)
      setEventModalDate(viewMode === 'month' ? today : weekAnchor)
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : pageEnter.initial}
      animate={pageEnter.animate}
      transition={reducedMotion ? { duration: 0 } : spring.gentle}
      className="text-text-primary relative flex h-full min-h-0 w-full overflow-hidden"
      style={{ background: 'var(--surface-base)' }}
    >
      {wallpaper.src && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage: `url(${wallpaper.src})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(60px) saturate(1.3)',
            transform: 'scale(1.15)',
          }}
        />
      )}
      {/* A soft top-down light wash over the blurred wallpaper so content
          still reads as sitting on --surface-base, not on a photo. */}
      {wallpaper.src && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(180deg, transparent, var(--surface-base) 65%)' }}
        />
      )}

      {/*
        No card background, no card border on the sidebar itself — on
        Linear/Notion/native sidebars the WINDOW CHROME is the only
        container; nothing inside it gets its own box. A single hairline on
        the right edge is the one divider earned, because it separates two
        genuinely different regions (nav vs. content), not decoration.
      */}
      <aside
        className="relative z-10 flex w-[258px] shrink-0 flex-col gap-6 overflow-y-auto px-5 pb-6 pt-6"
        style={{
          borderRight: '1px solid color-mix(in srgb, var(--border-hairline) 70%, transparent)',
          background: wallpaper.src ? 'color-mix(in srgb, var(--surface-base) 55%, transparent)' : undefined,
          backdropFilter: wallpaper.src ? 'blur(24px)' : undefined,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setEditingEvent(null)
            setPrefillTime(null)
            setEventModalDate(today)
          }}
          // Flat fill, system-accent-button weight — no gradient, no inset
          // highlight, no lift-on-hover. A native button changes shade by a
          // few percent on hover and nothing else.
          className="bg-accent text-accent-contrast flex h-8 items-center justify-center gap-1.5 rounded-[6px] text-[13px] font-medium transition-[filter] duration-100 hover:brightness-[1.08] active:brightness-[0.94]"
        >
          <PlusIcon width={13} height={13} />
          New event
        </button>

        <MiniMonth
          year={viewYear}
          month={viewMonth}
          today={today}
          datesWithEvents={datesWithEvents}
          onPick={(d) => {
            jumpTo(d)
            handleSelectDate(d)
          }}
          onShift={(n) => (n < 0 ? goPrevMonth() : goNextMonth())}
        />

        <section>
          <p className="text-text-tertiary mb-2 text-[11px] font-medium">Calendars</p>
          <div className="flex flex-col">
            {TAG_ORDER.map((t) => {
              const on = activeTags.has(t)
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => toggleTag(t)} className="hover:bg-surface-hover -mx-2 flex items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left text-[13px] transition-colors duration-100">
                  <span className={cn('flex h-[15px] w-[15px] items-center justify-center rounded-[4px]', on ? TAG_CONFIG[t].dot : 'bg-transparent shadow-[inset_0_0_0_1.5px_var(--tag-personal)]')}>
                    {on && (
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5 10 17 19 7" />
                      </svg>
                    )}
                  </span>
                  <span className={cn('flex-1', !on && 'text-text-tertiary')}>{TAG_CONFIG[t].label}</span>
                  <span className="text-text-tertiary text-[11.5px] tabular-nums">{tagCounts[t] ?? 0}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="min-h-0">
          <p className="text-text-tertiary mb-2.5 text-[11px] font-medium">Up next</p>
          {upcoming.length === 0 ? (
            <p className="text-text-tertiary text-[12.5px]">Nothing coming up</p>
          ) : (
            <div className="flex flex-col">
              {upcoming.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEventFromList(e)}
                  // A plain row, selection-highlight on hover only — no
                  // coloured accent bar standing in for the tag; the tag's
                  // own colour already shows in the day grid these point
                  // back to, so this list doesn't need to repeat it.
                  className="hover:bg-surface-hover -mx-2 flex flex-col gap-0.5 rounded-[5px] px-2 py-2 text-left transition-colors duration-100"
                >
                  <span className="text-text-primary truncate text-[13px] leading-tight">{e.title}</span>
                  <span className="text-text-tertiary text-[11.5px] leading-tight">
                    {new Date(`${e.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                    {!e.allDay && e.time ? ` · ${e.time}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <p className="text-text-tertiary mt-auto text-[11.5px] leading-relaxed">
          Ctrl + K to type things like &ldquo;maths test friday 9am&rdquo;. D, W, M and A switch view, T is today, N a new event, / searches.
        </p>
      </aside>

      {/*
        Capped and centred: on a wide window an unconstrained flex-1 column
        stretched the month grid into a thin letterboxed strip — every cell
        went wider than it is tall and the whole thing read as flimsy. A
        calendar's natural proportion is closer to square cells, so the
        column stops growing past a sensible width and the leftover space
        on a wide window becomes margin, not a distorted grid.
      */}
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 justify-center overflow-y-auto px-6 py-6">
      <div className="flex min-h-0 w-full max-w-[920px] flex-col gap-5">
        {loadError && (
          <p className="text-danger shrink-0 text-[12px] font-medium">
            Couldn&apos;t reach saved events — showing what&apos;s loaded. {loadError}
          </p>
        )}

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="pill-sm" onClick={goToday} className="text-[13px] font-medium">
            Today
          </Button>
          <div className="flex items-center">
            <Button variant="ghost" size="icon-sm" onClick={goPrev} disabled={viewMode === 'agenda'} aria-label="Previous">
              <ChevronRightIcon width={16} height={16} className="rotate-180" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goNext} disabled={viewMode === 'agenda'} aria-label="Next">
              <ChevronRightIcon width={16} height={16} />
            </Button>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h1
              key={viewMode === 'month' ? `${viewYear}-${viewMonth}` : `${viewMode}-${weekAnchor.toDateString()}`}
              initial={reducedMotion ? undefined : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="min-w-0 flex-1 truncate whitespace-nowrap text-[22px] font-bold tracking-tight"
            >
              {viewMode === 'month'
                ? formatMonthYear(viewYear, viewMonth)
                : viewMode === 'day'
                  ? weekAnchor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
                  : viewMode === 'agenda'
                    ? 'Upcoming'
                    : formatMonthYear(weekAnchor.getFullYear(), weekAnchor.getMonth())}
            </motion.h1>
          </AnimatePresence>
          <label className="u-search h-8 w-[128px] shrink-0">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events" />
          </label>
          <Segmented<CalendarViewMode>
            value={viewMode}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'agenda', label: 'Agenda' },
            ]}
            onChange={setViewMode}
          />
        </div>

        <div className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            {viewMode === 'month' ? (
              <motion.div
                key="month"
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -8 }}
                transition={{ duration: 0.26, ease: [0.2, 0, 0, 1] }}
                className="h-full"
              >
                <BigMonthGrid
                  year={viewYear}
                  month={viewMonth}
                  today={today}
                  eventsByDate={eventsByDateSorted}
                  onSelectDate={handleSelectDate}
                  onSelectEvent={openEventFromList}
                />
              </motion.div>
            ) : viewMode === 'agenda' ? (
              <motion.div key="agenda" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }} className="h-full">
                <AgendaView
                  events={visibleEvents}
                  today={today}
                  onOpen={openEventFromList}
                  onToggleDone={toggleEventDone}
                  onCreate={() => {
                    setEditingEvent(null)
                    setEventModalDate(today)
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key={viewMode}
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -8 }}
                transition={{ duration: 0.26, ease: [0.2, 0, 0, 1] }}
                className="h-full overflow-y-auto"
              >
                <WeekView
                  weekDates={viewMode === 'day' ? [weekAnchor] : weekDates}
                  today={today}
                  events={visibleEvents}
                  onSelectDate={handleSelectDate}
                  onSelectEvent={openEventFromList}
                  onCreateAt={createAtSlot}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      </div>

      {eventModalDate && (
        <EventModal
          open={!!eventModalDate}
          onOpenChange={(open) => {
            if (!open) {
              setEventModalDate(null)
              setEditingEvent(null)
              setPrefillTime(null)
            }
          }}
          initialDate={eventModalDate}
          today={today}
          datesWithEvents={datesWithEvents}
          editingEvent={editingEvent}
          initialTime={prefillTime}
          onSave={handleSaveEvent}
        />
      )}

      {dayPanelDate && (
        <DayEventsPanel
          open={!!dayPanelDate}
          onOpenChange={(open) => !open && setDayPanelDate(null)}
          date={dayPanelDate}
          events={eventsByDate(toISODate(dayPanelDate))}
          onAddEvent={handleAddFromDayPanel}
          onEditEvent={handleEditFromDayPanel}
          onDeleteEvent={(id) => deleteEvent(id)}
          onToggleDone={(id) => toggleEventDone(id)}
        />
      )}

      <CommandBar
        open={commandBarOpen}
        onOpenChange={setCommandBarOpen}
        today={today}
        events={events}
        onCreate={addEvent}
        onDelete={deleteEvent}
        onReschedule={handleCommandReschedule}
      />
    </motion.div>
  )
}

/** Small month for the sidebar: click a day to jump there; dots mark busy days. */
function MiniMonth({ year, month, today, datesWithEvents, onPick, onShift }: { year: number; month: number; today: Date; datesWithEvents: Set<string>; onPick: (d: Date) => void; onShift: (n: number) => void }) {
  const first = new Date(year, month, 1)
  const lead = first.getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const todayIso = toISODate(today)
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[13px] font-semibold">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <span className="flex">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => onShift(-1)}>
            <ChevronRightIcon width={13} height={13} className="rotate-180" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => onShift(1)}>
            <ChevronRightIcon width={13} height={13} />
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="text-text-tertiary pb-1 font-semibold">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = new Date(year, month, i + 1)
          const iso = toISODate(date)
          const isToday = iso === todayIso
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(date)}
              className={cn(
                'relative mx-auto flex h-7 w-7 items-center justify-center rounded-full tabular-nums transition-colors duration-150',
                isToday ? 'bg-accent text-accent-contrast font-bold' : 'hover:bg-surface-hover',
              )}
            >
              {i + 1}
              {datesWithEvents.has(iso) && !isToday && <span className="bg-text-tertiary absolute bottom-[3px] h-[3px] w-[3px] rounded-full" />}
            </button>
          )
        })}
      </div>
    </section>
  )
}
