import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface TimePickerProps {
  value: string // "HH:mm", empty for unset
  onChange: (value: string) => void
  placeholder?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

/** Custom-styled scrollable hour/minute picker — replaces the native `<input type="time">` OS widget. */
export function TimePicker({ value, onChange, placeholder = 'Select time' }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [hour, minute] = value ? value.split(':').map(Number) : [null, null]

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const id = window.setTimeout(() => {
      document.addEventListener('click', onClickOutside)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('click', onClickOutside)
    }
  }, [open])

  function commit(h: number, m: number) {
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`glass-surface w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none ${
          value ? 'text-text-primary' : 'text-text-tertiary'
        }`}
      >
        {value || placeholder}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="glass-surface absolute top-9 left-0 z-30 flex w-36 overflow-hidden rounded-2xl"
            style={{ boxShadow: 'var(--shadow-panel)' }}
          >
            <div className="flex max-h-48 flex-1 flex-col overflow-y-auto py-1">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => commit(h, minute ?? 0)}
                  className={`px-3 py-1 text-center text-[12.5px] transition-colors duration-150 ${
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
                  className={`px-3 py-1 text-center text-[12.5px] transition-colors duration-150 ${
                    m === minute
                      ? 'bg-glass-hover text-text-primary font-semibold'
                      : 'text-text-secondary hover:bg-glass-hover'
                  }`}
                >
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
