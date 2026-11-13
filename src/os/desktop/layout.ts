/** Pure desktop icon-grid logic. Windows lays icons out column-major from the top-left. */

export type IconSize = 'small' | 'medium' | 'large'
export type SortBy = 'name' | 'type' | 'modified' | 'size'

export const ICON_METRICS: Record<IconSize, { icon: number; cellW: number; cellH: number }> = {
  small: { icon: 32, cellW: 78, cellH: 78 },
  medium: { icon: 48, cellW: 90, cellH: 100 },
  large: { icon: 72, cellW: 114, cellH: 128 },
}

export const GRID_PADDING = { left: 10, top: 10 }

export interface Cell {
  col: number
  row: number
}

export interface Dims {
  cols: number
  rows: number
}

export function gridDims(width: number, height: number, size: IconSize): Dims {
  const m = ICON_METRICS[size]
  return {
    cols: Math.max(1, Math.floor((width - GRID_PADDING.left) / m.cellW)),
    rows: Math.max(1, Math.floor((height - GRID_PADDING.top) / m.cellH)),
  }
}

export const cellKey = (c: Cell) => `${c.col}:${c.row}`

export function cellToPx(c: Cell, size: IconSize): { x: number; y: number } {
  const m = ICON_METRICS[size]
  return { x: GRID_PADDING.left + c.col * m.cellW, y: GRID_PADDING.top + c.row * m.cellH }
}

export function pxToCell(x: number, y: number, size: IconSize, dims: Dims): Cell {
  const m = ICON_METRICS[size]
  return clampCell(
    { col: Math.round((x - GRID_PADDING.left) / m.cellW), row: Math.round((y - GRID_PADDING.top) / m.cellH) },
    dims,
  )
}

export function clampCell(c: Cell, dims: Dims): Cell {
  return {
    col: Math.min(dims.cols - 1, Math.max(0, c.col)),
    row: Math.min(dims.rows - 1, Math.max(0, c.row)),
  }
}

function inBounds(c: Cell, dims: Dims) {
  return c.col >= 0 && c.row >= 0 && c.col < dims.cols && c.row < dims.rows
}

/** Column-major index; cells past the grid spill into extra columns rather than being dropped. */
function cellAt(index: number, dims: Dims): Cell {
  return { col: Math.floor(index / dims.rows), row: index % dims.rows }
}

export function firstFree(occupied: Set<string>, dims: Dims, from = 0): Cell {
  for (let i = from; ; i++) {
    const c = cellAt(i, dims)
    if (!occupied.has(cellKey(c))) return c
  }
}

/**
 * Keeps every valid, non-colliding saved position and places everything
 * else in the first free cells. With `autoArrange`, saved positions are
 * ignored and items flow in the given order.
 */
export function assignPositions(
  orderedIds: string[],
  saved: Record<string, Cell>,
  dims: Dims,
  autoArrange: boolean,
): Record<string, Cell> {
  const out: Record<string, Cell> = {}
  const occupied = new Set<string>()
  if (!autoArrange) {
    for (const id of orderedIds) {
      const c = saved[id]
      if (c && inBounds(c, dims) && !occupied.has(cellKey(c))) {
        out[id] = c
        occupied.add(cellKey(c))
      }
    }
  }
  let cursor = 0
  for (const id of orderedIds) {
    if (out[id]) continue
    const c = firstFree(occupied, dims, cursor)
    out[id] = c
    occupied.add(cellKey(c))
    cursor = c.col * dims.rows + c.row + 1
  }
  return out
}

/**
 * Moves a selection by a cell delta, preserving its shape. Icons that
 * would land outside the grid are clamped; any that then collide with an
 * unmoved icon (or each other) take the nearest free cell after it.
 */
export function moveGroup(
  positions: Record<string, Cell>,
  ids: string[],
  delta: Cell,
  dims: Dims,
): Record<string, Cell> {
  const moving = new Set(ids)
  const next: Record<string, Cell> = {}
  const occupied = new Set<string>()
  for (const [id, c] of Object.entries(positions)) {
    if (!moving.has(id)) {
      next[id] = c
      occupied.add(cellKey(c))
    }
  }
  const ordered = [...ids].sort((a, b) => {
    const pa = positions[a]
    const pb = positions[b]
    return pa.col - pb.col || pa.row - pb.row
  })
  for (const id of ordered) {
    const from = positions[id]
    let c = clampCell({ col: from.col + delta.col, row: from.row + delta.row }, dims)
    if (occupied.has(cellKey(c))) c = firstFree(occupied, dims, c.col * dims.rows + c.row)
    next[id] = c
    occupied.add(cellKey(c))
  }
  return next
}

export interface SortableItem {
  id: string
  name: string
  isDir: boolean
  extension: string
  modifiedMs: number
  sizeBytes: number
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then by key; names compare "naturally" (file2 < file10), like Explorer. */
export function sortItems<T extends SortableItem>(items: T[], by: SortBy): T[] {
  return [...items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let d = 0
    if (by === 'type') d = collator.compare(a.extension, b.extension)
    else if (by === 'modified') d = b.modifiedMs - a.modifiedMs
    else if (by === 'size') d = b.sizeBytes - a.sizeBytes
    return d || collator.compare(a.name, b.name)
  })
}

/** Which cells a screen-space rectangle touches (rubber-band selection). */
export function intersects(
  rect: { x: number; y: number; w: number; h: number },
  cell: Cell,
  size: IconSize,
): boolean {
  const m = ICON_METRICS[size]
  const { x, y } = cellToPx(cell, size)
  const pad = 6
  return !(rect.x > x + m.cellW - pad || rect.x + rect.w < x + pad || rect.y > y + m.cellH - pad || rect.y + rect.h < y + pad)
}
