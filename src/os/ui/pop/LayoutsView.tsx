import { useMemo, useState, type ReactNode } from 'react'
import { Slider } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { PopIcon } from './icons'
import { Surface } from './Surface'
import { POP_W, PopHeader } from './TopbarPopups'

/**
 * ARRANGE WINDOWS. Step one: pick a layout. Step two: see its spaces, adjust the split where the layout allows it, and
 * choose WHICH window goes in each space; then Arrange places them all. The caller supplies the open windows and does
 * the arranging (`onArrange`).
 */

/** A zone as fractions of the work area. */
export interface Zone {
  x: number
  y: number
  w: number
  h: number
}

export interface Layout {
  id: string
  name: string
  /** `r` is the adjustable main split (0.3 to 0.7). */
  zones: (r: number) => Zone[]
  adjustable?: boolean
}

export const LAYOUTS: Layout[] = [
  { id: 'halves', name: 'Side by side', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: r, h: 1 }, { x: r, y: 0, w: 1 - r, h: 1 }] },
  { id: 'stack-left', name: 'Two left, one right', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: r, h: 0.5 }, { x: 0, y: 0.5, w: r, h: 0.5 }, { x: r, y: 0, w: 1 - r, h: 1 }] },
  { id: 'stack-right', name: 'One left, two right', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: r, h: 1 }, { x: r, y: 0, w: 1 - r, h: 0.5 }, { x: r, y: 0.5, w: 1 - r, h: 0.5 }] },
  { id: 'thirds', name: 'Three columns', zones: () => [0, 1, 2].map((i) => ({ x: i / 3, y: 0, w: 1 / 3, h: 1 })) },
  { id: 'focus-sides', name: 'Wide centre', zones: () => [{ x: 0, y: 0, w: 0.25, h: 1 }, { x: 0.25, y: 0, w: 0.5, h: 1 }, { x: 0.75, y: 0, w: 0.25, h: 1 }] },
  { id: 'quarters', name: 'Four corners', zones: () => [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { id: 'top-bottom', name: 'Top and bottom', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: 1, h: r }, { x: 0, y: r, w: 1, h: 1 - r }] },
  { id: 'big-top', name: 'Big top, two below', adjustable: true, zones: (r) => [{ x: 0, y: 0, w: 1, h: r }, { x: 0, y: r, w: 0.5, h: 1 - r }, { x: 0.5, y: r, w: 0.5, h: 1 - r }] },
  { id: 'centre', name: 'Centred', zones: () => [{ x: 0.15, y: 0.1, w: 0.7, h: 0.8 }] },
]

const ZONE_COLOURS = ['var(--u-accent,#3072f0)', '#34c759', '#ff9f0a', '#bf5af2']

/** An open window a space can take. `icon` is drawn by the caller (an app icon or the window's own). */
export interface LayoutWindow {
  handle: number
  title: string
  icon?: ReactNode
}

function ZonePreview({ zones, active, labels, onZone, large }: { zones: Zone[]; active?: number; labels?: (string | null)[]; onZone?: (i: number) => void; large?: boolean }) {
  return (
    <span className={cn('relative block w-full overflow-hidden rounded-[10px] bg-black/30 shadow-[inset_0_0_0_1px_rgb(255_255_255/.1)]', large ? 'aspect-[16/9]' : 'aspect-[16/10]')}>
      {zones.map((z, i) => (
        <span
          key={i}
          role={onZone ? 'button' : undefined}
          tabIndex={onZone ? 0 : -1}
          onClick={onZone ? () => onZone(i) : undefined}
          onKeyDown={onZone ? (e) => (e.key === 'Enter' || e.key === ' ') && onZone(i) : undefined}
          className={cn(
            'absolute flex items-center justify-center overflow-hidden rounded-[6px] border transition-colors',
            onZone ? 'cursor-pointer' : 'pointer-events-none',
            active === i ? 'border-white/70 bg-white/25' : 'border-white/15 bg-white/[0.12] hover:bg-white/[0.18] group-hover:bg-(--u-accent,#3072f0)',
          )}
          style={{ left: `calc(${z.x * 100}% + 2px)`, top: `calc(${z.y * 100}% + 2px)`, width: `calc(${z.w * 100}% - 4px)`, height: `calc(${z.h * 100}% - 4px)` }}
        >
          {large && (
            <span className="flex flex-col items-center gap-0.5 px-1 text-center">
              <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-black" style={{ background: ZONE_COLOURS[i % 4] }}>
                {i + 1}
              </span>
              <span className="line-clamp-2 text-[11px] font-medium leading-tight">{labels?.[i] ?? 'Choose a window'}</span>
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

export function LayoutsView({
  windows,
  onArrange,
  ratio: initialRatio = 0.5,
  onRatio,
  sub,
}: {
  windows: LayoutWindow[]
  onArrange: (zones: Zone[], assigned: (LayoutWindow | null)[], layout: Layout, ratio: number) => void
  ratio?: number
  onRatio?: (r: number) => void
  sub?: string
}) {
  const [layout, setLayout] = useState<Layout | null>(null)
  const [ratio, setRatio] = useState(initialRatio)
  const [assign, setAssign] = useState<(LayoutWindow | null)[]>([])
  const [zone, setZone] = useState(0)
  const zones = useMemo(() => layout?.zones(ratio) ?? [], [layout, ratio])

  const choose = (l: Layout) => {
    setLayout(l)
    setAssign(new Array(l.zones(ratio).length).fill(null))
    setZone(0)
  }
  const pick = (w: LayoutWindow) => {
    const next = assign.map((a) => (a?.handle === w.handle ? null : a))
    next[zone] = w
    setAssign(next)
    const empty = next.findIndex((a) => !a)
    if (empty >= 0) setZone(empty)
  }
  /** One tap: the open windows, front first, fill the spaces in order. */
  const autoFill = () => {
    setAssign(zones.map((_, i) => windows[i] ?? null))
    setZone(Math.min(zones.length - 1, windows.length))
  }

  if (!layout) {
    return (
      <Surface radius={24} className="pop-in" style={{ width: POP_W }}>
        <PopHeader icon="layout" title="Arrange windows" sub={sub ?? 'Pick a layout, then choose a window for each space'} />
        <div className="grid grid-cols-3 gap-2.5 px-4 pb-4 pt-3">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" className="group flex flex-col items-center gap-1.5 rounded-[14px] p-2 transition-colors hover:bg-white/[0.08]" onClick={() => choose(l)}>
              <ZonePreview zones={l.zones(0.5)} />
              <span className="text-[11.5px] leading-tight text-(--u-ink-2)">{l.name}</span>
            </button>
          ))}
        </div>
      </Surface>
    )
  }

  const filled = assign.filter(Boolean).length
  const pct = Math.round(ratio * 100)
  return (
    <Surface radius={24} className="pop-in" style={{ width: POP_W }}>
      <div className="flex items-center gap-2 px-3 pb-1 pt-3.5">
        <button type="button" className="pop-btn" onClick={() => setLayout(null)}>
          <PopIcon name="chevron" size={12} style={{ transform: 'scaleX(-1)' }} /> Layouts
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{layout.name}</h2>
        <button type="button" className="pop-btn disabled:opacity-40" disabled={!windows.length} onClick={autoFill}>
          Auto-fill
        </button>
      </div>
      <div className="px-4 pt-2">
        <ZonePreview large zones={zones} active={zone} labels={assign.map((a) => a?.title ?? null)} onZone={setZone} />
        {layout.adjustable && (
          <label className="mt-3 flex items-center gap-3 text-[12px] text-(--u-ink-3)">
            Split
            <Slider aria-label="Split" value={pct} min={30} max={70} step={5} onChange={(v) => (setRatio(v / 100), onRatio?.(v / 100))} className="flex-1" />
            <span className="w-14 text-right tabular-nums text-(--u-ink)">{pct} / {100 - pct}</span>
          </label>
        )}
        <p className="pop-label mb-1.5 mt-3">
          Choose a window for space <span style={{ color: ZONE_COLOURS[zone % 4] }}>{zone + 1}</span>
        </p>
        <div className="pop-scroll max-h-[210px] overflow-y-auto rounded-[14px] bg-white/[0.07] p-1">
          {windows.length === 0 && <p className="p-3 text-[12.5px] text-(--u-ink-3)">No windows are open.</p>}
          {windows.map((w) => {
            const at = assign.findIndex((a) => a?.handle === w.handle)
            return (
              <button key={w.handle} type="button" className="pop-row w-full" onClick={() => pick(w)}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">{w.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{w.title}</span>
                {at >= 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-black" style={{ background: ZONE_COLOURS[at % 4] }}>
                    {at + 1}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <button type="button" disabled={!filled} className="pop-btn pop-btn--accent h-10 w-full text-[13.5px] disabled:opacity-40" onClick={() => onArrange(zones, assign, layout, ratio)}>
          {filled === zones.length ? 'Arrange windows' : `Arrange ${filled} of ${zones.length}`}
        </button>
      </div>
    </Surface>
  )
}

const DEMO_WINDOWS: LayoutWindow[] = ['Quarterly report · Files', 'Mira · Chat', 'Calendar', 'Notes', 'Late Night Drive · Music'].map((title, i) => ({ handle: i + 1, title, icon: <PopIcon name="window" size={16} /> }))

/** The design gallery's version, with pretend windows. */
export function LayoutsPopup() {
  return <LayoutsView windows={DEMO_WINDOWS} onArrange={() => {}} />
}
