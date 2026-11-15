import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, pressableIcon, prefersReducedMotion } from '@/shared/lib/motion'

export type CalendarViewMode = 'day' | 'week' | 'month' | 'agenda'

export interface ViewToggleProps {
  value: CalendarViewMode
  onChange: (mode: CalendarViewMode) => void
}

const OPTIONS: { value: CalendarViewMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Agenda' },
]

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  const reduced = prefersReducedMotion()

  return (
    // Track sits on the input step of the surface ladder. It used to use
    // `bg-glass-border` — a BORDER token, not a surface one — which is why
    // the control had no visible body of its own.
    <div className="bg-surface-hover border-hairline inline-flex shrink-0 items-center gap-0.5 rounded-full border p-0.5">
      {OPTIONS.map((option) => {
        const active = value === option.value
        return (
          <motion.button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className="relative rounded-full px-3.5 py-1.5 text-xs font-medium"
            {...pressableIcon}
          >
            {active && (
              <motion.span
                layoutId="calendar-view-toggle-active"
                className="bg-accent absolute inset-0 rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]"
                transition={reduced ? { duration: 0 } : spring.panel}
              />
            )}
            <span
              className={cn(
                'relative transition-colors duration-150',
                // The active pill is the accent fill, so its label is
                // accent-contrast (white). This was previously a WHITE
                // pill with accent-contrast text on it — and once
                // accent-contrast became white too, the selected option
                // was white-on-white and simply vanished.
                active ? 'text-accent-contrast' : 'text-text-primary hover:text-accent',
              )}
            >
              {option.label}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
