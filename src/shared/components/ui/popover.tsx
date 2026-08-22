import * as PopoverPrimitive from '@radix-ui/react-popover'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'

/**
 * Thin restyle of Radix's popover onto the app's glass tokens — same
 * pattern as dropdown-menu.tsx/tooltip.tsx/dialog.tsx. Radix owns
 * positioning (flips/shifts to stay in viewport), Escape-to-close,
 * outside-click dismissal, and focus return to the trigger on close.
 */
export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const reduced = prefersReducedMotion()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content sideOffset={sideOffset} asChild {...props}>
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
          transition={spring.standard}
          className={cn(
            'glass-surface border-glass-border z-40 rounded-2xl border outline-none',
            className,
          )}
          style={{ boxShadow: 'var(--shadow-panel)' }}
        >
          {children}
        </motion.div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}
