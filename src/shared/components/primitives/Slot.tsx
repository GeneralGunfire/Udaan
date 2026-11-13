import { cloneElement, forwardRef, isValidElement, type HTMLAttributes, type ReactElement } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * Minimal hand-built replacement for @radix-ui/react-slot's `Slot`. Merges
 * this component's props/className/style/ref onto its single child
 * instead of rendering a wrapper element — used by Button's `asChild` so
 * e.g. `<Button asChild><a href="...">Link</a></Button>` renders one `<a>`
 * carrying Button's styling, not a `<button><a>...</a></button>`.
 *
 * Only handles what Button's asChild path actually needs (single element
 * child, merge className/style, forward ref, spread the rest of the
 * props) — Radix's version supports a much broader Slottable/multi-slot
 * API surface this app never exercises.
 */
export const Slot = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & { children?: React.ReactNode }>(
  ({ children, className, style, ...props }, ref) => {
    if (!isValidElement(children)) return null
    const child = children as ReactElement<{ className?: string; style?: React.CSSProperties }>
    return cloneElement(child, {
      ...props,
      ref,
      className: cn(className, child.props.className),
      style: { ...style, ...child.props.style },
    } as Partial<unknown>)
  },
)
Slot.displayName = 'Slot'
