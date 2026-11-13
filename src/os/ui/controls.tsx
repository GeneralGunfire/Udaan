import { forwardRef, useCallback, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { springs } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'

/**
 * Every interactive control in the Udaan shell.
 *
 * WHY THESE EXIST AS COMPONENTS
 * -----------------------------
 * A shell assembled from ad-hoc `<button className="...">` drifts: one
 * button scales on press, the next only tints, a third does nothing. People
 * do not notice the individual inconsistencies — they notice that the
 * product feels unfinished.
 *
 * WHAT MAKES A CONTROL FEEL PHYSICAL
 * ----------------------------------
 *  1. IT COMPRESSES. A press that only changes colour feels like a web
 *     page. A press that scales down ~4% and springs back feels like
 *     hardware. The release is a spring, not a tween, so interrupting it
 *     (clicking twice fast) redirects from the current velocity instead of
 *     restarting.
 *  2. IT RESPONDS FASTER THAN IT RECOVERS. Press-down is ~60ms; release is
 *     ~200ms. Equal timings feel mushy.
 *  3. IT ACKNOWLEDGES THE POINTER'S POSITION. A large control lights
 *     slightly where the cursor actually is, not uniformly.
 *  4. IT NEVER MOVES LAYOUT. Everything is transform and opacity.
 */

/* ------------------------------------------------------------------ */
/*  BUTTON                                                             */
/* ------------------------------------------------------------------ */

export type ButtonVariant = 'ghost' | 'filled' | 'tinted' | 'plain'
export type ButtonSize = 'sm' | 'md' | 'lg'

const SIZES: Record<ButtonSize, string> = {
  // Heights land on the 4pt grid; padding is optical, not mathematical —
  // text needs more room on the sides than above and below to look centred.
  sm: 'h-[24px] px-2 text-[12px]',
  md: 'h-[30px] px-3 text-[13px]',
  lg: 'h-[36px] px-4 text-[14px]',
}

const VARIANTS: Record<ButtonVariant, string> = {
  ghost: 'os-btn-ghost',
  filled: 'os-btn-filled font-medium',
  tinted: 'os-btn-tinted',
  plain: '',
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Square icon button — width is locked to the height. */
  icon?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon = false, className, children, ...rest },
  ref,
) {
  const reduced = prefersReducedMotion()
  return (
    <motion.button
      ref={ref}
      type="button"
      // Scale lives on the motion layer rather than in CSS so a press
      // interrupted mid-release resolves from its current velocity.
      whileTap={reduced || rest.disabled ? undefined : { scale: 0.96 }}
      transition={springs.snap}
      className={cn('os-control', VARIANTS[variant], SIZES[size], icon && 'aspect-square px-0', className)}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      {children}
    </motion.button>
  )
})

/* ------------------------------------------------------------------ */
/*  SWITCH                                                             */
/* ------------------------------------------------------------------ */

/**
 * The sliding on/off switch.
 *
 * The knob stretches while held (`:active` widens it) and springs back on
 * release — the detail that separates a switch you want to flip from a
 * styled checkbox. State is carried by FILL as well as position, so it stays
 * readable without colour vision.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('os-control os-switch', className)}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  SEGMENTED CONTROL                                                  */
/* ------------------------------------------------------------------ */

/**
 * A segmented control whose selection *slides* between cells.
 *
 * The sliding pill is a shared `layoutId`, so Framer animates it between
 * positions rather than cross-fading two static backgrounds. That movement
 * is what communicates "these are positions on one axis" instead of "these
 * are separate buttons that happen to be adjacent".
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (next: T) => void
  className?: string
}) {
  const id = useRef(`seg-${Math.random().toString(36).slice(2)}`).current
  const reduced = prefersReducedMotion()
  return (
    <div className={cn('os-segment', className)} role="tablist">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(o.value)}
            className="os-control relative text-[13px]"
          >
            {selected && (
              <motion.span
                layoutId={reduced ? undefined : id}
                className="absolute inset-0 -z-10 rounded-[6px]"
                style={{
                  background: 'var(--os-panel-solid)',
                  boxShadow: 'var(--os-edge), var(--os-shadow-sm)',
                }}
                transition={springs.standard}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  SLIDER                                                             */
/* ------------------------------------------------------------------ */

/**
 * A value slider. The filled portion is driven by a CSS custom property so
 * the track repaints without React re-rendering on every pointer move —
 * dragging a React-controlled range input at 120Hz is a frequent source of
 * dropped frames.
 */
export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onCommit,
  className,
  ...rest
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (next: number) => void
  /** Called once when the drag ends — use for expensive writes. */
  onCommit?: (next: number) => void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step'>) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      className={cn('os-slider w-full', className)}
      style={{ '--fill': `${pct}%` } as React.CSSProperties}
      {...rest}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  ROW                                                                */
/* ------------------------------------------------------------------ */

/** A selectable row in a list or menu. */
export const Row = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }>(
  function Row({ selected, className, children, ...rest }, ref) {
    return (
      <button ref={ref} type="button" aria-selected={selected} className={cn('os-row', className)} {...rest}>
        {children}
      </button>
    )
  },
)

/* ------------------------------------------------------------------ */
/*  FIELD                                                              */
/* ------------------------------------------------------------------ */

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Field(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn('os-field text-[13px]', className)} {...rest} />
})

/* ------------------------------------------------------------------ */
/*  SPOTLIGHT                                                          */
/* ------------------------------------------------------------------ */

/**
 * A surface that lights up where the pointer actually is.
 *
 * On a large tile, a uniform hover wash reads as "something is highlighted";
 * a highlight that follows the cursor reads as "this is a physical surface
 * catching light". The position is written to CSS custom properties on
 * pointermove — no React state, so it costs nothing per frame.
 *
 * Used by dock tiles, widget cards and start-menu tiles.
 */
export function Spotlight({
  children,
  className,
  radius = 120,
  strength = 0.1,
  ...rest
}: {
  children: ReactNode
  className?: string
  /** How far the light spreads, in px. */
  radius?: number
  /** Peak opacity of the light at the cursor. */
  strength?: number
} & Omit<HTMLMotionProps<'div'>, 'children'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState(false)

  const track = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--spot-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--spot-y', `${e.clientY - r.top}px`)
  }, [])

  return (
    <motion.div
      ref={ref}
      onPointerMove={track}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      className={cn('relative isolate', className)}
      {...rest}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] transition-opacity duration-200"
        style={{
          opacity: lit ? 1 : 0,
          background: `radial-gradient(${radius}px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgb(255 255 255 / ${strength}), transparent 70%)`,
        }}
      />
      {children}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  DIVIDER                                                            */
/* ------------------------------------------------------------------ */

export function Divider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('os-divider', vertical ? 'w-px self-stretch' : 'h-px w-full', className)}
    />
  )
}
