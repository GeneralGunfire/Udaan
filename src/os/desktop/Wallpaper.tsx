import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { fittedWallpaperSrc, getWallpaper } from '@/app/wallpapers'
import { dur, curve } from '@/os/motion/systemMotion'
import { renderWallpaper } from './generatedWallpapers'
import { isLive, liveWallpaper } from './liveWallpapers'
import { LiveWallpaperCanvas } from './LiveWallpaperCanvas'

/**
 * The desktop wallpaper.
 *
 * Three kinds, in order of preference:
 *   live:*   an animated shader (see liveWallpapers.ts)
 *   gen:*    a shader rendered once to a bitmap
 *   file:/color:  a picture on disk, or a flat colour
 *
 * A live wallpaper always renders its static fallback underneath. That is
 * not redundancy for its own sake: the shader takes a frame or two to
 * compile and may fail outright on old hardware, and a desktop that flashes
 * black before its wallpaper appears looks broken in a way the wallpaper
 * itself can never make up for.
 */
export const Wallpaper = memo(function Wallpaper({
  dim = 0,
  covered = false,
  animated = false,
}: {
  dim?: number
  /** Something opaque is on top of the whole desktop: stop animating. */
  covered?: boolean
  /**
   * Run the live shader. Off by default, so only a surface that asks for it
   * pays for a GL context and a 30fps loop. The lock screen, screensaver and
   * window switcher all draw this component too; they show the static frame.
   */
  animated?: boolean
}) {
  const { wallpaperId } = useWallpaper()
  const live = useMemo(() => (isLive(wallpaperId) ? liveWallpaper(wallpaperId) : null), [wallpaperId])
  // A live wallpaper shows its own fallback scene beneath the canvas.
  const staticId = live ? live.fallback : wallpaperId
  const wp = useMemo(() => getWallpaper(staticId), [staticId])
  // A picture from disk is not drawn until the engine's screen-sized copy is ready, so the
  // full-size original is never decoded here.
  const [readySrc, setReadySrc] = useState(wp.id.startsWith('file:') ? '' : wp.src)
  const [liveFailed, setLiveFailed] = useState(false)

  useEffect(() => setLiveFailed(false), [wallpaperId])
  const onLiveFailed = useCallback(() => setLiveFailed(true), [])

  // Generated wallpapers are painted at the display's native resolution.
  useEffect(() => {
    if (!wp.generated) return
    let cancelled = false
    const dpr = window.devicePixelRatio || 1
    void renderWallpaper(wp.id, Math.round(window.screen.width * dpr), Math.round(window.screen.height * dpr)).then((url) => !cancelled && setReadySrc(url))
    return () => {
      cancelled = true
    }
  }, [wp.generated, wp.id])

  useEffect(() => {
    if (!wp.src) return
    let cancelled = false
    void fittedWallpaperSrc(wp.id).then((src) => {
      if (cancelled) return
      const img = new Image()
      img.src = src
      img.decode().then(
        () => !cancelled && setReadySrc(src),
        () => !cancelled && setReadySrc(src),
      )
    })
    return () => {
      cancelled = true
    }
  }, [wp.src, wp.id])

  return (
    <div className="fixed -inset-1 overflow-hidden" style={{ background: wp.color ?? '#0b0f16' }}>
      {!wp.color && readySrc && (
        <motion.img
          key={readySrc}
          src={readySrc}
          alt=""
          aria-hidden
          draggable={false}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: dur.slow * 1.5, ease: curve.decelerate }}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      )}
      {live && animated && !liveFailed && (
        // Fades in over the static fallback once the first frames land, so
        // there is never a visible swap between the two.
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: dur.slow, ease: curve.decelerate }}
        >
          <LiveWallpaperCanvas id={live.id} paused={covered} onFailed={onLiveFailed} />
        </motion.div>
      )}
      {dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />}
    </div>
  )
})
