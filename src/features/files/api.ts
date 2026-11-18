import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Everything the Files app asks of the Rust side (src-tauri/src/files + the older file_explorer copy/move). */

export interface Entry {
  name: string
  path: string
  isDir: boolean
  size: number
  modifiedMs: number
  createdMs: number
  ext: string
  hidden: boolean
  system: boolean
  readonly: boolean
}

export interface TreeNode {
  name: string
  path: string
  hasChildren: boolean
  hidden: boolean
}

export interface Place {
  id: string
  name: string
  path: string
}

export interface Drive {
  name: string
  mount: string
  totalBytes: number
  freeBytes: number
  removable: boolean
}

export interface BinItem {
  id: string
  name: string
  originalPath: string
  deletedMs: number
  size: number | null
  isDir: boolean
}

export interface ArchiveEntry {
  path: string
  isDir: boolean
  size: number
  packed: number
  modifiedMs: number
}

export interface DupeGroup {
  size: number
  files: { path: string; modifiedMs: number }[]
}

export interface IndexStatus {
  ready: boolean
  building: boolean
  count: number
  builtMs: number
  roots: string[]
}

export interface Hit {
  path: string
  name: string
  isDir: boolean
  size: number
  modifiedMs: number
}

export type ConflictMode = 'keep_both' | 'overwrite' | 'skip'

const err = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong.')
export const errorText = err

export const fs = {
  list: (dir: string) => invoke<Entry[]>('files_list', { dir }),
  stat: (paths: string[]) => invoke<(Entry | null)[]>('files_stat', { paths }),
  subdirs: (dir: string) => invoke<TreeNode[]>('files_subdirs', { dir }),
  places: () => invoke<Place[]>('files_places'),
  drives: () => invoke<Drive[]>('file_explorer_drives'),
  thumb: (path: string, size = 256) => invoke<string>('files_thumb', { path, size }).then(convertFileSrc),
  text: (path: string) => invoke<string>('file_explorer_read_text_preview', { filePath: path }),
  dirSize: (path: string) => invoke<{ bytes: number; files: number; capped: boolean }>('file_explorer_dir_size', { path }),
  open: (path: string) => invoke<void>('file_explorer_open_with_system', { path }),
  reveal: (path: string) => invoke<void>('files_reveal', { path }),
  terminal: (dir: string) => invoke<void>('files_open_terminal', { dir }),
  watch: (dirs: string[]) => invoke<void>('files_watch', { dirs }),

  mkdir: (parentDir: string, name: string) => invoke<{ path: string; name: string }>('file_explorer_create_folder', { parentDir, name }),
  newFile: (parentDir: string, kind: 'text' | 'word' | 'excel' | 'power_point') => invoke<{ path: string; name: string }>('file_explorer_create_file', { parentDir, kind }),
  rename: (oldPath: string, newName: string) => invoke<{ path: string; name: string }>('file_explorer_rename', { oldPath, newName }),
  batchRename: (pairs: [string, string][]) => invoke<string[]>('files_batch_rename', { pairs }),
  duplicate: (path: string) => invoke<{ path: string; name: string }>('file_explorer_duplicate', { path }),
  conflicts: (sourcePaths: string[], destDir: string) => invoke<string[]>('file_explorer_check_conflicts', { sourcePaths, destDir }),
  copy: (sourcePaths: string[], destDir: string, conflictMode: ConflictMode, transferId: string) =>
    invoke<{ path: string }[]>('file_explorer_copy', { sourcePaths, destDir, conflictMode, transferId }),
  move: (sourcePaths: string[], destDir: string, conflictMode: ConflictMode, transferId: string) =>
    invoke<{ path: string }[]>('file_explorer_move', { sourcePaths, destDir, conflictMode, transferId }),
  deleteForever: (paths: string[]) => invoke<void>('file_explorer_delete', { paths }),

  recycle: (paths: string[]) => invoke<number>('files_recycle', { paths }),
  binList: () => invoke<BinItem[]>('files_bin_list'),
  binRestore: (ids: string[]) => invoke<void>('files_bin_restore', { ids }),
  binPurge: (ids: string[]) => invoke<void>('files_bin_purge', { ids }),
  binRestorePaths: (paths: string[], since: number) => invoke<void>('files_bin_restore_paths', { paths, since }),

  zipList: (path: string) => invoke<ArchiveEntry[]>('files_archive_list', { path }),
  zipRead: (path: string, inner: string, max = 200_000) => invoke<number[]>('files_archive_read', { path, inner, max }).then((b) => new Uint8Array(b)),
  zipExtract: (path: string, inner?: string[], dest?: string) => invoke<Entry>('files_archive_extract', { path, inner: inner ?? null, dest: dest ?? null }),
  compress: (paths: string[], destDir: string, name?: string) => invoke<Entry>('files_compress', { paths, destDir, name: name ?? null }),

  dupes: (root: string, minSize: number, includeHidden: boolean) => invoke<DupeGroup[]>('files_find_duplicates', { root, minSize, includeHidden }),
  dupesCancel: () => invoke<void>('files_dupes_cancel'),

  indexStatus: () => invoke<IndexStatus>('files_index_status'),
  indexBuild: (roots?: string[]) => invoke<void>('files_index_build', { roots: roots ?? null }),
  indexQuery: (query: string, limit = 400) => invoke<{ hits: Hit[]; total: number; status: IndexStatus }>('files_index_query', { query, limit }),
  indexTouch: (removed: string[], added: string[]) => invoke<void>('files_index_touch', { removed, added }).catch(() => {}),
}

export function on<T>(event: string, cb: (payload: T) => void): () => void {
  let un: UnlistenFn | undefined
  let dead = false
  void listen<T>(event, (e) => cb(e.payload)).then((u) => (dead ? u() : (un = u)))
  return () => {
    dead = true
    un?.()
  }
}

export { convertFileSrc }
