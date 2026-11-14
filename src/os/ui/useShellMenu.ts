import { useCallback, useEffect, useRef } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import type { FlyoutMenuItem } from '@/os/dock/taskbarPopupTypes'

export interface ShellMenuItemDef {
  /** Omit to render a separator instead of an item. */
  label?: string
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
}

/**
 * Opens a macOS-style context menu at an exact screen point, replacing
 * Tauri's native `Menu`/`popup()`. Renders through the shared
 * `taskbar-popup` window (see FlyoutWindow.tsx) rather than inline in the
 * caller's own window: the dock, menu bar and launcher windows are each
 * sized tight to their own content (the dock is only ~120px tall), so a
 * menu rendered in-place would be clipped to that tiny window — the same
 * reason the existing Quick Settings/Notifications flyouts already render
 * in a separate, dynamically-sized window instead of inline.
 *
 * Callbacks can't cross the IPC boundary to that window, so each item
 * gets a locally-generated id; the flyout window reports back which id
 * was picked, and this hook looks up and invokes the matching callback.
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
    // The popup window places itself in screen coordinates; the caller's
    // click or rect is relative to its own (dock, menu bar...) window.
    const x = window.screenX + ('clientX' in at ? at.clientX : at.x)
    const y = window.screenY + ('clientY' in at ? at.clientY : at.y)
    const map = new Map<string, () => void>()
    const payload: FlyoutMenuItem[] = items.map((it, i) => {
      if (it.label === undefined) return {}
      const id = String(i)
      if (it.onSelect) map.set(id, it.onSelect)
      return { label: it.label, danger: it.danger, disabled: it.disabled, id }
    })
    pending.current = map
    void emit('taskbar-popup:show', { kind: 'context-menu', x, y, placement: opts?.up ? 'point-up' : 'point', items: payload })
  }, [])

  return openMenu
}
