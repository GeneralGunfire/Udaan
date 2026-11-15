import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { formatFileSize } from '../lib/fileKind'
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
      <Drives currentPath={currentPath} onNavigate={onNavigate} />
    </aside>
  )
}

interface Drive {
  name: string
  mount: string
  totalBytes: number
  freeBytes: number
  removable: boolean
}

/** This PC: every drive with how full it is. */
function Drives({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  const [drives, setDrives] = useState<Drive[]>([])
  useEffect(() => {
    void invoke<Drive[]>('file_explorer_drives').then(setDrives, () => {})
  }, [])
  if (!drives.length) return null
  return (
    <nav aria-label="Drives" className="flex flex-col gap-0.5 pb-2 pt-1">
      <p className="u-label px-2.5 pb-1">This PC</p>
      {drives.map((d) => {
        const used = d.totalBytes ? 1 - d.freeBytes / d.totalBytes : 0
        const active = currentPath.toLowerCase().startsWith(d.mount.toLowerCase())
        return (
          <button key={d.mount} type="button" data-selected={active || undefined} onClick={() => onNavigate(d.mount)} className="u-row h-auto flex-col items-stretch gap-1.5 px-2.5 py-2" title={`${formatFileSize(d.freeBytes)} free of ${formatFileSize(d.totalBytes)}`}>
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <rect x="3" y="7" width="18" height="10" rx="2" />
                <path d="M7 12h.01M17 12h-5" />
              </svg>
              <span className="truncate">{d.name ? `${d.name} (${d.mount.replace(/[\\/]$/, '')})` : d.mount}</span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-(--u-wash-press)">
              <span className="block h-full rounded-full" style={{ width: `${Math.round(used * 100)}%`, background: used > 0.9 ? 'var(--u-danger)' : 'var(--u-ink)' }} />
            </span>
            <span className="text-[11px] tabular-nums text-(--u-ink-3)">{formatFileSize(d.freeBytes)} free</span>
          </button>
        )
      })}
    </nav>
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
      <button type="button" onClick={onClick} data-selected={active || undefined} className="u-row h-8 min-w-0 flex-1 gap-2 px-2.5 text-[13px]">
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
          className="text-text-tertiary hover:text-text-primary hover:bg-(--os-hover) absolute right-1.5 hidden h-5 w-5 items-center justify-center rounded-md transition-colors duration-150 group-hover:flex"
        >
          <WindowCloseIcon width={10} height={10} />
        </button>
      )}
    </div>
  )
}
