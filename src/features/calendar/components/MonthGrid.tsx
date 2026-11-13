import { cn } from '@/shared/lib/cn'
import { DAY_NAMES, getMonthGrid, isPastDay, isSameDay } from '../lib/dateUtils'
import { TAG_CONFIG } from '../lib/tags'
import type { EventTag } from '../lib/types'

export interface MonthGridProps {
  year: number
  month: number
  selectedDate: Date | null
  today: Date
  /** Dates (YYYY-MM-DD) that have at least one event — shown as a dot. */
  datesWithEvents?: Set<string>
  /** Dominant tag per date (YYYY-MM-DD), used to color the event dot. */
  tagByDate?: Map<string, EventTag>
  onSelectDate: (date: Date) => void
  /** 'pill' = filled circle (main view). 'square' = filled rounded-square (picker pane). */
  selectionShape?: 'pill' | 'square'
  /** Disallow selecting past days (used in the picker pane). */
  disablePast?: boolean
  toISODate: (d: Date) => string
  /** Larger cells/type for the main calendar card. */
  size?: 'default' | 'lg'
}

export function MonthGrid({
  year,
  month,
  selectedDate,
  today,
  datesWithEvents,
  tagByDate,
  onSelectDate,
  selectionShape = 'pill',
  disablePast = false,
  toISODate,
  size = 'default',
}: MonthGridProps) {
  const cells = getMonthGrid(year, month)
  const lg = size === 'lg'

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'text-text-secondary grid grid-cols-7 text-center font-semibold tracking-wide uppercase',
          lg ? 'gap-1.5 text-xs' : 'gap-1 text-2xs',
        )}
      >
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className={cn('grid grid-cols-7', lg ? 'gap-y-3' : 'gap-y-1.5')}>
        {cells.map(({ date, inCurrentMonth }) => {
          const selected = selectedDate ? isSameDay(date, selectedDate) : false
          const isToday = isSameDay(date, today)
          const past = disablePast && isPastDay(date, today) && inCurrentMonth
          const iso = toISODate(date)
          const hasEvents = datesWithEvents?.has(iso) ?? false
          const dotColor = tagByDate?.get(iso)
          const disabled = past

          return (
            <div key={date.toISOString()} className="flex items-center justify-center">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelectDate(date)}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={selected}
                className={cn(
                  'relative flex items-center justify-center font-medium transition-[background-color,color,transform,box-shadow] duration-150 active:scale-95',
                  lg ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm',
                  selectionShape === 'pill' ? 'rounded-full' : 'rounded-lg',
                  !inCurrentMonth && 'text-text-tertiary/50',
                  inCurrentMonth && !selected && 'text-text-primary hover:bg-surface-hover',
                  disabled && 'text-text-tertiary/30 pointer-events-none line-through',
                  selected && 'bg-accent text-accent-contrast',
                  // A real ring, not just a tinted number — today's date
                  // should read as "here" at a glance across a full grid
                  // of otherwise-identical cells, the way a live clock or
                  // status dot does, not just a slightly different text
                  // colour easy to scan straight past.
                  isToday && !selected && 'text-accent ring-2 ring-accent/60 ring-offset-2 ring-offset-surface-raised font-semibold',
                )}
              >
                {date.getDate()}
                {hasEvents && !selected && (
                  <span
                    className={cn(
                      'absolute left-1/2 -translate-x-1/2 rounded-full',
                      dotColor ? TAG_CONFIG[dotColor].dot : 'bg-[var(--color-text-secondary)]',
                      lg ? 'bottom-1.5 h-1.25 w-1.25' : 'bottom-1 h-1 w-1',
                    )}
                    aria-hidden
                  />
                )}
                {hasEvents && selected && (
                  <span
                    className={cn(
                      'absolute left-1/2 -translate-x-1/2 rounded-full bg-white',
                      lg ? 'bottom-1.5 h-1.25 w-1.25' : 'bottom-1 h-1 w-1',
                    )}
                    aria-hidden
                  />
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
