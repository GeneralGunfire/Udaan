import { DropdownMenuItem } from '@/shared/components/ui/dropdown-menu'
import { FolderIcon, FileTextIcon } from '@/shared/icons'
import { useNewFileKinds } from '../hooks/useNewFileKinds'
import type { NewFileKind } from '@/integrations/file-explorer/types'

interface NewFileMenuItemsProps {
  onNewFolder: () => void
  onNewFile: (kind: NewFileKind) => void
}

/** Shared "New" submenu contents — used by both the toolbar's New button and the blank-space context menu. */
export function NewFileMenuItems({ onNewFolder, onNewFile }: NewFileMenuItemsProps) {
  const options = useNewFileKinds()

  return (
    <>
      <DropdownMenuItem onSelect={onNewFolder}>
        <FolderIcon width={14} height={14} /> Folder
      </DropdownMenuItem>
      {options.map((option) => (
        <DropdownMenuItem key={option.kind} onSelect={() => onNewFile(option.kind)}>
          <FileTextIcon width={14} height={14} /> {option.label}
        </DropdownMenuItem>
      ))}
    </>
  )
}
