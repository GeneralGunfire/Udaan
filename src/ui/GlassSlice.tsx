import { useEffect, useMemo, useState } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { getWallpaper } from '@/app/wallpapers'

/**
 * A frosted-glass material for bars that sit directly over the desktop
 * wallpaper (the dock), made from the wallpaper itself.
 *
 * Why not real compositor blur? The dock's window spans the screen width so
 * it can hold hover labels and take clicks only where the bar is. The
 * compositor blurs a window's whole rectangle, so it cannot blur just the
 * bar. But the bar lives in a strip the desktop reserves for it: what is
 * behind it is always the wallpaper, which we know. So we paint a blurred
 * copy of it, aligned to the screen, and clip it to the bar.
 *
 * Cost: one tiny image (480px wide, ~0.5 MB decoded) scaled and blurred ONCE
 * into a compositor layer. No per-frame work, nothing while idle.
 *
 * The slice is positioned from its parent's page position so it lines up
 * with the real wallpaper pixels behind the bar. `edge` says which screen
 * edge the window is bound to.
 */
const W = 480
const H = 270

export function GlassSlice({ edge, parentRef }: { edge: 'top' | 'bottom'; parentRef: React.RefObject<HTMLElement | null> }) {
  const { wallpaperId } = useWallpaper()
  const wp = useMemo(() => getWallpaper(wallpaperId), [wallpaperId])
  const [src, setSrc] = useState('')
  const [rect, setRect] = useState({ x: 0, y: 0 })

  useEffect(() => {
    let cancelled = false
    setSrc('')
    if (!wp.src) return
    const load = async () => {
      let url = wp.src
      if (wp.id.startsWith('file:')) {
        try {
          url = convertFileSrc(await invoke<string>('wallpaper_fit', { path: wp.id.slice(5), width: W, height: H }))
        } catch {
          /* fall back to the original */
        }
      }
      if (!cancelled) setSrc(url)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [wp.id, wp.src])

  // Where the bar sits inside the window, so the slice can be offset back to the screen origin.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      // The bar slides vertically when auto-hiding; measure its resting position instead.
      const rest = el.offsetTop
      setRect({ x: Math.round(r.left), y: rest })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [parentRef])

  const sw = window.screen.width
  const sh = window.screen.height
  // The window is bound to a screen edge, so the bar's position on screen is known: a
  // bottom-bound window's bottom is the screen's bottom.
  const screenTop = (edge === 'bottom' ? sh - window.innerHeight : 0) + rect.y
  const PAD = 24 // overscan so the blur has pixels to sample at the bar's edges
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: 'inherit' }}>
      <span
        className="absolute"
        style={{
          inset: -PAD,
          backgroundColor: wp.color ?? '#0b0f16',
          backgroundImage: src ? `url("${src}")` : undefined,
          backgroundSize: `${sw}px ${sh}px`,
          backgroundPosition: `${PAD - rect.x}px ${PAD - screenTop}px`,
          filter: 'blur(14px) saturate(1.25)',
        }}
      />
    </span>
  )
}
