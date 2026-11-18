export interface Rect<T> {
  item: T
  x: number
  y: number
  w: number
  h: number
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk): lays items out as rectangles whose areas are proportional to
 * their values and whose shapes stay as close to square as possible, so small ones are still clickable.
 * Items must be sorted largest first.
 */
export function squarify<T>(items: { item: T; value: number }[], x: number, y: number, w: number, h: number): Rect<T>[] {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (!total || w <= 0 || h <= 0) return []
  const scale = (w * h) / total
  const queue = items.filter((i) => i.value > 0).map((i) => ({ item: i.item, area: i.value * scale }))
  const out: Rect<T>[] = []
  let rx = x
  let ry = y
  let rw = w
  let rh = h

  const worst = (row: { area: number }[], side: number) => {
    const s = row.reduce((a, r) => a + r.area, 0)
    const max = Math.max(...row.map((r) => r.area))
    const min = Math.min(...row.map((r) => r.area))
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }

  while (queue.length) {
    const side = Math.min(rw, rh)
    const row = [queue[0]]
    let i = 1
    while (i < queue.length && worst([...row, queue[i]], side) <= worst(row, side)) row.push(queue[i++])
    queue.splice(0, row.length)
    const sum = row.reduce((a, r) => a + r.area, 0)
    if (rw >= rh) {
      // A column down the left edge.
      const cw = sum / rh
      let cy = ry
      for (const r of row) {
        const ch = r.area / cw
        out.push({ item: r.item, x: rx, y: cy, w: cw, h: ch })
        cy += ch
      }
      rx += cw
      rw -= cw
    } else {
      // A row along the top edge.
      const rhh = sum / rw
      let cx = rx
      for (const r of row) {
        const cw = r.area / rhh
        out.push({ item: r.item, x: cx, y: ry, w: cw, h: rhh })
        cx += cw
      }
      ry += rhh
      rh -= rhh
    }
  }
  return out
}
