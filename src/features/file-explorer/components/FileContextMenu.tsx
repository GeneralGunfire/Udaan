import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useShellMenu, type ShellMenuItemDef } from '@/os/ui/useShellMenu'
import { useOpenWithHandlers } from '../hooks/useOpenWithHandlers'
import { useNewFileKinds } from '../hooks/useNewFileKinds'
import type { NewFileKind } from '@/integrations/file-explorer/types'

export interface ContextMenuPosition {
  x: number
  y: number
}

interface FileContextMenuProps {
  position: ContextMenuPosition | null
  onClose: () => void
  /** Absent when the menu was opened on empty space (blank-area context menu). */
  hasSelection: boolean
  selectionExtension: string | null
  isSingleFile: boolean
  onOpen?: () => void
  onOpenWith?: (exePath: string) => void
  /** Only offered for Document Reader types (.txt/.md/.pdf/.docx). */
  onReadAloud?: () => void
  onRename?: () => void
  onZip?: () => void
  onUnzip?: () => void
  onDelete?: () => void
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
  canPaste: boolean
  onNewFolder: () => void
  onNewFile: (kind: NewFileKind) => void
  onPinToQuickAccess?: () => void
  onProperties?: () => void
  onDuplicate?: () => void
  onCopyPath?: () => void
}

/**
 * The Files right-click menu, shown by the shared popup window like every other menu in the OS.
 *
 * It used to be a Radix dropdown anchored to an invisible element at the click point. In this window that
 * menu was mounted but never positioned (it sat at -9999px), so a right-click showed nothing at all, or the
 * browser's own menu. This component draws nothing itself: when asked to open, it hands the items to the
 * popup window and reports back when that window closes.
 */
export function FileContextMenu(p: FileContextMenuProps) {
  const open = useShellMenu()
  const openWithHandlers = useOpenWithHandlers(p.hasSelection && p.isSingleFile ? p.selectionExtension : null)
  const newKinds = useNewFileKinds()
  // Always read the latest props when the menu opens, without re-opening it every render.
  const latest = useRef(p)
  latest.current = p
  const handlers = useRef(openWithHandlers)
  handlers.current = openWithHandlers
  const kinds = useRef(newKinds)
  kinds.current = newKinds

  useEffect(() => {
    if (!p.position) return
    const c = latest.current
    const items: ShellMenuItemDef[] = []
    const sep = () => items.push({ label: undefined })
    if (c.hasSelection) {
      items.push({ label: 'Open', onSelect: c.onOpen })
      if (c.isSingleFile && c.onReadAloud) items.push({ label: 'Read aloud', onSelect: c.onReadAloud })
      if (c.isSingleFile) for (const h of handlers.current.slice(0, 5)) items.push({ label: `Open with ${h.name}${h.isDefault ? ' (default)' : ''}`, onSelect: () => c.onOpenWith?.(h.exePath) })
      sep()
      items.push({ label: 'Rename', onSelect: c.onRename })
      items.push({ label: 'Copy', onSelect: c.onCopy })
      items.push({ label: 'Cut', onSelect: c.onCut })
      if (c.onDuplicate) items.push({ label: 'Duplicate', onSelect: c.onDuplicate })
      sep()
      if (c.onZip) items.push({ label: 'Compress to ZIP', onSelect: c.onZip })
      if (c.onUnzip) items.push({ label: 'Extract here', onSelect: c.onUnzip })
      if (c.onCopyPath) items.push({ label: 'Copy path', onSelect: c.onCopyPath })
      if (c.onPinToQuickAccess) items.push({ label: 'Pin to Quick Access', onSelect: c.onPinToQuickAccess })
      sep()
      items.push({ label: 'Properties', onSelect: c.onProperties })
      items.push({ label: 'Delete', danger: true, onSelect: c.onDelete })
    } else {
      items.push({ label: 'New folder', onSelect: c.onNewFolder })
      for (const k of kinds.current) items.push({ label: `New ${k.label.toLowerCase()}`, onSelect: () => c.onNewFile(k.kind) })
      if (c.canPaste) {
        sep()
        items.push({ label: 'Paste', onSelect: c.onPaste })
      }
    }
    open({ x: p.position.x, y: p.position.y }, items)
  }, [p.position, open])

  // The popup window announces when it has closed (an item was picked, or the user clicked away).
  useEffect(() => {
    if (!p.position) return
    const un = listen('taskbar-popup:hidden', () => p.onClose())
    return () => void un.then((fn) => fn())
  }, [p.position, p.onClose])

  return null
}
