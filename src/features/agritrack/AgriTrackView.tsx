import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { WindowCloseIcon, SyncIcon } from '@/shared/icons'
import { ViewShell, ViewHeader, ViewBody } from '@/shared/components/ui/view'
import { Button } from '@/shared/components/ui/button'

// deck.gl + maplibre are a large module graph, and the table view is
// the one people open to check a collector run — no reason to pay for
// the map's bundle until someone actually switches to it.
const AgriTrackMap = lazy(() =>
  import('./AgriTrackMap').then((m) => ({ default: m.AgriTrackMap })),
)
import {
  listTables,
  queryTable,
  runCollectorNow,
  type AgriTrackRow,
} from '@/integrations/agritrack/client'

interface AgriTrackViewProps {
  onClose: () => void
}

/** Tables that carry a date column, and so respond to the date filter. */
const DATED_TABLES = new Set([
  'daily_weather',
  'daily_crop_telemetry',
  'daily_economic',
  'disease_bulletins',
  'collection_log',
])

/** Tables the province filter applies to (the Rust side joins locations in). */
const PROVINCE_TABLES = new Set([
  'crops',
  'daily_weather',
  'daily_crop_telemetry',
  'historical_climate_normals',
])

/** Tables the crop filter applies to. */
const CROP_TABLES = new Set([
  'daily_crop_telemetry',
  'soil_properties',
  'crop_water_coefficients',
  'crop_yield_history',
])

/** Turns `daily_crop_telemetry` into `Daily crop telemetry` for the tab strip. */
function humanise(table: string): string {
  const spaced = table.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Renders a cell honestly rather than prettily. A NULL is the single most
 * important thing to be able to see in this view — it's the difference
 * between "the API returned zero" and "we never got a value" — so it
 * reads as a dim em-dash rather than being blanked or coerced to 0.
 */
function formatCell(value: AgriTrackRow[string]): { text: string; muted: boolean } {
  if (value === null || value === undefined) return { text: '—', muted: true }
  if (typeof value === 'number') {
    return { text: Number.isInteger(value) ? String(value) : value.toFixed(3), muted: false }
  }
  if (typeof value === 'boolean') return { text: value ? 'yes' : 'no', muted: false }
  return { text: String(value), muted: false }
}

/**
 * AgriTrack — a raw table browser over the agricultural collection
 * database. Deliberately plain: this exists to verify that the collector
 * is writing correct data, so it shows rows as they are, with no charts,
 * no map, and no aggregation that could paper over a bad value.
 */
export function AgriTrackView({ onClose }: AgriTrackViewProps) {
  const [tables, setTables] = useState<string[]>([])
  const [activeTable, setActiveTable] = useState('daily_weather')
  const [rows, setRows] = useState<AgriTrackRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [province, setProvince] = useState('')
  const [cropName, setCropName] = useState('')

  const [mode, setMode] = useState<'table' | 'map'>('table')
  const [collecting, setCollecting] = useState(false)
  const [collectResult, setCollectResult] = useState<string | null>(null)

  // Filter option lists are read from the reference tables rather than
  // hardcoded, so they stay correct if the Rust seeder's crop list changes.
  const [provinceOptions, setProvinceOptions] = useState<string[]>([])
  const [cropOptions, setCropOptions] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [names, locations, crops] = await Promise.all([
          listTables(),
          queryTable('locations', { limit: 100 }),
          queryTable('crops', { limit: 200 }),
        ])
        if (cancelled) return
        setTables(names)
        setProvinceOptions(
          [...new Set(locations.map((r) => String(r.province)))].sort(),
        )
        setCropOptions([...new Set(crops.map((r) => String(r.crop_name)))].sort())
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await queryTable(activeTable, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        province: province || undefined,
        cropName: cropName || undefined,
        limit: 500,
      })
      setRows(result)
    } catch (err) {
      setError(String(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [activeTable, dateFrom, dateTo, province, cropName])

  useEffect(() => {
    void load()
  }, [load])

  const handleCollect = useCallback(async () => {
    setCollecting(true)
    setCollectResult(null)
    try {
      const log = await runCollectorNow()
      const failed = log.sources_failed
      setCollectResult(
        failed
          ? `Ran with failures — ${String(log.notes ?? '')} (failed: ${String(failed)})`
          : `Collected ${String(log.run_date ?? '')} — ${String(log.notes ?? 'done')}`,
      )
      await load()
    } catch (err) {
      setCollectResult(`Collector failed: ${String(err)}`)
    } finally {
      setCollecting(false)
    }
  }, [load])

  // Column order comes from the first row's key order, which mirrors the
  // SELECT in store.rs — schema order, with joined names appended.
  const columns = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows])

  const showDate = DATED_TABLES.has(activeTable)
  const showProvince = PROVINCE_TABLES.has(activeTable)
  const showCrop = CROP_TABLES.has(activeTable)

  return (
    <ViewShell>
      <ViewHeader
        title="AgriTrack"
        subtitle="South African agricultural collection — raw table view"
        actions={
          <>
            <div className="mr-1 flex rounded-md border border-[var(--border-hairline)] p-0.5">
              {(['table', 'map'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={
                    mode === m
                      ? 'rounded bg-[var(--surface-overlay)] px-3 py-1 text-xs capitalize text-text-primary'
                      : 'rounded px-3 py-1 text-xs capitalize text-text-tertiary hover:text-text-primary'
                  }
                >
                  {m}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="pill" onClick={handleCollect} disabled={collecting}>
              <SyncIcon className={collecting ? 'animate-spin' : undefined} />
              {collecting ? 'Collecting…' : 'Collect now'}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close AgriTrack">
              <WindowCloseIcon />
            </Button>
          </>
        }
      />

      {/* `[&>*]:h-full` forces the Suspense child to fill this flex
          item: the map sizes its canvas from the container's measured
          height, and a bare flex child leaves that at auto. */}
      {mode === 'map' ? (
        <div className="min-h-0 flex-1 px-8 pb-8 [&>*]:h-full">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
              </div>
            }
          >
            <AgriTrackMap />
          </Suspense>
        </div>
      ) : (
      <ViewBody>
        {/* Table selector */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tables.map((table) => (
            <button
              key={table}
              type="button"
              onClick={() => setActiveTable(table)}
              className={
                table === activeTable
                  ? 'rounded-md border border-[var(--border-strong)] bg-[var(--surface-overlay)] px-3 py-1.5 text-xs text-text-primary'
                  : 'rounded-md border border-transparent px-3 py-1.5 text-xs text-text-tertiary hover:bg-white/[0.07] hover:text-text-primary'
              }
            >
              {humanise(table)}
            </button>
          ))}
        </div>

        {/* Filters — only those that mean anything for the active table */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {showDate && (
            <>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-text-primary"
                />
              </label>
            </>
          )}
          {showProvince && (
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Province
              <select
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-text-primary"
              >
                <option value="">All</option>
                {provinceOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showCrop && (
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Crop
              <select
                value={cropName}
                onChange={(e) => setCropName(e.target.value)}
                className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-text-primary"
              >
                <option value="">All</option>
                {cropOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(dateFrom || dateTo || province || cropName) && (
            <Button
              variant="ghost"
              size="pill-sm"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
                setProvince('')
                setCropName('')
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {collectResult && (
          <p className="mb-3 text-xs text-text-secondary">{collectResult}</p>
        )}
        {error && (
          <p className="mb-3 text-xs text-[var(--color-danger)]">{error}</p>
        )}

        <p className="mb-2 text-xs text-text-tertiary">
          {loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
          {rows.length === 500 && ' (limit reached — narrow the filters)'}
        </p>

        {/* A wide table must scroll inside its own box; the view itself
            never scrolls sideways. */}
        <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)]">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[var(--surface-raised)]">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap border-b border-[var(--border-hairline)] px-3 py-2 text-left font-medium text-text-secondary"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-white/[0.04]">
                  {columns.map((col) => {
                    const { text, muted } = formatCell(row[col])
                    return (
                      <td
                        key={col}
                        className={`whitespace-nowrap border-b border-[var(--border-hairline)] px-3 py-1.5 ${
                          muted ? 'text-text-tertiary' : 'text-text-primary'
                        }`}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-text-tertiary">
              No rows. Run the collector to populate the daily tables.
            </p>
          )}
        </div>
      </ViewBody>
      )}
    </ViewShell>
  )
}
