import { memo, useEffect, useState } from 'react'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { fittedWallpaperSrc, getWallpaper } from '@/app/wallpapers'

/**
 * The desktop wallpaper: the engine's screen-sized picture, crossfaded when it changes.
 *
 * The picture is already exactly the screen's size and shape, so it is drawn 1:1 with no scaling
 * here. A new picture is decoded before it is shown, and the old one stays underneath until the
 * fade finishes, so the desktop is never blank between two wallpapers.
 *
 * The desktop webview is never hidden by the governor (a hidden webview repaints blank), so the
 * wallpaper stays put when windows open, move or maximise over it.
 */
export const Wallpaper = memo(function Wallpaper({ dim = 0 }: { dim?: number; covered?: boolean; animated?: boolean }) {
  const { wallpaperId } = useWallpaper()
  const wp = getWallpaper(wallpaperId)
  const [layers, setLayers] = useState<{ key: number; src: string }[]>([])

  useEffect(() => {
    if (!wp.src) return void setLayers([])
    let cancelled = false
    void fittedWallpaperSrc(wp.id).then(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode().catch(() => undefined)
      if (cancelled) return
      setLayers((l) => [...l.slice(-1), { key: Date.now(), src }])
      // Once the new picture has faded in, drop the one beneath it.
      setTimeout(() => !cancelled && setLayers((l) => l.slice(-1)), 900)
    })
    return () => {
      cancelled = true
    }
  }, [wp.id, wp.src])

  return (
    <div className="fixed -inset-1 overflow-hidden" style={{ background: wp.color ?? '#0b0f16' }}>
      {layers.map((l, i) => (
        <img key={l.key} src={l.src} alt="" aria-hidden draggable={false} className={`absolute inset-0 h-full w-full select-none ${i === layers.length - 1 && layers.length > 1 ? 'u-wp-in' : ''}`} style={{ objectFit: 'cover' }} />
      ))}
      {dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />}
    </div>
  )
})
