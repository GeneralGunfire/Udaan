import type { FileEntry } from '@/integrations/file-explorer/types'
import type { SortColumn, SortDirection } from './types'

/** Folders always sort before files, regardless of column/direction — matches Explorer. */
export function sortEntries(entries: FileEntry[], column: SortColumn, direction: SortDirection): FileEntry[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    switch (column) {
      case 'name':
        return sign * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      case 'modified':
        return sign * (a.modifiedMs - b.modifiedMs)
      case 'size':
        return sign * (a.sizeBytes - b.sizeBytes)
      case 'type':
        return sign * a.extension.localeCompare(b.extension)
      default:
        return 0
    }
  })
}
