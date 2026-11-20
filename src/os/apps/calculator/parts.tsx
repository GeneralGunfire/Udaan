import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

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
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.4h2.4M8 5v3l2 1.5',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  trash: 'M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9',
  back: 'M6 3.5h7.5v9H6L2.5 8zM8 6l4 4M12 6l-4 4',
  swap: 'M4.5 2.5v11M2 5l2.5-2.5L7 5M11.5 13.5v-11M9 11l2.5 2.5L14 11',
  close: 'M4 4l8 8M12 4l-8 8',
}

/**
 * Key tones, quietest to loudest:
 *   mem    memory and utility toggles: no fill, small caps
 *   fn     functions and clears: a hairline outline
 *   digit  the number pad: a neutral fill
 *   op     the four operators: a fill lightly tinted with the accent
 *   eq     equals: the accent
 */
export type KeyTone = 'mem' | 'digit' | 'fn' | 'op' | 'eq'

/**
 * One calculator key. `data-key` lets the keyboard handler flash the key it pressed, so typing
 * gives the same press feedback as clicking.
 */
export function Key({
  id,
  children,
  onPress,
  tone = 'fn',
  disabled,
  active,
  label,
  className,
}: {
  id: string
  children: ReactNode
  onPress: () => void
  tone?: KeyTone
  disabled?: boolean
  active?: boolean
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      data-key={id}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={onPress}
      className={cn(
        'u-btn h-auto min-h-0 w-full min-w-0 rounded-[10px] px-0 text-[14px] tabular-nums outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)] disabled:opacity-30',
        tone === 'mem' &&
          'u-btn--ghost text-[11.5px] font-semibold tracking-wide uppercase',
        tone === 'digit' &&
          'bg-(--u-wash-hover) text-[18px] font-medium text-(--u-ink)',
        tone === 'fn' &&
          'u-btn--ghost shadow-[inset_0_0_0_1px_var(--u-edge)]',
        tone === 'op' &&
          'bg-[color-mix(in_srgb,var(--u-accent)_14%,var(--u-wash-hover))] text-[19px] text-(--u-ink) shadow-[inset_0_0_0_1px_var(--u-edge)]',
        tone === 'eq' && 'u-btn--accent text-[20px]',
        active && 'bg-(--u-wash-on) text-(--u-accent)',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A small label in the display's top row: angle unit, word size, base. */
export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-[6px] bg-(--u-wash-on) px-1.5 text-[10.5px] leading-[18px] font-semibold tracking-wide text-(--u-ink-2)"
    >
      {children}
    </span>
  )
}

/** Tracks an element's width, for layouts that change shape with the window. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Briefly shows a key as pressed, for keyboard input. Direct DOM: no re-render. */
export function flashKey(root: HTMLElement | null, id: string) {
  const el = root?.querySelector<HTMLElement>(`[data-key="${CSS.escape(id)}"]`)
  if (!el || (el as HTMLButtonElement).disabled) return
  el.style.transform = 'scale(0.96)'
  el.style.filter = 'brightness(0.92)'
  window.setTimeout(() => {
    el.style.transform = ''
    el.style.filter = ''
  }, 110)
}

/**
 * The display: a row of mode chips, the expression small and dim, and the value large. The value
 * shrinks to fit its width (measured, not guessed from the length), so a long number never clips.
 * Right-click opens the display menu (copy, paste, history).
 */
export function Display({
  expr,
  value,
  error,
  onCopy,
  onMenu,
  chips,
  size = 46,
}: {
  expr: string
  value: string
  error?: boolean
  onCopy: () => void
  onMenu?: (e: React.MouseEvent) => void
  chips?: ReactNode
  /** The largest font size of the value. */
  size?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const txt = useRef<HTMLSpanElement>(null)
  const base = error ? 22 : size
  useLayoutEffect(() => {
    const fit = () => {
      const b = box.current
      const t = txt.current
      if (!b || !t) return
      t.style.fontSize = `${base}px`
      const need = t.scrollWidth
      const room = b.clientWidth
      t.style.fontSize = `${need > room && need > 0 ? Math.max(15, Math.floor((base * room) / need)) : base}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [value, base])

  return (
    <div
      className="flex shrink-0 flex-col gap-1 px-4 pt-1 pb-3"
      onContextMenu={
        onMenu ? (e) => (e.preventDefault(), onMenu(e)) : undefined
      }
    >
      <div className="flex h-[18px] items-center gap-1">{chips}</div>
      <div
        className="h-[18px] w-full truncate text-right text-[13px] text-(--u-ink-3) tabular-nums"
        aria-label="Expression"
      >
        {expr}
      </div>
      <div ref={box} className="flex h-[56px] w-full items-end justify-end">
        <button
          type="button"
          onClick={onCopy}
          title="Copy (Ctrl+C)"
          aria-live="polite"
          aria-label={`Result ${value}. Click to copy.`}
          className={cn(
            'max-w-full rounded-[8px] text-right leading-[1.1] font-semibold tracking-tight whitespace-nowrap tabular-nums outline-none focus-visible:shadow-[0_0_0_2px_var(--u-accent)]',
            error ? 'text-(--u-danger)' : 'text-(--u-ink)',
          )}
        >
          <span ref={txt} className="block overflow-hidden text-ellipsis">
            {value}
          </span>
        </button>
      </div>
    </div>
  )
}
