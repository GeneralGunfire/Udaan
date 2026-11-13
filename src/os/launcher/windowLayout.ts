import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { ShellWindow } from '@/os/kernel/shell'

export interface Tile {
  w: ShellWindow
  x: number
  y: number
  width: number
  height: number
}

/** Each window's restored size (physical px); falls back to 16:10 when unknown. */
export function useWindowSizes(handles: number[]) {
  const [sizes, setSizes] = useState<Record<number, [number, number]> | null>(null)
  const key = handles.join(',')
  useEffect(() => {
    let cancelled = false
    void invoke<Record<string, [number, number]>>('shell_window_sizes', { handles: key ? key.split(',').map(Number) : [] }).then(
      (r) => !cancelled && setSizes(Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), v]))),
      () => !cancelled && setSizes({}),
    )
    return () => {
      cancelled = true
    }
  }, [key])
  return sizes
}

export function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vp
}

const sizeOf = (w: ShellWindow, sizes: Record<number, [number, number]>) => sizes[w.handle] ?? [1280, 800]

/**
 * Mission-Control grid: tries every column count and keeps the one where
 * the smallest window ends up largest. Rows are centred.
 */
export function gridLayout(
  windows: ShellWindow[],
  sizes: Record<number, [number, number]>,
  area: { x: number; y: number; w: number; h: number },
  opts: { gap: number; label: number; maxScale: number },
): Tile[] {
  const n = windows.length
  let best: Tile[] = []
  let bestScale = 0
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cellW = (area.w - opts.gap * (cols - 1)) / cols
    const cellH = (area.h - opts.gap * (rows - 1)) / rows - opts.label
    if (cellW <= 40 || cellH <= 40) continue
    const tiles: Tile[] = []
    let minScale = Infinity
    windows.forEach((w, i) => {
      const [sw, sh] = sizeOf(w, sizes)
      const scale = Math.min(cellW / sw, cellH / sh, opts.maxScale)
      minScale = Math.min(minScale, scale)
      const width = sw * scale
      const height = sh * scale
      const col = i % cols
      const row = Math.floor(i / cols)
      const inRow = Math.min(cols, n - row * cols)
      const rowOffset = ((cols - inRow) * (cellW + opts.gap)) / 2
      tiles.push({
        w,
        x: area.x + rowOffset + col * (cellW + opts.gap) + (cellW - width) / 2,
        y: area.y + row * (cellH + opts.label + opts.gap) + (cellH - height) / 2,
        width,
        height,
      })
    })
    if (minScale > bestScale) {
      bestScale = minScale
      best = tiles
    }
  }
  return best
}
