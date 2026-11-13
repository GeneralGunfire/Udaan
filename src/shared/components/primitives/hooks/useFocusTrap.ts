import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null, // excludes display:none / hidden ancestors
  )
}

export interface UseFocusTrapOptions {
  enabled: boolean
  containerRef: React.RefObject<HTMLElement | null>
  /** Focus this element on open instead of the first focusable child.
   *  Maps to Radix's `onOpenAutoFocus` escape hatch: pass a ref to the
   *  container itself (or set `autoFocus: false`) to suppress the
   *  first-focusable-child default, which EventModal relies on today via
   *  `onOpenAutoFocus={(e) => e.preventDefault()}`. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Default true. Set false to skip moving focus on open entirely —
   *  the direct equivalent of Radix's `preventDefault()` escape hatch. */
  autoFocus?: boolean
}

/**
 * Traps Tab/Shift+Tab within `containerRef` while `enabled`, and restores
 * focus to whatever was focused before the trap activated once it
 * deactivates. Used by Dialog (always) and nothing else — Tooltip is
 * explicitly non-trapping (it isn't interactive), and Popover is
 * non-modal per its own spec, so neither composes this hook.
 *
 * The focusable-elements list is recomputed on every Tab keypress rather
 * than cached at mount: dialog content can change while open (an async
 * section finishing its load, a conditional row appearing), and a cached
 * list would let focus escape into elements that no longer exist or miss
 * ones that just appeared.
 */
export function useFocusTrap({
  enabled,
  containerRef,
  initialFocusRef,
  autoFocus = true,
}: UseFocusTrapOptions) {
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    previouslyFocused.current = document.activeElement as HTMLElement | null

    if (autoFocus) {
      // Deferred one frame: the container's content (often itself just
      // mounted this render) needs to have committed to the DOM before
      // anything inside it can receive focus.
      const raf = requestAnimationFrame(() => {
        const target =
          initialFocusRef?.current ??
          (containerRef.current ? getFocusableElements(containerRef.current)[0] : null) ??
          containerRef.current
        target?.focus()
      })
      return () => cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const focusable = getFocusableElements(container)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, containerRef])

  useEffect(() => {
    if (enabled) return
    const toRestore = previouslyFocused.current
    if (!toRestore) return
    // The trigger that opened this layer may itself have unmounted (e.g.
    // a context-menu item that closes the dialog it just opened isn't the
    // pattern here, but a trigger inside another closing overlay is
    // possible) — guard with try/catch rather than assume .focus() is safe.
    try {
      toRestore.focus()
    } catch {
      // Best-effort restoration only.
    }
    previouslyFocused.current = null
  }, [enabled])
}
