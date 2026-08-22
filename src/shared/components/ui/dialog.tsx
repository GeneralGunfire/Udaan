import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'

/**
 * Thin restyle of Radix's dialog onto the app's glass tokens — same
 * pattern as dropdown-menu.tsx/tooltip.tsx. Radix owns focus trapping,
 * Escape-to-close, click-outside, and correct ARIA (role="dialog",
 * aria-modal, labelledby wiring via Title/Description) — none of which a
 * hand-rolled `motion.div` + backdrop gets for free.
 *
 * Enter/exit motion is Framer Motion, not Radix's CSS data-state — same
 * mount-while-open pattern as DropdownMenuContent: caller renders
 * `<DialogContent>` only while `open`, wrapped in its own
 * `AnimatePresence`.
 */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const reduced = prefersReducedMotion()
  return (
    <DialogPrimitive.Portal forceMount>
      <DialogPrimitive.Overlay asChild forceMount>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.15 }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        />
      </DialogPrimitive.Overlay>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Content asChild forceMount {...props}>
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={spring.panel}
            className={cn(
              'glass-surface w-full max-w-sm rounded-2xl p-5 outline-none',
              className,
            )}
            style={{ boxShadow: 'var(--shadow-panel)' }}
          >
            {children}
          </motion.div>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  )
}
