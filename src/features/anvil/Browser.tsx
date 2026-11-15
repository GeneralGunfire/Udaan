import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { anvilSchema, count, reason, type SchemaInfo, type SourceStatus, type TableInfo } from './api'
import { SourcePicker } from './SourcePicker'

/** The schema browser: tables, columns, types, keys and row counts. Structure only, no data. */
export function Browser({ sources, initial, onQuery }: { sources: SourceStatus[] | null; initial: string; onQuery: (source: string, sql: string) => void }) {
  const [source, setSource] = useState(initial)
  const [schema, setSchema] = useState<SchemaInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setSchema(null)
    setError(null)
    setPicked(null)
    anvilSchema(source).then(
      (s) => live && setSchema(s),
      (e) => live && setError(reason(e)),
    )
    return () => {
      live = false
    }
  }, [source])

  const q = filter.trim().toLowerCase()
  const tables = useMemo(() => (schema?.tables ?? []).filter((t) => !q || `${t.schema}.${t.name}`.toLowerCase().includes(q)), [schema, q])
  const table: TableInfo | undefined = schema?.tables.find((t) => `${t.schema}.${t.name}` === picked)
  const keyOf = (t: TableInfo) => `${t.schema}.${t.name}`

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-[300px] shrink-0 flex-col border-r border-(--u-edge)">
        <div className="flex flex-col gap-2 border-b border-(--u-edge) p-3">
          <SourcePicker sources={sources} value={source} onChange={setSource} className="w-full" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={schema ? `Filter ${schema.tables.length} tables` : 'Filter tables'}
            spellCheck={false}
            className="h-8 rounded-[8px] bg-(--u-wash-on) px-3 text-[13px] text-(--u-ink) outline-none placeholder:text-(--u-ink-3)"
          />
        </div>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {!schema && !error && <p className="p-4 text-[12.5px] text-(--u-ink-3)">Reading the structure…</p>}
          {error && <p className="p-4 text-[12.5px] text-(--u-ink-3)">{error}</p>}
          {schema && tables.length === 0 && <p className="p-4 text-[12.5px] text-(--u-ink-3)">No table matches.</p>}
          {tables.map((t) => (
            <button key={keyOf(t)} type="button" data-selected={picked === keyOf(t) || undefined} onClick={() => setPicked(keyOf(t))} className="u-row h-auto w-full justify-between gap-2 px-3 py-1.5 text-left">
              <span className="min-w-0 truncate text-[12.5px]">
                {t.schema !== 'main' && t.schema !== 'file' && <span className="text-(--u-ink-3)">{t.schema}.</span>}
                {t.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-(--u-ink-3)">{count(t.rows)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        {!table ? (
          <p className="m-auto text-[13px] text-(--u-ink-3)">{schema ? 'Pick a table to see its columns.' : ' '}</p>
        ) : (
          <>
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-(--u-edge) px-5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[14px] font-semibold">
                  {table.schema}.{table.name}
                </h2>
                <p className="text-[11.5px] text-(--u-ink-3)">
                  {count(table.rows)} rows · {table.columns.length} columns · {table.fksOut} foreign {table.fksOut === 1 ? 'key' : 'keys'} out
                </p>
              </div>
              <button
                type="button"
                className="u-btn u-btn--tonal h-8 px-3 text-[12.5px]"
                onClick={() => {
                  const name = table.schema === 'main' || table.schema === 'file' ? `"${table.name}"` : table.schema === 'dbo' || table.schema === 'public' ? table.name : `${table.schema}.${table.name}`
                  onQuery(source, `SELECT * FROM ${name}`)
                }}
              >
                Query this table
              </button>
            </header>
            <div className="grid h-9 shrink-0 grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_80px_56px] items-center gap-3 border-b border-(--u-edge) px-5 text-[11px] font-medium uppercase tracking-wide text-(--u-ink-3)">
              <span>Column</span>
              <span>Type</span>
              <span>Empty OK</span>
              <span>Key</span>
            </div>
            <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1">
              {table.columns.map((c) => (
                <div key={c.name} className={cn('grid min-h-9 grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_80px_56px] items-center gap-3 rounded-[8px] px-3 py-1.5 hover:bg-(--u-wash-on)')}>
                  <span className="truncate text-[12.5px] font-medium">{c.name}</span>
                  <span className="truncate text-[12.5px] tabular-nums text-(--u-ink-2)">{c.dataType}</span>
                  <span className="text-[12.5px] text-(--u-ink-2)">{c.nullable ? 'Yes' : 'No'}</span>
                  <span className="text-[12.5px] text-(--u-ink-2)">{c.key ? 'PK' : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
