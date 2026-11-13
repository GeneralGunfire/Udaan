import { useEffect, useState, type PropsWithChildren } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DEFAULT_WALLPAPER_ID, getWallpaper, isValidWallpaperId } from '@/app/wallpapers'
import { resolveWallpaperUrl } from '@/os/desktop/generatedWallpapers'
import { UdaanMark as SharedMark } from '@/os/ui/icons/UdaanMark'
import { BootCanvas } from './BootCanvas'
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
const MIN_STAGE_MS = 300
/** Overall floor for the whole boot sequence (stages 1-3 combined), independent of the per-stage
 *  floor above — real work is genuinely done well within this on a fast machine, but the splash
 *  should still hold for the full duration rather than exit early once that work finishes. */
const MIN_BOOT_MS = 2500
/** How long the logo holds fully stopped, centered, before sliding into the reveal position. */
const HOLD_BEFORE_SLIDE_MS = 200
/** How long the wordmark reveal holds before the whole splash dissolves into the app. */
const HOLD_AFTER_REVEAL_MS = 350

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
  const imageReady = resolveWallpaperUrl(id, getWallpaper(id).src)
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

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            className="fixed inset-0 z-[9999] overflow-hidden bg-[#08090c]"
            initial={{ opacity: 1 }}
            // The whole screen scales up very slightly as it dissolves, so
            // the desktop appears to come *through* it rather than the boot
            // screen simply vanishing.
            exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
            role="presentation"
            aria-hidden="true"
          >
            {/* Light gathering toward the centre, converging as boot
                completes. Without it the wait reads as a frozen screen. */}
            <BootCanvas progress={progress} />

            <div className="relative flex h-full flex-col items-center justify-center">
              <motion.div
                className="flex flex-col items-center"
                // The whole lockup drifts up a few pixels over the sequence,
                // which keeps the composition alive during the wait without
                // anything appearing to actually move.
                animate={{ y: stopped ? -6 : 0 }}
                transition={{ duration: 0.8, ease: [0.05, 0.7, 0.1, 1] }}
              >
                {/* The mark arrives first and the word follows. Staging the
                    two reads as the brand assembling itself; animating them
                    together reads as one picture fading in. */}
                <UdaanMark size={92} />
                <motion.p
                  className="mt-6 overflow-hidden text-[32px] font-light tracking-[0.18em] text-white"
                  initial={{ opacity: 0, y: 10, letterSpacing: '0.38em' }}
                  animate={{ opacity: 1, y: 0, letterSpacing: '0.18em' }}
                  transition={{ delay: 0.3, duration: 0.9, ease: [0.05, 0.7, 0.1, 1] }}
                >
                  Udaan
                </motion.p>
              </motion.div>

              {/* The progress track fades away once the work is done, so the
                  finale is the mark alone rather than a completed bar. */}
              <motion.div
                className="mt-11 h-[2px] w-[200px] overflow-hidden rounded-full bg-white/[0.09]"
                animate={{ opacity: stopped ? 0 : 1 }}
                transition={{ duration: 0.4 }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--color-accent-alt, #7bb8ff), var(--color-accent, #2b7fd4))' }}
                  initial={{ width: '4%' }}
                  animate={{ width: `${Math.min(100, progress * 100)}%` }}
                  transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                />
              </motion.div>

              {/* Status crossfades between stages rather than cutting, so a
                  fast machine's rapid stage changes don't flicker. */}
              <div className="mt-4 h-4">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={stopped ? 'done' : statusText}
                    className="text-[12.5px] tracking-wide text-white/45"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.22 }}
                  >
                    {stopped ? '' : statusText}
                    {!stopped && slowHint ? ' — taking longer than usual' : ''}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </>
  )
}

/**
 * Udaan's mark at hero size.
 *
 * Three things happen at once, and the overlap is what makes it feel
 * composed rather than merely animated: the mark rises into place, its
 * glow blooms behind it a beat later, and it breathes very slowly
 * afterwards so the screen is never completely still while waiting.
 */
function UdaanMark({ size }: { size: number }) {
  return (
    <span className="relative inline-flex">
      {/* The glow, behind and slightly larger. It arrives after the mark so
          the mark lands first and is then lit, rather than appearing
          pre-lit, which reads as a static image. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 rounded-full"
        style={{
          width: size * 2.6,
          height: size * 2.6,
          x: '-50%',
          y: '-50%',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--color-accent, #2b7fd4) 42%, transparent), transparent 62%)',
        }}
        initial={{ opacity: 0, scale: 0.65 }}
        animate={{ opacity: [0, 0.9, 0.62], scale: 1 }}
        transition={{ delay: 0.42, duration: 1.5, ease: [0.05, 0.7, 0.1, 1], times: [0, 0.45, 1] }}
      />
      <motion.span
        className="inline-flex"
        initial={{ opacity: 0, y: 14, scale: 0.9 }}
        animate={{
          opacity: 1,
          y: 0,
          // Settles, then breathes: a 4% swell over six seconds. Slow
          // enough to be felt rather than watched.
          scale: [0.9, 1.03, 1, 1.015, 1],
        }}
        transition={{
          opacity: { delay: 0.1, duration: 0.5, ease: [0.05, 0.7, 0.1, 1] },
          y: { delay: 0.1, duration: 0.7, ease: [0.05, 0.7, 0.1, 1] },
          scale: { delay: 0.1, duration: 6, times: [0, 0.12, 0.3, 0.65, 1], repeat: Infinity, ease: 'easeInOut' },
        }}
      >
        <SharedMark size={size} tone="brand" />
      </motion.span>
    </span>
  )
}
