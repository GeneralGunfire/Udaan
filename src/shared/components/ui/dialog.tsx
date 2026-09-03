import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, duration, zIndex, prefersReducedMotion } from '@/shared/lib/motion'

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
          transition={{ duration: reduced ? 0 : duration.backdrop }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          style={{ zIndex: zIndex.overlay }}
        />
      </DialogPrimitive.Overlay>
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: zIndex.overlayPanel }}
      >
        <DialogPrimitive.Content asChild forceMount {...props}>
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={spring.panel}
            className={cn(
              // max-h + overflow-y-auto: without this, a dialog whose
              // content grows taller than the viewport (a long error
              // message, a multi-step confirm flow like
              // ShellSafetyPanel's) had nowhere to go but off the top/
              // bottom of the screen — same "cut off, can't reach the
              // button" symptom as the taskbar popup's unclamped
              // position, just vertical overflow instead of off-screen
              // placement. The dialog is centered via the wrapper's own
              // flex/p-4, so this only ever kicks in once content
              // actually exceeds the available height.
              'flex max-h-[calc(100vh-2rem)] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border p-5 outline-none',
              className,
            )}
            style={{
              // A modal is the one layer that genuinely floats free of the
              // app surface, so it keeps the heaviest shadow in the scale.
              background: 'var(--surface-overlay)',
              borderColor: 'var(--border-hairline)',
              boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-modal)',
            }}
            data-overlay-scroll
          >
            {children}
          </motion.div>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  )
}
