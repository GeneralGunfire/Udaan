import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { anvilBackups, bytesLabel, reason, when, type BackupFile, type BackupList } from './api'

/**
 * The backups list: names, sizes, dates and how they group. Read-only: nothing is opened, verified or restored here.
 * Taking, verifying and restoring a backup are separate actions that need explicit approval first.
 */
export function Backups() {
  const [list, setList] = useState<BackupList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    try {
      setList(await anvilBackups())
      setError(null)
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  // Per source: how many backups, and the newest one.
  const bySource = useMemo(() => {
    const m = new Map<string, { name: string; files: BackupFile[] }>()
    for (const f of list?.files ?? []) {
      const key = f.sourceId ?? 'other'
      const g = m.get(key) ?? { name: f.sourceName ?? 'Other files', files: [] }
      g.files.push(f)
      m.set(key, g)
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [list])

  const totalBytes = (list?.files ?? []).reduce((a, f) => a + f.bytes, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-(--u-edge) px-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold leading-tight">Backups</h1>
          <p className="truncate text-[11.5px] text-(--u-ink-3)">
            {error ?? (list ? `${list.files.length} files · ${bytesLabel(totalBytes)} · ${list.snapshots.length} snapshot folders · listed only, nothing opened` : 'Listing…')}
          </p>
        </div>
        <Button variant="tinted" disabled={busy} onClick={() => void load()}>
          {busy ? 'Listing…' : 'Refresh'}
        </Button>
      </header>

      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {list && !list.rootFound && <p className="py-6 text-center text-[13px] text-(--u-ink-3)">The backup folders were not found on this PC.</p>}

        {list && list.snapshots.length > 0 && (
          <section className="mb-6">
            <h2 className="u-label pb-2">Snapshots</h2>
            <div className="flex flex-col gap-1">
              {list.snapshots.map((s) => (
                <div key={s.folder} className="grid grid-cols-[minmax(0,1.5fr)_90px_100px_minmax(0,1.5fr)_110px] items-center gap-3 rounded-[10px] px-3 py-2 hover:bg-(--u-wash-on)">
                  <span className="truncate text-[13px] font-medium tabular-nums">{s.folder}</span>
                  <span className="text-[12px] text-(--u-ink-2)">{s.files} files</span>
                  <span className="text-[12px] tabular-nums text-(--u-ink-2)">{bytesLabel(s.bytes)}</span>
                  <span className="text-[12px] text-(--u-ink-3)">{when(s.modifiedMs)}</span>
                  <span className={cn('text-right text-[11.5px]', s.hasManifest ? 'text-(--u-ok)' : 'text-(--u-ink-3)')}>{s.hasManifest ? 'Has manifest' : 'No manifest'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {bySource.map(([id, g]) => {
          const named = g.files.filter((f) => f.folder === 'backups')
          const newest = g.files[0]
          return (
            <section key={id} className="mb-6">
              <div className="flex items-baseline gap-3 pb-2">
                <h2 className="text-[13px] font-semibold">{g.name}</h2>
                <span className="text-[11.5px] text-(--u-ink-3)">
                  {g.files.length} {g.files.length === 1 ? 'copy' : 'copies'} · newest {newest ? when(newest.modifiedMs) : '–'}
                  {named.length ? ` · ${named.length} named` : ''}
                </span>
              </div>
              <div className="flex flex-col">
                {g.files.map((f) => (
                  <div key={`${f.folder}/${f.name}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_90px_minmax(0,1.2fr)] items-center gap-3 rounded-[8px] px-3 py-1.5 hover:bg-(--u-wash-on)">
                    <span className="truncate text-[12.5px]" title={f.name}>
                      {f.name}
                    </span>
                    <span className="truncate text-[11.5px] text-(--u-ink-3)">{f.folder === 'backups' ? f.label || 'named' : `snapshot ${f.folder}`}</span>
                    <span className="text-right text-[12px] tabular-nums text-(--u-ink-2)">{bytesLabel(f.bytes)}</span>
                    <span className="text-right text-[11.5px] text-(--u-ink-3)">{when(f.modifiedMs)}</span>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
