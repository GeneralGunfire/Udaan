import { useEffect } from 'react'
import { useTypeahead } from './useTypeahead'

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'

function getItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
}

export interface UseRovingFocusOptions {
  enabled: boolean
  containerRef: React.RefObject<HTMLElement | null>
  /** Called when Arrow Right is pressed on an item that owns a submenu —
   *  the item itself reports whether it has one via `data-has-submenu`. */
  onOpenSubmenu?: (item: HTMLElement) => void
  /** Called when Arrow Left is pressed while inside a submenu, to close it
   *  and hand focus back to the parent SubTrigger. Only relevant inside a
   *  SubContent's own useRovingFocus instance. */
  onCloseSubmenu?: () => void
  onSelectItem?: (item: HTMLElement) => void
}

/**
 * Arrow Up/Down navigation with wraparound, Home/End, Enter/Space to
 * activate, and Arrow Right/Left for submenu open/close — composed with
 * typeahead so a plain letter keypress jumps to the next matching item.
 * The focusable-items list is recomputed on every keydown, not cached,
 * since a menu's item set can change while open (a dynamic "recent files"
 * list, a conditionally-rendered separator).
 *
 * This is the single most fiddly piece of keyboard logic in the primitive
 * set: nested wraparound, typeahead, and submenu focus handoff all
 * interact, which is why it's built last, after every other hook it
 * depends on (useDismissableLayer, useFocusTrap's sibling concerns) is
 * already proven working in Dialog/Popover/Tooltip.
 */
export function useRovingFocus({
  enabled,
  containerRef,
  onOpenSubmenu,
  onCloseSubmenu,
  onSelectItem,
}: UseRovingFocusOptions) {
  const { handleTypeaheadKey } = useTypeahead()

  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    function currentIndex(items: HTMLElement[]): number {
      const active = document.activeElement as HTMLElement | null
      return active ? items.indexOf(active) : -1
    }

    function focusIndex(items: HTMLElement[], index: number) {
      items[index]?.focus()
    }

    function handleKeyDown(e: KeyboardEvent) {
      const items = getItems(container!)
      if (items.length === 0) return
      const index = currentIndex(items)

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const next = index < 0 ? 0 : (index + 1) % items.length
          focusIndex(items, next)
          return
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prev = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
          focusIndex(items, prev)
          return
        }
        case 'Home': {
          e.preventDefault()
          focusIndex(items, 0)
          return
        }
        case 'End': {
          e.preventDefault()
          focusIndex(items, items.length - 1)
          return
        }
        case 'ArrowRight': {
          const active = document.activeElement as HTMLElement | null
          if (active?.dataset.hasSubmenu === 'true') {
            e.preventDefault()
            onOpenSubmenu?.(active)
          }
          return
        }
        case 'ArrowLeft': {
          if (onCloseSubmenu) {
            e.preventDefault()
            onCloseSubmenu()
          }
          return
        }
        case 'Enter':
        case ' ': {
          const active = document.activeElement as HTMLElement | null
          if (active && items.includes(active)) {
            e.preventDefault()
            if (active.dataset.hasSubmenu === 'true') {
              onOpenSubmenu?.(active)
            } else {
              onSelectItem?.(active)
            }
          }
          return
        }
        default: {
          const targetIndex = handleTypeaheadKey(e.key, items, index)
          if (targetIndex !== null) {
            e.preventDefault()
            focusIndex(items, targetIndex)
          }
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, containerRef])
}
