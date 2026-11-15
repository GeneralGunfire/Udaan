import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ConflictMode, FileEntry, NewFileKind, QuickAccessLocation, TrashedEntry, TransferProgress } from './types'

interface RawDirEntry {
  name: string
  path: string
  is_dir: boolean
  size_bytes: number
  modified_ms: number
  created_ms: number
  extension: string
}

function fromRaw(raw: RawDirEntry): FileEntry {
  return {
    name: raw.name,
    path: raw.path,
    isDir: raw.is_dir,
    sizeBytes: raw.size_bytes,
    modifiedMs: raw.modified_ms,
    createdMs: raw.created_ms,
    extension: raw.extension,
  }
}

export async function listDir(dirPath: string): Promise<FileEntry[]> {
  const raw = await invoke<RawDirEntry[]>('file_explorer_list_dir', { dirPath })
  return raw.map(fromRaw)
}

export async function searchDir(dirPath: string, query: string, recursive: boolean): Promise<FileEntry[]> {
  const raw = await invoke<RawDirEntry[]>('file_explorer_search', { dirPath, query, recursive })
  return raw.map(fromRaw)
}

export async function createFolder(parentDir: string, name: string): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_create_folder', { parentDir, name })
  return fromRaw(raw)
}

export async function createFile(parentDir: string, kind: NewFileKind): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_create_file', { parentDir, kind })
  return fromRaw(raw)
}

export async function renameEntry(oldPath: string, newName: string): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_rename', { oldPath, newName })
  return fromRaw(raw)
}

export async function deleteEntries(paths: string[]): Promise<void> {
  await invoke('file_explorer_delete', { paths })
}

/** Moves entries into the app's hidden trash directory instead of deleting them outright — reversible via `restoreFromTrash`. */
export async function softDeleteEntries(paths: string[]): Promise<TrashedEntry[]> {
  const raw = await invoke<{ original_path: string; trash_path: string }[]>('file_explorer_soft_delete', { paths })
  return raw.map((r) => ({ originalPath: r.original_path, trashPath: r.trash_path }))
}

export async function restoreFromTrash(trashPath: string, originalPath: string): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_restore', { trashPath, originalPath })
  return fromRaw(raw)
}

export async function copyEntries(
  sourcePaths: string[],
  destDir: string,
  conflictMode: ConflictMode = 'keep_both',
  transferId: string = crypto.randomUUID(),
): Promise<FileEntry[]> {
  const raw = await invoke<RawDirEntry[]>('file_explorer_copy', { sourcePaths, destDir, conflictMode, transferId })
  return raw.map(fromRaw)
}

export async function moveEntries(
  sourcePaths: string[],
  destDir: string,
  conflictMode: ConflictMode = 'keep_both',
  transferId: string = crypto.randomUUID(),
): Promise<FileEntry[]> {
  const raw = await invoke<RawDirEntry[]>('file_explorer_move', { sourcePaths, destDir, conflictMode, transferId })
  return raw.map(fromRaw)
}

/** Subscribes to progress events for in-flight copy/move transfers. Every event carries its own `transferId` so callers can ignore events from a transfer they're no longer tracking. */
export async function onTransferProgress(callback: (progress: TransferProgress) => void): Promise<() => void> {
  const unlisten = await listen<{
    transfer_id: string
    done: number
    total: number
    current_name: string
  }>('file-explorer://transfer-progress', (event) => {
    callback({
      transferId: event.payload.transfer_id,
      done: event.payload.done,
      total: event.payload.total,
      currentName: event.payload.current_name,
    })
  })
  return unlisten
}

export async function zipEntries(paths: string[], destDir: string): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_zip', { paths, destDir })
  return fromRaw(raw)
}

export async function unzipEntry(path: string): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_unzip', { path })
  return fromRaw(raw)
}

export async function duplicateEntry(path: string): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_duplicate', { path })
  return fromRaw(raw)
}

/** Returns the subset of `sourcePaths` whose name would collide with an existing entry in `destDir`. */
export async function checkConflicts(sourcePaths: string[], destDir: string): Promise<string[]> {
  return invoke<string[]>('file_explorer_check_conflicts', { sourcePaths, destDir })
}

export async function readFileBytes(filePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('file_explorer_read_file', { filePath })
  return new Uint8Array(bytes)
}

/** Decoded + downsized thumbnail bytes (JPEG) — use this instead of `readFileBytes` for grid-view tiles so a large original image is never pulled across IPC just to render a small thumbnail. */
export async function readThumbnailBytes(filePath: string, maxDimension = 160): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await invoke<number[]>('file_explorer_read_thumbnail', { filePath, maxDimension })
  return new Uint8Array(bytes)
}

export async function readTextPreview(filePath: string): Promise<string> {
  return invoke<string>('file_explorer_read_text_preview', { filePath })
}

export async function openWithSystem(path: string): Promise<void> {
  await invoke('file_explorer_open_with_system', { path })
}

export async function getQuickAccess(): Promise<QuickAccessLocation[]> {
  return invoke<QuickAccessLocation[]>('file_explorer_quick_access')
}

export async function statPath(path: string): Promise<FileEntry> {
  const raw = await invoke<RawDirEntry>('file_explorer_stat', { path })
  return fromRaw(raw)
}
