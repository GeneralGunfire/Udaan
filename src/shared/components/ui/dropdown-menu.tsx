import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring } from '@/shared/lib/motion'

/**
 * Thin restyle of Radix's dropdown-menu primitives onto this app's glass
 * tokens. Radix owns focus trapping, click-outside, and Escape-to-close —
 * behavior the previous hand-rolled popover (open state + no outside-click
 * handling) didn't have.
 *
 * Enter/exit motion is Framer Motion (the app's one animation engine), not
 * Radix's own CSS-driven open/closed states. Caller controls `open` and
 * only renders `<DropdownMenuContent>` while open, wrapped in its own
 * `AnimatePresence` — the same mount/unmount-driven exit pattern used
 * everywhere else in the app.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content sideOffset={sideOffset} asChild {...props}>
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.97 }}
          transition={spring.standard}
          className={cn(
            'glass-surface border-glass-border z-20 flex max-h-72 w-64 flex-col overflow-hidden rounded-2xl',
            className,
          )}
          style={{ boxShadow: 'var(--shadow-panel)' }}
        >
          {children}
        </motion.div>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'text-text-secondary hover:text-text-primary data-highlighted:bg-glass-hover data-highlighted:text-text-primary flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] outline-none transition-colors duration-150',
        className,
      )}
      {...props}
    />
  )
}
