import { useEffect, useRef, useState } from 'react'
import { Button } from '@/os/ui/controls'
import { anvilQuery, count, reason, type QueryResult, type SourceStatus } from './api'
import { SourcePicker } from './SourcePicker'

/**
 * The safe query console. One SELECT or WITH statement at a time, read-only, with a time limit and a row cap.
 * Results appear here only: nothing is exported, logged or kept, and they vanish when Work locks.
 */
export function Query({ sources, initialSource, initialSql }: { sources: SourceStatus[] | null; initialSource: string; initialSql: string }) {
  const [source, setSource] = useState(initialSource)
  const [sql, setSql] = useState(initialSql)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useRef(0)

  // "Query this table" in the browser hands over a starting statement.
  useEffect(() => {
    setSource(initialSource)
    setSql(initialSql)
  }, [initialSource, initialSql])

  const execute = async () => {
    if (busy || !sql.trim()) return
    const mine = ++run.current
    setBusy(true)
    setError(null)
    try {
      const r = await anvilQuery(source, sql)
      if (run.current === mine) setResult(r)
    } catch (e) {
      if (run.current === mine) {
        setResult(null)
        setError(reason(e))
      }
    } finally {
      if (run.current === mine) setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-(--u-edge) p-3">
        <div className="flex items-center gap-2">
          <SourcePicker sources={sources} value={source} onChange={setSource} />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-(--u-ink-3)">Read-only · one SELECT or WITH · 500 rows · 20 seconds · nothing is saved</span>
          <Button
            variant="tinted"
            disabled={busy || !result && !error}
            onClick={() => {
              run.current++
              setResult(null)
              setError(null)
              setBusy(false)
            }}
          >
            Clear
          </Button>
          <Button variant="primary" disabled={busy || !sql.trim()} onClick={() => void execute()}>
            {busy ? 'Running…' : 'Run'}
          </Button>
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void execute()
            }
          }}
          spellCheck={false}
          rows={5}
          placeholder="SELECT …   (Ctrl+Enter to run)"
          className="u-scroll w-full resize-none rounded-[10px] bg-(--u-wash-on) p-3 font-mono text-[12.5px] leading-[1.5] text-(--u-ink) outline-none placeholder:text-(--u-ink-3)"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p className="p-5 text-[13px] text-(--u-danger)">{error}</p>}
        {!error && !result && <p className="p-5 text-[12.5px] text-(--u-ink-3)">{busy ? 'Running…' : 'Results show here. Counts and structure are safe to share; rows are not: they stay in this window.'}</p>}
        {result && (
          <table className="w-max min-w-full border-separate border-spacing-0 text-left text-[12.5px]">
            <thead className="sticky top-0 bg-(--u-bg)">
              <tr>
                <th className="w-12 border-b border-(--u-edge) px-3 py-2 text-right text-[11px] font-medium text-(--u-ink-3)">#</th>
                {result.columns.map((c, i) => (
                  <th key={i} className="whitespace-nowrap border-b border-(--u-edge) px-3 py-2 text-[11.5px] font-medium text-(--u-ink-3)">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i} className="hover:bg-(--u-wash-on)">
                  <td className="px-3 py-1.5 text-right text-[11px] tabular-nums text-(--u-ink-3)">{i + 1}</td>
                  {r.map((v, j) => (
                    <td key={j} className="max-w-[360px] truncate whitespace-nowrap px-3 py-1.5 tabular-nums text-(--u-ink)" title={v}>
                      {v === 'NULL' ? <span className="text-(--u-ink-3)">NULL</span> : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {result && (
        <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-(--u-edge) px-4 text-[11.5px] text-(--u-ink-3)">
          <span>
            {count(result.rows.length)} {result.rows.length === 1 ? 'row' : 'rows'}
            {result.truncated ? ' (more exist: the first 500 are shown)' : ''}
          </span>
          <span>· {result.elapsedMs} ms</span>
        </footer>
      )}
    </div>
  )
}
