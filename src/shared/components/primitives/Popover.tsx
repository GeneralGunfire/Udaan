import { cloneElement, createContext, isValidElement, useContext, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import type { Placement } from '@floating-ui/dom'
import { cn } from '@/shared/lib/cn'
import { spring, zIndex, prefersReducedMotion } from '@/shared/lib/motion'
import { usePortalContainer } from './hooks/usePortal'
import { useDismissableLayer } from './hooks/useDismissableLayer'
import { useFloatingPosition } from './hooks/useFloatingPosition'

/**
 * Hand-built replacement for the Radix-backed Popover. Like Dialog, no
 * trap here — a popover is non-modal, so the rest of the page stays
 * interactive while it's open; it only needs dismiss-on-escape/outside
 * and positioning (@floating-ui/dom, same as DropdownMenu/Tooltip).
 *
 * PopoverTrigger toggles `open` itself on click, same as
 * DropdownMenuTrigger — a real, working bug: it used to only attach the
 * anchor ref (positioning) and leave the actual click-to-open wiring to
 * the caller, on the theory that WorkspaceSettingsPanel's own
 * PopoverAnchor + hand-rolled onClick was "the proven path" and
 * PopoverTrigger only existed for API-shape parity with Dialog. A later
 * consumer (ChatHistoryPopup) reasonably used PopoverTrigger exactly as
 * its name implies — a thing you click to open the popover — and got a
 * button with correct hover/press states that did precisely nothing on
 * click, since nothing anywhere called setOpen. PopoverAnchor stays
 * anchor-only (no implicit click behavior) for WorkspaceSettingsPanel's
 * case, where the caller's own toggle logic is more than a plain
 * open/close (it also has to route through onUdaanTaskbarOnChange
 * elsewhere) — but "Trigger" now actually triggers.
 */

interface PopoverContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const PopoverContext = createContext<PopoverContextValue | null>(null)

function usePopoverContext(): PopoverContextValue {
  const ctx = useContext(PopoverContext)
  if (!ctx) throw new Error('Popover components must be used within <Popover>')
  return ctx
}

export function Popover({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const anchorRef = useRef<HTMLElement | null>(null)
  return (
    <PopoverContext.Provider value={{ open, onOpenChange, anchorRef }}>
      {children}
    </PopoverContext.Provider>
  )
}

function attachAnchorRef(
  child: ReactNode,
  anchorRef: React.RefObject<HTMLElement | null>,
): ReactNode {
  // Cloning the child and attaching the ref directly, rather than
  // wrapping it in a `<span style="display:contents">`. That wrapper
  // has zero box geometry (useless for the getBoundingClientRect the
  // positioning hook needs) and — the real bug — WebView2 has a known
  // class of issue where `display: contents` on an intermediate element
  // can silently swallow pointer events before they reach its children,
  // which presented here as "the button does nothing at all, not even
  // a hover state." Cloning puts the ref on the real interactive
  // element with no wrapper in the DOM at all.
  if (isValidElement<{ ref?: React.Ref<HTMLElement> }>(child)) {
    return cloneElement(child, { ref: anchorRef as React.Ref<HTMLElement> })
  }
  return child
}

// `asChild` is accepted (not destructured — it's a Radix-API-compat prop
// with no behavioral difference here, since attachAnchorRef always wraps
// rather than clones) so call sites passing it don't need to change.
export function PopoverAnchor({ children }: { asChild?: boolean; children: ReactNode }) {
  const { anchorRef } = usePopoverContext()
  return attachAnchorRef(children, anchorRef)
}

export function PopoverTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
  const { anchorRef, open, onOpenChange } = usePopoverContext()
  const withRef = attachAnchorRef(children, anchorRef)
  if (!isValidElement<{ onClick?: (e: React.MouseEvent) => void }>(withRef)) return withRef
  return cloneElement(withRef, {
    onClick: (e: React.MouseEvent) => {
      // Matches DropdownMenuTrigger's own onClick: stop propagation so
      // this click doesn't also register as a bubbling document-level
      // event another open layer's outside-click check could react to
      // on the very same click that's opening this one.
      e.stopPropagation()
      withRef.props.onClick?.(e)
      onOpenChange(!open)
    },
  })
}

const SIDE_ALIGN_TO_PLACEMENT: Record<string, Placement> = {
  'bottom-center': 'bottom',
  'bottom-start': 'bottom-start',
  'bottom-end': 'bottom-end',
  'top-center': 'top',
  'top-start': 'top-start',
  'top-end': 'top-end',
  'left-center': 'left',
  'left-start': 'left-start',
  'left-end': 'left-end',
  'right-center': 'right',
  'right-start': 'right-start',
  'right-end': 'right-end',
}

export interface PopoverContentProps {
  className?: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Radix compat no-op: the hand-built version already only renders
   *  DialogContent-style overlay children while `open`, controlled at the
   *  call site's own <AnimatePresence>, so there's no separate "force
   *  mount before open" state to opt into. */
  forceMount?: boolean
}

export function PopoverContent({
  className,
  children,
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
}: PopoverContentProps) {
  const { open, onOpenChange, anchorRef } = usePopoverContext()
  const container = usePortalContainer()
  const contentRef = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()

  const placement = SIDE_ALIGN_TO_PLACEMENT[`${side}-${align}`] ?? 'bottom'
  const position = useFloatingPosition(anchorRef.current, contentRef, {
    enabled: open,
    placement,
    sideOffset,
  })

  useDismissableLayer({
    enabled: open,
    containerRef: contentRef,
    excludeRefs: [anchorRef],
    onDismiss: () => onOpenChange(false),
  })

  if (!container) return null

  return createPortal(
    <motion.div
      ref={contentRef}
      role="dialog"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
      transition={spring.standard}
      data-overlay-scroll
      className={cn('rounded-xl border outline-none', className)}
      style={{
        position: position?.strategy ?? 'fixed',
        top: position?.y ?? -9999,
        left: position?.x ?? -9999,
        background: 'var(--surface-overlay)',
        borderColor: 'var(--border-hairline)',
        boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-overlay)',
        zIndex: zIndex.overlayPanel,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </motion.div>,
    container,
  )
}
