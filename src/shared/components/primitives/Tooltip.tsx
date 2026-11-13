import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { Placement } from '@floating-ui/dom'
import { cn } from '@/shared/lib/cn'
import { duration, zIndex, prefersReducedMotion } from '@/shared/lib/motion'
import { usePortalContainer } from './hooks/usePortal'
import { useFloatingPosition } from './hooks/useFloatingPosition'
import { shouldSkipDelay, recordTooltipClosed } from './hooks/useDelayGroup'

/**
 * Hand-built replacement for the Radix-backed Tooltip. Not trapping (a
 * tooltip is non-interactive, so it never owns focus) and not part of the
 * dismissable-layer stack — it opens on hover/focus and closes on
 * unhover/blur/Escape/scroll, which is a different lifecycle from a
 * dialog/menu's "stays open until explicitly dismissed."
 *
 * Delay-group behavior (see hooks/useDelayGroup.ts): if another tooltip
 * anywhere just closed, a newly-hovered one skips its own open-delay —
 * this is what makes sweeping across a toolbar's icon buttons feel like
 * one continuous tooltip rather than each one pausing to reconsider.
 */

const TooltipContext = createContext<{ delayDuration: number }>({ delayDuration: 400 })

export function TooltipProvider({
  delayDuration = 400,
  children,
}: {
  delayDuration?: number
  children: ReactNode
}) {
  return (
    <TooltipContext.Provider value={{ delayDuration }}>{children}</TooltipContext.Provider>
  )
}

const SIDE_TO_PLACEMENT: Record<string, Placement> = {
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  const { delayDuration } = useContext(TooltipContext)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number | null>(null)
  const container = usePortalContainer()
  const reduced = prefersReducedMotion()

  const position = useFloatingPosition(triggerRef.current, contentRef, {
    enabled: open,
    placement: SIDE_TO_PLACEMENT[side],
    sideOffset: 6,
  })

  function clearOpenTimer() {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }

  function scheduleOpen() {
    clearOpenTimer()
    if (shouldSkipDelay()) {
      setOpen(true)
      return
    }
    openTimer.current = window.setTimeout(() => setOpen(true), delayDuration)
  }

  function close() {
    clearOpenTimer()
    if (open) recordTooltipClosed()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    // A tooltip anchored to a control the user then scrolls away from
    // should disappear rather than drift, since it no longer points at
    // anything meaningful once its trigger has moved off-screen.
    function handleScroll() {
      close()
    }
    window.addEventListener('scroll', handleScroll, true)
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => clearOpenTimer, [])

  if (!isValidElement(children)) return <>{children}</>

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      // The wrapped child's own ref can be either a callback ref OR a
      // ref object (from useRef) — e.g. Popover.tsx's PopoverTrigger
      // clones its child with `ref: anchorRef`, an object, not a
      // function. This used to only forward callback refs, so wrapping
      // a PopoverTrigger in a Tooltip (as ChatHistoryPopup does) silently
      // dropped the popover's own anchorRef assignment: anchorRef.current
      // stayed null, so useFloatingPosition had nothing to position
      // against and the popover rendered hidden (visibility: 'hidden')
      // or mispositioned — intermittent since it depended on render
      // timing/StrictMode remounts which of the two clone layers'
      // ref callback ran last. Both ref shapes now get the node.
      const originalRef = (children as ReactElement & { ref?: unknown }).ref
      if (typeof originalRef === 'function') {
        originalRef(node)
      } else if (originalRef && typeof originalRef === 'object' && 'current' in originalRef) {
        ;(originalRef as React.RefObject<HTMLElement | null>).current = node
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      scheduleOpen()
      ;(children.props as { onMouseEnter?: (e: React.MouseEvent) => void }).onMouseEnter?.(e)
    },
    onMouseLeave: (e: React.MouseEvent) => {
      close()
      ;(children.props as { onMouseLeave?: (e: React.MouseEvent) => void }).onMouseLeave?.(e)
    },
    onFocus: (e: React.FocusEvent) => {
      // Keyboard focus shows the tooltip immediately — a keyboard user
      // tabbing through controls shouldn't wait out a hover-tuned delay
      // to learn what an icon-only button does.
      setOpen(true)
      ;(children.props as { onFocus?: (e: React.FocusEvent) => void }).onFocus?.(e)
    },
    onBlur: (e: React.FocusEvent) => {
      close()
      ;(children.props as { onBlur?: (e: React.FocusEvent) => void }).onBlur?.(e)
    },
  })

  return (
    <>
      {trigger}
      {container &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={contentRef}
                role="tooltip"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                transition={{ duration: duration.instant }}
                className={cn(
                  'pointer-events-none text-text-primary rounded-md border px-2 py-1 text-2xs font-medium',
                )}
                style={{
                  position: position?.strategy ?? 'fixed',
                  top: position?.y ?? -9999,
                  left: position?.x ?? -9999,
                  background: 'var(--surface-overlay)',
                  borderColor: 'var(--border-hairline)',
                  boxShadow: 'var(--shadow-overlay)',
                  zIndex: zIndex.tooltip,
                }}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          container,
        )}
    </>
  )
}
