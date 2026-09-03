import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { keepAwake } from '@/integrations/power-state'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { getWallpaper } from '@/app/wallpapers'

/** How long the desktop sits idle (no mouse/key input) before the screensaver takes over. */
export const SCREENSAVER_IDLE_MS = 90_000

/**
 * Full-screen clock screensaver — appears after SCREENSAVER_IDLE_MS of no
 * input, or on demand (Space from anywhere, or the sidebar's clock
 * button).
 *
 * Composed as an always-on-display face rather than a widget: oversized
 * ultra-light numerals sit directly on the wallpaper, anchored low-left,
 * with a gradient weighted only to the corner they occupy. The
 * photograph keeps the frame; the time reads as part of it. The earlier
 * version put the clock in a glass card at screen centre, which turned
 * the wallpaper into a backdrop for a widget rather than the subject.
 */
export function ClockScreensaver({ onDismiss }: { onDismiss: () => void }) {
  const [now, setNow] = useState(() => new Date())
  const [revealed, setRevealed] = useState(false)
  const { wallpaperId } = useWallpaper()
  const wallpaperSrc = getWallpaper(wallpaperId).src

  useEffect(() => {
    const holdTimer = window.setTimeout(() => setRevealed(true), 900)
    return () => window.clearTimeout(holdTimer)
  }, [])

  // The screensaver overlay itself has no effect on Windows' own display/
  // system sleep timers — they run independently, so the screen was still
  // turning off on schedule underneath a visibly "active" screensaver.
  // Suppress it for as long as this component is mounted, and release it
  // unconditionally on unmount (including an unexpected one) so Udaan
  // never leaves the display forced awake after the screensaver is gone.
  useEffect(() => {
    void keepAwake(true)
    return () => {
      void keepAwake(false)
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    // Dismiss only on a deliberate input — keydown or a mouse click/press —
    // never bare `mousemove`. Listening for mousemove used to close this
    // almost immediately after opening: the click that opens it (sidebar
    // clock button, or the Space-bar shortcut) reliably produces a stray
    // mousemove right after (cursor settling, layout shifting under it),
    // so the screensaver would flash open and vanish within the same
    // gesture instead of actually staying up. A screensaver that reopens
    // itself as an idle-timeout is *supposed* to close on the first real
    // motion — that idle-triggered case is exactly why mousemove felt
    // right originally — but "stay open until you mean to leave" is what
    // was asked for here, so motion alone is no longer enough.
    function dismiss() {
      onDismiss()
    }
    window.addEventListener('keydown', dismiss)
    window.addEventListener('mousedown', dismiss)
    return () => {
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('mousedown', dismiss)
    }
  }, [onDismiss])

  const hours = now.getHours()
  const displayHours = ((hours + 11) % 12) + 1
  const hh = String(displayHours).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const period = hours >= 12 ? 'PM' : 'AM'
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <motion.div
      className="fixed inset-0 z-100 overflow-hidden"
      style={{ background: 'var(--surface-canvas)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* The active wallpaper, full-bleed — the same image the rest of
          the app shows, and the subject of this screen. */}
      <img
        src={wallpaperSrc}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 z-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* A gradient weighted to the lower-left, where the clock actually
          sits, rather than a flat dim across the whole frame — the top
          and right of the photograph stay fully visible. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0"
        style={{
          background:
            'linear-gradient(to top right, rgb(2 5 10 / 55%) 0%, rgb(2 5 10 / 20%) 45%, transparent 75%)',
        }}
      />

      {/* Always-on-display treatment: the time IS the overlay, with no
          card or panel around it. Large ultra-light numerals sit directly
          on the photograph, anchored to the lower-left rather than dead
          centre so the image keeps the frame — the same composition
          phone lock screens and AOD faces use, where the clock reads as
          part of the picture rather than a widget parked on top of it.
          Legibility comes from a soft text-shadow (cheap, and it tracks
          the glyph shapes) instead of a scrim dimming the whole image. */}
      <motion.div
        className="absolute bottom-[14%] left-[8%] z-10 flex flex-col items-start"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      >
        <div
          className="flex items-baseline tabular-nums"
          style={{ textShadow: '0 2px 24px rgb(0 0 0 / 55%), 0 1px 3px rgb(0 0 0 / 40%)' }}
        >
          <span
            className="text-[15vw] leading-[0.85] font-extralight tracking-[-0.03em] text-white md:text-[11vw]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {hh}
          </span>
          <span
            className="text-[15vw] leading-[0.85] font-extralight tracking-[-0.03em] text-white/60 md:text-[11vw]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            :{mm}
          </span>
        </div>

        <AnimatePresence>
          {revealed && (
            <motion.div
              className="mt-4 flex items-center gap-3 pl-1"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              style={{ textShadow: '0 1px 8px rgb(0 0 0 / 60%)' }}
            >
              <span className="text-md font-medium tracking-wide text-white/85">{dateLabel}</span>
              <span className="h-3.5 w-px bg-white/25" aria-hidden />
              <span className="text-md font-medium tabular-nums text-white/55">
                {ss}s · {period}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-2xs font-medium tracking-wide text-white/35 uppercase"
        style={{ textShadow: '0 1px 3px rgb(0 0 0 / 70%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 1 : 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        Press any key or click to return
      </motion.div>
    </motion.div>
  )
}
