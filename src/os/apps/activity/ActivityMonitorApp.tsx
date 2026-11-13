import { memo, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/shared/lib/cn'
import { SearchIcon } from '@/shared/icons'
import { shell, subscribeShell, useShell } from '@/os/kernel/shell'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { toastError } from '@/os/ui/toasts'

interface Proc {
  pid: number
  name: string
  exe: string | null
  cpu: number
  memory: number
  parent: number | null
  runTime: number
}

interface Load {
  cpu: number
  perCore: number[]
  memoryUsed: number
  memoryTotal: number
  swapUsed: number
  swapTotal: number
  processCount: number
  uptime: number
}

/** One row: an app (all its processes together) or a single process. */
interface Row {
  key: string
  name: string
  exe: string | null
  cpu: number
  memory: number
  pids: number[]
}

type SortKey = 'name' | 'cpu' | 'memory'

const POLL_MS = 1500
const HISTORY = 60

function fmtBytes(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`
  return `${Math.round(b / 1024)} KB`
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

const prettyName = (name: string) => name.replace(/\.exe$/i, '')

const iconCache = new Map<string, string | null>()

const ProcIcon = memo(function ProcIcon({ exe }: { exe: string | null }) {
  const [src, setSrc] = useState<string | null>(() => (exe ? (iconCache.get(exe) ?? null) : null))
  useEffect(() => {
    if (!exe || iconCache.has(exe)) return
    iconCache.set(exe, null)
    void shell.fileIcons([exe]).then((r) => {
      iconCache.set(exe, r[exe] ?? null)
      setSrc(r[exe] ?? null)
    })
  }, [exe])
  return src ? <img src={src} alt="" className="h-5 w-5 shrink-0 object-contain" /> : <span className="h-5 w-5 shrink-0 rounded-[5px] bg-[var(--surface-raised)]" />
})

/** Filled line chart of the last HISTORY samples (0–100), newest at the right. */
function Spark({ values, color }: { values: number[]; color: string }) {
  const w = 300
  const h = 56
  const start = HISTORY - values.length
  const pts = values.map((v, i) => [((start + i) / (HISTORY - 1)) * w, h - (Math.min(100, Math.max(0, v)) / 100) * h] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-14 w-full">
      {pts.length > 1 && (
        <>
          <path d={`${line} L${w},${h} L${pts[0][0]},${h} Z`} fill={color} fillOpacity="0.16" />
          <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  )
}

function Card({ title, value, sub, children, delay }: { title: string; value: string; sub?: string; children?: React.ReactNode; delay: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-w-0 flex-col rounded-[14px] border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 pt-3"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">{title}</p>
      <p className="mt-0.5 text-[24px] font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="truncate text-[11.5px] text-[var(--color-text-tertiary)]">{sub}</p>}
      <div className="mt-auto pt-1">{children}</div>
    </motion.section>
  )
}

/** Activity Monitor: live system load, apps grouped with their processes, End task. */
export function ActivityMonitorApp(_props: { onClose: () => void }) {
  const [procs, setProcs] = useState<Proc[]>([])
  const [load, setLoad] = useState<Load | null>(null)
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] })
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'memory', desc: true })
  const [grouped, setGrouped] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const windows = useShell((s) => s.windows)

  useEffect(() => subscribeShell(), [])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      // No work while the window is minimized or hidden.
      if (document.visibilityState === 'visible') {
        try {
          const snap = await invoke<{ load: Load; processes: Proc[] }>('shell_processes')
          if (stopped) return
          setProcs(snap.processes)
          setLoad(snap.load)
          const memPct = (snap.load.memoryUsed / Math.max(1, snap.load.memoryTotal)) * 100
          setHistory((hist) => ({ cpu: [...hist.cpu, snap.load.cpu].slice(-HISTORY), mem: [...hist.mem, memPct].slice(-HISTORY) }))
        } catch (err) {
          console.error('[activity] snapshot failed', err)
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  const rows = useMemo<Row[]>(() => {
    let list: Row[]
    if (grouped) {
      const map = new Map<string, Row>()
      for (const p of procs) {
        const key = p.name.toLowerCase()
        const r = map.get(key) ?? { key, name: prettyName(p.name), exe: p.exe, cpu: 0, memory: 0, pids: [] }
        r.cpu += p.cpu
        r.memory += p.memory
        r.pids.push(p.pid)
        r.exe ??= p.exe
        map.set(key, r)
      }
      list = [...map.values()]
    } else {
      list = procs.map((p) => ({ key: String(p.pid), name: prettyName(p.name), exe: p.exe, cpu: p.cpu, memory: p.memory, pids: [p.pid] }))
    }
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.pids.some((pid) => String(pid) === q))
    const dir = sort.desc ? -1 : 1
    return list.sort((a, b) => (sort.key === 'name' ? dir * a.name.localeCompare(b.name) : dir * (a[sort.key] - b[sort.key])))
  }, [procs, grouped, query, sort])

  const maxMem = Math.max(1, ...rows.map((r) => r.memory))
  const heaviest = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of procs) map.set(prettyName(p.name), (map.get(prettyName(p.name)) ?? 0) + p.memory)
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]
  }, [procs])
  const selectedRow = rows.find((r) => r.key === selected) ?? null

  async function endRow(r: Row) {
    const what = r.pids.length > 1 ? `${r.name} (${r.pids.length} processes)` : `${r.name} (PID ${r.pids[0]})`
    if (!window.confirm(`End ${what}? Unsaved work in it will be lost.`)) return
    const results = await Promise.allSettled(r.pids.map((pid) => invoke('shell_end_process', { pid })))
    const failed = results.find((x) => x.status === 'rejected') as PromiseRejectedResult | undefined
    if (failed) toastError(`Couldn't end all of ${r.name}`, failed.reason)
    setSelected(null)
  }

  function bringToFront(r: Row) {
    const w = windows.find((x) => x.exePath && r.exe && x.exePath.toLowerCase() === r.exe.toLowerCase())
    if (w) void shell.focus(w.handle)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedRow) void endRow(selectedRow)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const header = (key: SortKey, label: string, cls = '') => (
    <button
      type="button"
      onClick={() => setSort((st) => ({ key, desc: st.key === key ? !st.desc : key !== 'name' }))}
      className={cn('flex items-center gap-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]', cls)}
    >
      {label}
      {sort.key === key && <span className="text-[9px]">{sort.desc ? '▼' : '▲'}</span>}
    </button>
  )

  const memPct = load ? (load.memoryUsed / Math.max(1, load.memoryTotal)) * 100 : 0

  return (
    <div className="flex h-full flex-col bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <div className="grid shrink-0 grid-cols-4 gap-3 px-5 pb-3 pt-4">
        <Card title="Processor" value={load ? `${load.cpu.toFixed(0)}%` : '—'} sub={load ? `${load.perCore.length} cores` : undefined} delay={0}>
          <Spark values={history.cpu} color="#34c759" />
        </Card>
        <Card title="Memory" value={load ? `${memPct.toFixed(0)}%` : '—'} sub={load ? `${fmtBytes(load.memoryUsed)} of ${fmtBytes(load.memoryTotal)}` : undefined} delay={0.05}>
          <Spark values={history.mem} color="#0a84ff" />
        </Card>
        <Card title="Cores" value={load ? `${Math.max(0, ...load.perCore).toFixed(0)}%` : '—'} sub="busiest core" delay={0.1}>
          <div className="flex h-14 items-end gap-[3px] pb-2">
            {load?.perCore.map((c, i) => (
              <span key={i} className="flex-1 rounded-t-[3px] bg-[#34c759]/80 transition-[height] duration-700 ease-out" style={{ height: `${Math.max(4, c)}%` }} title={`Core ${i + 1}: ${c.toFixed(0)}%`} />
            ))}
          </div>
        </Card>
        <Card title="Heaviest app" value={heaviest ? fmtBytes(heaviest[1]) : '—'} sub={heaviest ? heaviest[0] : undefined} delay={0.15}>
          <p className="pb-3 text-[11.5px] text-[var(--color-text-tertiary)]">{load ? `${load.processCount} processes · up ${fmtUptime(load.uptime)}` : ''}</p>
        </Card>
      </div>

      <div className="flex shrink-0 items-center gap-3 px-5 pb-3">
        <div className="flex rounded-[9px] bg-[var(--surface-raised)] p-0.5 text-[12.5px] font-medium">
          {[
            { v: true, label: 'Apps' },
            { v: false, label: 'All processes' },
          ].map((t) => (
            <button key={t.label} type="button" onClick={() => setGrouped(t.v)} className={cn('relative rounded-[7px] px-3 py-1.5', grouped === t.v ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}>
              {grouped === t.v && <motion.span layoutId="am-tab" className="absolute inset-0 rounded-[7px] bg-[var(--surface-hover)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        <label className="flex h-8 w-64 items-center gap-2 rounded-[8px] bg-[var(--surface-raised)] px-2.5 focus-within:bg-[var(--surface-hover)]">
          <SearchIcon width={13} height={13} className="text-[var(--color-text-tertiary)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
        </label>
        <div className="flex-1" />
        {selectedRow?.exe && (
          <button type="button" onClick={() => void openWithSystem(selectedRow.exe!.replace(/[\\/][^\\/]+$/, ''))} className="rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--os-menu-item-hover)] hover:text-[var(--color-text-primary)]">
            Open location
          </button>
        )}
        <button
          type="button"
          disabled={!selectedRow}
          onClick={() => selectedRow && void endRow(selectedRow)}
          className="rounded-[8px] bg-[#ff453a]/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-[#ff6b61] transition-colors hover:bg-[#ff453a]/25 disabled:opacity-35"
        >
          End task
        </button>
      </div>

      <div className="mx-5 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[var(--border-hairline)]">
        <div className="grid shrink-0 grid-cols-[1fr_90px_220px] border-b border-[var(--border-hairline)] bg-[var(--surface-raised)]">
          {header('name', grouped ? 'App' : 'Process', 'justify-start')}
          {header('cpu', 'CPU', 'justify-end')}
          {header('memory', 'Memory', 'justify-end')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((r) => (
            <div
              key={r.key}
              onClick={() => setSelected(r.key)}
              onDoubleClick={() => bringToFront(r)}
              className={cn('grid cursor-default grid-cols-[1fr_90px_220px] items-center border-b border-[var(--border-hairline)] text-[13px] transition-colors', selected === r.key ? 'bg-[var(--color-accent)]/25' : 'hover:bg-[var(--os-menu-item-hover)]')}
            >
              <span className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                <ProcIcon exe={r.exe} />
                <span className="truncate">{r.name}</span>
                {r.pids.length > 1 && <span className="shrink-0 rounded-full bg-[var(--surface-raised)] px-1.5 text-[10.5px] text-[var(--color-text-secondary)]">{r.pids.length}</span>}
              </span>
              <span className={cn('px-3 text-right tabular-nums', r.cpu > 25 ? 'text-[#ff9f0a]' : 'text-[var(--color-text-secondary)]')}>{r.cpu.toFixed(1)}%</span>
              <span className="flex items-center justify-end gap-2.5 px-3">
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                  <span className="block h-full rounded-full bg-[#0a84ff]/80 transition-[width] duration-700" style={{ width: `${(r.memory / maxMem) * 100}%` }} />
                </span>
                <span className="w-16 text-right tabular-nums text-[var(--color-text-secondary)]">{fmtBytes(r.memory)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
