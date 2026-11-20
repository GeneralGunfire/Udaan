import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { useShellMenu } from '@/os/ui/useShellMenu'

export interface ShellSelectOption<T extends string> {
  value: T
  label: string
  /** Shown quietly on the right of the option in the menu (a unit symbol, a shortcut). */
  hint?: string
}

/** Rough height of one menu row and the menu's padding, to decide whether the list fits below. */
const ROW_H = 30
const MENU_PAD = 16

/**
 * A dropdown for app windows. The trigger is a `u-field`; the list opens through the shared popup
 * window (`useShellMenu`, the liquid-glass pop-kit Menu), so it matches every other menu in Udaan
 * instead of the browser's native list. Opens below the trigger, or above it when there is no room.
 */
export function ShellSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled,
}: {
  value: T
  options: ShellSelectOption<T>[]
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
  disabled?: boolean
}) {
  const openMenu = useShellMenu()
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  // The menu lives in another window, so its closing isn't reported here. Any later input in this
  // window (or the window regaining focus) means it has gone.
  useEffect(() => {
    if (!open) return
    const done = () => setOpen(false)
    const t = window.setTimeout(() => {
      window.addEventListener('pointerdown', done, true)
      window.addEventListener('keydown', done, true)
      window.addEventListener('focus', done)
    }, 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('pointerdown', done, true)
      window.removeEventListener('keydown', done, true)
      window.removeEventListener('focus', done)
    }
  }, [open])

  const show = () => {
    const el = btn.current
    if (!el || disabled) return
    const r = el.getBoundingClientRect()
    const need = Math.min(options.length, 14) * ROW_H + MENU_PAD
    const up = window.innerHeight - r.bottom < need && r.top > window.innerHeight - r.bottom
    setOpen(true)
    openMenu(
      { x: r.left, y: up ? r.top - 4 : r.bottom + 4 },
      options.map((o) => ({
        label: o.label,
        shortcut: o.hint,
        checked: o.value === value,
        onSelect: () => {
          setOpen(false)
          if (o.value !== value) onChange(o.value)
        },
      })),
      { up },
    )
  }

  return (
    <button
      ref={btn}
      type="button"
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`${ariaLabel}: ${current?.label ?? value}`}
      onClick={show}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          show()
        }
      }}
      className={cn(
        'u-field flex min-w-0 items-center gap-2 pr-2 text-left text-[12.5px] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)] disabled:opacity-40',
        open && 'shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
      {current?.hint && <span className="shrink-0 text-(--u-ink-3)">{current.hint}</span>}
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0 text-(--u-ink-3) transition-transform duration-150', open && 'rotate-180')} aria-hidden>
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
  )
}
