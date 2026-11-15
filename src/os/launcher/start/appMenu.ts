import { useCallback } from 'react'
import { shell } from '@/os/kernel/shell'
import { useShellMenu, type ShellMenuItemDef } from '@/os/ui/useShellMenu'

export interface AppMenuAction {
  /** The real launch target (a path or `shell:AppsFolder\\id`): enables "Run as administrator" and "Properties". */
  path?: string
  onOpen: () => void
  pinned?: boolean
  onPin?: () => void
  onUnpin?: () => void
}

/**
 * The right-click menu for an app tile, shown by the shared popup window.
 *
 * It used to be a Radix context menu wrapped around every one of the 28+ tiles, so merely opening Start
 * built dozens of menu roots, which is a large part of why Start stuttered as it opened. Now a tile is a
 * plain button, and the menu is only built when someone actually right-clicks.
 */
export function useAppMenu() {
  const open = useShellMenu()
  return useCallback(
    (e: React.MouseEvent, a: AppMenuAction) => {
      e.preventDefault()
      e.stopPropagation()
      const items: ShellMenuItemDef[] = [{ label: 'Open', onSelect: a.onOpen }]
      if (a.pinned !== undefined) items.push({ label: a.pinned ? 'Unpin from Start' : 'Pin to Start', onSelect: a.pinned ? a.onUnpin : a.onPin })
      if (a.path) {
        items.push({ label: undefined })
        items.push({ label: 'Run as administrator', onSelect: () => void shell.invokeVerb(a.path!, 'runas').catch(() => {}) })
        items.push({ label: 'Properties', onSelect: () => void shell.invokeVerb(a.path!, 'properties').catch(() => {}) })
      }
      open({ x: e.clientX, y: e.clientY }, items)
    },
    [open],
  )
}
