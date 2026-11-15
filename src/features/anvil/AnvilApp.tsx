import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useProfile } from '@/os/kernel/profile'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { anvilSources, count, size, type SourceStatus } from './api'
import { Browser } from './Browser'
import { Backups } from './Backups'
import { Forged } from './Forged'
import { Links } from './Links'
import { Query } from './Query'

/**
 * ANVIL: the Work-mode console for the company's database estate.
 * Read-only, counts and descriptions only. Nothing measured here is stored, and everything on screen is
 * dropped the moment Work is left or locked (the content below is remounted, so query results cannot linger).
 */

type View = 'sources' | 'browser' | 'query' | 'links' | 'backups' | 'forged'

const RAIL: { id: View; label: string; ready: boolean }[] = [
  { id: 'sources', label: 'Sources', ready: true },
  { id: 'browser', label: 'Browser', ready: true },
  { id: 'query', label: 'Query', ready: true },
  { id: 'links', label: 'Links', ready: true },
  { id: 'backups', label: 'Backups', ready: true },
  { id: 'forged', label: 'Forged', ready: true },
]

const COLS = 'grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_88px_88px_104px_28px]'

export function AnvilApp() {
  const profile = useProfile()
  // Bumped whenever Work locks: the views remount and every result, table and filter is gone.
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    const un = listen('work://locked', () => setEpoch((n) => n + 1))
    return () => void un.then((fn) => fn())
  }, [])

  if (profile !== 'work') {
    return (
      <div className="flex h-full items-center justify-center bg-(--u-bg) p-8 text-center text-(--u-ink)">
        <div>
          <p className="text-[15px] font-semibold">Anvil opens in Work only</p>
          <p className="mt-1 text-[12.5px] text-(--u-ink-3)">Switch to Work from Start, then open it again.</p>
        </div>
      </div>
    )
  }
  return <Console key={epoch} />
}

function Console() {
  const [view, setView] = useState<View>('sources')
  const [sources, setSources] = useState<SourceStatus[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // "Query this table" in the browser fills the console and switches to it.
  const [handoff, setHandoff] = useState<{ source: string; sql: string }>({ source: 'private_hospital', sql: '' })

  const refresh = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      setSources(await anvilSources())
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const servers = (sources ?? []).filter((s) => s.service)
  const running = servers.filter((s) => s.serviceState === 'running').length
  const measured = sources?.[0]?.measuredAtMs

  return (
    <div className="flex h-full bg-(--u-bg) text-(--u-ink)">
      <nav className="flex w-[188px] shrink-0 flex-col gap-0.5 border-r border-(--u-edge) p-3" aria-label="Anvil sections">
        <p className="u-label px-2 pb-2 pt-1">Anvil</p>
        {RAIL.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={!r.ready}
            data-selected={view === r.id || undefined}
            onClick={() => setView(r.id)}
            className="u-row h-9 justify-between px-3 text-left text-[13px] disabled:cursor-default disabled:opacity-45"
          >
            {r.label}
            {!r.ready && <span className="text-[10.5px] text-(--u-ink-3)">soon</span>}
          </button>
        ))}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {view === 'sources' && (
          <>
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-(--u-edge) px-5">
              <div className="min-w-0 flex-1">
                <h1 className="text-[15px] font-semibold leading-tight">Sources</h1>
                <p className="truncate text-[11.5px] text-(--u-ink-3)">
                  {sources === null
                    ? busy
                      ? 'Measuring…'
                      : failed
                        ? 'Could not measure'
                        : ' '
                    : `${running} of ${servers.length} services running · measured ${measured ? new Date(measured).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`}
                </p>
              </div>
              <Button variant="tinted" disabled={busy} onClick={() => void refresh()}>
                {busy ? 'Measuring…' : 'Refresh'}
              </Button>
            </header>

            <div className={cn('grid h-9 shrink-0 items-center gap-3 border-b border-(--u-edge) px-5 text-[11px] font-medium uppercase tracking-wide text-(--u-ink-3)', COLS)}>
              <span>Source</span>
              <span>Engine</span>
              <span>Where</span>
              <span className="text-right">Size</span>
              <span className="text-right">Tables</span>
              <span className="text-right">Rows</span>
              <span />
            </div>

            <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 py-1">
              {failed && <p className="p-6 text-center text-[13px] text-(--u-ink-3)">Could not measure the sources. Try Refresh.</p>}
              {(sources ?? []).map((s) => {
                const down = !s.up
                return (
                  <div key={s.id} className={cn('grid min-h-[52px] items-center gap-3 rounded-[10px] px-3 py-2 hover:bg-(--u-wash-on)', COLS)}>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{s.name}</p>
                      <p className="truncate text-[11.5px] text-(--u-ink-3)">{s.note ?? (s.service ? `Service ${s.serviceState ?? 'unknown'}` : 'File')}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px]">{s.engine}</p>
                      <p className="truncate text-[11.5px] tabular-nums text-(--u-ink-3)">{s.version ?? ' '}</p>
                    </div>
                    <p className="truncate text-[12.5px] tabular-nums text-(--u-ink-2)" title={s.service ?? undefined}>
                      {s.location}
                    </p>
                    <p className="text-right text-[12.5px] tabular-nums text-(--u-ink-2)" title={s.logMb ? `Includes a ${size(s.logMb)} log` : undefined}>
                      {size(s.sizeMb)}
                    </p>
                    <p className="text-right text-[12.5px] tabular-nums text-(--u-ink-2)">{count(s.tables)}</p>
                    <p className="text-right text-[12.5px] tabular-nums text-(--u-ink-2)">{count(s.rows)}</p>
                    <span className="flex justify-end" role="img" aria-label={down ? 'Down' : 'Up'} title={down ? 'Down' : 'Up'}>
                      <span className={cn('h-2.5 w-2.5 rounded-full', down ? 'bg-(--u-danger)' : s.note ? 'bg-(--u-ink-3)' : 'bg-(--u-ok)')} />
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {view === 'browser' && (
          <Browser
            sources={sources}
            initial={handoff.source}
            onQuery={(source, sql) => {
              setHandoff({ source, sql })
              setView('query')
            }}
          />
        )}
        {view === 'query' && <Query sources={sources} initialSource={handoff.source} initialSql={handoff.sql} />}
        {view === 'links' && <Links onDrafted={() => setView('forged')} />}
        {view === 'backups' && <Backups />}
        {view === 'forged' && <Forged />}
      </main>
    </div>
  )
}
