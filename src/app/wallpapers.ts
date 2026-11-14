import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { GENERATED_WALLPAPERS } from '@/os/desktop/generatedWallpapers'
import { LIVE_WALLPAPERS, liveWallpaper } from '@/os/desktop/liveWallpapers'

export interface WallpaperDefinition {
  id: string
  label: string
  src: string
}

/**
 * Photo wallpapers bundled with Udaan. Intentionally empty: the previous
 * set was below display resolution and carried a stock-site watermark.
 * The generated and live sets render on the GPU at native resolution, and
 * any photo on disk can be chosen in Settings.
 */
export const WALLPAPERS: WallpaperDefinition[] = []

export const DEFAULT_WALLPAPER_ID = 'gen:sequoia'

/**
 * Besides the built-ins, a wallpaper id can be `file:<absolute path>` (any
 * picture on disk, served through Tauri's asset protocol) or
 * `color:#rrggbb` (a solid colour), like Windows' Personalize options.
 *
 * A `live:` id resolves to its own static fallback scene here, because this
 * function answers "what bitmap goes behind the desktop" — the animated
 * layer is drawn on top of that by Wallpaper.tsx.
 */
export function getWallpaper(id: string): WallpaperDefinition & { color?: string; generated?: boolean } {
  if (id.startsWith('live:')) {
    const live = liveWallpaper(id)
    return live ? getWallpaper(live.fallback) : getWallpaper(DEFAULT_WALLPAPER_ID)
  }
  if (id.startsWith('gen:')) {
    const g = GENERATED_WALLPAPERS.find((w) => w.id === id)
    return { id, label: g?.label ?? 'Generated', src: '', generated: true }
  }
  if (id.startsWith('file:')) {
    const path = id.slice(5)
    return { id, label: path.split(/[\\/]/).pop() ?? path, src: convertFileSrc(path) }
  }
  if (id.startsWith('color:')) {
    return { id, label: 'Solid colour', src: '', color: id.slice(6) }
  }
  return WALLPAPERS.find((w) => w.id === id) ?? getWallpaper(DEFAULT_WALLPAPER_ID)
}

export function isValidWallpaperId(id: string): boolean {
  return (
    GENERATED_WALLPAPERS.some((w) => w.id === id) ||
    LIVE_WALLPAPERS.some((w) => w.id === id) ||
    id.startsWith('file:') ||
    /^color:#[0-9a-f]{6}$/i.test(id) ||
    WALLPAPERS.some((w) => w.id === id)
  )
}

/**
 * What to actually draw for a wallpaper. A picture from disk is asked of the engine's
 * wallpaper service at this screen's size: a cached, screen-sized copy that decodes to a
 * fraction of the memory of the original (a 5120x2880 image is ~59 MB decoded, a
 * 1920x1080 copy ~8 MB). Anything else, or if the service fails, draws as before.
 */
export async function fittedWallpaperSrc(id: string): Promise<string> {
  const original = getWallpaper(id).src
  if (!id.startsWith('file:')) return original
  try {
    const dpr = window.devicePixelRatio || 1
    const fitted = await invoke<string>('wallpaper_fit', {
      path: id.slice(5),
      width: Math.round(window.screen.width * dpr),
      height: Math.round(window.screen.height * dpr),
    })
    return convertFileSrc(fitted)
  } catch {
    return original
  }
}
