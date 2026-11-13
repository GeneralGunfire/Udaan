import { useState } from 'react'
import { WindowCloseIcon, FolderIcon, PlusIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/cn'
import { FILE_DRAG_MIME, encodeDragPaths, decodeDragPaths } from '../lib/dragDrop'
import type { QuickAccessLocation } from '@/integrations/file-explorer/types'

interface ExplorerSidebarProps {
  quickAccess: QuickAccessLocation[]
  pinned: QuickAccessLocation[]
  currentPath: string
  onNavigate: (path: string) => void
  onPinCurrent: () => void
  onPinPath: (path: string) => void
  onUnpin: (path: string) => void
  onReorderPinned: (fromIndex: number, toIndex: number) => void
  onDropOntoFolder: (draggedPaths: string[], targetFolderPath: string) => void
}

export function ExplorerSidebar({
  quickAccess,
  pinned,
  currentPath,
  onNavigate,
  onPinCurrent,
  onPinPath,
  onUnpin,
  onReorderPinned,
  onDropOntoFolder,
}: ExplorerSidebarProps) {
  const [dragOverPinnedList, setDragOverPinnedList] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  function handlePinnedListDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOverPinnedList(false)
    const draggedPaths = decodeDragPaths(e.dataTransfer)
    // A single dragged folder onto empty list space pins it; reordering
    // (dragging an existing pin over another) is handled per-item below.
    if (dragIndex === null && draggedPaths.length === 1) {
      onPinPath(draggedPaths[0])
    } else if (dragIndex !== null && dropIndex !== null) {
      onReorderPinned(dragIndex, dropIndex)
    }
    setDragIndex(null)
    setDropIndex(null)
  }

  return (
    <aside className="border-hairline flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r px-3 py-4">
      <nav aria-label="Quick access" className="flex flex-col gap-0.5">
        <p className="text-text-tertiary px-2.5 pb-1 text-2xs font-medium tracking-wide uppercase">
          Quick access
        </p>
        {quickAccess.map((loc) => (
          <SidebarItem
            key={loc.path}
            location={loc}
            active={loc.path === currentPath}
            onClick={() => onNavigate(loc.path)}
            onDropOntoFolder={onDropOntoFolder}
          />
        ))}
      </nav>

      <nav
        aria-label="Pinned folders"
        className={cn('flex flex-col gap-0.5 rounded-lg py-1 transition-colors', dragOverPinnedList && 'bg-[var(--surface-raised)]')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOverPinnedList(true)
        }}
        onDragLeave={() => setDragOverPinnedList(false)}
        onDrop={handlePinnedListDrop}
      >
        <div className="flex items-center justify-between px-2.5 pb-1">
          <p className="text-text-tertiary text-2xs font-medium tracking-wide uppercase">Pinned</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onPinCurrent}
            aria-label="Pin current folder"
            title="Pin current folder"
          >
            <PlusIcon width={14} height={14} />
          </Button>
        </div>
        {pinned.length === 0 && (
          <p className="text-text-tertiary px-2.5 text-xs">Drag a folder here, or use "Pin to Quick Access".</p>
        )}
        {pinned.map((loc, index) => (
          <SidebarItem
            key={loc.path}
            location={loc}
            active={loc.path === currentPath}
            onClick={() => onNavigate(loc.path)}
            onRemove={() => onUnpin(loc.path)}
            reorderable
            onReorderDragStart={() => setDragIndex(index)}
            onReorderDragOver={() => setDropIndex(index)}
            onDropOntoFolder={onDropOntoFolder}
          />
        ))}
      </nav>
    </aside>
  )
}

function SidebarItem({
  location,
  active,
  onClick,
  onRemove,
  reorderable,
  onReorderDragStart,
  onReorderDragOver,
  onDropOntoFolder,
}: {
  location: QuickAccessLocation
  active: boolean
  onClick: () => void
  onRemove?: () => void
  reorderable?: boolean
  onReorderDragStart?: () => void
  onReorderDragOver?: () => void
  onDropOntoFolder: (draggedPaths: string[], targetFolderPath: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      draggable={reorderable}
      onDragStart={(e) => {
        if (!reorderable) return
        e.dataTransfer.setData(FILE_DRAG_MIME, encodeDragPaths([location.path]))
        onReorderDragStart?.()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
        if (reorderable) onReorderDragOver?.()
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        const draggedPaths = decodeDragPaths(e.dataTransfer)
        // A folder dragged from the file list onto a sidebar location moves
        // it there; dragging the pin itself (reorder) never triggers a move.
        if (draggedPaths.length > 0 && !draggedPaths.includes(location.path)) {
          onDropOntoFolder(draggedPaths, location.path)
        }
      }}
      className={cn(
        'group relative flex items-center',
        dragOver && 'bg-accent/15 ring-accent/50 rounded-lg ring-1',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex h-8 flex-1 min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150',
          active
            ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
            : 'text-text-secondary hover:bg-[var(--os-menu-item-hover)] hover:text-text-primary',
        )}
      >
        <FolderIcon width={16} height={16} className="shrink-0" />
        <span className="truncate">{location.name}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Unpin ${location.name}`}
          // A real icon, not the "×" multiplication character. That glyph
          // renders at whatever weight and baseline the body font gives
          // it, so it sat visibly off-centre and lighter than every other
          // control — the most obvious instance of the button
          // inconsistency in this view.
          className="text-text-tertiary hover:text-text-primary hover:bg-[var(--os-menu-item-hover)] absolute right-1.5 hidden h-5 w-5 items-center justify-center rounded-md transition-colors duration-150 group-hover:flex"
        >
          <WindowCloseIcon width={10} height={10} />
        </button>
      )}
    </div>
  )
}
