import { AnimatePresence } from 'framer-motion'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/shared/components/ui/dropdown-menu'
import {
  PencilIcon,
  TrashIcon,
  ClipboardIcon,
  FolderIcon,
  ExplorerIcon,
  ChevronRightIcon,
  GridStepIcon,
  SettingsIcon,
  LayersIcon,
  BookOpenIcon,
} from '@/shared/icons'
import { useOpenWithHandlers } from '../hooks/useOpenWithHandlers'
import { NewFileMenuItems } from './NewFileMenuItems'
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
  /** Only offered when `selectionExtension` is a Document Reader-supported type (.txt/.md/.pdf/.docx). Opens Document Reader directly with this file rather than routing through the OS's own file association. */
  onReadAloud?: () => void
  onRename?: () => void
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

/** Positioned via an invisible 0-size anchor placed at the click coordinates. */
export function FileContextMenu({
  position,
  onClose,
  hasSelection,
  selectionExtension,
  isSingleFile,
  onOpen,
  onOpenWith,
  onReadAloud,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onPaste,
  canPaste,
  onNewFolder,
  onNewFile,
  onPinToQuickAccess,
  onProperties,
  onDuplicate,
  onCopyPath,
}: FileContextMenuProps) {
  const openWithHandlers = useOpenWithHandlers(hasSelection && isSingleFile ? selectionExtension : null)

  return (
    <AnimatePresence>
      {position && (
        <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
          <DropdownMenuPrimitive.Trigger asChild>
            <div
              style={{ position: 'fixed', left: position.x, top: position.y, width: 1, height: 1 }}
            />
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuContent align="start" className="w-52 p-1">
            {hasSelection ? (
              <>
                <DropdownMenuItem onSelect={onOpen}>
                  <ExplorerIcon width={14} height={14} /> Open
                </DropdownMenuItem>

                {isSingleFile && onReadAloud && (
                  <DropdownMenuItem onSelect={onReadAloud}>
                    <BookOpenIcon width={14} height={14} /> Read Aloud
                  </DropdownMenuItem>
                )}

                {isSingleFile && openWithHandlers.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ExplorerIcon width={14} height={14} />
                      Open with
                      <ChevronRightIcon width={12} height={12} className="ml-auto" />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {openWithHandlers.map((handler) => (
                        <DropdownMenuItem key={handler.exePath} onSelect={() => onOpenWith?.(handler.exePath)}>
                          {handler.name}
                          {handler.isDefault && <span className="text-text-tertiary ml-auto text-[10px]">Default</span>}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}

                <DropdownMenuItem onSelect={onRename}>
                  <PencilIcon width={14} height={14} /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onCopy}>
                  <ClipboardIcon width={14} height={14} /> Copy
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onCut}>
                  <ClipboardIcon width={14} height={14} /> Cut
                </DropdownMenuItem>
                {onDuplicate && (
                  <DropdownMenuItem onSelect={onDuplicate}>
                    <LayersIcon width={14} height={14} /> Duplicate
                  </DropdownMenuItem>
                )}
                {onCopyPath && (
                  <DropdownMenuItem onSelect={onCopyPath}>
                    <ClipboardIcon width={14} height={14} /> Copy path
                  </DropdownMenuItem>
                )}
                {onPinToQuickAccess && (
                  <DropdownMenuItem onSelect={onPinToQuickAccess}>
                    <GridStepIcon width={14} height={14} /> Pin to Quick Access
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onProperties}>
                  <SettingsIcon width={14} height={14} /> Properties
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onDelete}
                  className="text-red-400 hover:text-red-300 data-highlighted:text-red-300"
                >
                  <TrashIcon width={14} height={14} /> Delete
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderIcon width={14} height={14} />
                    New
                    <ChevronRightIcon width={12} height={12} className="ml-auto" />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <NewFileMenuItems onNewFolder={onNewFolder} onNewFile={onNewFile} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {canPaste && (
                  <DropdownMenuItem onSelect={onPaste}>
                    <ClipboardIcon width={14} height={14} /> Paste
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </AnimatePresence>
  )
}
