import { useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { duration, ease } from '@/shared/lib/motion'
import type { FileEntry } from '@/integrations/file-explorer/types'
import type { SortColumn, SortDirection } from '../lib/types'
import { fileKind, formatFileSize, formatModified } from '../lib/fileKind'
import { iconForKind } from '../lib/iconForKind'
import { FILE_DRAG_MIME, encodeDragPaths, decodeDragPaths } from '../lib/dragDrop'

interface FileListViewProps {
  entries: FileEntry[]
  selectedPaths: Set<string>
  cutPaths: Set<string>
  sortColumn: SortColumn
  sortDirection: SortDirection
  renamingPath: string | null
  onSort: (column: SortColumn) => void
  onSelect: (path: string, e: React.MouseEvent) => void
  onOpen: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, path: string) => void
  onRenameSubmit: (path: string, newName: string) => void
  onRenameCancel: () => void
  onDropOntoFolder: (draggedPaths: string[], targetFolderPath: string) => void
}

const COLUMNS: { key: SortColumn; label: string; width: string }[] = [
  { key: 'name', label: 'Name', width: 'flex-1 min-w-0' },
  { key: 'modified', label: 'Date modified', width: 'w-44 shrink-0' },
  { key: 'type', label: 'Type', width: 'w-28 shrink-0' },
  { key: 'size', label: 'Size', width: 'w-24 shrink-0' },
]

export function FileListView({
  entries,
  selectedPaths,
  cutPaths,
  sortColumn,
  sortDirection,
  renamingPath,
  onSort,
  onSelect,
  onOpen,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
  onDropOntoFolder,
}: FileListViewProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-hairline text-text-tertiary flex items-center gap-2 border-b px-3 py-1.5 text-2xs font-medium tracking-wide uppercase">
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            type="button"
            onClick={() => onSort(col.key)}
            className={cn('hover:text-text-secondary flex items-center gap-1 text-left transition-colors', col.width)}
          >
            {col.label}
            {sortColumn === col.key && (
              <span aria-hidden>{sortDirection === 'asc' ? '↑' : '↓'}</span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1 py-1">
        {entries.map((entry, i) => (
          <FileListRow
            key={entry.path}
            entry={entry}
            index={i}
            selected={selectedPaths.has(entry.path)}
            selectedPaths={selectedPaths}
            cut={cutPaths.has(entry.path)}
            renaming={renamingPath === entry.path}
            onSelect={onSelect}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            onDropOntoFolder={onDropOntoFolder}
          />
        ))}
      </div>
    </div>
  )
}

function FileListRow({
  entry,
  index,
  selected,
  selectedPaths,
  cut,
  renaming,
  onSelect,
  onOpen,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
  onDropOntoFolder,
}: {
  entry: FileEntry
  index: number
  selected: boolean
  selectedPaths: Set<string>
  cut: boolean
  renaming: boolean
  onSelect: (path: string, e: React.MouseEvent) => void
  onOpen: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, path: string) => void
  onRenameSubmit: (path: string, newName: string) => void
  onRenameCancel: () => void
  onDropOntoFolder: (draggedPaths: string[], targetFolderPath: string) => void
}) {
  const kind = fileKind(entry.extension, entry.isDir)
  const Icon = iconForKind(kind)
  const [draft, setDraft] = useState(entry.name)
  const [dragOver, setDragOver] = useState(false)

  return (
    <motion.div
      data-path={entry.path}
      draggable
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: duration.micro, delay: Math.min(index, 20) * 0.01, ease: ease.standard }}
      onClick={(e) => onSelect(entry.path, e)}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, entry.path)
      }}
      // framer-motion types `onDragStart` for its own gesture drag
      // (mouse/touch/pointer, no `dataTransfer`), which shadows the DOM
      // handler entirely. This element uses HTML5 drag-and-drop, so the
      // DOM event is what actually arrives at runtime — `onDragStartCapture`
      // is not overridden by motion and keeps the correct DragEvent type.
      onDragStartCapture={(e: React.DragEvent<HTMLDivElement>) => {
        const paths = selected ? Array.from(selectedPaths) : [entry.path]
        e.dataTransfer.setData(FILE_DRAG_MIME, encodeDragPaths(paths))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!entry.isDir) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!entry.isDir) return
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        const paths = decodeDragPaths(e.dataTransfer)
        if (paths.length > 0) onDropOntoFolder(paths, entry.path)
      }}
      className={cn(
        'flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-100 select-none',
        selected ? 'bg-[var(--surface-hover)] text-text-primary' : 'text-text-secondary hover:bg-[var(--os-menu-item-hover)]',
        dragOver && 'bg-accent/20 ring-accent/60 ring-1',
        cut && 'opacity-45',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon width={16} height={16} className="shrink-0" />
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => onRenameSubmit(entry.path, draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(entry.path, draft)
              if (e.key === 'Escape') onRenameCancel()
            }}
            className="border-hairline text-text-primary h-6 min-w-0 flex-1 rounded border bg-[var(--surface-raised)] px-1.5 text-sm outline-none"
          />
        ) : (
          <span className="truncate">{entry.name}</span>
        )}
      </div>
      <span className="w-44 shrink-0 truncate">{formatModified(entry.modifiedMs)}</span>
      <span className="w-28 shrink-0 truncate capitalize">{entry.isDir ? 'Folder' : entry.extension || 'File'}</span>
      <span className="w-24 shrink-0 truncate">{entry.isDir ? '—' : formatFileSize(entry.sizeBytes)}</span>
    </motion.div>
  )
}
