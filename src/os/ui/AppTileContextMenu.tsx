import { Fragment, useState, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/os/ui/ContextMenu'
import { ShieldAlertIcon, ExplorerIcon, PlusIcon, TrashIcon, SettingsIcon } from '@/shared/icons'
import { shell } from '@/os/kernel/shell'

export interface AppTileAction {
  /** The real launch target — a file path or a `shell:AppsFolder\<id>` string.
   *  Absent for Udaan's own built-in views, which have nothing on disk to elevate. */
  path?: string
  onOpen: () => void
  onPin?: () => void
  onUnpin?: () => void
  pinned?: boolean
  onRemove?: () => void
  onOpenFileLocation?: () => void
}

/**
 * Win11-shaped right-click menu for an app tile (Start Menu / Launchpad):
 * Open, pin/unpin, Run as administrator (real UAC elevation via
 * `shell_invoke_verb`'s `runas` verb — only offered when `path` is a real
 * launch target, since Udaan's own built-in apps are React views with
 * nothing on disk to elevate), open file location, Properties, Uninstall-ish
 * remove-from-list. Elevation failures surface inline instead of silently
 * no-op'ing, since a swallowed UAC failure reads as "the app just didn't
 * open" with no explanation.
 */
export function AppTileContextMenu({ action, children }: { action: AppTileAction; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null)

  async function runAsAdmin() {
    if (!action.path) return
    setError(null)
    try {
      await shell.invokeVerb(action.path, 'runas')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not launch elevated.')
    }
  }

  async function properties() {
    if (!action.path) return
    try {
      await shell.invokeVerb(action.path, 'properties')
    } catch {
      /* no properties dialog available for this target */
    }
  }

  return (
    <Fragment>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setError(null)
        }}
      >
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem icon={ExplorerIcon} onSelect={action.onOpen}>
            Open
          </ContextMenuItem>
          {action.path && (
            <ContextMenuItem icon={ShieldAlertIcon} onSelect={() => void runAsAdmin()}>
              Run as administrator
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {action.onPin && !action.pinned && (
            <ContextMenuItem icon={PlusIcon} onSelect={action.onPin}>
              Pin to Start
            </ContextMenuItem>
          )}
          {action.onUnpin && action.pinned && (
            <ContextMenuItem icon={TrashIcon} onSelect={action.onUnpin}>
              Unpin from Start
            </ContextMenuItem>
          )}
          {action.onOpenFileLocation && (
            <ContextMenuItem icon={ExplorerIcon} onSelect={action.onOpenFileLocation}>
              Open file location
            </ContextMenuItem>
          )}
          {action.path && (
            <ContextMenuItem icon={SettingsIcon} onSelect={() => void properties()}>
              Properties
            </ContextMenuItem>
          )}
          {action.onRemove && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem icon={TrashIcon} danger onSelect={action.onRemove}>
                Remove from this list
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {error && (
        <div
          role="alert"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-[10px] bg-[var(--surface-raised)] px-4 py-2 text-[12.5px] text-[var(--color-danger)] shadow-[var(--os-shadow-overlay)]"
        >
          {error}
        </div>
      )}
    </Fragment>
  )
}
