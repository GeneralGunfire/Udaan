import * as PopoverPrimitive from '@radix-ui/react-popover'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, zIndex, prefersReducedMotion } from '@/shared/lib/motion'

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
          data-overlay-scroll
          className={cn('rounded-xl border outline-none', className)}
          style={{
            background: 'var(--surface-overlay)',
            borderColor: 'var(--border-hairline)',
            boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-overlay)',
            zIndex: zIndex.overlayPanel,
          }}
        >
          {children}
        </motion.div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}
