export type { FileEntry, QuickAccessLocation } from '@/integrations/file-explorer/types'

export type ExplorerViewMode = 'list' | 'grid'

export type SortColumn = 'name' | 'modified' | 'size' | 'type'

export type SortDirection = 'asc' | 'desc'

export interface ClipboardState {
  paths: string[]
  mode: 'copy' | 'cut'
}
