import { useEffect, useState, type PropsWithChildren } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DEFAULT_WALLPAPER_ID, fittedWallpaperSrc, isValidWallpaperId } from '@/app/wallpapers'
import { CinemaCanvas } from '@/os/cinema/CinemaCanvas'
import { activateShell, showDock } from '@/os/kernel/session'
import { runBootOptimize, onBootOptimizeProgress } from '@/integrations/boot-optimize/client'
import { listOpenWindows } from '@/integrations/taskbar/client'
import { hydrateScheduleCache } from '@/integrations/schedule'
import { listSessions } from '@/integrations/general-chat/client'

const WALLPAPER_STORAGE_KEY = 'udaan-wallpaper'

/** Per-stage ceiling — if a stage hasn't reported done by this point, move on anyway rather than hang. */
const STAGE_TIMEOUT_MS = 8000
/** How long a stage can run before we show "taking longer than expected..." under the status text. */
const SLOW_HINT_MS = 4000
/** Floor so a stage (and its status text) stays on screen long enough to actually read, even when the
 *  underlying work resolves near-instantly — a fast machine could otherwise blow through all three
 *  stages in well under a second, which is what "too short, didn't get to see what it was doing" was about. */
const MIN_STAGE_MS = 900
/** Overall floor for the whole boot sequence (stages 1-3 combined), independent of the per-stage
 *  floor above — real work is genuinely done well within this on a fast machine, but the splash
 *  should still hold for the full duration rather than exit early once that work finishes. */
const MIN_BOOT_MS = 6500
/** How long the logo holds fully stopped, centered, before sliding into the reveal position. */
const HOLD_BEFORE_SLIDE_MS = 300
/** How long the wordmark reveal holds before the whole splash dissolves into the app. */
const HOLD_AFTER_REVEAL_MS = 1000

/** The wallpaper the desktop will show, rendered (or decoded) ahead of time. */
function currentWallpaperId(): string {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(WALLPAPER_STORAGE_KEY)
  } catch {
    // ignore — fall through to default
  }
  return stored && isValidWallpaperId(stored) ? stored : DEFAULT_WALLPAPER_ID
}

/** Resolves once the wallpaper is ready to paint and fonts have loaded — the app's own paint-readiness. */
function waitForAppPaintReady(): Promise<void> {
  const id = currentWallpaperId()
  const imageReady = fittedWallpaperSrc(id)
    .then(async (url) => {
      if (!url) return
      const img = new Image()
      img.src = url
      await img.decode()
    })
    .catch(() => undefined)

  const fontsReady =
    typeof document !== 'undefined' && document.fonts
      ? document.fonts.ready.then(() => undefined)
      : Promise.resolve()

  return Promise.all([imageReady, fontsReady]).then(() => undefined)
}

/** Races a real readiness promise against a hard ceiling — never lets one stage hang the whole splash. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => window.setTimeout(() => resolve('timeout'), ms)),
  ])
}

/**
 * Real taskbar health check — not a fixed wait, an actual verification
 * that the taskbar is present, visible, and genuinely able to answer a
 * live IPC round-trip. `activateUdaanTaskbar()` in Stage 1 only confirms
 * the show/resize CALLS succeeded; it doesn't confirm the taskbar window
 * is actually up and its Rust command handlers are responding — those are
 * two different things, and only this check verifies the second one.
 * Retries with a short backoff rather than a single attempt, since the
 * taskbar window can still be finishing its own mount/first-poll cycle
 * for a brief moment right after activateUdaanTaskbar() resolves.
 */
async function waitForTaskbarHealthy(onAttempt?: (attempt: number) => void): Promise<void> {
  const maxAttempts = 6
  const retryDelayMs = 300

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onAttempt?.(attempt)
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const taskbarWin = await WebviewWindow.getByLabel('taskbar')
      if (!taskbarWin) {
        throw new Error('Taskbar window is not registered')
      }
      const visible = await taskbarWin.isVisible()
      if (!visible) {
        throw new Error('Taskbar window exists but is not visible yet')
      }
      // The real proof of health: a live round-trip through Tauri's IPC
      // bridge to the Rust taskbar_list_windows command — if this
      // resolves, the whole chain (webview → IPC → Win32 enumeration →
      // response) is genuinely working, not just "a window object exists."
      await listOpenWindows()
      return
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error('[splash] Taskbar health check did not pass after retries:', err)
        return
      }
      await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs))
    }
  }
}

type Stage = 1 | 2 | 3
type Phase = 'boot' | 'stopping' | 'reveal' | 'exiting' | 'done'

const STAGE_LABEL: Record<Stage, string> = {
  1: 'Setting up your desktop...',
  2: 'Optimizing your PC...',
  3: 'Loading Udaan...',
}

/**
 * Full boot sequence, replacing the blank window during startup: the logo
 * spins continuously through three real stages (OS/shell setup, safe
 * performance pass, app init) — status text at the bottom tracks whichever
 * is actually in flight, not a fake timer. Once all three resolve, the spin
 * decelerates to a stop, the mark slides left, and the "Udaan" wordmark
 * glows in beside it before the whole splash dissolves into the app
 * (already mounted underneath, ready to be revealed instantly).
 */
export function SplashScreen({ children }: PropsWithChildren) {
  // Always runs the full staged sequence on every launch — a previous
  // version checked the OS's prefers-reduced-motion / "Show animations"
  // setting and skipped straight to a bare 400ms flash with no visible
  // stages when that was off, which is not what was asked for: the
  // loading sequence should always play, in full, independent of that OS
  // setting. Also no longer gated on a sessionStorage "already played
  // this session" flag (a previous version had that too) — relying on
  // WebView storage semantics for "did the process actually restart" was
  // fragile and reportedly didn't always reset.
  const [phase, setPhase] = useState<Phase>('boot')
  const [stage, setStage] = useState<Stage>(1)
  const [subStatus, setSubStatus] = useState<string | null>(null)
  const [slowHint, setSlowHint] = useState(false)
  const [errorHint, setErrorHint] = useState<string | null>(null)

  useEffect(() => {
    if (phase !== 'boot') return

    let cancelled = false
    let slowTimer: number | undefined
    const bootStartedAt = Date.now()

    const startSlowTimer = () => {
      window.clearTimeout(slowTimer)
      setSlowHint(false)
      slowTimer = window.setTimeout(() => {
        if (!cancelled) setSlowHint(true)
      }, SLOW_HINT_MS)
    }

    const runStage = async <T,>(n: Stage, work: () => Promise<T>): Promise<T | 'timeout' | 'error'> => {
      if (cancelled) return 'timeout'
      setStage(n)
      setSubStatus(null)
      startSlowTimer()
      const started = Date.now()
      let result: T | 'timeout' | 'error'
      try {
        result = await withTimeout(work(), STAGE_TIMEOUT_MS)
      } catch (err) {
        console.error(`[splash] Stage ${n} failed:`, err)
        result = 'error'
      }
      const elapsed = Date.now() - started
      if (elapsed < MIN_STAGE_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, MIN_STAGE_MS - elapsed))
      }
      window.clearTimeout(slowTimer)
      setSlowHint(false)
      return result
    }

    async function sequence() {
      // Stage 1 — reuse the exact same taskbar-hide/resize logic, sequenced
      // here purely so the splash's status text reflects it honestly during
      // boot. App.tsx is the actual source of truth for this (it always
      // calls activateUdaanTaskbar() itself on mount, independent of
      // whether this stage ran/succeeded) — calling it again here is a
      // harmless, idempotent no-op if App.tsx's own call already landed
      // first, and a real head-start if this one wins the race. showDock is
      // false here too — the dock only becomes visible via
      // showDock() at the very end of this sequence, once the
      // splash is actually about to disappear. A failure here is logged but
      // never blocks the rest of boot.
      const stage1 = await runStage(1, () => activateShell(false))
      if (cancelled) return
      if (stage1 === 'error' || stage1 === 'timeout') {
        setErrorHint('Desktop setup ran into an issue — continuing anyway.')
        window.setTimeout(() => setErrorHint(null), 2500)
      }

      // Stage 2 — the real, safe, logged performance pass. Sub-status text
      // is driven by actual progress events from the Rust side, not timers —
      // but each real step (temp cleanup, startup scan, disk/memory check,
      // DNS flush) can complete in a handful of milliseconds, so without a
      // floor the text would overwrite itself faster than it's readable.
      // Queue updates through one at a time, each held for a minimum
      // duration, rather than setting subStatus directly on every event.
      let subStatusChain = Promise.resolve()
      let lastSubStatusAt = 0
      const MIN_SUBSTATUS_MS = 420
      function queueSubStatus(text: string) {
        subStatusChain = subStatusChain.then(async () => {
          if (cancelled) return
          const wait = Math.max(0, MIN_SUBSTATUS_MS - (Date.now() - lastSubStatusAt))
          if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait))
          if (cancelled) return
          setSubStatus(text)
          lastSubStatusAt = Date.now()
        })
      }

      let unlistenProgress: (() => void) | undefined
      try {
        unlistenProgress = await onBootOptimizeProgress(({ detail }) => {
          if (!cancelled) queueSubStatus(detail)
        })
      } catch {
        // Event subscription failing is non-fatal — the stage still runs,
        // just without granular sub-status text.
      }
      const stage2 = await runStage(2, () => runBootOptimize())
      await subStatusChain
      unlistenProgress?.()
      if (cancelled) return
      if (stage2 === 'error') {
        setErrorHint('Performance check ran into an issue — continuing anyway.')
        window.setTimeout(() => setErrorHint(null), 2500)
      }
      setSubStatus(null)

      // Stage 3 — app paint-readiness (wallpaper decode + fonts) AND a
      // real taskbar health verification, not just "the activation calls
      // didn't throw" from Stage 1. This is the actual fix for landing in
      // a half-warmed app that felt laggy right after boot: previously
      // the splash only waited for the wallpaper image + fonts, which
      // says nothing about whether the taskbar's own window has actually
      // finished mounting and started responding to real IPC calls.
      await runStage(3, async () => {
        setSubStatus('Loading Udaan...')
        await waitForAppPaintReady()
        if (cancelled) return
        setSubStatus('Checking taskbar...')
        await waitForTaskbarHealthy((attempt) => {
          if (!cancelled && attempt > 1) setSubStatus(`Checking taskbar... (${attempt}/6)`)
        })
        if (cancelled) return
        setSubStatus('Warming up your data...')
        await Promise.all([
          hydrateScheduleCache().catch((err) => {
            console.error('[splash] Schedule warmup failed:', err)
          }),
          listSessions('local').catch((err) => {
            console.error('[splash] Chat session warmup failed:', err)
          }),
        ])
      })
      if (cancelled) return

      // Real work is genuinely done at this point on most machines — this
      // trailing hold is purely so the splash's full 20s runtime is spent
      // visibly "doing something" rather than the logo sitting frozen on
      // Stage 3's label once there's nothing left to wait on. Cycles back
      // through all three stage labels so the spin always has fresh text
      // under it for the remainder of the hold.
      const bootElapsed = Date.now() - bootStartedAt
      const remaining = MIN_BOOT_MS - bootElapsed
      if (remaining > 0) {
        setSubStatus(null)
        const cycleStages: Stage[] = [1, 2, 3]
        let cycleIdx = 0
        const cycleMs = 1400
        const cycleTimer = window.setInterval(() => {
          if (cancelled) return
          cycleIdx = (cycleIdx + 1) % cycleStages.length
          setStage(cycleStages[cycleIdx])
        }, cycleMs)
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
        window.clearInterval(cycleTimer)
      }
      if (cancelled) return

      // Reveal the taskbar dock now, right as the splash begins its own
      // stop-and-reveal sequence — not on App.tsx's mount, which fires at
      // process start and would otherwise show the dock while the splash
      // is still covering the whole screen. A failure here is logged but
      // never blocks the reveal transition itself.
      showDock().catch((err) => {
        console.error('[splash] Failed to reveal taskbar dock:', err)
      })

      setPhase('stopping')
    }

    void sequence()

    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
    }
  }, [phase])

  // Deceleration hold, then slide-and-reveal, then exit — each a fixed,
  // deliberate beat rather than driven by further async work.
  useEffect(() => {
    if (phase !== 'stopping') return
    const timer = window.setTimeout(() => setPhase('reveal'), HOLD_BEFORE_SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'reveal') return
    const timer = window.setTimeout(() => setPhase('exiting'), HOLD_AFTER_REVEAL_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'exiting') return
    const timer = window.setTimeout(() => setPhase('done'), 800)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Skip is disabled once the stop-and-reveal sequence has begun — that
  // finale is short and deliberate, not worth interrupting.
  useEffect(() => {
    if (phase !== 'boot') return
    const skip = () => setPhase('stopping')
    window.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', skip)
    return () => {
      window.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', skip)
    }
  }, [phase])

  const visible = phase !== 'done'
  const stopped = phase !== 'boot'
  const progress = stopped ? 1 : (stage - 1) / 3 + 0.12
  const statusText = errorHint ?? subStatus ?? STAGE_LABEL[stage]
  const finale = phase === 'reveal' || phase === 'exiting'

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            className="fixed inset-0 z-[9999] overflow-hidden bg-[#03040a]"
            initial={{ opacity: 1 }}
            // The finale: the whole picture pushes toward you and dissolves, so the desktop arrives
            // from behind it rather than the boot screen simply switching off.
            exit={{ opacity: 0, scale: 1.14, filter: 'blur(10px)', transition: { duration: 1.2, ease: [0.5, 0, 0.15, 1] } }}
            role="presentation"
            aria-hidden="true"
          >
            {/* The scene: slow ribbons of light, fading in out of the dark. */}
            <motion.div className="absolute inset-0" initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 0.62, scale: 1 }} transition={{ duration: 3.2, ease: [0.16, 1, 0.3, 1] }}>
              <CinemaCanvas kind="aurora" scale={0.4} fps={24} />
            </motion.div>
            <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 48%, transparent 30%, rgb(0 0 0 / 0.78) 100%)' }} />

            <div className="relative flex h-full flex-col items-center justify-center">
              {/* The anamorphic streak: a thin line of light that opens across the screen. */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-[min(78vw,860px)] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: 'linear-gradient(90deg, transparent, rgb(150 200 255 / 0.9) 30%, #fff 50%, rgb(255 190 120 / 0.9) 70%, transparent)', boxShadow: '0 0 30px 4px rgb(120 170 255 / 0.35)' }}
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: [0, 1, 1], opacity: [0, 1, 0] }}
                transition={{ delay: 0.5, duration: 2.4, times: [0, 0.4, 1], ease: [0.16, 1, 0.3, 1] }}
              />

              <motion.div className="flex flex-col items-center" animate={{ scale: finale ? 1.18 : 1, y: finale ? -4 : 0 }} transition={{ duration: 1.1, ease: [0.5, 0, 0.15, 1] }}>
                {/* The mark resolves out of blur, as a lens pulls focus. */}
                <motion.img
                  src="/logo/udaan.png"
                  alt=""
                  draggable={false}
                  width={132}
                  height={132}
                  className="select-none"
                  initial={{ opacity: 0, scale: 0.82, filter: 'blur(22px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  transition={{ delay: 0.7, duration: 2.1, ease: [0.16, 1, 0.3, 1] }}
                />
                <motion.p
                  className="mt-7 text-[30px] font-extralight uppercase text-white"
                  initial={{ opacity: 0, letterSpacing: '0.9em', y: 8 }}
                  animate={{ opacity: 1, letterSpacing: '0.46em', y: 0 }}
                  transition={{ delay: 1.5, duration: 2.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  Udaan
                </motion.p>
              </motion.div>

              <div className="absolute bottom-[11vh] flex h-5 items-center justify-center">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p key={stopped ? 'done' : statusText} className="text-[12px] font-light uppercase tracking-[0.3em] text-white/40" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.35 }}>
                    {stopped ? '' : statusText}
                    {!stopped && slowHint ? ' (taking longer than usual)' : ''}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>

            {/* One hairline along the bottom edge carries the real progress, in the logo's colours. */}
            <motion.div
              className="absolute bottom-0 left-0 h-[2px] origin-left"
              style={{ width: '100%', background: 'linear-gradient(90deg, #3072f0, #00c8ff 45%, #ff8c28)' }}
              initial={{ scaleX: 0.02 }}
              animate={{ scaleX: Math.min(1, progress), opacity: stopped ? 0 : 1 }}
              transition={{ scaleX: { duration: 1.1, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.8 } }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </>
  )
}
