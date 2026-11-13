import { useEffect, useRef } from 'react'
import { createLayerId, registerLayer, isTopLayer } from '../layerStack'

export interface UseDismissableLayerOptions {
  /** Whether this layer is currently open/mounted. */
  enabled: boolean
  /** Container ref — clicks inside this (and inside `excludeRefs`) never dismiss. */
  containerRef: React.RefObject<HTMLElement | null>
  /** Additional elements a click on which should NOT dismiss — typically
   *  the trigger, so clicking it toggles rather than closes-then-reopens
   *  (a plain outside-click check would otherwise fire the moment the
   *  trigger's own onClick handler flips `open` back to true). */
  excludeRefs?: Array<React.RefObject<HTMLElement | null>>
  onDismiss: () => void
  closeOnEscape?: boolean
  closeOnOutsideClick?: boolean
}

/**
 * Escape-to-close and click-outside-to-close, unified behind one shared
 * layer stack (see ../layerStack.ts) so nested layers (a submenu open
 * inside a dropdown open inside a dialog) each dismiss independently
 * instead of Escape closing all three because three listeners all fired.
 *
 * Outside-click uses `pointerdown`, not `click`: dismissing on pointerdown
 * means the layer is already gone by the time a `click` on whatever's
 * underneath would fire, matching how native OS dropdowns/context menus
 * behave (click through to what's beneath, not a click that both closes
 * the layer AND is swallowed by it).
 */
export function useDismissableLayer({
  enabled,
  containerRef,
  excludeRefs,
  onDismiss,
  closeOnEscape = true,
  closeOnOutsideClick = true,
}: UseDismissableLayerOptions) {
  const layerId = useRef(createLayerId())
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!enabled) return
    return registerLayer(layerId.current)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    function isExcluded(target: Node): boolean {
      if (containerRef.current?.contains(target)) return true
      return (excludeRefs ?? []).some((ref) => ref.current?.contains(target))
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!closeOnEscape) return
      if (e.key !== 'Escape') return
      if (!isTopLayer(layerId.current)) return
      e.stopPropagation()
      onDismissRef.current()
    }

    function handlePointerDown(e: PointerEvent) {
      if (!closeOnOutsideClick) return
      if (!isTopLayer(layerId.current)) return
      const target = e.target as Node
      if (isExcluded(target)) return
      onDismissRef.current()
    }

    // Capture phase for Escape so the topmost layer's check runs before a
    // parent layer's own (non-stacked) key handling; pointerdown doesn't
    // need capture since outside-click correctness comes from the
    // containerRef/excludeRefs check, not from listener order.
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, closeOnEscape, closeOnOutsideClick, containerRef, excludeRefs])
}
