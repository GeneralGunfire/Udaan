import { cloneElement, createContext, isValidElement, useContext, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, duration, zIndex, prefersReducedMotion } from '@/shared/lib/motion'
import { usePortalContainer } from './hooks/usePortal'
import { useDismissableLayer } from './hooks/useDismissableLayer'
import { useFocusTrap } from './hooks/useFocusTrap'
import { useScrollLock } from './hooks/useScrollLock'

/**
 * Hand-built replacement for the Radix-backed Dialog. Composes the shared
 * primitive hooks (portal, dismissable-layer, focus-trap, scroll-lock)
 * rather than a component library's behavior — see
 * src/shared/components/primitives/hooks/ for what each piece owns.
 *
 * API is deliberately identical to the Radix-backed version it replaces
 * (Dialog/DialogTrigger/DialogContent/DialogTitle/DialogDescription with
 * open/onOpenChange), since every one of its 11 consumers already wraps
 * DialogContent in their own <AnimatePresence>{open && <DialogContent>}
 * and none of that call-site code needed to change.
 */

interface DialogContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: React.RefObject<HTMLElement | null>
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialogContext(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('Dialog components must be used within <Dialog>')
  return ctx
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const triggerRef = useRef<HTMLElement | null>(null)
  return (
    <DialogContext.Provider value={{ open, onOpenChange, triggerRef }}>
      {children}
    </DialogContext.Provider>
  )
}

/** `asChild` clones the trigger ref directly onto the child element
 *  (matching Radix's Slot behavior for this one call site's needs,
 *  without pulling in @radix-ui/react-slot) rather than wrapping it in
 *  an intermediate element. A `<span style="display:contents">` wrapper
 *  was tried first and is a real bug, not just an unnecessary DOM node:
 *  WebView2 has a known issue class where `display: contents` on an
 *  intermediate element can silently swallow pointer events before they
 *  reach its children — a trigger wrapped that way could stop responding
 *  to clicks entirely, with no hover state either. Cloning avoids the
 *  wrapper altogether.
 *
 *  Also wires click-to-open itself — a real, previously-missing bug of
 *  the exact same shape PopoverTrigger had (see that file's own comment):
 *  this only ever attached the ref for positioning/focus-return, leaving
 *  every consumer to open the dialog through some OTHER path. Every
 *  current consumer does drive `open` from its own state and happened to
 *  wire a click handler at the call site — except DaemonStatusControl,
 *  whose trigger Button has no onClick at all, so clicking it visibly did
 *  nothing. Rather than patch that one call site, DialogTrigger now does
 *  what its name says on its own, the same way DropdownMenuTrigger and
 *  PopoverTrigger already do — a call site's own onClick (if any) still
 *  runs first, this just adds the open call after it. */
export function DialogTrigger({
  asChild,
  children,
}: {
  asChild?: boolean
  children: ReactNode
}) {
  const { open, onOpenChange, triggerRef } = useDialogContext()
  if (asChild && isValidElement<{ ref?: React.Ref<HTMLElement>; onClick?: (e: React.MouseEvent) => void }>(children)) {
    return cloneElement(children, {
      ref: triggerRef as React.Ref<HTMLElement>,
      onClick: (e: React.MouseEvent) => {
        children.props.onClick?.(e)
        onOpenChange(!open)
      },
    })
  }
  return (
    <span
      ref={triggerRef as React.RefObject<HTMLSpanElement>}
      onClick={() => onOpenChange(!open)}
    >
      {children}
    </span>
  )
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <h2 className={className}>{children}</h2>
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <p className={className}>{children}</p>
}

export interface DialogContentProps {
  className?: string
  children: ReactNode
  /** Suppress the default "focus the first focusable child" behavior —
   *  the direct equivalent of the Radix version's
   *  `onOpenAutoFocus={(e) => e.preventDefault()}`, used by EventModal. */
  autoFocus?: boolean
}

export function DialogContent({ className, children, autoFocus = true }: DialogContentProps) {
  const { open, onOpenChange, triggerRef } = useDialogContext()
  const container = usePortalContainer()
  const overlayRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()

  useDismissableLayer({
    enabled: open,
    containerRef: contentRef,
    excludeRefs: [triggerRef],
    onDismiss: () => onOpenChange(false),
    closeOnEscape: true,
    closeOnOutsideClick: true,
  })
  useFocusTrap({ enabled: open, containerRef: contentRef, autoFocus })
  useScrollLock(open)

  if (!container) return null

  return createPortal(
    <>
      <motion.div
        ref={overlayRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : duration.backdrop }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        style={{ zIndex: zIndex.overlay }}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: zIndex.overlayPanel }}
      >
        <motion.div
          ref={contentRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
          transition={spring.panel}
          className={cn(
            // A dialog whose content grows taller than the viewport needs
            // somewhere to go other than off the top/bottom of the
            // screen — the wrapper centers it, this caps and scrolls it.
            'flex max-h-[calc(100vh-2rem)] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border p-5 outline-none',
            className,
          )}
          style={{
            background: 'var(--surface-overlay)',
            borderColor: 'var(--border-hairline)',
            boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-modal)',
          }}
          data-overlay-scroll
        >
          {children}
        </motion.div>
      </div>
    </>,
    container,
  )
}
