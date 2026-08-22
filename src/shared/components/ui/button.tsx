import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/cn'
import { pressableIcon, prefersReducedMotion } from '@/shared/lib/motion'

/**
 * shadcn-style Button, restyled onto this app's existing glass-token system
 * rather than shadcn's default theme.
 *
 * Sizes and hover contrast were bumped up a full pass after the first
 * version read as "hard to tell what's a button" — `hover:bg-white/6` and
 * 24-28px icon targets are both too subtle/small to register as
 * interactive at a glance, especially on a photographic wallpaper
 * background. `ghost` now gets a real border-appears-on-hover + a visible
 * (not barely-there) background tint; sizes moved to a 32/36/40px scale
 * closer to what Arc/Raycast/Linear actually ship.
 *
 * Press feedback uses `pressableIcon` (hover 1.03 / tap 0.97) — tuned down
 * from an earlier 1.04/0.96 pass that read as a visible "bounce" rather
 * than a felt compression; a button should acknowledge a click, not
 * perform one. Built in, not opt-in per instance, so every button in the
 * app shares the same one interaction pattern. `asChild` renders a plain
 * (non-motion) Slot, since Radix trigger components need to own the
 * element themselves.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent font-medium transition-[background-color,border-color,color] duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-elevated)]',
  {
    variants: {
      variant: {
        ghost:
          'text-text-secondary hover:text-text-primary hover:bg-white/10 hover:border-white/10',
        surface:
          'glass-surface text-text-secondary hover:text-text-primary hover:bg-white/10',
        brand: 'text-white shadow-[0_2px_10px_rgb(37_99_235/35%)]',
        danger:
          'bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/25 hover:border-red-500/35',
      },
      size: {
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
        pill: 'h-9 px-3.5 text-[13px]',
        'pill-sm': 'h-8 px-2.5 text-[12px]',
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

    return (
      <motion.button
        ref={ref}
        whileHover={prefersReducedMotion() ? undefined : pressableIcon.whileHover}
        whileTap={prefersReducedMotion() ? undefined : pressableIcon.whileTap}
        transition={pressableIcon.transition}
        className={classes}
        style={resolvedStyle}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
