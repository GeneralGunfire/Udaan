import { motion } from 'framer-motion'
import { WeekTimeGrid } from './WeekTimeGrid'
import { prefersReducedMotion } from '@/shared/lib/motion'
import type { CalendarEvent } from '../lib/types'

export interface WeekViewProps {
  weekDates: Date[]
  today: Date
  events: CalendarEvent[]
  onSelectDate: (date: Date) => void
  /** Opens an existing event for editing. */
  onSelectEvent?: (event: CalendarEvent) => void
  /** Creates an event at a clicked empty slot, pre-filled with that time. */
  onCreateAt?: (date: Date, time: string) => void
}

/**
 * One full-height card, same footprint as BigMonthGrid. Week navigation
 * lives in CalendarView's own shared header now (the same prev/next
 * chevrons the month view uses, retargeted to week stepping) rather than a
 * second nav row duplicated inside this card — having both meant the
 * header's chevrons visually jumped position switching between month/week
 * since only one view had them. The weather forecast strip that used to
 * sit below this card was removed entirely — it pushed the actual event
 * grid down and made it noticeably smaller than the month view beside it.
 */
export function WeekView({ weekDates, today, events, onSelectDate, onSelectEvent, onCreateAt }: WeekViewProps) {
  const reduced = prefersReducedMotion()

  return (
    <motion.div
      initial={reduced ? undefined : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="border-hairline h-full w-full min-w-0 overflow-hidden rounded-2xl border p-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-overlay)' }}
    >
      <WeekTimeGrid
        weekDates={weekDates}
        today={today}
        events={events}
        onSelectDate={onSelectDate}
        onSelectEvent={onSelectEvent}
        onCreateAt={onCreateAt}
      />
    </motion.div>
  )
}
