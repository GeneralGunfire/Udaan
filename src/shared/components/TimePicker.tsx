import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'

interface TimePickerProps {
  value: string // "HH:mm", empty for unset
  onChange: (value: string) => void
  placeholder?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

/**
 * Custom-styled scrollable hour/minute picker — replaces the native
 * `<input type="time">` OS widget. Built on the shared Radix Popover
 * (same reasoning as DatePicker) so it gets real collision-aware
 * positioning instead of a fixed offset that clips at a viewport edge.
 */
export function TimePicker({ value, onChange, placeholder = 'Select time' }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [hour, minute] = value ? value.split(':').map(Number) : [null, null]

  function commit(h: number, m: number) {
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`glass-surface focus-visible:ring-brand-cyan/60 w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 ${
            value ? 'text-text-primary' : 'text-text-tertiary'
          }`}
        >
          {value || placeholder}
        </button>
      </PopoverTrigger>
      {open && (
        <PopoverContent align="start" className="flex w-36 overflow-hidden p-0">
          <div className="flex max-h-48 flex-1 flex-col overflow-y-auto py-1">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => commit(h, minute ?? 0)}
                className={`focus-visible:ring-brand-cyan/60 px-3 py-1 text-center text-[12.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset ${
                  h === hour
                    ? 'bg-glass-hover text-text-primary font-semibold'
                    : 'text-text-secondary hover:bg-glass-hover'
                }`}
              >
                {String(h).padStart(2, '0')}
              </button>
            ))}
          </div>
          <div className="border-glass-border flex max-h-48 flex-1 flex-col overflow-y-auto border-l py-1">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  commit(hour ?? 0, m)
                  setOpen(false)
                }}
                className={`focus-visible:ring-brand-cyan/60 px-3 py-1 text-center text-[12.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset ${
                  m === minute
                    ? 'bg-glass-hover text-text-primary font-semibold'
                    : 'text-text-secondary hover:bg-glass-hover'
                }`}
              >
                {String(m).padStart(2, '0')}
              </button>
            ))}
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
