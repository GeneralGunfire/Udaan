import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { shell, type ShellWindow } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { playSound } from '@/os/sound/sounds'
import { Button, Slider } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'

/** A zone as fractions of the work area. */
interface Zone {
  x: number
  y: number
  w: number
  h: number
}

interface Layout {
  id: string
  name: string
  /** `r` is the adjustable main split (0.3–0.7). */
  zones: (r: number) => Zone[]
  adjustable?: boolean
}

const LAYOUTS: Layout[] = [
  { id: 'halves', name: 'Side by side', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: r, h: 1 }, { x: r, y: 0, w: 1 - r, h: 1 }] },
  { id: 'stack-left', name: 'Two left, one right', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: r, h: 0.5 }, { x: 0, y: 0.5, w: r, h: 0.5 }, { x: r, y: 0, w: 1 - r, h: 1 }] },
  { id: 'stack-right', name: 'One left, two right', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: r, h: 1 }, { x: r, y: 0, w: 1 - r, h: 0.5 }, { x: r, y: 0.5, w: 1 - r, h: 0.5 }] },
  { id: 'thirds', name: 'Three columns', zones: () => [0, 1, 2].map((i) => ({ x: i / 3, y: 0, w: 1 / 3, h: 1 })) },
  { id: 'focus-sides', name: 'Wide centre', zones: () => [{ x: 0, y: 0, w: 0.25, h: 1 }, { x: 0.25, y: 0, w: 0.5, h: 1 }, { x: 0.75, y: 0, w: 0.25, h: 1 }] },
  { id: 'quarters', name: 'Four corners', zones: () => [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { id: 'top-bottom', name: 'Top and bottom', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: 1, h: r }, { x: 0, y: r, w: 1, h: 1 - r }] },
  { id: 'big-top', name: 'Big top, two below', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: 1, h: r }, { x: 0, y: r, w: 0.5, h: 1 - r }, { x: 0.5, y: r, w: 0.5, h: 1 - r }] },
  { id: 'centre', name: 'Centred', zones: () => [{ x: 0.14, y: 0.05, w: 0.72, h: 0.9 }] },
]

const ZONE_COLOURS = ['#3072f0', '#4cd37b', '#f5a623', '#b36bf0']
const STORE = 'layouts.last'

function Preview({ zones, active, assigned, onZone, size = 'small' }: { zones: Zone[]; active?: number; assigned?: (string | null)[]; onZone?: (i: number) => void; size?: 'small' | 'large' }) {
  const big = size === 'large'
  return (
    <div className={cn('relative w-full overflow-hidden rounded-[8px] bg-(--u-wash-hover) shadow-[inset_0_0_0_1px_var(--u-edge)]', big ? 'aspect-[16/9]' : 'aspect-[16/10]')}>
      {zones.map((z, i) => (
        <button
          key={i}
          type="button"
          tabIndex={onZone ? 0 : -1}
          onClick={onZone ? () => onZone(i) : undefined}
          className={cn(
            'absolute flex items-center justify-center overflow-hidden rounded-[5px] border transition-colors',
            !onZone && 'pointer-events-none',
            active === i ? 'border-(--u-accent) bg-(--u-accent)/20' : 'border-(--u-edge-strong) bg-(--u-wash-on) hover:bg-(--u-wash-press)',
          )}
          style={{ left: `calc(${z.x * 100}% + 2px)`, top: `calc(${z.y * 100}% + 2px)`, width: `calc(${z.w * 100}% - 4px)`, height: `calc(${z.h * 100}% - 4px)` }}
        >
          {big && (
            <span className="flex flex-col items-center gap-0.5 px-1 text-center">
              <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-black" style={{ background: ZONE_COLOURS[i % 4] }}>
                {i + 1}
              </span>
              <span className="line-clamp-2 text-[11px] font-medium">{assigned?.[i] ?? 'Choose an app'}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Snap Layouts: pick an arrangement, choose an app per zone, and Udaan places them. */
export function LayoutsPanel({ onDone }: { onDone: () => void }) {
  const [windows, setWindows] = useState<ShellWindow[]>([])
  const [layout, setLayout] = useState<Layout | null>(null)
  const [ratio, setRatio] = useState(0.5)
  const [assign, setAssign] = useState<(ShellWindow | null)[]>([])
  const [zone, setZone] = useState(0)

  useEffect(() => {
    void shell.snapshot().then((s) => setWindows(s.windows), () => {})
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      if (saved?.ratio) setRatio(saved.ratio)
    } catch {
      /* none saved */
    }
  }, [])

  const zones = useMemo(() => layout?.zones(ratio) ?? [], [layout, ratio])

  const choose = (l: Layout) => {
    setLayout(l)
    setAssign(new Array(l.zones(ratio).length).fill(null))
    setZone(0)
  }

  const pick = (w: ShellWindow) => {
    const next = assign.map((a) => (a?.handle === w.handle ? null : a))
    next[zone] = w
    setAssign(next)
    const empty = next.findIndex((a) => !a)
    if (empty >= 0) setZone(empty)
  }

  const arrange = async () => {
    const pairs = zones.map((z, i) => [z, assign[i]] as const).filter(([, w]) => w)
    // Back to front, so zone 1's window ends up on top.
    for (const [z, w] of [...pairs].reverse()) {
      await invoke('shell_snap_window', { handle: w!.handle, zone: z }).catch(() => {})
      await shell.focus(w!.handle).catch(() => {})
    }
    try {
      localStorage.setItem(STORE, JSON.stringify({ id: layout?.id, ratio }))
    } catch {
      /* storage unavailable */
    }
    playSound('switch')
    onDone()
  }

  if (!layout) {
    return (
      <div className="p-4">
        <h2 className="text-[15px] font-semibold">Arrange windows</h2>
        <p className="mb-3 text-[12.5px] text-(--u-ink-3)">Pick a layout, then choose an app for each space.</p>
        <div className="grid grid-cols-3 gap-2">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" onClick={() => choose(l)} className="u-tile items-stretch gap-1.5 p-2 text-left">
              <Preview zones={l.zones(0.5)} />
              <span className="text-[11.5px] font-medium">{l.name}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const filled = assign.filter(Boolean).length
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" onClick={() => setLayout(null)}>
          ‹ Layouts
        </Button>
        <h2 className="flex-1 text-[14px] font-semibold">{layout.name}</h2>
      </div>
      <Preview size="large" zones={zones} active={zone} assigned={assign.map((a) => a?.title || a?.processName || null)} onZone={setZone} />
      {layout.adjustable && (
        <label className="mt-3 flex items-center gap-3 text-[12px] text-(--u-ink-2)">
          Split
          <Slider value={Math.round(ratio * 100)} min={30} max={70} step={5} aria-label="Split" onChange={(v) => setRatio(v / 100)} />
          <span className="w-16 text-right tabular-nums text-(--u-ink)">
            {Math.round(ratio * 100)} / {100 - Math.round(ratio * 100)}
          </span>
        </label>
      )}
      <p className="u-label mb-1.5 mt-3">
        Choose an app for space <span style={{ color: ZONE_COLOURS[zone % 4] }}>{zone + 1}</span>
      </p>
      <div className="u-scroll u-surface--card max-h-[220px] overflow-y-auto p-1">
        {windows.length === 0 && <p className="p-3 text-[12.5px] text-(--u-ink-3)">No windows open.</p>}
        {windows.map((w) => {
          const at = assign.findIndex((a) => a?.handle === w.handle)
          return (
            <button key={w.handle} type="button" onClick={() => pick(w)} className="u-row gap-2.5">
              {w.appId ? <AppIcon appId={w.appId} size={20} /> : <WindowIcon handle={w.handle} />}
              <span className="min-w-0 flex-1 truncate text-[13px]">{w.title || w.processName}</span>
              {at >= 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-black" style={{ background: ZONE_COLOURS[at % 4] }}>
                  {at + 1}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <Button variant="primary" size="lg" disabled={!filled} onClick={() => void arrange()} className="mt-3 w-full">
        {filled === zones.length ? 'Arrange windows' : `Arrange ${filled} of ${zones.length}`}
      </Button>
    </div>
  )
}

const iconCache = new Map<number, string | null>()
function WindowIcon({ handle }: { handle: number }) {
  const [src, setSrc] = useState(iconCache.get(handle) ?? null)
  useEffect(() => {
    if (iconCache.has(handle)) return
    void shell.windowIcons([handle]).then((r) => {
      iconCache.set(handle, r[handle] ?? null)
      setSrc(r[handle] ?? null)
    })
  }, [handle])
  return src ? <img src={src} alt="" className="h-5 w-5" /> : <span className="h-5 w-5 rounded bg-(--u-wash-on)" />
}
