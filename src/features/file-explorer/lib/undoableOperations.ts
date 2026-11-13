import {
  createFolder,
  createFile,
  moveEntries,
  renameEntry,
  softDeleteEntries,
  restoreFromTrash,
} from '@/integrations/file-explorer/client'
import type { FileEntry, NewFileKind, TrashedEntry } from '@/integrations/file-explorer/types'

/** One reversible file-management action, pushed onto the undo stack after it succeeds. */
export interface UndoableOperation {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

export function renameOperation(oldPath: string, oldName: string, newPath: string, newName: string): UndoableOperation {
  return {
    label: `Rename "${oldName}" to "${newName}"`,
    undo: async () => {
      await renameEntry(newPath, oldName)
    },
    redo: async () => {
      await renameEntry(oldPath, newName)
    },
  }
}

export function createFolderOperation(createdPath: string): UndoableOperation {
  return {
    label: 'Create folder',
    undo: async () => {
      await softDeleteEntries([createdPath])
    },
    redo: async () => {
      const name = createdPath.split(/[\\/]/).pop() ?? 'New folder'
      const parent = createdPath.slice(0, createdPath.length - name.length - 1)
      await createFolder(parent, name)
    },
  }
}

export function createFileOperation(createdPath: string, kind: NewFileKind): UndoableOperation {
  return {
    label: 'Create file',
    undo: async () => {
      await softDeleteEntries([createdPath])
    },
    redo: async () => {
      const name = createdPath.split(/[\\/]/).pop() ?? ''
      const parent = createdPath.slice(0, createdPath.length - name.length - 1)
      await createFile(parent, kind)
    },
  }
}

/** Delete-undo restores from the app's hidden trash directory rather than a true OS recycle bin — see `file_explorer_soft_delete`. */
export function deleteOperation(trashed: TrashedEntry[]): UndoableOperation {
  return {
    label: `Delete ${trashed.length} item${trashed.length === 1 ? '' : 's'}`,
    undo: async () => {
      for (const entry of trashed) {
        await restoreFromTrash(entry.trashPath, entry.originalPath)
      }
    },
    redo: async () => {
      const paths = trashed.map((t) => t.originalPath)
      const retrashed = await softDeleteEntries(paths)
      // Mutate in place so a later undo call sees the fresh trash paths —
      // redo can move an item to a new trash location each time.
      trashed.forEach((t, i) => {
        t.trashPath = retrashed[i]?.trashPath ?? t.trashPath
      })
    },
  }
}

export function moveOperation(entries: FileEntry[], sourceDir: string, destDir: string): UndoableOperation {
  const paths = entries.map((e) => e.path)
  return {
    label: `Move ${entries.length} item${entries.length === 1 ? '' : 's'}`,
    undo: async () => {
      const movedPaths = entries.map((e) => `${destDir}${destDir.endsWith('\\') ? '' : '\\'}${e.name}`)
      await moveEntries(movedPaths, sourceDir, 'overwrite')
    },
    redo: async () => {
      await moveEntries(paths, destDir, 'overwrite')
    },
  }
}
