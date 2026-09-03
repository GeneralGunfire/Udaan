import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, zIndex } from '@/shared/lib/motion'

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
          data-overlay-scroll
          className={cn(
            // overflow-y-auto, not overflow-hidden: a menu with more items
            // than fit in max-h-72 was previously just silently clipped —
            // the extra items existed in the DOM but had no way to be
            // scrolled to or clicked, reading as "missing" items rather
            // than a cut-off list (real reported bug, e.g. OpenInAppMenu
            // with many installed apps, or a sound picker with a long
            // library).
            'flex max-h-72 w-64 flex-col overflow-y-auto rounded-xl border p-1',
            className,
          )}
          style={{
            // A menu floats one step above whatever opened it, so it takes
            // `surface-overlay` and the matching overlay shadow — the
            // heavier modal shadow it used before belongs to dialogs.
            background: 'var(--surface-overlay)',
            borderColor: 'var(--border-hairline)',
            boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-overlay)',
            zIndex: zIndex.dropdown,
          }}
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
        'text-text-secondary hover:text-text-primary data-highlighted:bg-(--surface-raised) data-highlighted:text-text-primary flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Nested submenu (e.g. right-click item → "Open with" → app list). Same
 * restyle approach as the top-level menu: Radix owns positioning/hover
 * intent, Framer Motion owns enter/exit.
 */
export const DropdownMenuSub = DropdownMenuPrimitive.Sub

export function DropdownMenuSubTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        'text-text-secondary hover:text-text-primary data-highlighted:bg-(--surface-raised) data-highlighted:text-text-primary data-[state=open]:bg-(--surface-raised) flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSubContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent asChild sideOffset={4} alignOffset={-4} {...props}>
        <motion.div
          initial={{ opacity: 0, x: -4, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -4, scale: 0.97 }}
          transition={spring.standard}
          data-overlay-scroll
          className={cn(
            'flex max-h-72 w-56 flex-col overflow-y-auto rounded-xl border p-1',
            className,
          )}
          style={{
            background: 'var(--surface-overlay)',
            borderColor: 'var(--border-hairline)',
            boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-overlay)',
            zIndex: zIndex.dropdown,
          }}
        >
          {children}
        </motion.div>
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  )
}
