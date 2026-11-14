import { useEffect, useRef, useState } from 'react'
import type { FlyoutMenuItem } from './taskbarPopupTypes'

/**
 * A context menu's items, inside the shared popup window.
 *
 * Plain data in, plain `id` out: this window is a separate webview from the
 * surface (dock, launcher, menu bar) that opened the menu, so it cannot hold
 * the real onSelect closures; the opener matches the id back to its handler.
 *
 * Keyboard: arrows move, Home/End jump, Enter/Space select, typing jumps to
 * the next item starting with those letters. Pointer and keyboard share one
 * highlighted row.
 */
export function ContextMenuList({ items, onSelect }: { items: FlyoutMenuItem[]; onSelect: (id: string) => void }) {
  const [active, setActive] = useState<number>(-1)
  const typed = useRef({ text: '', at: 0 })

  const selectable = items.flatMap((it, i) => (it.label !== undefined && !it.disabled ? [i] : []))

  useEffect(() => {
    const step = (delta: number) => {
      if (!selectable.length) return
      const at = selectable.indexOf(active)
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
    <div className="flex flex-col gap-px" role="menu">
      {items.map((it, i) =>
        it.label === undefined ? (
          <hr key={i} className="u-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            data-active={active === i}
            onPointerEnter={() => !it.disabled && setActive(i)}
            onClick={() => it.id && onSelect(it.id)}
            className="u-row h-8 min-h-0 px-3"
            style={it.danger ? { color: 'var(--u-danger)' } : undefined}
          >
            <span className="flex-1 truncate">{it.label}</span>
          </button>
        ),
      )}
    </div>
  )
}
