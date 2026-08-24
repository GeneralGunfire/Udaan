import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { duration, ease } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/components/ui/button'
import { WindowCloseIcon } from '@/shared/icons'
import type { FileEntry, NewFileKind } from '@/integrations/file-explorer/types'
import {
  createFolder,
  createFile,
  softDeleteEntries,
  copyEntries,
  moveEntries,
  checkConflicts,
  renameEntry,
  searchDir,
  getQuickAccess,
  statPath,
  duplicateEntry,
} from '@/integrations/file-explorer/client'
import { ExplorerSidebar } from './components/ExplorerSidebar'
import { ExplorerTopBar } from './components/ExplorerTopBar'
import { FileListView } from './components/FileListView'
import { FileGridView } from './components/FileGridView'
import { FileContextMenu, type ContextMenuPosition } from './components/FileContextMenu'
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog'
import { NewFolderDialog } from './components/NewFolderDialog'
import { ConflictDialog } from './components/ConflictDialog'
import { PropertiesDialog } from './components/PropertiesDialog'
import { FilePreviewModal } from './components/FilePreviewModal'
import { ClipboardStatusBar } from './components/ClipboardStatusBar'
import { TransferProgressBar } from './components/TransferProgressBar'
import { ToastStack } from './components/ToastStack'
import { LoadingState, EmptyFolderState, ErrorState } from './components/ExplorerStates'
import { useDirectoryListing } from './hooks/useDirectoryListing'
import { useNavigationHistory } from './hooks/useNavigationHistory'
import { usePinnedFolders } from './hooks/usePinnedFolders'
import { useUndoStack } from './hooks/useUndoStack'
import { useTransferProgress } from './hooks/useTransferProgress'
import { useToasts } from './hooks/useToasts'
import { sortEntries } from './lib/sortEntries'
import { openFileWith } from '@/integrations/installed-apps/client'
import { openDocumentReader } from '@/app/apps'

const DOCUMENT_READER_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'pdf', 'docx'])
import {
  renameOperation,
  createFolderOperation,
  createFileOperation,
  deleteOperation,
  moveOperation,
} from './lib/undoableOperations'
import type { ExplorerViewMode, SortColumn, SortDirection, ClipboardState } from './lib/types'
import type { QuickAccessLocation, ConflictMode } from '@/integrations/file-explorer/types'

/**
 * File Explorer — Windows Explorer's interaction model (sidebar, breadcrumb,
 * list/grid toggle, multi-select, context menu, cut/copy/paste, drag-drop,
 * undo/redo) rendered in Udaan's own dark glass styling. See lib/ for pure
 * helpers and hooks/ for data loading — this component is composition +
 * interaction wiring only.
 */
interface FileExplorerViewProps {
  onClose: () => void
}

export function FileExplorerView({ onClose }: FileExplorerViewProps) {
  const [homePath, setHomePath] = useState<string | null>(null)
  const [quickAccess, setQuickAccess] = useState<QuickAccessLocation[]>([])

  useEffect(() => {
    getQuickAccess().then((locations) => {
      setQuickAccess(locations)
      setHomePath((prev) => prev ?? locations[0]?.path ?? null)
    })
  }, [])

  if (!homePath) {
    return (
      <div className="relative h-full w-full">
        <CloseButton onClose={onClose} />
        <LoadingState />
      </div>
    )
  }

  return <FileExplorerReady initialPath={homePath} quickAccess={quickAccess} onClose={onClose} />
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button
      type="button"
      aria-label="Close File Explorer"
      variant="ghost"
      size="icon-sm"
      onClick={onClose}
      className="absolute top-3 right-3 z-20"
    >
      <WindowCloseIcon width={14} height={14} />
    </Button>
  )
}

interface PendingTransfer {
  paths: string[]
  destDir: string
  mode: 'copy' | 'move'
  conflictCount: number
  destLabel: string
}

function FileExplorerReady({
  initialPath,
  quickAccess,
  onClose,
}: {
  initialPath: string
  quickAccess: QuickAccessLocation[]
  onClose: () => void
}) {
  const { currentPath, canGoBack, canGoForward, navigateTo, goBack, goForward } = useNavigationHistory(initialPath)
  const { entries, loading, error, refresh } = useDirectoryListing(currentPath)
  const { pinned, pin, unpin, reorder } = usePinnedFolders()
  const { canUndo, canRedo, push: pushUndo, undo, redo } = useUndoStack()
  const { active: activeTransfer, start: startTransfer, finish: finishTransfer } = useTransferProgress()
  const { toasts, push: pushToast } = useToasts()

  const [viewMode, setViewMode] = useState<ExplorerViewMode>('list')
  const [sortColumn, setSortColumn] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null)
  const [contextMenu, setContextMenu] = useState<{ position: ContextMenuPosition; path: string | null } | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false)
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null)
  const [propertiesEntry, setPropertiesEntry] = useState<FileEntry | null>(null)
  const [pendingNewName, setPendingNewName] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchRecursive, setSearchRecursive] = useState(false)
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null)
  const [searching, setSearching] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // Reset per-folder UI state on navigation so selection/search don't leak across folders.
  useEffect(() => {
    setSelectedPaths(new Set())
    setLastSelectedPath(null)
    setRenamingPath(null)
    setSearchQuery('')
    setSearchResults(null)
  }, [currentPath])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    let cancelled = false
    setSearching(true)
    // Recursive search walks the whole subtree per keystroke (bounded, but
    // still real disk I/O) — debounce it more than the flat, single-folder
    // case so fast typing doesn't queue up several overlapping walks.
    const timeout = setTimeout(
      () => {
        searchDir(currentPath, searchQuery.trim(), searchRecursive)
          .then((results) => {
            if (!cancelled) setSearchResults(results)
          })
          .finally(() => {
            if (!cancelled) setSearching(false)
          })
      },
      searchRecursive ? 400 : 200,
    )
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [searchQuery, searchRecursive, currentPath])

  const visibleEntries = useMemo(() => {
    const base = searchResults ?? entries
    return sortEntries(base, sortColumn, sortDirection)
  }, [entries, searchResults, sortColumn, sortDirection])

  const isSearchMode = searchResults !== null

  // After creating a new file/folder, select it and drop straight into
  // rename mode once it shows up in the freshly-refreshed listing —
  // matches Explorer's "New Folder" behavior.
  useEffect(() => {
    if (!pendingNewName) return
    const created = entries.find((e) => e.name === pendingNewName)
    if (created) {
      setSelectedPaths(new Set([created.path]))
      setLastSelectedPath(created.path)
      setRenamingPath(created.path)
      setPendingNewName(null)
    }
  }, [entries, pendingNewName])

  function handleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const handleSelect = useCallback(
    (path: string, e: React.MouseEvent) => {
      setSelectedPaths((prev) => {
        if (e.shiftKey && lastSelectedPath) {
          const paths = visibleEntries.map((en) => en.path)
          const start = paths.indexOf(lastSelectedPath)
          const end = paths.indexOf(path)
          if (start === -1 || end === -1) return new Set([path])
          const [lo, hi] = start < end ? [start, end] : [end, start]
          return new Set(paths.slice(lo, hi + 1))
        }
        if (e.ctrlKey || e.metaKey) {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        }
        return new Set([path])
      })
      setLastSelectedPath(path)
    },
    [lastSelectedPath, visibleEntries],
  )

  // Double-click always previews first — image/text render inline, other
  // types show a file-info card — and opening the real file externally is
  // a separate, explicit confirmed step from inside that preview (see
  // FilePreviewModal's "Open in App ▾" picker). Folders still navigate
  // straight in, since there's nothing to preview there.
  function handleOpen(entry: FileEntry) {
    if (entry.isDir) {
      navigateTo(entry.path)
      return
    }
    setPreviewEntry(entry)
  }

  function handleOpenSelected() {
    const entry = visibleEntries.find((en) => en.path === (contextMenu?.path ?? Array.from(selectedPaths)[0]))
    if (entry) handleOpen(entry)
  }

  // Right-click → "Open with <app>" bypasses the preview modal and opens
  // directly — the picker there already IS the confirm+choose step, so a
  // second preview step first would be redundant.
  async function handleOpenWith(exePath: string) {
    const path = contextMenu?.path ?? Array.from(selectedPaths)[0]
    const entry = visibleEntries.find((en) => en.path === path)
    if (!entry) return
    setOpenError(null)
    try {
      await openFileWith(exePath, entry.path)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : `Couldn't open "${entry.name}".`)
    }
  }

  function startRename(path?: string | null) {
    const target = path ?? Array.from(selectedPaths)[0]
    if (target) setRenamingPath(target)
  }

  async function submitRename(oldPath: string, newName: string) {
    setRenamingPath(null)
    const trimmed = newName.trim()
    const current = visibleEntries.find((en) => en.path === oldPath)
    if (!trimmed || !current || trimmed === current.name) return
    try {
      const renamed = await renameEntry(oldPath, trimmed)
      pushUndo(renameOperation(oldPath, current.name, renamed.path, trimmed))
      pushToast(`Renamed to "${trimmed}"`)
      refresh()
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Rename failed.', 'danger')
    }
  }

  function requestDelete() {
    if (selectedPaths.size > 0) setDeleteDialogOpen(true)
  }

  async function confirmDelete() {
    const count = selectedPaths.size
    try {
      const trashed = await softDeleteEntries(Array.from(selectedPaths))
      pushUndo(deleteOperation(trashed))
      setSelectedPaths(new Set())
      pushToast(`Deleted ${count} item${count === 1 ? '' : 's'}`)
      refresh()
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Delete failed.', 'danger')
    }
  }

  function handleCopy() {
    if (selectedPaths.size === 0) return
    const count = selectedPaths.size
    setClipboard({ paths: Array.from(selectedPaths), mode: 'copy' })
    pushToast(`Copied ${count} item${count === 1 ? '' : 's'}`)
  }

  function handleCut() {
    if (selectedPaths.size === 0) return
    const count = selectedPaths.size
    setClipboard({ paths: Array.from(selectedPaths), mode: 'cut' })
    pushToast(`Cut ${count} item${count === 1 ? '' : 's'} — paste to move`)
  }

  function clearClipboard() {
    setClipboard(null)
  }

  async function runTransfer(
    paths: string[],
    destDir: string,
    mode: 'copy' | 'move',
    conflictMode: ConflictMode,
    destLabel: string,
  ) {
    const sourceDirs = new Map<string, FileEntry[]>()
    const transferId = crypto.randomUUID()
    const isLarge = paths.length > 3
    if (isLarge) startTransfer(transferId, mode === 'copy' ? 'Copying' : 'Moving')
    try {
      if (mode === 'copy') {
        await copyEntries(paths, destDir, conflictMode, transferId)
      } else {
        // Undo needs each moved entry's original parent dir + name, so
        // resolve those before the move (paths won't exist there after).
        const movedEntries = paths
          .map((p) => visibleEntries.find((en) => en.path === p))
          .filter((e): e is FileEntry => !!e)
        await moveEntries(paths, destDir, conflictMode, transferId)
        if (movedEntries.length > 0) {
          const parent = paths[0].slice(0, paths[0].length - (paths[0].split(/[\\/]/).pop()?.length ?? 0) - 1)
          sourceDirs.set(parent, movedEntries)
        }
      }
      if (mode === 'move') {
        for (const [sourceDir, movedEntries] of sourceDirs) {
          pushUndo(moveOperation(movedEntries, sourceDir, destDir))
        }
        setClipboard(null)
      }
      pushToast(
        `${mode === 'copy' ? 'Copied' : 'Moved'} ${paths.length} item${paths.length === 1 ? '' : 's'} to ${destLabel}`,
      )
      refresh()
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Transfer failed.', 'danger')
    } finally {
      if (isLarge) finishTransfer(transferId)
    }
  }

  async function pasteOrDropInto(paths: string[], destDir: string, mode: 'copy' | 'move', destLabel: string) {
    const conflicts = await checkConflicts(paths, destDir).catch(() => [])
    if (conflicts.length > 0) {
      setPendingTransfer({ paths, destDir, mode, conflictCount: conflicts.length, destLabel })
      return
    }
    await runTransfer(paths, destDir, mode, 'keep_both', destLabel)
  }

  async function handlePaste() {
    if (!clipboard) return
    await pasteOrDropInto(clipboard.paths, currentPath, clipboard.mode === 'copy' ? 'copy' : 'move', 'this folder')
  }

  async function handleDropOntoFolder(draggedPaths: string[], targetFolderPath: string) {
    // Native HTML5 drag-and-drop has no reliable cross-browser signal for
    // "was Ctrl held" at drop time in this webview, so drag always moves —
    // matches the most common Explorer drag gesture (same-drive drag = move).
    const targetName = targetFolderPath.split(/[\\/]/).filter(Boolean).pop() ?? targetFolderPath
    await pasteOrDropInto(draggedPaths, targetFolderPath, 'move', targetName)
  }

  function resolveConflict(mode: ConflictMode) {
    if (!pendingTransfer) return
    const { paths, destDir, mode: transferMode, destLabel } = pendingTransfer
    setPendingTransfer(null)
    runTransfer(paths, destDir, transferMode, mode, destLabel)
  }

  async function handleCreateFolder(name: string) {
    try {
      const created = await createFolder(currentPath, name)
      pushUndo(createFolderOperation(created.path))
      setPendingNewName(created.name)
      refresh()
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create folder.', 'danger')
    }
  }

  async function handleCreateFile(kind: NewFileKind) {
    try {
      const created = await createFile(currentPath, kind)
      pushUndo(createFileOperation(created.path, kind))
      setPendingNewName(created.name)
      refresh()
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create file.', 'danger')
    }
  }

  async function handleDuplicate(path?: string | null) {
    const target = path ?? Array.from(selectedPaths)[0]
    if (!target) return
    try {
      const created = await duplicateEntry(target)
      pushToast(`Duplicated as "${created.name}"`)
      refresh()
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Duplicate failed.', 'danger')
    }
  }

  async function handleCopyPath(path?: string | null) {
    const target = path ?? Array.from(selectedPaths)[0]
    if (!target) return
    try {
      await navigator.clipboard.writeText(target)
      pushToast('Path copied to clipboard')
    } catch (err) {
      pushToast('Could not copy path.', 'danger')
    }
  }

  async function handleProperties(path?: string | null) {
    const target = path ?? Array.from(selectedPaths)[0]
    if (!target) return
    try {
      const stat = await statPath(target)
      setPropertiesEntry(stat)
    } catch (err) {
      console.error(err)
    }
  }

  function openContextMenu(e: React.MouseEvent, path: string | null) {
    if (path && !selectedPaths.has(path)) {
      setSelectedPaths(new Set([path]))
      setLastSelectedPath(path)
    }
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, path })
  }

  // Keyboard shortcuts scoped to the explorer panel.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return
      if (renamingPath) return
      const key = e.key.toLowerCase()
      if (e.key === 'Delete' && selectedPaths.size > 0) {
        e.preventDefault()
        requestDelete()
      } else if (e.key === 'F2' && selectedPaths.size === 1) {
        e.preventDefault()
        startRename()
      } else if (e.key === 'Enter' && selectedPaths.size === 1) {
        e.preventDefault()
        const entry = visibleEntries.find((en) => en.path === Array.from(selectedPaths)[0])
        if (entry) handleOpen(entry)
      } else if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault()
        setSelectedPaths(new Set(visibleEntries.map((en) => en.path)))
      } else if ((e.ctrlKey || e.metaKey) && key === 'c' && selectedPaths.size > 0) {
        handleCopy()
      } else if ((e.ctrlKey || e.metaKey) && key === 'x' && selectedPaths.size > 0) {
        handleCut()
      } else if ((e.ctrlKey || e.metaKey) && key === 'v' && clipboard) {
        handlePaste()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault()
        redo()
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && visibleEntries.length > 0) {
        e.preventDefault()
        const paths = visibleEntries.map((en) => en.path)
        const currentIndex = lastSelectedPath ? paths.indexOf(lastSelectedPath) : -1
        const nextIndex =
          e.key === 'ArrowDown'
            ? Math.min(paths.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex === -1 ? 0 : currentIndex - 1)
        const nextPath = paths[nextIndex]
        setSelectedPaths(new Set([nextPath]))
        setLastSelectedPath(nextPath)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPaths, clipboard, renamingPath, visibleEntries, lastSelectedPath])

  // refresh() after undo/redo mutate the filesystem out from under the current listing.
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo])

  function handlePinCurrent() {
    pin(currentPath)
  }

  const contextMenuEntry = visibleEntries.find((en) => en.path === contextMenu?.path)
  const cutPaths = useMemo(
    () => (clipboard?.mode === 'cut' ? new Set(clipboard.paths) : new Set<string>()),
    [clipboard],
  )

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full flex-col" tabIndex={-1}>
      <CloseButton onClose={onClose} />
      <ExplorerTopBar
        currentPath={currentPath}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
        onNavigate={navigateTo}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchRecursive={searchRecursive}
        onToggleRecursive={() => setSearchRecursive((r) => !r)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onNewFolder={() => setNewFolderDialogOpen(true)}
        onNewFile={handleCreateFile}
        canUndo={canUndo}
        onUndo={undo}
        canRedo={canRedo}
        onRedo={redo}
        hasSelection={selectedPaths.size > 0}
        canPaste={!!clipboard}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
      />

      <div className="flex min-h-0 flex-1">
        <ExplorerSidebar
          quickAccess={quickAccess}
          pinned={pinned}
          currentPath={currentPath}
          onNavigate={navigateTo}
          onPinCurrent={handlePinCurrent}
          onPinPath={pin}
          onUnpin={unpin}
          onReorderPinned={reorder}
          onDropOntoFolder={handleDropOntoFolder}
        />

        <div
          className="flex min-h-0 flex-1 flex-col"
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('[data-path]')) return
            e.preventDefault()
            openContextMenu(e, null)
          }}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('[data-path]')) {
              setSelectedPaths(new Set())
            }
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPath}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: duration.standard, ease: ease.standard }}
              className={cn('flex min-h-0 flex-1 flex-col')}
            >
              {loading && <LoadingState />}
              {!loading && error && <ErrorState message={error} />}
              {!loading && !error && visibleEntries.length === 0 && (
                <EmptyFolderState searching={isSearchMode} />
              )}
              {!loading && !error && visibleEntries.length > 0 && viewMode === 'list' && (
                <FileListView
                  entries={visibleEntries}
                  selectedPaths={selectedPaths}
                  cutPaths={cutPaths}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  renamingPath={renamingPath}
                  onSort={handleSort}
                  onSelect={handleSelect}
                  onOpen={handleOpen}
                  onContextMenu={(e, path) => openContextMenu(e, path)}
                  onRenameSubmit={submitRename}
                  onRenameCancel={() => setRenamingPath(null)}
                  onDropOntoFolder={handleDropOntoFolder}
                />
              )}
              {!loading && !error && visibleEntries.length > 0 && viewMode === 'grid' && (
                <FileGridView
                  entries={visibleEntries}
                  selectedPaths={selectedPaths}
                  cutPaths={cutPaths}
                  renamingPath={renamingPath}
                  onSelect={handleSelect}
                  onOpen={handleOpen}
                  onContextMenu={(e, path) => openContextMenu(e, path)}
                  onRenameSubmit={submitRename}
                  onRenameCancel={() => setRenamingPath(null)}
                  onDropOntoFolder={handleDropOntoFolder}
                />
              )}
              {searching && <p className="text-text-tertiary px-3 pb-2 text-[11px]">Searching…</p>}
              {openError && <p className="text-danger px-3 pb-2 text-[11px]">{openError}</p>}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <TransferProgressBar transfer={activeTransfer} />
      <ClipboardStatusBar clipboard={clipboard} onPaste={handlePaste} onClear={clearClipboard} />

      <FileContextMenu
        position={contextMenu?.position ?? null}
        onClose={() => setContextMenu(null)}
        hasSelection={!!contextMenu?.path}
        selectionExtension={contextMenuEntry?.extension ?? null}
        isSingleFile={selectedPaths.size === 1 && !!contextMenuEntry && !contextMenuEntry.isDir}
        onOpen={handleOpenSelected}
        onOpenWith={handleOpenWith}
        onReadAloud={
          contextMenuEntry && !contextMenuEntry.isDir && DOCUMENT_READER_EXTENSIONS.has(contextMenuEntry.extension.toLowerCase())
            ? () => openDocumentReader(contextMenuEntry.path)
            : undefined
        }
        onRename={() => startRename(contextMenu?.path)}
        onDelete={requestDelete}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        canPaste={!!clipboard}
        onNewFolder={() => setNewFolderDialogOpen(true)}
        onNewFile={handleCreateFile}
        onPinToQuickAccess={contextMenuEntry?.isDir ? () => pin(contextMenuEntry.path) : undefined}
        onProperties={() => handleProperties(contextMenu?.path)}
        onDuplicate={contextMenuEntry ? () => handleDuplicate(contextMenu?.path) : undefined}
        onCopyPath={contextMenuEntry ? () => handleCopyPath(contextMenu?.path) : undefined}
      />

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        count={selectedPaths.size}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
      />

      <NewFolderDialog
        open={newFolderDialogOpen}
        onOpenChange={setNewFolderDialogOpen}
        onCreate={handleCreateFolder}
      />

      <ConflictDialog
        open={!!pendingTransfer}
        conflictCount={pendingTransfer?.conflictCount ?? 0}
        onResolve={resolveConflict}
        onCancel={() => setPendingTransfer(null)}
      />

      <PropertiesDialog entry={propertiesEntry} onOpenChange={(open) => !open && setPropertiesEntry(null)} />

      <FilePreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />

      <ToastStack toasts={toasts} />
    </div>
  )
}
