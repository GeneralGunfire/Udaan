import { invoke } from '@tauri-apps/api/core'
import { shell } from '@/os/kernel/shell'

/**
 * Pictures of open windows for the switcher, kept ready so it opens already full instead of filling in after it appears.
 * `warmSwitcher()` refreshes them quietly in the background after the foreground window changes (never while the PC is
 * short of memory); the switcher itself shows whatever is here at once and replaces it with fresh pictures a moment later.
 */
export const snapshotCache = new Map<number, string>()
export const iconCache = new Map<number, string | null>()

const WARM_WIDTH = 540

export async function captureSnapshots(handles: number[], width: number): Promise<Record<number, string>> {
  if (!handles.length) return {}
  const r = await invoke<Record<string, string | null>>('shell_window_snapshots', { handles, maxWidth: Math.round(width) }).catch(() => ({}) as Record<string, string | null>)
  const out: Record<number, string> = {}
  for (const [k, v] of Object.entries(r)) if (v) (out[Number(k)] = v), snapshotCache.set(Number(k), v)
  return out
}

let timer: ReturnType<typeof setTimeout> | undefined
let last = 0

/** Refreshes the cached pictures a moment after things settle. At most once every few seconds. */
export function warmSwitcher(delayMs = 700): void {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    if (document.documentElement.dataset.tier === 'tight') return
    if (performance.now() - last < 4000) return
    last = performance.now()
    const snap = await shell.snapshot().catch(() => null)
    if (!snap) return
    const live = new Set(snap.windows.map((w) => w.handle))
    for (const h of [...snapshotCache.keys()]) if (!live.has(h)) snapshotCache.delete(h)
    await captureSnapshots(snap.windows.filter((w) => !w.isMinimized).slice(0, 11).map((w) => w.handle), WARM_WIDTH * (window.devicePixelRatio || 1))
  }, delayMs)
}
