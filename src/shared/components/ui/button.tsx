import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/cn'

/**
 * The app's one Button. Built on the surface ladder (tokens.css) rather
 * than flat white-tint overlays: a control at rest sits on
 * `--surface-raised`, and hovering advances it to `--surface-overlay`, so
 * interaction reads as the element rising toward the light rather than
 * merely changing colour.
 *
 * `asChild` renders a plain (non-motion) Slot, since Radix trigger
 * components need to own the element themselves.
 */
/**
 * Every variant implements the same four-state contract:
 *
 *   rest    surface-ladder fill + hairline border
 *   hover   surface steps UP one ladder level, border strengthens, -1px lift
 *   active  surface steps back down, lift released — a real "press in"
 *   focus   2px accent outline with offset (never `outline-none` alone)
 *
 * The lift/settle is what makes a control read as a physical object
 * rather than a rectangle that changes colour. `-translate-y-px` on hover
 * and `translate-y-0` on active is deliberately tiny: felt, not seen.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium',
    'transition-[background-color,border-color,color,opacity,filter,box-shadow,transform] duration-150 ease-out',
    'disabled:pointer-events-none disabled:opacity-40',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
    'motion-reduce:transform-none',
  ].join(' '),
  {
    variants: {
      variant: {
        ghost: [
          'border-transparent bg-transparent text-text-secondary',
          'hover:bg-[var(--surface-raised)] hover:border-[var(--border-hairline)] hover:text-text-primary hover:-translate-y-px',
          'active:bg-[var(--surface-overlay)] active:translate-y-0',
        ].join(' '),
        surface: [
          'border-[var(--border-hairline)] bg-[var(--surface-raised)] text-text-secondary',
          'shadow-[inset_0_1px_0_var(--highlight-inset)]',
          'hover:bg-[var(--surface-overlay)] hover:border-[var(--border-strong)] hover:text-text-primary hover:-translate-y-px',
          'active:bg-[var(--surface-raised)] active:translate-y-0',
        ].join(' '),
        // Filled neutral — visible weight without reaching for the brand
        // gradient, e.g. a secondary action beside a primary `brand`.
        secondary: [
          'border-[var(--border-hairline)] bg-[var(--surface-raised)] text-text-primary',
          'shadow-[inset_0_1px_0_var(--highlight-inset)]',
          'hover:bg-[var(--surface-overlay)] hover:border-[var(--border-strong)] hover:-translate-y-px',
          'active:bg-[var(--surface-raised)] active:translate-y-0',
        ].join(' '),
        // Primary. Gradient fill is the one place the raw logo petals are
        // used; label must stay >=13px/600 for white to clear contrast at
        // the cyan end (measured 3.37:1).
        brand: [
          'border-transparent text-white font-semibold',
          'shadow-[var(--shadow-brand)]',
          'hover:brightness-110 hover:saturate-[1.08] hover:-translate-y-px',
          'hover:shadow-[0_6px_20px_-2px_rgb(45_111_239/45%)]',
          'active:brightness-95 active:translate-y-0 active:shadow-[var(--shadow-raised)]',
        ].join(' '),
        danger: [
          'border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] text-[var(--color-danger)]',
          'bg-[color-mix(in_srgb,var(--color-danger)_14%,var(--surface-raised))]',
          'hover:bg-[color-mix(in_srgb,var(--color-danger)_24%,var(--surface-raised))] hover:-translate-y-px',
          'hover:border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)]',
          'active:translate-y-0 active:bg-[color-mix(in_srgb,var(--color-danger)_30%,var(--surface-raised))]',
        ].join(' '),
      },
      size: {
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
        'icon-lg': 'h-10 w-10',
        pill: 'h-9 px-3.5 text-sm',
        'pill-sm': 'h-8 px-2.5 text-xs',
        // Primary actions that need real presence (send, confirm, submit).
        lg: 'h-11 px-5 text-base',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'icon',
    },
  },
)

export interface ButtonProps
  extends HTMLMotionProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, ...props }, ref) => {
    const resolvedStyle =
      variant === 'brand' ? { background: 'var(--gradient-brand)', ...style } : style
    const classes = cn(buttonVariants({ variant, size, className }))

    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={classes}
          style={resolvedStyle as React.CSSProperties | undefined}
          {...(props as React.HTMLAttributes<HTMLButtonElement>)}
        />
      )
    }

    // Hover/press feedback is CSS now (see buttonVariants' four-state
    // contract) rather than a Framer scale spring. Two reasons: the two
    // systems were fighting for the same transform channel, and the CSS
    // lift composites without React re-rendering on every pointer event.
    // `motion.button` stays so callers can still pass motion props for
    // orchestration (AnimatePresence swaps, layout animations).
    return <motion.button ref={ref} className={classes} style={resolvedStyle} {...props} />
  },
)
Button.displayName = 'Button'

export { buttonVariants }
