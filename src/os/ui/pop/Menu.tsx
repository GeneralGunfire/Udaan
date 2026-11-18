import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PopIcon, type PopIconName } from './icons'
import { Surface } from './Surface'

/**
 * The right-click / dropdown menu. A flat list of entries: items (with an icon, a shortcut, a check, a
 * destructive style, or a submenu), hairline separators and small section labels.
 *
 * Sub-menus open to the side OUTSIDE the card (the card clips its own glass), flip to the left when there is no
 * room, and open on hover; arrow keys, Enter and Escape work like a native menu.
 */
export type MenuEntry =
  | { type: 'sep' }
  | { type: 'label'; text: string }
  | { type?: 'item'; label: string; icon?: PopIconName; shortcut?: string; danger?: boolean; checked?: boolean; disabled?: boolean; items?: MenuEntry[]; onSelect?: () => void }

const ROW = 30

export function Menu({ items, onClose, width = 236, depth = 0, autoFocus = true, side = 'auto' }: { items: MenuEntry[]; onClose?: () => void; width?: number; depth?: number; autoFocus?: boolean; /** Which way sub-menus open. 'auto' looks at the window; a popup window passes it explicitly. */ side?: 'auto' | 'right' | 'left' }) {
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [autoFlip, setFlip] = useState(false)
  const flip = side === 'auto' ? autoFlip : side === 'left'
  const hasLead = items.some((e) => (e.type === undefined || e.type === 'item') && (e.icon || e.checked !== undefined))

  useEffect(() => {
    if (autoFocus && depth === 0) root.current?.focus()
  }, [autoFocus, depth])

  // A sub-menu goes to the left of its parent when the right side of the screen is too tight.
  useLayoutEffect(() => {
    if (open === null || side !== 'auto') return
    const r = root.current?.getBoundingClientRect()
    if (r) setFlip(r.right + width + 8 > window.innerWidth)
  }, [open, width])

  const move = (e: KeyboardEvent, dir: 1 | -1) => {
    e.preventDefault()
    const list = root.current?.querySelector(':scope > .pop-surface > div')
    const btns = [...(list?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') ?? [])]
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    btns[(i + dir + btns.length) % btns.length]?.focus()
  }

  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') move(e, 1)
    else if (e.key === 'ArrowUp') move(e, -1)
    else if (e.key === 'Escape') {
      e.stopPropagation()
      if (open !== null) setOpen(null)
      else onClose?.()
    } else if (e.key === 'ArrowRight' && open === null) {
      const i = Number((document.activeElement as HTMLElement | null)?.dataset.index)
      const it = items[i]
      if (it && (it.type === undefined || it.type === 'item') && it.items) setOpen(i)
    } else if (e.key === 'ArrowLeft' && depth > 0) onClose?.()
  }

  return (
    <div ref={root} tabIndex={-1} onKeyDown={key} className="relative outline-none" style={{ width }} role="menu">
      <Surface radius={14} className="pop-in p-1.5" style={{ width }}>
        <div className="flex flex-col">
          {items.map((e, i) => {
            if (e.type === 'sep') return <div key={i} className="pop-sep" role="separator" />
            if (e.type === 'label') return <div key={i} className="pop-label px-2.5 pb-1 pt-2">{e.text}</div>
            const sub = !!e.items
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                data-index={i}
                disabled={e.disabled}
                data-danger={e.danger || undefined}
                data-open={open === i || undefined}
                className="pop-menu-item"
                style={{ height: ROW }}
                onMouseEnter={(ev) => {
                  ev.currentTarget.focus()
                  setOpen(sub && !e.disabled ? i : null)
                }}
                onClick={() => {
                  if (sub) return setOpen(i)
                  e.onSelect?.()
                  onClose?.()
                }}
              >
                {hasLead && (
                  <span className="flex w-[18px] shrink-0 items-center justify-center">
                    {e.checked ? <PopIcon name="check" size={15} strokeWidth={2.2} /> : e.icon ? <PopIcon name={e.icon} size={16} /> : null}
                  </span>
                )}
                <span className="truncate">{e.label}</span>
                {e.shortcut && <span className="pop-kbd">{e.shortcut}</span>}
                {sub && <PopIcon name="chevron" size={14} className="ml-auto opacity-70" />}
              </button>
            )
          })}
        </div>
      </Surface>
      {open !== null && (() => {
        const e = items[open]
        if (!e || (e.type !== undefined && e.type !== 'item') || !e.items) return null
        const top = 6 + items.slice(0, open).reduce((h, it) => h + (it.type === 'sep' ? 9 : it.type === 'label' ? 31 : ROW), 0) - 6
        return (
          <div className="absolute z-10" style={{ top, ...(flip ? { right: width - 6 } : { left: width - 6 }) }}>
            <Menu items={e.items} width={width} depth={depth + 1} side={side} onClose={() => (setOpen(null), root.current?.focus())} autoFocus={false} />
          </div>
        )
      })()}
    </div>
  )
}

/**
 * Opens a Menu at the pointer: `const { open, node } = usePopMenu()`, call `open(event, items)` from onContextMenu
 * and render `node` once. It closes on any outside press, scroll, resize or Escape, and stays on screen.
 */
export function usePopMenu(): { open: (e: MouseEvent | { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuEntry[], width?: number) => void; close: () => void; node: ReactNode } {
  const [state, setState] = useState<{ x: number; y: number; items: MenuEntry[]; width: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const close = useCallback(() => setState(null), [])
  const open = useCallback<ReturnType<typeof usePopMenu>['open']>((e, items, width = 236) => {
    e.preventDefault?.()
    setPos(null)
    setState({ x: e.clientX, y: e.clientY, items, width })
  }, [])

  // Keep the whole menu on screen: measured after it renders, then moved.
  useLayoutEffect(() => {
    if (!state || !box.current) return
    const r = box.current.getBoundingClientRect()
    setPos({ x: Math.max(8, Math.min(state.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(state.y, window.innerHeight - r.height - 8)) })
  }, [state])

  useEffect(() => {
    if (!state) return
    const out = (ev: PointerEvent) => {
      if (!box.current?.contains(ev.target as Node)) close()
    }
    const esc = (ev: globalThis.KeyboardEvent) => ev.key === 'Escape' && close()
    window.addEventListener('pointerdown', out, true)
    window.addEventListener('keydown', esc)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', out, true)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [state, close])

  const node = state
    ? createPortal(
        <div ref={box} className="fixed z-[9999]" style={{ left: pos?.x ?? state.x, top: pos?.y ?? state.y, visibility: pos ? 'visible' : 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
          <Menu items={state.items} width={state.width} onClose={close} />
        </div>,
        document.body,
      )
    : null
  return { open, close, node }
}
