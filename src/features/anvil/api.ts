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

export const anvilSources = () => invoke<SourceStatus[]>('anvil_sources')
export const anvilSchema = (source: string) => invoke<SchemaInfo>('anvil_schema', { source })
export const anvilQuery = (source: string, sql: string) => invoke<QueryResult>('anvil_query', { source, sql })

export const count = (n: number | null) => (n === null ? '–' : n.toLocaleString())
export const size = (mb: number | null) => (mb === null ? '–' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(2)} MB`)

/** Tauri rejects with a string; anything else becomes a plain message. */
export const reason = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong')
