import { useEffect, useRef, useState } from 'react'
import {
  computePosition,
  autoUpdate,
  flip,
  shift,
  offset as offsetMiddleware,
  size,
  type Placement,
  type VirtualElement,
} from '@floating-ui/dom'

export type FloatingReference = HTMLElement | VirtualElement | null

export interface UseFloatingPositionOptions {
  enabled: boolean
  placement?: Placement
  /** Gap between the reference and the floating element, in px. */
  sideOffset?: number
  /** Minimum distance to keep from the viewport edge. */
  viewportPadding?: number
  /** Cap the floating element's height to the available space instead of
   *  letting it overflow the viewport — used by scrollable menus/lists. */
  constrainHeight?: boolean
}

export interface FloatingPosition {
  x: number
  y: number
  strategy: 'absolute' | 'fixed'
  placement: Placement
  maxHeight?: number
}

/**
 * Thin wrapper around @floating-ui/dom for the four positioned primitives
 * (DropdownMenu, Popover, Tooltip — Dialog is viewport-centered and
 * doesn't need this). This is a geometry library, not a behavior/component
 * library: it computes flip/shift/collision math, nothing about a
 * primitive's API, state machine, or accessibility semantics, so adopting
 * it doesn't reintroduce what hand-building these primitives is removing
 * (Radix's component layer). Hand-rolling this specific slice would mean
 * re-deriving flip-when-no-room, shift-while-preferring-the-original-side,
 * and scroll-container-aware collision detection — solved problems with
 * far more edge-case coverage upstream than a first attempt here would get.
 *
 * `reference` accepts a real element OR a floating-ui VirtualElement
 * (`{ getBoundingClientRect: () => DOMRect }`), which is what
 * FileContextMenu's anchor-to-click-point pattern needs — a context menu
 * has no real trigger element, only a coordinate.
 */
export function useFloatingPosition(
  reference: FloatingReference,
  floatingRef: React.RefObject<HTMLElement | null>,
  {
    enabled,
    placement = 'bottom-start',
    sideOffset = 6,
    viewportPadding = 8,
    constrainHeight = false,
  }: UseFloatingPositionOptions,
) {
  const [position, setPosition] = useState<FloatingPosition | null>(null)
  const referenceRef = useRef(reference)
  referenceRef.current = reference

  useEffect(() => {
    if (!enabled) {
      setPosition(null)
      return
    }
    const floating = floatingRef.current
    const ref = referenceRef.current
    if (!floating || !ref) return

    async function update() {
      const floatingEl = floatingRef.current
      const refEl = referenceRef.current
      if (!floatingEl || !refEl) return

      const middleware = [
        offsetMiddleware(sideOffset),
        flip({ padding: viewportPadding }),
        shift({ padding: viewportPadding }),
      ]
      if (constrainHeight) {
        middleware.push(
          size({
            padding: viewportPadding,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(availableHeight, 80)}px`
            },
          }),
        )
      }

      const result = await computePosition(refEl, floatingEl, {
        placement,
        strategy: 'fixed',
        middleware,
      })
      setPosition({
        x: result.x,
        y: result.y,
        strategy: result.strategy,
        placement: result.placement,
      })
    }

    // autoUpdate re-runs on scroll/resize/reference-mutation so the
    // floating element tracks its anchor without a component needing to
    // manually re-trigger positioning on every layout-affecting event.
    return autoUpdate(ref, floating, update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, placement, sideOffset, viewportPadding, constrainHeight, floatingRef])

  return position
}

/** Builds a floating-ui VirtualElement anchored to a fixed point — for
 *  FileContextMenu's "open at the click coordinate" pattern, which has no
 *  real DOM trigger to anchor to. */
export function pointVirtualElement(x: number, y: number): VirtualElement {
  return {
    getBoundingClientRect: () => ({
      x,
      y,
      width: 0,
      height: 0,
      top: y,
      left: x,
      right: x,
      bottom: y,
    }),
  }
}
