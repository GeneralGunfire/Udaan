import { useEffect, useState } from 'react'
import { renderWallpaper } from '@/os/desktop/generatedWallpapers'

export const SOLID_COLOURS = ['#0b0f16', '#1f2a44', '#2d4a3e', '#4a2d3e', '#3a3a3a', '#6b4f2a', '#0f5e9c', '#8a1c3a']

/** A generated wallpaper rendered at thumbnail size (device pixels). */
export function GeneratedThumb({ id, width = 240, height = 150 }: { id: string; width?: number; height?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const dpr = window.devicePixelRatio || 1
    void renderWallpaper(id, Math.round(width * dpr), Math.round(height * dpr)).then((u) => !cancelled && setSrc(u))
    return () => {
      cancelled = true
    }
  }, [id, width, height])
  return src ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-[var(--surface-raised)]" />
}
