import { cn } from '@/shared/lib/cn'
import type { FlyoutMenuItem } from './taskbarPopupTypes'

/**
 * Renders a context menu's item list inside the shared taskbar-popup
 * window, styled to match the Radix menus used elsewhere (Start, desktop).
 * Plain data in, plain `id` out — this window is a separate webview from
 * whichever surface (dock, launcher, menu bar) opened the menu, so it can't
 * hold the real onSelect closures; the opener matches the returned id back
 * to its own handler.
 */
export function ContextMenuList({ items, onSelect }: { items: FlyoutMenuItem[]; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-px text-[13px]">
      {items.map((it, i) =>
        it.label === undefined ? (
          <div key={i} className="mx-2 my-1 h-px bg-[var(--os-menu-separator)]" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => it.id && onSelect(it.id)}
            className={cn(
              'relative flex h-8 w-full cursor-default select-none items-center rounded-[var(--os-radius-control)] px-3 text-left outline-none hover:bg-[var(--os-menu-item-hover)] focus:bg-[var(--os-menu-item-hover)]',
              it.danger && 'text-[var(--color-danger)]',
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
