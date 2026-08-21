import { FolderIcon, PlusIcon } from '@/shared/icons'

interface AddSourceButtonsProps {
  hasFolder: boolean
  onPickFolder: () => void
  onPickFiles: (multiple: boolean) => void
}

/**
 * Shared "Add file(s)" / "Add folder" button pair — every local-library
 * feature (DJ Board, Music Player, Image Editor, Video Editor) offers
 * both, not just a folder-only picker. Single click opens a single-file
 * picker; the small dropdown-style second button opens a multi-file
 * picker, keeping both one click away without a hidden modifier key.
 */
export function AddSourceButtons({ hasFolder, onPickFolder, onPickFiles }: AddSourceButtonsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onPickFiles(false)}
        title="Add one file"
        className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium transition-colors duration-150"
      >
        <PlusIcon width={11} height={11} />
        File
      </button>
      <button
        type="button"
        onClick={() => onPickFiles(true)}
        title="Add multiple files"
        className="text-text-secondary hover:text-text-primary hover:bg-glass-hover rounded-md px-1.5 py-1 text-[10.5px] font-medium transition-colors duration-150"
      >
        Files
      </button>
      <button
        type="button"
        onClick={onPickFolder}
        title="Add a whole folder"
        className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium transition-colors duration-150"
      >
        <FolderIcon width={11} height={11} />
        {hasFolder ? 'Add folder' : 'Folder'}
      </button>
    </div>
  )
}
