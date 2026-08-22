import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRightIcon, CalendarIcon } from '@/shared/icons'

interface DatePickerProps {
  value: string // ISO "YYYY-MM-DD", empty for unset
  onChange: (value: string) => void
  placeholder?: string
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function toISO(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function buildCells(year: number, month: number) {
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length < 42) cells.push(null)
  return cells
}

/** Custom-styled calendar date picker — replaces the native `<input type="date">` OS widget. */
export function DatePicker({ value, onChange, placeholder = 'Select date' }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const initial = value ? new Date(`${value}T00:00:00`) : new Date()
  const [cursor, setCursor] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  )

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    // Deferred one tick so the click that opened the picker doesn't
    // immediately bubble into this listener and close it again.
    const id = window.setTimeout(() => {
      document.addEventListener('click', onClickOutside)
      document.addEventListener('keydown', onKeyDown)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('click', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const cells = buildCells(year, month)
  const displayLabel = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : placeholder

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`glass-surface focus-visible:ring-brand-cyan/60 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 ${
          value ? 'text-text-primary' : 'text-text-tertiary'
        }`}
      >
        <CalendarIcon width={13} height={13} className="text-text-tertiary shrink-0" />
        <span className="flex-1 truncate">{displayLabel}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="glass-surface absolute top-9 left-0 z-30 w-64 rounded-2xl p-3"
            style={{ boxShadow: 'var(--shadow-panel)' }}
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setCursor(new Date(year, month - 1, 1))}
                className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover focus-visible:ring-brand-cyan/60 flex h-6 w-6 items-center justify-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2"
              >
                <span className="flex rotate-180">
                  <ChevronRightIcon width={11} height={11} />
                </span>
              </button>
              <span className="text-text-primary text-[12px] font-semibold">
                {monthLabel}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setCursor(new Date(year, month + 1, 1))}
                className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover focus-visible:ring-brand-cyan/60 flex h-6 w-6 items-center justify-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2"
              >
                <ChevronRightIcon width={11} height={11} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center">
              {WEEKDAY_LABELS.map((wd, i) => (
                <div
                  key={`${wd}-${i}`}
                  className="text-text-tertiary text-[9px] font-semibold tracking-wide uppercase"
                >
                  {wd}
                </div>
              ))}
              {cells.map((day, i) => {
                if (day === null) return <div key={`e-${i}`} className="h-7 w-7" />
                const iso = toISO(year, month, day)
                const isSelected = iso === value
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      onChange(iso)
                      setOpen(false)
                    }}
                    className={`focus-visible:ring-brand-cyan/60 mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11.5px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 ${
                      isSelected
                        ? 'text-white'
                        : 'text-text-secondary hover:bg-glass-hover'
                    }`}
                    style={isSelected ? { background: 'var(--gradient-brand)' } : undefined}
                  >
                    {day}
                  </button>
                )
              })}
            </div>

            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="text-text-tertiary hover:text-text-primary focus-visible:ring-brand-cyan/60 border-glass-border mt-2 w-full rounded-md border-t pt-2 text-center text-[11.5px] outline-none focus-visible:ring-2"
              >
                Clear date
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
