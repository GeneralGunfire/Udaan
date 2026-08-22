import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import udaanMark from '@/assets/udaan-mark.png'
import { DEFAULT_WALLPAPER_ID, WALLPAPERS } from '@/app/wallpapers'
import './SplashScreen.css'

const SESSION_KEY = 'udaan-splash-played'
const WALLPAPER_STORAGE_KEY = 'udaan-wallpaper'

/** Never hold the splash open past this, even if a readiness signal never resolves. */
const MAX_WAIT_MS = 6000
/** Floor so the intro never flashes for a load that happens to finish instantly. */
const MIN_SWIRL_MS = 1400
/** Time for the resolve-to-logo + wordmark + tagline + hold sequence, once readiness is confirmed. */
const RESOLVE_SEQUENCE_MS = 1500
const REDUCED_MOTION_MS = 400

/** Module-level guard: survives StrictMode's double-mount within one launch. */
let hasPlayedThisLoad = false

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function alreadyPlayed(): boolean {
  if (hasPlayedThisLoad) return true
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function markPlayed() {
  hasPlayedThisLoad = true
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) — in-memory guard still holds for this load
  }
}

/** Same wallpaper the app itself will paint behind AmbientBackground — see WallpaperProvider. */
function currentWallpaperSrc(): string {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(WALLPAPER_STORAGE_KEY)
  } catch {
    // ignore — fall through to default
  }
  const id = stored && WALLPAPERS.some((w) => w.id === stored) ? stored : DEFAULT_WALLPAPER_ID
  return (WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]).src
}

/** Resolves once the ambient wallpaper image has decoded and fonts have loaded — the two known slow paints. */
function waitForAppReady(): Promise<void> {
  const imageReady = new Promise<void>((resolve) => {
    const img = new Image()
    img.src = currentWallpaperSrc()
    img
      .decode()
      .then(() => resolve())
      .catch(() => resolve())
    img.onerror = () => resolve()
  })

  const fontsReady =
    typeof document !== 'undefined' && document.fonts
      ? document.fonts.ready.then(() => undefined)
      : Promise.resolve()

  return Promise.all([imageReady, fontsReady]).then(() => undefined)
}

type Phase = 'loading' | 'resolving' | 'exiting' | 'done'

/**
 * One-time launch intro: a looping swirl of brand-gradient smoke holds for as
 * long as the real app takes to become paint-ready (wallpaper decoded, fonts
 * loaded), then resolves into the Udaan mark/wordmark and crossfades out.
 * Wraps the app root so it can sit above everything while the app mounts
 * underneath, ready to be revealed the moment the splash exits.
 */
export function SplashScreen({ children }: PropsWithChildren) {
  const skipAnimation = useMemo(() => prefersReducedMotion(), [])
  const [phase, setPhase] = useState<Phase>(() => (alreadyPlayed() ? 'done' : 'loading'))

  useEffect(() => {
    if (phase !== 'loading') return

    if (skipAnimation) {
      const timer = window.setTimeout(() => setPhase('exiting'), REDUCED_MOTION_MS)
      return () => window.clearTimeout(timer)
    }

    let cancelled = false
    const minWaitElapsed = new Promise<void>((resolve) => {
      window.setTimeout(resolve, MIN_SWIRL_MS)
    })
    Promise.all([waitForAppReady(), minWaitElapsed]).then(() => {
      if (!cancelled) setPhase('resolving')
    })

    const maxWaitTimer = window.setTimeout(() => {
      if (!cancelled) setPhase('resolving')
    }, MAX_WAIT_MS)

    return () => {
      cancelled = true
      window.clearTimeout(maxWaitTimer)
    }
  }, [phase, skipAnimation])

  useEffect(() => {
    if (phase !== 'resolving') return
    const timer = window.setTimeout(() => setPhase('exiting'), RESOLVE_SEQUENCE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'exiting') return
    markPlayed()
    const timer = window.setTimeout(() => setPhase('done'), 450)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase === 'done') return
    const skip = () => setPhase('exiting')
    window.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', skip)
    return () => {
      window.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', skip)
    }
  }, [phase])

  const visible = phase !== 'done'
  const resolved = phase === 'resolving' || phase === 'exiting'

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            className="splash-root"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.45, ease: [0.2, 0, 0, 1] }}
            role="presentation"
            aria-hidden="true"
          >
            <div className="splash-stage">
              {!skipAnimation && (
                <div className={`splash-blob-field${resolved ? ' splash-blob-field--resolved' : ''}`}>
                  <span className="splash-seed" />
                  <span className="splash-orbit splash-orbit--4">
                    <span className="splash-blob splash-blob--4" />
                  </span>
                  <span className="splash-orbit splash-orbit--2">
                    <span className="splash-blob splash-blob--2" />
                  </span>
                  <span className="splash-orbit splash-orbit--1">
                    <span className="splash-blob splash-blob--1" />
                  </span>
                  <span className="splash-orbit splash-orbit--3">
                    <span className="splash-blob splash-blob--3" />
                  </span>
                </div>
              )}
              <img
                src={udaanMark}
                alt=""
                className={`splash-mark${resolved || skipAnimation ? ' splash-mark--resolved' : ''}`}
              />
              <div className={`splash-wordmark${resolved || skipAnimation ? ' splash-wordmark--resolved' : ''}`}>
                UDAAN
              </div>
              <div className={`splash-tagline${resolved || skipAnimation ? ' splash-tagline--resolved' : ''}`}>
                Your ideas, set in motion
              </div>
              {!skipAnimation && <div className="splash-skip-hint">click or press any key to skip</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* App renders underneath immediately so it's ready to crossfade in as the splash exits */}
      {children}
    </>
  )
}
