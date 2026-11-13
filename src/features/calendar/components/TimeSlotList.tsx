import { cn } from '@/shared/lib/cn'
import { formatTime12h, getTimeSlots, isSameDay, timeToMinutes } from '../lib/dateUtils'

export interface TimeSlotListProps {
  date: Date
  today: Date
  selectedTime: string | null
  allDay: boolean
  onSelectTime: (time: string) => void
  onSelectAllDay: () => void
}

/** 15-minute increments, plus an "All day" option pinned above the list; times before "now" are hidden when `date` is today. */
export function TimeSlotList({
  date,
  today,
  selectedTime,
  allDay,
  onSelectTime,
  onSelectAllDay,
}: TimeSlotListProps) {
  const slots = getTimeSlots(15)
  const isToday = isSameDay(date, today)
  const nowMinutes = today.getHours() * 60 + today.getMinutes()

  const visibleSlots = isToday ? slots.filter((s) => timeToMinutes(s) >= nowMinutes) : slots

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
      <button
        type="button"
        onClick={onSelectAllDay}
        aria-pressed={allDay}
        className={cn(
          'w-full shrink-0 rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.98]',
          allDay
            ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
            : 'bg-[var(--surface-raised)] text-text-secondary hover:bg-[var(--os-menu-item-hover)] hover:text-text-primary',
        )}
      >
        All day
      </button>

      <div className="border-hairline my-0.5 border-t" />

      {visibleSlots.length === 0 && (
        <p className="text-text-tertiary px-1 py-4 text-center text-xs">
          No more time slots today.
        </p>
      )}
      {visibleSlots.map((slot) => {
        const selected = !allDay && slot === selectedTime
        return (
          <button
            key={slot}
            type="button"
            onClick={() => onSelectTime(slot)}
            aria-pressed={selected}
            className={cn(
              'w-full shrink-0 rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.98]',
              selected
                ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
                : 'bg-[var(--surface-raised)] text-text-secondary hover:bg-[var(--os-menu-item-hover)] hover:text-text-primary',
            )}
          >
            {formatTime12h(slot)}
          </button>
        )
      })}
    </div>
  )
}
