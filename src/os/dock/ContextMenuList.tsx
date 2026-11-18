import { Menu, type MenuEntry } from '@/os/ui/pop/Menu'
import type { PopIconName } from '@/os/ui/pop/icons'
import type { FlyoutMenuItem } from './taskbarPopupTypes'

/**
 * A context menu's items, inside the shared popup window: the pop-kit menu (icons, shortcuts, checks, sub-menus,
 * arrow-key navigation). This window is a separate webview from whoever opened the menu, so it holds data, not
 * closures: picking an item reports its `id` and the opener runs its own handler.
 */
function toEntries(items: FlyoutMenuItem[], onSelect: (id: string) => void): MenuEntry[] {
  return items.map((it): MenuEntry => {
    if (it.header) return { type: 'label', text: it.label ?? '' }
    if (it.label === undefined) return { type: 'sep' }
    return {
      label: it.label,
      icon: it.icon as PopIconName | undefined,
      shortcut: it.shortcut,
      danger: it.danger,
      disabled: it.disabled,
      checked: it.checked,
      items: it.items ? toEntries(it.items, onSelect) : undefined,
      onSelect: () => it.id !== undefined && onSelect(it.id),
    }
  })
}

export function ContextMenuList({ items, onSelect, onClose, side = 'right' }: { items: FlyoutMenuItem[]; onSelect: (id: string) => void; onClose: () => void; side?: 'right' | 'left' }) {
  return <Menu items={toEntries(items, onSelect)} onClose={onClose} side={side} />
}
