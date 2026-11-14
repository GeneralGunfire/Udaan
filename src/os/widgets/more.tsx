import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { thumbFor, useWallpaperLibrary } from '@/os/wallpaper/library'
import { usePoll } from '@/os/kernel/poll'
import { Tile } from './widgets'

/** Small helper: state that survives restarts, in this webview's storage. */
function useStored<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const set = (next: T) => {
    setV(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* best effort */
    }
  }
  return [v, set] as const
}

const btn = 'rounded-full bg-(--u-wash-on) px-3 py-1 text-[11.5px] font-medium hover:bg-(--u-wash-press) active:scale-95'

/* ── Stopwatch ─────────────────────────────────────────────────── */

export function StopwatchWidget() {
  const [run, setRun] = useStored<{ start: number | null; acc: number }>('widget.stopwatch', { start: null, acc: 0 })
  const [, tick] = useState(0)
  // Only ticks while running (and only while the desktop is visible).
  usePoll(() => run.start !== null && tick((n) => n + 1), 100, run.start !== null)
  const ms = run.acc + (run.start ? Date.now() - run.start : 0)
  const t = (n: number) => String(Math.floor(n)).padStart(2, '0')
  return (
    <Tile className="flex flex-col items-center justify-center gap-3">
      <p className="text-[34px] font-light tabular-nums leading-none">
        {t(ms / 60000)}:{t((ms / 1000) % 60)}
        <span className="text-[16px] text-(--u-ink-3)">.{Math.floor((ms % 1000) / 100)}</span>
      </p>
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => setRun(run.start ? { start: null, acc: ms } : { start: Date.now(), acc: run.acc })}>
          {run.start ? 'Pause' : ms ? 'Resume' : 'Start'}
        </button>
        <button type="button" className={btn} disabled={!ms} onClick={() => setRun({ start: null, acc: 0 })}>
          Reset
        </button>
      </div>
    </Tile>
  )
}

/* ── Countdown ─────────────────────────────────────────────────── */

export function CountdownWidget() {
  const [target, setTarget] = useStored<{ name: string; date: string }>('widget.countdown', { name: 'My event', date: '' })
  const now = useMemo(() => Date.now(), [])
  const [editing, setEditing] = useState(!target.date)
  const days = target.date ? Math.ceil((new Date(`${target.date}T00:00`).getTime() - now) / 86400000) : null
  return (
    <Tile className="flex flex-col justify-between">
      {editing ? (
        <div className="flex h-full flex-col gap-2">
          <input value={target.name} onChange={(e) => setTarget({ ...target, name: e.target.value })} className="u-field h-8" placeholder="What are you counting to?" />
          <input type="date" value={target.date} onChange={(e) => setTarget({ ...target, date: e.target.value })} className="u-field h-8" />
          <button type="button" className={`${btn} self-start`} disabled={!target.date} onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      ) : (
        <button type="button" className="flex h-full flex-col justify-between text-left" onClick={() => setEditing(true)} title="Click to edit">
          <p className="truncate text-[12px] font-semibold text-(--u-ink-2)">{target.name}</p>
          <div>
            <p className="text-[48px] font-light leading-none tabular-nums">{days === null ? '–' : Math.abs(days)}</p>
            <p className="text-[12px] text-(--u-ink-3)">{days === null ? '' : days === 0 ? 'today' : days > 0 ? `day${days === 1 ? '' : 's'} to go` : `day${days === -1 ? '' : 's'} ago`}</p>
          </div>
        </button>
      )}
    </Tile>
  )
}

/* ── To-do ─────────────────────────────────────────────────────── */

interface Todo {
  id: number
  text: string
  done: boolean
}

export function TodoWidget() {
  const [items, setItems] = useStored<Todo[]>('widget.todo', [])
  const [text, setText] = useState('')
  const left = items.filter((i) => !i.done).length
  return (
    <Tile className="flex flex-col gap-2 !p-3.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold text-(--u-ink-2)">To do</p>
        <p className="text-[11px] tabular-nums text-(--u-ink-3)">{left} left</p>
      </div>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto">
        {items.map((i) => (
          <div key={i.id} className="group flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={i.done} onChange={() => setItems(items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))} className="h-3.5 w-3.5 accent-(--u-accent)" />
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${i.done ? 'text-(--u-ink-3) line-through' : ''}`}>{i.text}</span>
            <button type="button" aria-label="Remove" className="text-[12px] text-(--u-ink-3) opacity-0 group-hover:opacity-100" onClick={() => setItems(items.filter((x) => x.id !== i.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            setItems([...items, { id: Date.now(), text: text.trim(), done: false }])
            setText('')
          }
        }}
        placeholder="Add a task"
        className="u-field h-7 text-[12px]"
      />
    </Tile>
  )
}

/* ── Photo frame ───────────────────────────────────────────────── */

export function PhotoWidget() {
  const { lib } = useWallpaperLibrary()
  const [i, setI] = useState(0)
  const [src, setSrc] = useState('')
  const item = lib?.items.length ? lib.items[i % lib.items.length] : null
  useEffect(() => {
    if (!item) return
    let off = false
    void thumbFor(item.path, 640).then((s) => !off && setSrc(s))
    return () => {
      off = true
    }
  }, [item])
  return (
    <Tile className="relative !p-0">
      {src ? <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : <span className="absolute inset-0 bg-(--u-wash-on)" />}
      <button type="button" aria-label="Next picture" onClick={() => setI((n) => n + 1)} className="absolute inset-0" />
    </Tile>
  )
}

/* ── Moon ──────────────────────────────────────────────────────── */

const SYNODIC = 29.530588853
function moonAge(d: Date) {
  const ref = Date.UTC(2000, 0, 6, 18, 14) // a known new moon
  return (((d.getTime() - ref) / 86400000) % SYNODIC + SYNODIC) % SYNODIC
}
const PHASES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent']

export function MoonWidget() {
  const age = moonAge(new Date())
  const frac = age / SYNODIC // 0 new .. 0.5 full .. 1 new
  const lit = (1 - Math.cos(frac * 2 * Math.PI)) / 2
  const name = PHASES[Math.round(frac * 8) % 8]
  const waxing = frac < 0.5
  // The terminator is an ellipse whose width follows the phase.
  const rx = Math.abs(1 - 2 * lit) * 40
  const gibbous = lit > 0.5
  return (
    <Tile className="flex flex-col items-center justify-center gap-2">
      <svg viewBox="0 0 100 100" className="h-[84px] w-[84px]">
        <circle cx="50" cy="50" r="40" fill="rgb(255 255 255 / 0.1)" />
        <path
          d={`M50 10 A40 40 0 0 ${waxing ? 1 : 0} 50 90 A${rx} 40 0 0 ${waxing === gibbous ? 0 : 1} 50 10 Z`}
          fill="rgb(250 248 244 / 0.92)"
        />
      </svg>
      <p className="text-[12.5px] font-medium">{name}</p>
      <p className="text-[11px] tabular-nums text-(--u-ink-3)">{Math.round(lit * 100)}% lit</p>
    </Tile>
  )
}

/* ── Year grid ─────────────────────────────────────────────────── */

export function YearWidget() {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0).getTime()
  const day = Math.floor((now.getTime() - start) / 86400000)
  const total = (now.getFullYear() % 4 === 0 && now.getFullYear() % 100 !== 0) || now.getFullYear() % 400 === 0 ? 366 : 365
  return (
    <Tile className="flex flex-col gap-2 !p-3.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold text-(--u-ink-2)">{now.getFullYear()}</p>
        <p className="text-[11px] tabular-nums text-(--u-ink-3)">{Math.round((day / total) * 100)}%</p>
      </div>
      <div className="grid flex-1 content-start gap-[2px]" style={{ gridTemplateColumns: 'repeat(21, 1fr)' }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="aspect-square rounded-[1.5px]" style={{ background: i + 1 === day ? 'var(--u-accent)' : i < day ? 'var(--u-ink)' : 'var(--u-wash-press)', opacity: i + 1 === day ? 1 : i < day ? 0.75 : 1 }} />
        ))}
      </div>
    </Tile>
  )
}

/* ── CPU graph ─────────────────────────────────────────────────── */

export function CpuGraphWidget() {
  const [history, setHistory] = useState<number[]>(() => Array(48).fill(0))
  const last = useRef(0)
  usePoll(() => {
    void invoke<{ cpu: number }>('shell_system_load').then((l) => {
      last.current = l.cpu
      setHistory((h) => [...h.slice(1), l.cpu])
    }, () => {})
  }, 2000)
  const pts = history.map((v, i) => `${(i / (history.length - 1)) * 100},${100 - Math.min(100, v)}`).join(' ')
  return (
    <Tile className="flex flex-col gap-1 !p-3.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold text-(--u-ink-2)">Processor</p>
        <p className="text-[18px] font-light tabular-nums">{Math.round(last.current)}%</p>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 flex-1">
        <polyline points={`0,100 ${pts} 100,100`} fill="var(--u-wash-on)" stroke="none" />
        <polyline points={pts} fill="none" stroke="var(--u-ink)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </Tile>
  )
}
