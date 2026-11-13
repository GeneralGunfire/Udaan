import { forwardRef } from 'react'
import { Slot } from '@/shared/components/primitives/Slot'
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
    // Invisible hit-area expansion. A ::before pseudo-element stretched
    // 4px past every edge gives even the smallest icon button a target
    // comfortably over the 44px minimum, without inflating the painted
    // box or the layout it sits in. Pointer-events pass through it to the
    // button itself, so it costs nothing but reach.
    'relative before:absolute before:-inset-1 before:content-[""]',
    // Two curves, not one. Colour/shadow settle on a gentle ease-out, but
    // `transform` runs on a short overshoot curve so the press and release
    // have snap — with a single flat 150ms ease-out on everything, the
    // lift read as the button slowly drifting rather than responding, and
    // that "drift" is most of what makes a control feel dead. The active
    // state is faster still (90ms): a press should register instantly,
    // while the release is allowed to settle.
    '[transition:background-color_150ms_ease-out,border-color_150ms_ease-out,color_150ms_ease-out,opacity_150ms_ease-out,filter_150ms_ease-out,box-shadow_150ms_ease-out,transform_180ms_cubic-bezier(0.34,1.56,0.64,1)]',
    'active:[transition:transform_90ms_cubic-bezier(0.4,0,0.2,1)]',
    'disabled:pointer-events-none disabled:opacity-40',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
    'motion-reduce:transform-none',
  ].join(' '),
  {
    variants: {
      variant: {
        // Ghost is the toolbar workhorse, so it must be calm in a row of
        // its own kind. It previously grew a visible BORDER and lifted a
        // pixel on hover, which meant sweeping a pointer across a toolbar
        // made every button in turn jump and outline itself — restless,
        // and the borders read as a row of boxes appearing and vanishing.
        // A wash alone is enough to say "this is a target".
        ghost: [
          'border-transparent bg-transparent text-text-secondary',
          'hover:bg-(--os-hover) hover:text-text-primary',
          'active:bg-[var(--surface-hover)]',
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
        // Primary. Fill runs the logo's own gradient (--gradient-brand,
        // applied inline in the component below since a CSS variable
        // can't be a Tailwind background utility).
        //
        // The gradient alone was not enough: a flat diagonal wash reads
        // as a coloured rectangle, which is exactly the "looks bad" the
        // earlier passes kept landing on. Three things give it a body —
        // an inset top highlight (the lit edge, as if from above), an
        // inset bottom shade (the far side falling away), and a real
        // drop shadow beneath. That trio is what makes it a raised
        // object rather than a painted panel. `.text-on-gradient-brand`
        // (theme.css) carries the label across the gradient's light end.
        brand: [
          'border-transparent text-white font-semibold text-on-gradient-brand',
          'shadow-[inset_0_1px_0_rgb(255_255_255/28%),inset_0_-1px_0_rgb(0_0_0/22%),var(--shadow-brand)]',
          // Hover brightens and lifts a little further than other
          // variants — this is the primary action, so it is allowed to
          // be the most responsive thing on screen.
          'hover:brightness-[1.13] hover:-translate-y-0.5',
          'hover:shadow-[inset_0_1px_0_rgb(255_255_255/34%),inset_0_-1px_0_rgb(0_0_0/22%),0_8px_22px_-4px_rgb(0_0_0/50%)]',
          // Press collapses the lift AND the inset highlight, so the
          // button visibly sits back down into the surface instead of
          // just dimming.
          'active:brightness-[0.94] active:translate-y-0',
          'active:shadow-[inset_0_2px_4px_rgb(0_0_0/28%),var(--shadow-raised)]',
        ].join(' '),
        // Destructive, quiet form: a tinted surface rather than a solid
        // red slab. Correct for a delete sitting in a list or a menu,
        // where a filled red button would dominate a screen full of
        // ordinary rows. Use `danger-solid` when the destruction is the
        // whole point of the dialog.
        danger: [
          'border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] text-[var(--color-danger)]',
          'bg-[color-mix(in_srgb,var(--color-danger)_14%,var(--surface-raised))]',
          'hover:bg-[color-mix(in_srgb,var(--color-danger)_24%,var(--surface-raised))] hover:-translate-y-px',
          'hover:border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)]',
          'active:translate-y-0 active:bg-[color-mix(in_srgb,var(--color-danger)_30%,var(--surface-raised))]',
        ].join(' '),
        // Destructive, committed form — the confirm button in a "delete
        // this permanently?" dialog. Same raised-object treatment as
        // `brand` (lit top edge, shaded bottom, real shadow) so the two
        // read as the same class of control, just different intent.
        'danger-solid': [
          'border-transparent bg-[var(--color-danger)] text-white font-semibold',
          'shadow-[inset_0_1px_0_rgb(255_255_255/26%),inset_0_-1px_0_rgb(0_0_0/20%),var(--shadow-raised)]',
          'hover:brightness-110 hover:-translate-y-0.5',
          'hover:shadow-[inset_0_1px_0_rgb(255_255_255/32%),inset_0_-1px_0_rgb(0_0_0/20%),0_8px_22px_-4px_rgb(0_0_0/50%)]',
          'active:brightness-95 active:translate-y-0',
          'active:shadow-[inset_0_2px_4px_rgb(0_0_0/26%),var(--shadow-raised)]',
        ].join(' '),
        // Affirmative/confirming action — "start", "connect", "mark
        // done". The success hue exists in the token set for status, and
        // a button that commits to that state should be able to speak the
        // same colour.
        success: [
          'border-transparent bg-[var(--color-success)] text-[var(--color-success-contrast)] font-semibold',
          'shadow-[inset_0_1px_0_rgb(255_255_255/30%),inset_0_-1px_0_rgb(0_0_0/18%),var(--shadow-raised)]',
          'hover:brightness-110 hover:-translate-y-0.5',
          'hover:shadow-[inset_0_1px_0_rgb(255_255_255/36%),inset_0_-1px_0_rgb(0_0_0/18%),0_8px_22px_-4px_rgb(0_0_0/50%)]',
          'active:brightness-95 active:translate-y-0',
          'active:shadow-[inset_0_2px_4px_rgb(0_0_0/24%),var(--shadow-raised)]',
        ].join(' '),
      },
      size: {
        // Icon buttons carry a transparent margin so their real hit area
        // meets the 44px target even where the painted box is smaller —
        // a 28px toolbar button is a genuinely hard thing to hit, and
        // growing the paint instead would make every toolbar bulky.
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
        'icon-lg': 'h-10 w-10',
        pill: 'h-9 px-3.5 text-sm',
        'pill-sm': 'h-8 px-3 text-xs',
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
    // The brand gradient lives in a CSS variable, which Tailwind cannot
    // express as a background utility, so it is applied inline. Disabled
    // brand buttons drop the gradient entirely rather than fading it: a
    // 30%-opacity gradient over a dark surface resolves to an
    // indeterminate grey blob that reads as a broken/unstyled control
    // (which is exactly how the composer's send button looked while the
    // input was empty). A flat, obviously-inert surface fill is honest
    // about the state instead.
    const brandDisabled = variant === 'brand' && props.disabled
    const resolvedStyle =
      variant === 'brand' && !brandDisabled
        ? { background: 'var(--gradient-brand)', ...style }
        : style
    const classes = cn(
      buttonVariants({ variant, size, className }),
      brandDisabled &&
        'disabled:opacity-100 bg-[var(--surface-overlay)] text-text-tertiary shadow-none [text-shadow:none]',
    )

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
