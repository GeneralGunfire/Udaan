import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'

interface Drive {
  mount: string
  name: string
  total: number
  free: number
}
interface DirSize {
  path: string
  name: string
  bytes: number
  isDir: boolean
}
interface Cleanable {
  id: string
  label: string
  detail: string
  path: string
  bytes: number
}

function fmt(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

const parentOf = (p: string) => {
  const t = p.replace(/[\\/]+$/, '')
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'))
  return i > 2 ? t.slice(0, i) : null
}

/** Storage: what fills each drive, a one-click cleanup of safe clutter, and a size browser for any folder. */
export function StorageApp(_props: { onClose: () => void }) {
  const [drives, setDrives] = useState<Drive[]>([])
  const [clean, setClean] = useState<Cleanable[] | null>(null)
  const [cleaning, setCleaning] = useState<string | null>(null)
  const [freed, setFreed] = useState(0)
  const [path, setPath] = useState<string | null>(null)
  const [root, setRoot] = useState<string | null>(null)
  const [items, setItems] = useState<DirSize[] | null>(null)
  const [sort, setSort] = useState<'size' | 'name'>('size')

  const refreshDrives = () => void invoke<Drive[]>('storage_drives').then(setDrives, () => {})

  const browse = useCallback(async (p: string) => {
    setPath(p)
    setItems(null)
    setItems(await invoke<DirSize[]>('storage_scan', { path: p }).catch(() => []))
  }, [])

  useEffect(() => {
    refreshDrives()
    void invoke<Cleanable[]>('storage_cleanables').then(setClean, () => setClean([]))
    void (async () => {
      const home = (await homeDir().catch(() => 'C:\\Users')).replace(/[\\/]+$/, '')
      setRoot(home)
      void browse(home)
    })()
  }, [browse])

  const doClean = async (c: Cleanable) => {
    setCleaning(c.id)
    const bytes = await invoke<number>('storage_clean', { id: c.id }).catch(() => 0)
    setFreed((f) => f + bytes)
    setCleaning(null)
    setClean((list) => (list ?? []).map((x) => (x.id === c.id ? { ...x, bytes: Math.max(0, x.bytes - bytes) } : x)).filter((x) => x.bytes > 1_000_000))
    refreshDrives()
  }

  const total = useMemo(() => (items ?? []).reduce((s, i) => s + i.bytes, 0), [items])
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => (sort === 'size' ? b.bytes - a.bytes : a.name.localeCompare(b.name))), [items, sort])
  const cleanTotal = (clean ?? []).reduce((s, c) => s + c.bytes, 0)
  const up = path ? parentOf(path) : null
  const crumbs = useMemo(() => {
    if (!path) return []
    const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
    return parts.map((p, i) => ({ label: p || '/', to: parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '') }))
  }, [path])

  return (
    <div className="flex h-full bg-(--u-bg) text-(--u-ink)">
      <aside className="u-scroll flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-(--u-edge) p-4">
        <h1 className="text-[19px] font-semibold tracking-tight">Storage</h1>

        <section className="flex flex-col gap-2">
          <p className="u-label">Drives</p>
          {drives.map((d) => {
            const used = d.total - d.free
            const pct = (used / Math.max(1, d.total)) * 100
            const here = !!path && path.toLowerCase().startsWith(d.mount.toLowerCase())
            return (
              <button key={d.mount} type="button" data-selected={here || undefined} onClick={() => void browse(d.mount)} className="u-row h-auto flex-col items-stretch gap-2 px-3 py-2.5 text-left">
                <span className="flex items-baseline justify-between gap-2 text-[13px] font-medium">
                  <span className="truncate">
                    {d.name || 'Local disk'} ({d.mount.replace(/\\$/, '')})
                  </span>
                  <span className="shrink-0 text-[11.5px] font-normal text-(--u-ink-3)">{fmt(d.free)} free</span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-(--u-wash-press)">
                  <span className={cn('block h-full rounded-full transition-[width] duration-700', pct > 90 ? 'bg-(--u-danger)' : pct > 75 ? 'bg-[#e0a03a]' : 'bg-(--u-accent)')} style={{ width: `${pct}%` }} />
                </span>
                <span className="text-[11px] tabular-nums text-(--u-ink-3)">
                  {fmt(used)} of {fmt(d.total)} used · {Math.round(pct)}%
                </span>
              </button>
            )
          })}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <p className="u-label">Clean up</p>
            {freed > 0 && <span className="text-[11.5px] font-medium text-(--u-ok)">{fmt(freed)} freed</span>}
          </div>
          {clean === null && <p className="text-[12.5px] text-(--u-ink-3)">Measuring…</p>}
          {clean?.length === 0 && <p className="text-[12.5px] text-(--u-ink-3)">Nothing worth cleaning right now.</p>}
          {clean && clean.length > 0 && <p className="text-[12px] text-(--u-ink-3)">{fmt(cleanTotal)} of safe clutter.</p>}
          {clean?.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 rounded-[10px] bg-(--u-wash-on) px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{c.label}</p>
                <p className="truncate text-[11px] text-(--u-ink-3)" title={c.detail}>
                  {c.detail}
                </p>
              </div>
              <span className="text-[12px] font-semibold tabular-nums">{fmt(c.bytes)}</span>
              <Button size="sm" variant="primary" disabled={cleaning !== null} onClick={() => void doClean(c)}>
                {cleaning === c.id ? '…' : 'Clean'}
              </Button>
            </div>
          ))}
        </section>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-(--u-edge) px-4">
          <Button size="sm" icon title="Up one folder" disabled={!up} onClick={() => up && void browse(up)}>
            ↑
          </Button>
          <Button size="sm" title="Back to your user folder" disabled={!root || path === root} onClick={() => root && void browse(root)}>
            Home
          </Button>
          <div className="mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[12.5px]">
            {crumbs.slice(-4).map((c, i, arr) => (
              <span key={c.to} className="flex min-w-0 items-center gap-0.5">
                {i > 0 && <span className="text-(--u-ink-3)">›</span>}
                <button type="button" onClick={() => void browse(c.to)} className={cn('truncate rounded px-1.5 py-0.5 hover:bg-(--u-wash-on)', i === arr.length - 1 ? 'font-semibold' : 'text-(--u-ink-2)')}>
                  {c.label}
                </button>
              </span>
            ))}
          </div>
          <div className="flex rounded-[8px] bg-(--u-wash-on) p-0.5 text-[11.5px]">
            {(['size', 'name'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)} className={cn('rounded-[6px] px-2.5 py-1', sort === s ? 'bg-(--u-wash-press) text-(--u-ink)' : 'text-(--u-ink-3)')}>
                {s === 'size' ? 'Largest' : 'A–Z'}
              </button>
            ))}
          </div>
          {path && (
            <Button size="sm" onClick={() => void openWithSystem(path)}>
              Open in Explorer
            </Button>
          )}
        </header>

        <div className="flex h-10 shrink-0 items-center border-b border-(--u-edge) px-5 text-[12px] text-(--u-ink-3)">
          {items === null ? 'Measuring folders… large folders take a few seconds' : `${items.length} items · ${fmt(total)} in this folder`}
        </div>

        <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {items !== null && sorted.length === 0 && <p className="p-6 text-center text-[13px] text-(--u-ink-3)">This folder is empty or can't be read.</p>}
          {sorted.slice(0, 120).map((it) => {
            const share = total ? (it.bytes / total) * 100 : 0
            return (
              <button key={it.path} type="button" disabled={!it.isDir} onClick={() => void browse(it.path)} className="u-row mb-0.5 h-11 w-full gap-3 px-3 text-left disabled:cursor-default">
                <span className="w-4 text-center text-(--u-ink-3)">{it.isDir ? '▸' : ''}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{it.name}</span>
                <span className="h-1.5 w-44 overflow-hidden rounded-full bg-(--u-wash-press)">
                  <span className="block h-full rounded-full bg-(--u-accent)" style={{ width: `${Math.max(1.5, share)}%` }} />
                </span>
                <span className="w-10 text-right text-[11.5px] tabular-nums text-(--u-ink-3)">{share >= 1 ? `${Math.round(share)}%` : '<1%'}</span>
                <span className="w-[72px] text-right text-[12.5px] tabular-nums text-(--u-ink-2)">{fmt(it.bytes)}</span>
              </button>
            )
          })}
        </div>
      </main>
    </div>
  )
}
