import { FolderIcon, PlusIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'

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
 *
 * All three carry a visible text label, so no tooltips — the label already
 * says what the button does.
 */
export function AddSourceButtons({ hasFolder, onPickFolder, onPickFiles }: AddSourceButtonsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" variant="ghost" size="pill-sm" onClick={() => onPickFiles(false)} className="rounded-md">
        <PlusIcon width={11} height={11} />
        File
      </Button>
      <Button type="button" variant="ghost" size="pill-sm" onClick={() => onPickFiles(true)} className="rounded-md">
        Files
      </Button>
      <Button type="button" variant="ghost" size="pill-sm" onClick={onPickFolder} className="rounded-md">
        <FolderIcon width={11} height={11} />
        {hasFolder ? 'Add folder' : 'Folder'}
      </Button>
    </div>
  )
}
