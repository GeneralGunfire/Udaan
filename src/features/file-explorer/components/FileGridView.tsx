import { useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { duration, ease } from '@/shared/lib/motion'
import type { FileEntry } from '@/integrations/file-explorer/types'
import { fileKind } from '../lib/fileKind'
import { iconForKind } from '../lib/iconForKind'
import { useImageThumbnail } from '../hooks/useImageThumbnail'
import { FILE_DRAG_MIME, encodeDragPaths, decodeDragPaths } from '../lib/dragDrop'

interface FileGridViewProps {
  entries: FileEntry[]
  selectedPaths: Set<string>
  cutPaths: Set<string>
  renamingPath: string | null
  onSelect: (path: string, e: React.MouseEvent) => void
  onOpen: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, path: string) => void
  onRenameSubmit: (path: string, newName: string) => void
  onRenameCancel: () => void
  onDropOntoFolder: (draggedPaths: string[], targetFolderPath: string) => void
}

export function FileGridView({
  entries,
  selectedPaths,
  cutPaths,
  renamingPath,
  onSelect,
  onOpen,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
  onDropOntoFolder,
}: FileGridViewProps) {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1 overflow-y-auto p-3">
      {entries.map((entry, i) => (
        <FileGridTile
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
  )
}

function FileGridTile({
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
  const thumbnail = useImageThumbnail(kind === 'image' ? entry.path : null)

  return (
    <motion.div
      data-path={entry.path}
      draggable
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: duration.micro, delay: Math.min(index, 30) * 0.008, ease: ease.standard }}
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
        'flex cursor-default flex-col items-center gap-1.5 rounded-xl p-2.5 text-center transition-colors duration-100 select-none',
        selected ? 'bg-[var(--surface-hover)]' : 'hover:bg-(--os-hover)',
        dragOver && 'bg-accent/20 ring-accent/60 ring-1',
        cut && 'opacity-45',
      )}
    >
      <div className="border-hairline bg-surface-raised flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon width={28} height={28} className="text-text-secondary" />
        )}
      </div>
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
          className="border-hairline text-text-primary h-6 w-full rounded border bg-[var(--surface-raised)] px-1 text-center text-xs outline-none"
        />
      ) : (
        <span className="text-text-secondary line-clamp-2 w-full text-xs break-words">{entry.name}</span>
      )}
    </motion.div>
  )
}
