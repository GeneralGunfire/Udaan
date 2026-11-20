import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { dur, overlayMotion } from '@/os/motion/systemMotion'
import { cn } from '@/shared/lib/cn'
import { prefersReducedMotion } from '@/shared/lib/motion'

export function Ico({
  d,
  size = 15,
  className,
}: {
  d: string
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

export const P = {
  globe:
    'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM1.5 8h13M8 1.5c1.8 1.8 2.6 4 2.6 6.5S9.8 12.7 8 14.5M8 1.5C6.2 3.3 5.4 5.5 5.4 8s.8 4.7 2.6 6.5',
  alarm:
    'M8 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 5.5v3l2 1.2M2 3.5 4 1.8M14 3.5 12 1.8',
  stopwatch:
    'M8 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 9V6.2M6.5 1.5h3M12.3 4.3l1-1',
  timer:
    'M4 1.5h8M4 14.5h8M5 1.5c0 3 3 4 3 6.5S5 11.5 5 14.5M11 1.5c0 3-3 4-3 6.5s3 3.5 3 6.5',
  focus:
    'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  plus: 'M8 3v10M3 8h10',
  trash: 'M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9',
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14 14',
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  reset: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.4h2.4',
  flag: 'M4 14.5v-12M4 3h8l-1.5 3L12 9H4',
  sun: 'M8 10.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6ZM8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9',
  moon: 'M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6Z',
  edit: 'M10.5 2.5l3 3-8 8h-3v-3z',
  close: 'M4 4l8 8M12 4l-8 8',
  volume: 'M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5',
}

/** Re-renders every `ms` while mounted. One timer per caller; nothing runs per frame. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Line up with the start of the next second so the display ticks with the real clock.
    let iv: ReturnType<typeof setInterval> | undefined
    const first = setTimeout(
      () => {
        setNow(Date.now())
        iv = setInterval(() => setNow(Date.now()), ms)
      },
      ms - (Date.now() % ms),
    )
    return () => {
      clearTimeout(first)
      clearInterval(iv)
    }
  }, [ms])
  return now
}

const LOCAL_EVENT = 'udaan-clock-changed'
/** Tells hooks in this window that a key was written outside them (storage events only reach other windows). */
export const announce = (key: string) =>
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: key }))

/**
 * State kept in localStorage that also follows changes made by other windows (the background
 * alarm service marks timers done and moves focus sessions on).
 */
export function useStored<T>(
  storageKey: string,
  load: () => T,
  save: (v: T) => void,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(load)
  const ref = useRef(v)
  ref.current = v
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) setV(load())
    }
    const onLocal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === storageKey) setV(load())
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(LOCAL_EVENT, onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(LOCAL_EVENT, onLocal)
    }
  }, [storageKey, load])
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const value =
        typeof next === 'function' ? (next as (p: T) => T)(ref.current) : next
      ref.current = value
      setV(value)
      save(value)
    },
    [save],
  )
  return [v, set]
}

export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable)

/** Keyboard shortcuts for the active tab. Ignored while typing in a field or while a dialog is open. */
export function useKeys(handler: (e: KeyboardEvent) => void, enabled = true) {
  const h = useRef(handler)
  h.current = handler
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('[data-clock-dialog]')) return
      h.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** h:mm:ss or m:ss, with optional hundredths. */
export function fmtDuration(ms: number, hundredths = false): string {
  const neg = ms < 0
  const t = Math.abs(ms)
  const h = Math.floor(t / 3_600_000)
  const m = Math.floor((t % 3_600_000) / 60_000)
  const s = Math.floor((t % 60_000) / 1000)
  const cs = Math.floor((t % 1000) / 10)
  const body = `${h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${hundredths ? `.${String(cs).padStart(2, '0')}` : ''}`
  return neg ? `-${body}` : body
}

export function fmtClock(
  h: number,
  m: number,
  clock24: boolean,
): { time: string; suffix: string } {
  if (clock24)
    return {
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      suffix: '',
    }
  return {
    time: `${h % 12 || 12}:${String(m).padStart(2, '0')}`,
    suffix: h < 12 ? 'AM' : 'PM',
  }
}

/** A modal sheet in the style of the other Udaan apps. Escape and a click outside close it; focus stays inside. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 420,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>(
      'input, select, button, [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        close.current()
      } else if (e.key === 'Tab' && box.current) {
        const items = [
          ...box.current.querySelectorAll<HTMLElement>(
            'input, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ]
        if (!items.length) return
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) {
          e.preventDefault()
          items[items.length - 1].focus()
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault()
          items[0].focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [])
  const reduced = prefersReducedMotion()
  return (
    <motion.div
      data-clock-dialog
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: dur.fade } }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reduced ? { opacity: 0 } : overlayMotion.initial}
        animate={reduced ? { opacity: 1 } : overlayMotion.animate}
        className="u-surface flex max-h-full flex-col overflow-hidden rounded-[14px] bg-(--u-m-solid) shadow-[inset_0_0_0_1px_var(--u-edge)]"
        style={{ width, maxWidth: '100%' }}
      >
        <h2 id={titleId} className="shrink-0 px-5 pt-5 text-[15px] font-semibold">
          {title}
        </h2>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 px-5 pb-5">
            {footer}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-6 pt-16 text-center text-[13px] leading-relaxed text-(--u-ink-3)">
      {children}
    </p>
  )
}

/** The header of a tab's main area, matching the other apps' panes. */
export function PaneHeader({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-(--u-edge) px-5 py-3">
      <span className="text-[13px] font-semibold">{title}</span>
      <span className="flex-1" />
      {children}
    </header>
  )
}

/** A thin progress ring, drawn as two circles. */
export function Ring({
  fraction,
  size = 120,
  stroke = 6,
  children,
  className,
}: {
  fraction: number
  size?: number
  stroke?: number
  children?: ReactNode
  className?: string
}) {
  const r = (size - stroke) / 2
  const f = Math.max(0, Math.min(1, fraction))
  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--u-wash-press)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--u-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={`${f} 1`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 300ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  )
}
