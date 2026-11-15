import { invoke } from '@tauri-apps/api/core'

/** What Anvil's Rust side returns. Counts, names, sizes and states; query results are the only place values appear. */

export interface SourceStatus {
  id: string
  name: string
  engine: string
  location: string
  service: string | null
  serviceState: string | null
  up: boolean
  version: string | null
  sizeMb: number | null
  logMb: number | null
  tables: number | null
  rows: number | null
  note: string | null
  measuredAtMs: number
}

export interface Column {
  name: string
  dataType: string
  nullable: boolean
  key: boolean
}

export interface TableInfo {
  schema: string
  name: string
  rows: number | null
  fksOut: number
  columns: Column[]
}

export interface SchemaInfo {
  source: string
  tables: TableInfo[]
}

export interface QueryResult {
  columns: string[]
  rows: string[][]
  truncated: boolean
  elapsedMs: number
}

export interface LinkInfo {
  id: string
  label: string
  from: string
  to: string
  how: string
  forgedValues: number
  forgedResolved: number
}

export interface LinkResult {
  id: string
  values: number
  resolved: number
  distinctValues: number
  distinctResolved: number
  share: number
  agrees: boolean
  error: string | null
  measuredAtMs: number
}

export interface HistoryPoint {
  id: string
  atMs: number
  values: number
  resolved: number
}

export const anvilLinkList = () => invoke<LinkInfo[]>('anvil_link_list')
export const anvilLinkMeasure = (id: string) => invoke<LinkResult>('anvil_link_measure', { id })
export const anvilLinkHistory = () => invoke<HistoryPoint[]>('anvil_link_history')

export interface BackupFile {
  name: string
  folder: string
  sourceId: string | null
  sourceName: string | null
  label: string
  bytes: number
  modifiedMs: number
}

export interface Snapshot {
  folder: string
  files: number
  bytes: number
  hasManifest: boolean
  modifiedMs: number
}

export interface BackupList {
  files: BackupFile[]
  snapshots: Snapshot[]
  rootFound: boolean
}

export interface Draft {
  id: number
  createdMs: number
  db: string
  kind: string
  title: string
  summary: string
  detail: string
  status: 'pending' | 'approved' | 'rejected'
}

export const FORGED_SLUGS = ['estate', 'private_hospital', 'public_hospital', 'hprs', 'hpcsa', 'mfl_dhis2', 'cms', 'sanc', 'nhls', 'icd10', 'nappi', 'nrpl'] as const
export const FORGED_TYPES = ['Note', 'Action', 'Decision', 'Error', 'Fix', 'Response'] as const

export const anvilBackups = () => invoke<BackupList>('anvil_backups')
export const forgedDraft = (source: string, kind: string, title: string, summary: string, detail: string) => invoke<number>('anvil_forged_draft', { source, kind, title, summary, detail })
export const forgedList = () => invoke<Draft[]>('anvil_forged_list')
export const forgedDecide = (id: number, status: Draft['status']) => invoke<void>('anvil_forged_decide', { id, status })
export const forgedDelete = (id: number) => invoke<void>('anvil_forged_delete', { id })

export const bytesLabel = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`)
export const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const anvilSources = () => invoke<SourceStatus[]>('anvil_sources')
export const anvilSchema = (source: string) => invoke<SchemaInfo>('anvil_schema', { source })
export const anvilQuery = (source: string, sql: string) => invoke<QueryResult>('anvil_query', { source, sql })

export const count = (n: number | null) => (n === null ? '–' : n.toLocaleString())
export const size = (mb: number | null) => (mb === null ? '–' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(2)} MB`)

/** Tauri rejects with a string; anything else becomes a plain message. */
export const reason = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong')
