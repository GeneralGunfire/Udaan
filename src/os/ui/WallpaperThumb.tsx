import { useEffect, useState } from 'react'
import { renderWallpaper } from '@/os/desktop/generatedWallpapers'
import { liveWallpaper, renderLiveStill } from '@/os/desktop/liveWallpapers'

export const SOLID_COLOURS = ['#0b0f16', '#1f2a44', '#2d4a3e', '#4a2d3e', '#3a3a3a', '#6b4f2a', '#0f5e9c', '#8a1c3a']

/**
 * A generated wallpaper rendered at thumbnail size (device pixels).
 *
 * A live wallpaper is drawn as one frame of its own shader, frozen: a
 * thumbnail that animated would hold a WebGL context and a render loop for
 * every tile in the gallery. If that frame cannot be rendered it falls back
 * to the wallpaper's static scene.
 */
export function GeneratedThumb({ id, width = 240, height = 150 }: { id: string; width?: number; height?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const renderId = liveWallpaper(id)?.fallback ?? id
  useEffect(() => {
    let cancelled = false
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(width * dpr)
    const h = Math.round(height * dpr)
    const job = liveWallpaper(id)
      ? renderLiveStill(id, w, h).then((u) => u ?? renderWallpaper(renderId, w, h))
      : renderWallpaper(renderId, w, h)
    void job.then((u) => !cancelled && setSrc(u))
    return () => {
      cancelled = true
    }
  }, [id, renderId, width, height])
  return src ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-[var(--surface-raised)]" />
}
