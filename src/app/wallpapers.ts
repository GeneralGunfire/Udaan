import { convertFileSrc } from '@tauri-apps/api/core'
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
