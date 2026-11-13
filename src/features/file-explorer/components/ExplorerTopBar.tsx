import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/shared/components/ui/dropdown-menu'
import {
  ChevronRightIcon,
  SearchIcon,
  GridIcon,
  QueueIcon,
  PlusIcon,
  SyncIcon,
  ScissorsIcon,
  ClipboardIcon,
  DownloadIcon,
} from '@/shared/icons'
import { Breadcrumb } from './Breadcrumb'
import { NewFileMenuItems } from './NewFileMenuItems'
import type { ExplorerViewMode } from '../lib/types'
import type { NewFileKind } from '@/integrations/file-explorer/types'

interface ExplorerTopBarProps {
  currentPath: string
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onNavigate: (path: string) => void
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchRecursive: boolean
  onToggleRecursive: () => void
  viewMode: ExplorerViewMode
  onViewModeChange: (mode: ExplorerViewMode) => void
  onNewFolder: () => void
  onNewFile: (kind: NewFileKind) => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
  hasSelection: boolean
  canPaste: boolean
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
}

export function ExplorerTopBar({
  currentPath,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  searchQuery,
  onSearchQueryChange,
  searchRecursive,
  onToggleRecursive,
  viewMode,
  onViewModeChange,
  onNewFolder,
  onNewFile,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  hasSelection,
  canPaste,
  onCopy,
  onCut,
  onPaste,
}: ExplorerTopBarProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  return (
    <div className="border-hairline flex items-center gap-2 border-b py-2.5 pr-14 pl-3">
      <Button type="button" variant="ghost" size="icon-sm" disabled={!canGoBack} onClick={onBack} aria-label="Back">
        <ChevronRightIcon width={14} height={14} className="rotate-180" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={!canGoForward} onClick={onForward} aria-label="Forward">
        <ChevronRightIcon width={14} height={14} />
      </Button>

      <Breadcrumb path={currentPath} onNavigate={onNavigate} />

      <div className="border-hairline flex h-8 w-56 shrink-0 items-center gap-1.5 rounded-lg border bg-[var(--surface-raised)] px-2.5">
        <SearchIcon width={14} height={14} className="text-text-tertiary shrink-0" />
        <input
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search this folder"
          className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </div>
      <Button
        type="button"
        variant={searchRecursive ? 'surface' : 'ghost'}
        size="pill-sm"
        onClick={onToggleRecursive}
        title="Search subfolders"
      >
        Subfolders
      </Button>

      <DropdownMenu open={newMenuOpen} onOpenChange={setNewMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="pill-sm" aria-label="New">
            <PlusIcon width={14} height={14} /> New
          </Button>
        </DropdownMenuTrigger>
        <AnimatePresence>
          {newMenuOpen && (
            <DropdownMenuContent align="start" className="w-52 p-1">
              <NewFileMenuItems onNewFolder={onNewFolder} onNewFile={onNewFile} />
            </DropdownMenuContent>
          )}
        </AnimatePresence>
      </DropdownMenu>

      <div className="border-hairline flex items-center gap-0.5 rounded-lg border p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!hasSelection}
          onClick={onCopy}
          aria-label="Copy"
          title="Copy (Ctrl+C)"
        >
          <ClipboardIcon width={14} height={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!hasSelection}
          onClick={onCut}
          aria-label="Cut"
          title="Cut (Ctrl+X)"
        >
          <ScissorsIcon width={14} height={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canPaste}
          onClick={onPaste}
          aria-label="Paste"
          title="Paste (Ctrl+V)"
        >
          <DownloadIcon width={14} height={14} />
        </Button>
      </div>

      <div className="border-hairline flex items-center gap-0.5 rounded-lg border p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canUndo}
          onClick={onUndo}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          <SyncIcon width={14} height={14} className="-scale-x-100" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canRedo}
          onClick={onRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
        >
          <SyncIcon width={14} height={14} />
        </Button>
      </div>

      <div className="border-hairline ml-auto flex items-center gap-0.5 rounded-lg border p-0.5">
        <Button
          type="button"
          variant={viewMode === 'list' ? 'surface' : 'ghost'}
          size="icon-sm"
          onClick={() => onViewModeChange('list')}
          aria-label="List view"
          aria-pressed={viewMode === 'list'}
        >
          <QueueIcon width={14} height={14} />
        </Button>
        <Button
          type="button"
          variant={viewMode === 'grid' ? 'surface' : 'ghost'}
          size="icon-sm"
          onClick={() => onViewModeChange('grid')}
          aria-label="Grid view"
          aria-pressed={viewMode === 'grid'}
        >
          <GridIcon width={14} height={14} />
        </Button>
      </div>
    </div>
  )
}
