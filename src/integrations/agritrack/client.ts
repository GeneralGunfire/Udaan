import { invoke } from '@tauri-apps/api/core'

/**
 * Rows come back as untyped JSON maps rather than a per-table interface:
 * the table view renders whatever columns a table happens to have, and
 * the Rust side already joins province/crop names in, so a shared shape
 * here would only get in the way of that.
 */
export type AgriTrackRow = Record<string, string | number | boolean | null>

export interface AgriTrackFilters {
  dateFrom?: string
  dateTo?: string
  province?: string
  cropName?: string
  limit?: number
}

/** Every table the store owns, in schema order — the query allowlist. */
export async function listTables(): Promise<string[]> {
  return invoke<string[]>('agritrack_list_tables')
}

/**
 * Read one table, optionally filtered. Filters that don't apply to the
 * requested table are ignored server-side rather than erroring, so the
 * view can keep a single filter bar mounted while the user switches
 * between tables that support different subsets of it.
 */
export async function queryTable(
  table: string,
  filters: AgriTrackFilters = {},
): Promise<AgriTrackRow[]> {
  return invoke<AgriTrackRow[]>('agritrack_query_table', {
    table,
    dateFrom: filters.dateFrom ?? null,
    dateTo: filters.dateTo ?? null,
    province: filters.province ?? null,
    cropName: filters.cropName ?? null,
    limit: filters.limit ?? 500,
  })
}

/** Every date that has weather data, ascending — the map slider's domain. */
export async function availableDates(): Promise<string[]> {
  return invoke<string[]>('agritrack_available_dates')
}

/** One row per province for a date, crop telemetry already aggregated. */
export async function provinceSnapshot(date: string): Promise<AgriTrackRow[]> {
  return invoke<AgriTrackRow[]>('agritrack_province_snapshot', { date })
}

/** Per-crop rows for one province on one date — the detail panel. */
export async function cropDetail(province: string, date: string): Promise<AgriTrackRow[]> {
  return invoke<AgriTrackRow[]>('agritrack_crop_detail', { province, date })
}

/**
 * Runs the Python collector once and resolves with the `collection_log`
 * row it wrote. Slow by nature — it makes live calls to Open-Meteo and
 * NASA POWER, and on a first run also seeds ten years of climate
 * normals — so callers should show a pending state rather than assume
 * this returns promptly.
 */
export async function runCollectorNow(): Promise<AgriTrackRow> {
  return invoke<AgriTrackRow>('agritrack_run_collector_now')
}
