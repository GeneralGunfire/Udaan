import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { anvilLinkHistory, anvilLinkList, anvilLinkMeasure, count, reason, type HistoryPoint, type LinkInfo, type LinkResult } from './api'

const COLS = 'grid-cols-[minmax(0,2.2fr)_88px_88px_minmax(120px,1.2fr)_minmax(0,1.3fr)_96px]'
const CONCURRENCY = 3

/**
 * The link checker: how many values in one source resolve in another, measured now, next to what DEXA Forged
 * says. Values are compared inside Udaan's memory and dropped; only counts are shown or kept.
 */
export function Links() {
  const [links, setLinks] = useState<LinkInfo[] | null>(null)
  const [results, setResults] = useState<Record<string, LinkResult>>({})
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const loadHistory = useCallback(async () => {
    try {
      const pts = await anvilLinkHistory()
      const by: Record<string, HistoryPoint[]> = {}
      for (const p of pts) (by[p.id] ??= []).push(p)
      if (alive.current) setHistory(by)
    } catch {
      /* the trend is optional */
    }
  }, [])

  useEffect(() => {
    alive.current = true
    anvilLinkList().then(
      (l) => alive.current && setLinks(l),
      (e) => alive.current && setError(reason(e)),
    )
    void loadHistory()
    return () => {
      alive.current = false
    }
  }, [loadHistory])

  const measureOne = useCallback(
    async (id: string) => {
      setRunning((s) => new Set(s).add(id))
      try {
        const r = await anvilLinkMeasure(id)
        if (alive.current) setResults((m) => ({ ...m, [id]: r }))
      } catch (e) {
        if (alive.current) setResults((m) => ({ ...m, [id]: { id, values: 0, resolved: 0, distinctValues: 0, distinctResolved: 0, share: 0, agrees: false, error: reason(e), measuredAtMs: Date.now() } }))
      } finally {
        if (alive.current)
          setRunning((s) => {
            const n = new Set(s)
            n.delete(id)
            return n
          })
      }
    },
    [],
  )

  const measureAll = useCallback(async () => {
    if (!links) return
    const queue = links.map((l) => l.id)
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await measureOne(id)
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    void loadHistory()
  }, [links, measureOne, loadHistory])

  const measured = Object.keys(results).length
  const agreeing = Object.values(results).filter((r) => !r.error && r.agrees).length
  const differing = Object.values(results).filter((r) => !r.error && !r.agrees).length
  const failed = Object.values(results).filter((r) => r.error).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-(--u-edge) px-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold leading-tight">Links</h1>
          <p className="truncate text-[11.5px] text-(--u-ink-3)">
            {error ?? (measured === 0 ? 'How many values in one source resolve in another, checked against DEXA Forged' : `${agreeing} agree with Forged · ${differing} differ${failed ? ` · ${failed} could not be measured` : ''}`)}
          </p>
        </div>
        <Button variant="primary" disabled={!links || running.size > 0} onClick={() => void measureAll()}>
          {running.size > 0 ? `Measuring ${running.size}…` : measured ? 'Measure again' : 'Measure all'}
        </Button>
      </header>

      <div className={cn('grid h-9 shrink-0 items-center gap-3 border-b border-(--u-edge) px-5 text-[11px] font-medium uppercase tracking-wide text-(--u-ink-3)', COLS)}>
        <span>Link</span>
        <span className="text-right">Values</span>
        <span className="text-right">Resolve</span>
        <span>Share</span>
        <span>Forged says</span>
        <span className="text-right">Since last</span>
      </div>

      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {(links ?? []).map((l) => {
          const r = results[l.id]
          const busy = running.has(l.id)
          const hist = history[l.id] ?? []
          // The measurement before the one on screen: the last stored one, or the one before that when this run is already stored.
          const prev = r && hist.length >= 2 ? hist[hist.length - 2] : !r && hist.length ? hist[hist.length - 1] : null
          const delta = r && !r.error && prev ? r.resolved - prev.resolved : null
          return (
            <div key={l.id} className={cn('grid min-h-[56px] items-center gap-3 rounded-[10px] px-3 py-2 hover:bg-(--u-wash-on)', COLS)}>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{l.label}</p>
                <p className="truncate text-[11.5px] text-(--u-ink-3)" title={l.how}>
                  {l.from} → {l.to} · {l.how}
                </p>
              </div>
              <p className="text-right text-[12.5px] tabular-nums">{busy ? '…' : r && !r.error ? count(r.values) : '–'}</p>
              <p className="text-right text-[12.5px] tabular-nums">{busy ? '…' : r && !r.error ? count(r.resolved) : '–'}</p>
              <div className="flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--u-wash-press)">
                  <span className="block h-full rounded-full bg-(--u-accent) transition-[width] duration-500" style={{ width: `${r && !r.error ? Math.max(r.share, r.share > 0 ? 1.5 : 0) : 0}%` }} />
                </span>
                <span className="w-12 text-right text-[12px] tabular-nums text-(--u-ink-2)">{r && !r.error ? `${r.share.toFixed(1)}%` : ''}</span>
              </div>
              <div className="min-w-0">
                {r?.error ? (
                  <p className="truncate text-[12px] text-(--u-danger)" title={r.error}>
                    {r.error}
                  </p>
                ) : (
                  <>
                    <p className="truncate text-[12.5px] tabular-nums text-(--u-ink-2)">
                      {count(l.forgedResolved)} of {count(l.forgedValues)}
                    </p>
                    {r && <p className={cn('text-[11px]', r.agrees ? 'text-(--u-ok)' : 'text-(--u-danger)')}>{r.agrees ? 'Agrees' : 'Differs'}</p>}
                  </>
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <span className="text-[11.5px] tabular-nums text-(--u-ink-3)">{delta === null ? '' : delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${count(delta)}`}</span>
                <button type="button" disabled={busy} onClick={() => void measureOne(l.id)} className="u-btn u-btn--ghost h-7 px-2 text-[11.5px]" aria-label={`Measure ${l.label}`}>
                  ↻
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
