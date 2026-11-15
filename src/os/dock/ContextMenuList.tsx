import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import type { FlyoutMenuItem } from './taskbarPopupTypes'

/**
 * A context menu's items, inside the shared taskbar-popup window.
 *
 * Plain data in, plain `id` out — this window is a separate webview from
 * whichever surface (dock, launcher, menu bar) opened the menu, so it
 * cannot hold the real onSelect closures; the opener matches the returned
 * id back to its own handler.
 *
 * WHAT A REAL CONTEXT MENU DOES THAT A STYLED LIST DOES NOT
 * ---------------------------------------------------------
 *  1. KEYBOARD. Arrow keys move, Home/End jump, Enter selects, and typing a
 *     letter jumps to the next item starting with it. A menu you cannot
 *     drive from the keyboard is a list of buttons wearing a menu's clothes.
 *  2. ONE HIGHLIGHT. Pointer and keyboard share a single active item, so
 *     moving the mouse after arrowing does not leave two things lit.
 *  3. ITEMS ARRIVE IN ORDER. A very short stagger down the list reads as
 *     the menu unrolling. It is capped, so a long menu still lands quickly.
 */
export function ContextMenuList({ items, onSelect }: { items: FlyoutMenuItem[]; onSelect: (id: string) => void }) {
  const [active, setActive] = useState<number>(-1)
  const typed = useRef({ text: '', at: 0 })

  // Indices that can actually be focused — separators and disabled items
  // are skipped by every form of navigation.
  const selectable = items.flatMap((it, i) => (it.label !== undefined && !it.disabled ? [i] : []))

  useEffect(() => {
    const step = (delta: number) => {
      if (!selectable.length) return
      const at = selectable.indexOf(active)
      // From nothing, Down goes to the first item and Up to the last.
      const next = at === -1 ? (delta > 0 ? 0 : selectable.length - 1) : (at + delta + selectable.length) % selectable.length
      setActive(selectable[next])
    }

    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          return step(1)
        case 'ArrowUp':
          e.preventDefault()
          return step(-1)
        case 'Home':
          e.preventDefault()
          return setActive(selectable[0] ?? -1)
        case 'End':
          e.preventDefault()
          return setActive(selectable.at(-1) ?? -1)
        case 'Enter':
        case ' ': {
          const it = items[active]
          if (!it?.id) return
          e.preventDefault()
          return onSelect(it.id)
        }
        default: {
          // Typeahead: letters typed within a second accumulate, so "do"
          // reaches "Downloads" rather than cycling D-items.
          if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return
          const now = Date.now()
          typed.current = { text: now - typed.current.at > 1000 ? e.key : typed.current.text + e.key, at: now }
          const q = typed.current.text.toLowerCase()
          const hit = selectable.find((i) => items[i].label?.toLowerCase().startsWith(q))
          if (hit !== undefined) setActive(hit)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, items, onSelect, selectable])

  return (
    <div className="flex flex-col text-[12.5px]" role="menu">
      {items.map((it, i) =>
        it.label === undefined ? (
          <div key={i} className="mx-2.5 my-1 h-px bg-white/10" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onPointerEnter={() => !it.disabled && setActive(i)}
            onClick={() => it.id && onSelect(it.id)}
            className={cn(
              'relative flex h-7 w-full cursor-default select-none items-center rounded-[6px] px-2.5 text-left font-normal outline-none transition-colors duration-75',
              active === i && 'bg-white/10',
              it.danger && 'text-(--color-danger)',
              it.disabled && 'pointer-events-none opacity-40',
            )}
          >
            <span className="flex-1 truncate">{it.label}</span>
          </button>
        ),
      )}
    </div>
  )
}
