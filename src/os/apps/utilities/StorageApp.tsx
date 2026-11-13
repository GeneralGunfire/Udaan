import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'
import { openWithSystem } from '@/integrations/file-explorer/client'

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

/** Storage: what fills your drive, and one-click cleanup of safe clutter. */
export function StorageApp(_props: { onClose: () => void }) {
  const [drives, setDrives] = useState<Drive[]>([])
  const [clean, setClean] = useState<Cleanable[] | null>(null)
  const [cleaning, setCleaning] = useState<string | null>(null)
  const [freed, setFreed] = useState(0)
  const [trail, setTrail] = useState<string[]>([])
  const [items, setItems] = useState<DirSize[] | null>(null)

  const refreshDrives = () => void invoke<Drive[]>('storage_drives').then(setDrives, () => {})

  const browse = useCallback(async (path: string, newTrail: string[]) => {
    setTrail(newTrail)
    setItems(null)
    setItems(await invoke<DirSize[]>('storage_scan', { path }).catch(() => []))
  }, [])

  useEffect(() => {
    refreshDrives()
    void invoke<Cleanable[]>('storage_cleanables').then(setClean, () => setClean([]))
    void (async () => {
      const home = (await homeDir().catch(() => 'C:\\Users')).replace(/[\\/]+$/, '')
      void browse(home, [home])
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

  const max = Math.max(1, ...(items ?? []).map((i) => i.bytes))
  const current = trail[trail.length - 1]

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--surface-base)] px-7 pb-8 pt-6 text-[var(--color-text-primary)]">
      <h1 className="text-[24px] font-bold tracking-tight">Storage</h1>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {drives.map((d) => {
          const used = d.total - d.free
          const pct = (used / Math.max(1, d.total)) * 100
          return (
            <div key={d.mount} className="rounded-[14px] bg-white/[0.05] p-4">
              <p className="flex justify-between text-[14px] font-semibold">
                {d.name || 'Local disk'} ({d.mount.replace(/\\$/, '')}) <span className="font-normal text-[var(--color-text-tertiary)]">{fmt(d.free)} free</span>
              </p>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.08]">
                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} className={`h-full rounded-full ${pct > 90 ? 'bg-[#ff453a]' : pct > 75 ? 'bg-[#ff9f0a]' : 'bg-[var(--color-accent)]'}`} />
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--color-text-tertiary)]">
                {fmt(used)} of {fmt(d.total)} used
              </p>
            </div>
          )
        })}
      </div>

      <h2 className="mt-7 flex items-baseline gap-3 text-[16px] font-semibold">
        Clean up {freed > 0 && <span className="text-[13px] font-medium text-[#6fdc8c]">{fmt(freed)} freed</span>}
      </h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {clean === null && <p className="text-[13px] text-[var(--color-text-tertiary)]">Measuring…</p>}
        {clean?.length === 0 && <p className="text-[13px] text-[var(--color-text-tertiary)]">Nothing worth cleaning right now.</p>}
        <AnimatePresence>
          {clean?.map((c) => (
            <motion.div key={c.id} layout exit={{ opacity: 0, scale: 0.95 }} className="flex items-center gap-3 rounded-[14px] bg-white/[0.05] p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{c.label}</p>
                <p className="truncate text-[12px] text-[var(--color-text-tertiary)]">{c.detail}</p>
              </div>
              <span className="text-[14px] font-semibold tabular-nums">{fmt(c.bytes)}</span>
              <button type="button" disabled={cleaning !== null} onClick={() => void doClean(c)} className="h-8 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[12.5px] font-semibold disabled:opacity-50">
                {cleaning === c.id ? 'Cleaning…' : 'Clean'}
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <h2 className="mt-7 text-[16px] font-semibold">What&apos;s taking space</h2>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[13px]">
        {trail.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && <span className="text-[var(--color-text-tertiary)]">›</span>}
            <button type="button" onClick={() => void browse(p, trail.slice(0, i + 1))} className={`rounded px-1.5 py-0.5 hover:bg-(--os-hover) ${i === trail.length - 1 ? 'font-semibold' : 'text-[var(--color-text-secondary)]'}`}>
              {i === 0 ? p : p.split('\\').pop()}
            </button>
          </span>
        ))}
        {current && (
          <button type="button" onClick={() => void openWithSystem(current)} className="ml-auto rounded-[8px] px-3 py-1 text-[12.5px] text-[var(--color-text-secondary)] hover:bg-(--os-hover) hover:text-[var(--color-text-primary)]">
            Open in Explorer
          </button>
        )}
      </div>
      <div className="mt-2 overflow-hidden rounded-[14px] border border-[var(--border-hairline)]">
        {items === null ? (
          <p className="p-5 text-[13px] text-[var(--color-text-tertiary)]">Measuring folders… (large folders take a few seconds)</p>
        ) : (
          items.slice(0, 60).map((it) => (
            <button
              key={it.path}
              type="button"
              disabled={!it.isDir}
              onClick={() => void browse(it.path, [...trail, it.path])}
              className="flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-left text-[13.5px] transition-colors last:border-0 hover:bg-white/[0.04] disabled:cursor-default"
            >
              <span className="w-5 text-center text-[var(--color-text-tertiary)]">{it.isDir ? '▸' : ''}</span>
              <span className="min-w-0 flex-1 truncate">{it.name}</span>
              <span className="h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.06]">
                <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${(it.bytes / max) * 100}%` }} />
              </span>
              <span className="w-20 text-right tabular-nums text-[var(--color-text-secondary)]">{fmt(it.bytes)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
