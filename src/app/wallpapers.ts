import { convertFileSrc, invoke } from '@tauri-apps/api/core'

/**
 * Wallpapers are pictures from the user's wallpaper folders (`file:<path>`) or a
 * solid colour (`color:#rrggbb`). Nothing is bundled: the library, its packs,
 * rotation and per-picture fitting all live in the engine (`wallpaper_*`).
 */
export interface WallpaperDefinition {
  id: string
  label: string
  src: string
  color?: string
}

/** Nothing is chosen until the engine says so; the provider asks it for the first picture. */
export const DEFAULT_WALLPAPER_ID = ''

export function getWallpaper(id: string): WallpaperDefinition {
  if (id.startsWith('file:')) {
    const path = id.slice(5)
    return { id, label: (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, ''), src: convertFileSrc(path) }
  }
  if (id.startsWith('color:')) return { id, label: 'Solid colour', src: '', color: id.slice(6) }
  return { id: '', label: 'None', src: '', color: '#0b0f16' }
}

export function isValidWallpaperId(id: string): boolean {
  return id.startsWith('file:') || /^color:#[0-9a-f]{6}$/i.test(id)
}

/** The size of this screen in real pixels. */
export function screenPixels(): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1
  return { width: Math.round(window.screen.width * dpr), height: Math.round(window.screen.height * dpr) }
}

/**
 * What to draw for a wallpaper: the engine's copy made for exactly this screen (cropped around the
 * part of the picture that matters, resampled at high quality). Anything else draws as it is.
 */
export async function fittedWallpaperSrc(id: string): Promise<string> {
  const original = getWallpaper(id).src
  if (!id.startsWith('file:')) return original
  try {
    const { width, height } = screenPixels()
    return convertFileSrc(await invoke<string>('wallpaper_render', { path: id.slice(5), width, height }))
  } catch {
    return original
  }
}
