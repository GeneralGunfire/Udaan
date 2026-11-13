export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  sizeBytes: number
  modifiedMs: number
  createdMs: number
  extension: string
}

export interface QuickAccessLocation {
  name: string
  path: string
}

export type NewFileKind = 'text' | 'word' | 'excel' | 'power_point'

export type ConflictMode = 'keep_both' | 'overwrite' | 'skip'

export interface TrashedEntry {
  originalPath: string
  trashPath: string
}

export interface TransferProgress {
  transferId: string
  done: number
  total: number
  currentName: string
}
