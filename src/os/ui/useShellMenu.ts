import { useCallback, useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { showPopup } from '@/os/dock/showPopup'
import type { FlyoutMenuItem } from '@/os/dock/taskbarPopupTypes'
import type { PopIconName } from '@/os/ui/pop/icons'

export interface ShellMenuItemDef {
  /** Omit (and leave `header` unset) to render a separator instead of an item. */
  label?: string
  /** A small section title rather than an item. */
  header?: boolean
  danger?: boolean
  disabled?: boolean
  icon?: PopIconName
  shortcut?: string
  checked?: boolean
  /** A sub-menu: the entries open to the side. */
  items?: ShellMenuItemDef[]
  onSelect?: () => void
}

/**
 * Opens a context menu at an exact screen point through the shared popup window (see FlyoutWindow.tsx): the dock,
 * menu bar and launcher windows are each sized tight to their own content, so a menu drawn in place would be
 * clipped to that tiny window.
 *
 * Callbacks can't cross the window boundary, so every item (and every sub-menu item) gets a path id like "3" or
 * "3.1"; the popup reports which id was picked and this hook runs the matching callback.
 */
export function useShellMenu() {
  const pending = useRef<Map<string, () => void> | null>(null)

  useEffect(() => {
    const un = listen<string>('taskbar-popup:select', (e) => {
      const map = pending.current
      if (!map) return
      pending.current = null
      map.get(e.payload)?.()
    })
    return () => void un.then((fn) => fn())
  }, [])

  const openMenu = useCallback((at: { clientX: number; clientY: number } | { x: number; y: number }, items: ShellMenuItemDef[], opts?: { up?: boolean }) => {
    // The popup window places itself in screen coordinates; the caller's click or rect is relative to its own window.
    const x = window.screenX + ('clientX' in at ? at.clientX : at.x)
    const y = window.screenY + ('clientY' in at ? at.clientY : at.y)
    const map = new Map<string, () => void>()
    const build = (list: ShellMenuItemDef[], prefix: string): FlyoutMenuItem[] =>
      list.map((it, i) => {
        if (it.header) return { header: true, label: it.label }
        if (it.label === undefined) return {}
        const id = `${prefix}${i}`
        if (it.onSelect) map.set(id, it.onSelect)
        return { label: it.label, danger: it.danger, disabled: it.disabled, icon: it.icon, shortcut: it.shortcut, checked: it.checked, id, items: it.items ? build(it.items, `${id}.`) : undefined }
      })
    const payload = build(items, '')
    pending.current = map
    showPopup({ kind: 'context-menu', x, y, placement: opts?.up ? 'point-up' : 'point', items: payload })
  }, [])

  return openMenu
}
