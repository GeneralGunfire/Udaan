import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import type { Placement } from '@floating-ui/dom'
import { cn } from '@/shared/lib/cn'
import { spring, zIndex } from '@/shared/lib/motion'
import { usePortalContainer } from './hooks/usePortal'
import { useDismissableLayer } from './hooks/useDismissableLayer'
import { useFloatingPosition } from './hooks/useFloatingPosition'
import { useRovingFocus } from './hooks/useRovingFocus'

/**
 * Hand-built replacement for the Radix-backed DropdownMenu. Highest-
 * complexity of the four rebuilt primitives (roving focus, typeahead,
 * nested submenus, and — via FileContextMenu — anchoring to an arbitrary
 * DOM point rather than a semantic trigger), so it's built last, on top
 * of every other already-proven hook.
 *
 * Supports both controlled (`open`/`onOpenChange` passed) and
 * uncontrolled (neither passed — DjEffectsPanel's preset menu) usage,
 * since both exist among current consumers.
 */

interface DropdownMenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLElement | null>
  /** Present only for a Sub's own context — lets a SubTrigger register
   *  itself so ArrowLeft inside the SubContent can return focus to it. */
  isSubmenu: boolean
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenuContext(): DropdownMenuContextValue {
  const ctx = useContext(DropdownMenuContext)
  if (!ctx) throw new Error('DropdownMenu components must be used within <DropdownMenu>')
  return ctx
}

export function DropdownMenu({
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const triggerRef = useRef<HTMLElement | null>(null)

  function setOpen(next: boolean) {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, isSubmenu: false }}>
      {children}
    </DropdownMenuContext.Provider>
  )
}

/**
 * Ref and click handler are cloned directly onto the child rather than
 * attached to a wrapping `<span style="display:contents">` — that
 * wrapper is a real bug, not just an extra DOM node: WebView2 has a
 * known issue class where `display: contents` on an intermediate
 * element can silently swallow pointer events before they reach its
 * children, which presents as a trigger that does nothing at all, not
 * even a hover state. Every consumer here passes a single element
 * child, so cloning is always safe.
 */
export function DropdownMenuTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
  const { triggerRef, open, setOpen } = useDropdownMenuContext()
  if (!isValidElement<{ ref?: React.Ref<HTMLElement>; onClick?: (e: React.MouseEvent) => void }>(children)) {
    return children
  }
  return cloneElement(children, {
    ref: triggerRef as React.Ref<HTMLElement>,
    onClick: (e: React.MouseEvent) => {
      // A real click toggles rather than only opens, so clicking an
      // already-open trigger closes the menu instead of it staying
      // stuck open (useDismissableLayer's own outside-click check
      // already excludes the trigger, so without this the only way to
      // close from the trigger would be Escape or clicking elsewhere).
      e.stopPropagation()
      children.props.onClick?.(e)
      setOpen(!open)
    },
  })
}

function sideAlignToPlacement(side: 'top' | 'bottom', align: 'start' | 'center' | 'end'): Placement {
  if (align === 'center') return side
  return `${side}-${align}` as Placement
}

export interface DropdownMenuContentProps {
  className?: string
  children: ReactNode
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

export function DropdownMenuContent({
  className,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 8,
}: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext()
  const container = usePortalContainer()
  const contentRef = useRef<HTMLDivElement>(null)

  const position = useFloatingPosition(triggerRef.current, contentRef, {
    enabled: open,
    placement: sideAlignToPlacement(side, align),
    sideOffset,
    constrainHeight: true,
  })

  useDismissableLayer({
    enabled: open,
    containerRef: contentRef,
    excludeRefs: [triggerRef],
    onDismiss: () => setOpen(false),
  })

  useRovingFocus({
    enabled: open,
    containerRef: contentRef,
    onSelectItem: (item) => item.click(),
  })

  // Move focus to the first item once the menu opens, matching native
  // menu behavior (opening a menu with the keyboard lands you on an item
  // immediately, not on nothing).
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const first = contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
      first?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  if (!container) return null

  return createPortal(
    <motion.div
      ref={contentRef}
      role="menu"
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={spring.standard}
      data-overlay-scroll
      className={cn(
        'flex max-h-72 w-64 flex-col overflow-y-auto rounded-xl border p-1 outline-none',
        className,
      )}
      style={{
        position: position?.strategy ?? 'fixed',
        top: position?.y ?? -9999,
        left: position?.x ?? -9999,
        background: 'var(--surface-overlay)',
        borderColor: 'var(--border-hairline)',
        boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-overlay)',
        zIndex: zIndex.dropdown,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </motion.div>,
    container,
  )
}

export interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  onSelect?: () => void
  disabled?: boolean
}

export function DropdownMenuItem({
  className,
  onSelect,
  disabled,
  onClick,
  ...props
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdownMenuContext()
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        if (disabled) return
        onClick?.(e)
        onSelect?.()
        setOpen(false)
      }}
      className={cn(
        'text-text-secondary hover:text-text-primary focus:bg-(--surface-raised) focus:text-text-primary flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Nested submenu. Its own DropdownMenuContext (isSubmenu: true) tracks
 * open state; the parent's roving-focus instance calls onOpenSubmenu when
 * ArrowRight is pressed on this SubTrigger, and this SubContent's own
 * useRovingFocus reports onCloseSubmenu on ArrowLeft to close and hand
 * focus back.
 */
export function DropdownMenuSub({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, isSubmenu: true }}>
      {children}
    </DropdownMenuContext.Provider>
  )
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext()

  return (
    <div
      ref={triggerRef as React.RefObject<HTMLDivElement>}
      role="menuitem"
      tabIndex={-1}
      data-has-submenu="true"
      aria-haspopup="menu"
      aria-expanded={open}
      onMouseEnter={() => setOpen(true)}
      onClick={() => setOpen(true)}
      className={cn(
        'text-text-secondary hover:text-text-primary focus:bg-(--surface-raised) focus:text-text-primary flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100',
        open && 'bg-(--surface-raised) text-text-primary',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function DropdownMenuSubContent({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext()
  const container = usePortalContainer()
  const contentRef = useRef<HTMLDivElement>(null)

  const position = useFloatingPosition(triggerRef.current, contentRef, {
    enabled: open,
    placement: 'right-start',
    sideOffset: 2,
    constrainHeight: true,
  })

  useDismissableLayer({
    enabled: open,
    containerRef: contentRef,
    excludeRefs: [triggerRef],
    onDismiss: () => setOpen(false),
  })

  useRovingFocus({
    enabled: open,
    containerRef: contentRef,
    onCloseSubmenu: () => {
      setOpen(false)
      triggerRef.current?.focus()
    },
    onSelectItem: (item) => item.click(),
  })

  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const first = contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
      first?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  if (!open || !container) return null

  return createPortal(
    <motion.div
      ref={contentRef}
      role="menu"
      initial={{ opacity: 0, x: -4, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -4, scale: 0.97 }}
      transition={spring.standard}
      data-overlay-scroll
      className={cn(
        'flex max-h-72 w-56 flex-col overflow-y-auto rounded-xl border p-1 outline-none',
        className,
      )}
      style={{
        position: position?.strategy ?? 'fixed',
        top: position?.y ?? -9999,
        left: position?.x ?? -9999,
        background: 'var(--surface-overlay)',
        borderColor: 'var(--border-hairline)',
        boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-overlay)',
        zIndex: zIndex.dropdown,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </motion.div>,
    container,
  )
}
