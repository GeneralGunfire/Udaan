import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { cn } from '@/shared/lib/cn'
import { TrashGlyph } from '@/os/ui/icons/SystemGlyphs'
import { fileKind } from '@/features/file-explorer/lib/fileKind'
import { iconForKind } from '@/features/file-explorer/lib/iconForKind'
import {
  ICON_METRICS,
  assignPositions,
  cellKey,
  cellToPx,
  gridDims,
  intersects,
  moveGroup,
  pxToCell,
  sortItems,
  type Cell,
  type IconSize,
} from './layout'
import type { DesktopItem, DesktopPrefs } from './useDesktopItems'

interface Props {
  items: DesktopItem[]
  prefs: DesktopPrefs
  width: number
  height: number
  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void
  renamingId: string | null
  onRenameStart: (id: string) => void
  onRenameCommit: (item: DesktopItem, newLabel: string) => void
  onRenameCancel: () => void
  onPositionsChange: (positions: Record<string, Cell>) => void
  onOpen: (items: DesktopItem[]) => void
  onMoveInto: (items: DesktopItem[], folder: DesktopItem) => void
}

interface DragState {
  anchorId: string
  startX: number
  startY: number
  dx: number
  dy: number
  active: boolean
}

const DRAG_THRESHOLD = 4

function KindIcon({ item, size }: { item: DesktopItem; size: number }) {
  if (item.system === 'recycle-bin') return <TrashGlyph size={size} full={!!item.binFull} />
  if (item.system === 'quickstart') return <QuickstartGlyph size={size} />
  return createElement(iconForKind(fileKind(item.extension, item.isDir)), { className: 'h-4/5 w-4/5 text-white/85' })
}

/** A tiled-windows mark, so a quickstart reads as "a arrangement of apps". */
function QuickstartGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" style={{ width: size * 0.8, height: size * 0.8 }}>
      <defs>
        <linearGradient id="qs-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent-alt)" />
          <stop offset="1" stopColor="var(--color-accent)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#qs-plate)" />
      <g fill="#fff">
        <rect x="9" y="10" width="13" height="12" rx="2.5" />
        <rect x="26" y="10" width="13" height="12" rx="2.5" fillOpacity="0.75" />
        <rect x="9" y="26" width="13" height="12" rx="2.5" fillOpacity="0.75" />
        <rect x="26" y="26" width="13" height="12" rx="2.5" />
      </g>
    </svg>
  )
}

const IconTile = memo(function IconTile({
  item,
  size,
  selected,
  dropTarget,
  renaming,
  dragging,
  offset,
  onPointerDown,
  onDoubleClick,
  onRenameCommit,
  onRenameCancel,
}: {
  item: DesktopItem
  size: IconSize
  selected: boolean
  dropTarget: boolean
  renaming: boolean
  dragging: boolean
  offset: { x: number; y: number } | null
  onPointerDown: (e: RPointerEvent, item: DesktopItem) => void
  onDoubleClick: (item: DesktopItem) => void
  onRenameCommit: (item: DesktopItem, label: string) => void
  onRenameCancel: () => void
}) {
  const m = ICON_METRICS[size]
  return (
    <div
      data-desktop-icon={item.id}
      onPointerDown={(e) => onPointerDown(e, item)}
      onDoubleClick={() => onDoubleClick(item)}
      className={cn(
        'group absolute flex flex-col items-center gap-1 rounded-[6px] border px-1 pb-1.5 pt-2 outline-none',
        selected ? 'border-[var(--os-selection-border)] bg-[var(--os-selection-fill)]' : 'border-transparent hover:bg-[var(--os-menu-item-hover)]',
        dropTarget && 'border-[var(--os-selection-border)] bg-[var(--surface-hover)]',
        dragging && 'pointer-events-none opacity-70',
      )}
      style={{
        width: m.cellW - 4,
        transform: offset ? `translate3d(${offset.x}px, ${offset.y}px, 0)` : undefined,
        zIndex: dragging ? 5 : undefined,
      }}
    >
      <div className="relative flex items-center justify-center" style={{ width: m.icon, height: m.icon }}>
        {item.iconUrl ? (
          <img src={item.iconUrl} alt="" draggable={false} className="h-full w-full object-contain drop-shadow-[0_2px_4px_rgb(0_0_0/45%)]" />
        ) : (
          <KindIcon item={item} size={m.icon} />
        )}
        {item.isShortcut && (
          <svg viewBox="0 0 16 16" className="absolute bottom-0 left-0 h-[36%] w-[36%]">
            <rect x="0.5" y="0.5" width="15" height="15" rx="2" fill="#fff" stroke="#8a8a8a" />
            <path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6H11M9 4l2 2-2 2" fill="none" stroke="#1e6fd9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {renaming ? (
        <RenameField item={item} onCommit={onRenameCommit} onCancel={onRenameCancel} />
      ) : (
        <span
          className={cn(
            'w-full break-words text-center text-[12px] leading-[15px] text-white',
            selected ? 'line-clamp-none' : 'line-clamp-2',
          )}
          style={{ textShadow: selected ? undefined : 'var(--os-icon-label-shadow)' }}
        >
          {item.label}
        </span>
      )}
    </div>
  )
})

function RenameField({ item, onCommit, onCancel }: { item: DesktopItem; onCommit: (i: DesktopItem, v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Like Explorer: select the name, not the extension.
    const dot = item.isDir || item.isShortcut ? -1 : item.label.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : item.label.length)
  }, [item])
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const v = ref.current?.value.trim() ?? ''
    if (commit && v && v !== item.label) onCommit(item, v)
    else onCancel()
  }
  return (
    <textarea
      ref={ref}
      defaultValue={item.label}
      rows={2}
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') finish(false)
      }}
      className="w-full resize-none rounded-[3px] border border-[var(--os-selection-border)] bg-[var(--surface-overlay)] px-1 text-center text-[12px] leading-[15px] text-white outline-none"
    />
  )
}

export function DesktopIcons({
  items,
  prefs,
  width,
  height,
  selected,
  onSelectedChange,
  renamingId,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onPositionsChange,
  onOpen,
  onMoveInto,
}: Props) {
  const size = prefs.iconSize
  const m = ICON_METRICS[size]
  const dims = useMemo(() => gridDims(width, height, size), [width, height, size])
  const ordered = useMemo(() => [...items.filter((i) => i.system), ...sortItems(items.filter((i) => !i.system), prefs.sortBy)], [items, prefs.sortBy])
  const positions = useMemo(
    () => assignPositions(ordered.map((i) => i.id), prefs.positions, dims, prefs.autoArrange),
    [ordered, prefs.positions, dims, prefs.autoArrange],
  )
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const [drag, setDrag] = useState<DragState | null>(null)
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number; additive: Set<string> } | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const anchorRef = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Persist positions once so newly placed icons stay put on the next load.
  useEffect(() => {
    if (prefs.autoArrange) return
    const saved = prefs.positions
    const changed = ordered.some((i) => !saved[i.id] || cellKey(saved[i.id]) !== cellKey(positions[i.id]))
    if (changed && ordered.length) onPositionsChange(positions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions])

  const dropFolder = useMemo(() => {
    if (!drag?.active) return null
    const anchor = positions[drag.anchorId]
    if (!anchor) return null
    const p = cellToPx(anchor, size)
    const target = pxToCell(p.x + drag.dx, p.y + drag.dy, size, dims)
    const hit = ordered.find((i) => (i.isDir || i.system === 'recycle-bin') && !selected.has(i.id) && cellKey(positions[i.id]) === cellKey(target))
    return hit ?? null
  }, [drag, positions, size, dims, ordered, selected])

  const onIconPointerDown = useCallback(
    (e: RPointerEvent, item: DesktopItem) => {
      if (e.button === 2) {
        if (!selected.has(item.id)) onSelectedChange(new Set([item.id]))
        setFocusId(item.id)
        return
      }
      if (e.button !== 0) return
      e.stopPropagation()
      rootRef.current?.focus()
      setFocusId(item.id)
      if (e.ctrlKey) {
        const next = new Set(selected)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        onSelectedChange(next)
        anchorRef.current = item.id
        return
      }
      if (e.shiftKey && anchorRef.current) {
        const ids = ordered.map((i) => i.id)
        const a = ids.indexOf(anchorRef.current)
        const b = ids.indexOf(item.id)
        onSelectedChange(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)))
        return
      }
      if (!selected.has(item.id)) onSelectedChange(new Set([item.id]))
      anchorRef.current = item.id
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDrag({ anchorId: item.id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, active: false })
    },
    [selected, onSelectedChange, ordered],
  )

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      setDrag((d) => {
        if (!d) return d
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        return { ...d, dx, dy, active: d.active || Math.hypot(dx, dy) > DRAG_THRESHOLD }
      })
    }
    const up = () => {
      setDrag((d) => {
        if (d?.active) {
          const moving = [...selected].filter((id) => positions[id])
          if (dropFolder) {
            onMoveInto(moving.map((id) => byId.get(id)!).filter(Boolean), dropFolder)
          } else {
            const anchor = positions[d.anchorId]
            const p = cellToPx(anchor, size)
            const target = pxToCell(p.x + d.dx, p.y + d.dy, size, dims)
            const delta = { col: target.col - anchor.col, row: target.row - anchor.row }
            // With auto-arrange on, Explorer snaps icons back into order.
            if ((delta.col || delta.row) && !prefs.autoArrange) {
              onPositionsChange(moveGroup(positions, moving, delta, dims))
            }
          }
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, selected, positions, size, dims, dropFolder, byId, onMoveInto, onPositionsChange, prefs.autoArrange])

  const onBackgroundPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return
    rootRef.current?.focus()
    const rect = rootRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const additive = e.ctrlKey ? new Set(selected) : new Set<string>()
    if (!e.ctrlKey) onSelectedChange(new Set())
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setBand({ x0: x, y0: y, x1: x, y1: y, additive })
  }

  const onBackgroundPointerMove = (e: RPointerEvent) => {
    if (!band) return
    const rect = rootRef.current!.getBoundingClientRect()
    const next = { ...band, x1: e.clientX - rect.left, y1: e.clientY - rect.top }
    setBand(next)
    const r = { x: Math.min(next.x0, next.x1), y: Math.min(next.y0, next.y1), w: Math.abs(next.x1 - next.x0), h: Math.abs(next.y1 - next.y0) }
    const hit = new Set(band.additive)
    for (const i of ordered) if (intersects(r, positions[i.id], size)) hit.add(i.id)
    onSelectedChange(hit)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const sel = [...selected].map((id) => byId.get(id)).filter((i): i is DesktopItem => !!i)
    if (e.key === 'Enter' && !e.altKey && sel.length) {
      e.preventDefault()
      onOpen(sel)
      return
    }
    if (e.key === 'F2' && sel.length === 1) {
      e.preventDefault()
      onRenameStart(sel[0].id)
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onSelectedChange(new Set(items.map((i) => i.id)))
      return
    }
    const dir: Record<string, Cell> = { ArrowUp: { col: 0, row: -1 }, ArrowDown: { col: 0, row: 1 }, ArrowLeft: { col: -1, row: 0 }, ArrowRight: { col: 1, row: 0 } }
    const d = dir[e.key]
    if (!d) return
    e.preventDefault()
    const from = focusId && positions[focusId] ? positions[focusId] : null
    if (!from) {
      const first = ordered[0]
      if (first) {
        setFocusId(first.id)
        onSelectedChange(new Set([first.id]))
      }
      return
    }
    // Nearest icon in that direction (Explorer navigates to occupied cells, skipping gaps).
    let best: { id: string; score: number } | null = null
    for (const i of ordered) {
      const c = positions[i.id]
      const dc = c.col - from.col
      const dr = c.row - from.row
      const along = d.col ? dc * d.col : dr * d.row
      const across = d.col ? Math.abs(dr) : Math.abs(dc)
      if (along <= 0) continue
      const score = along * 10 + across * 11
      if (!best || score < best.score) best = { id: i.id, score }
    }
    if (best) {
      setFocusId(best.id)
      if (e.shiftKey) onSelectedChange(new Set([...selected, best.id]))
      else onSelectedChange(new Set([best.id]))
      anchorRef.current = best.id
    }
  }

  const bandRect = band && {
    left: Math.min(band.x0, band.x1),
    top: Math.min(band.y0, band.y1),
    width: Math.abs(band.x1 - band.x0),
    height: Math.abs(band.y1 - band.y0),
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="listbox"
      aria-label="Desktop"
      aria-multiselectable
      className="absolute inset-0 outline-none"
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onBackgroundPointerMove}
      onPointerUp={() => setBand(null)}
      onKeyDown={onKeyDown}
    >
      {prefs.showIcons &&
        ordered.map((item) => {
          const c = positions[item.id]
          if (!c) return null
          const { x, y } = cellToPx(c, size)
          const isDragging = !!drag?.active && selected.has(item.id)
          return (
            <div key={item.id} className="absolute" style={{ left: x + 2, top: y, width: m.cellW }}>
              <IconTile
                item={item}
                size={size}
                selected={selected.has(item.id)}
                dropTarget={dropFolder?.id === item.id}
                renaming={renamingId === item.id}
                dragging={isDragging}
                offset={isDragging && drag ? { x: drag.dx, y: drag.dy } : null}
                onPointerDown={onIconPointerDown}
                onDoubleClick={(i) => onOpen([i])}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
              />
            </div>
          )
        })}
      {bandRect && bandRect.width + bandRect.height > 4 && (
        <div
          className="pointer-events-none absolute border border-[var(--os-selection-border)] bg-[var(--os-selection-fill)]"
          style={bandRect}
        />
      )}
    </div>
  )
}
