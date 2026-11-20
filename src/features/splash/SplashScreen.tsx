import { useCallback, useEffect, useState, type PropsWithChildren } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DEFAULT_WALLPAPER_ID, fittedWallpaperSrc, isValidWallpaperId } from '@/app/wallpapers'
import { activateShell, showDock } from '@/os/kernel/session'
import { getPref } from '@/os/kernel/prefs'
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
const MIN_STAGE_MS = 1300

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
type Phase = 'boot' | 'exiting' | 'done'

const STAGE_LABEL: Record<Stage, string> = {
  1: 'Preparing your desktop',
  2: 'Optimising performance',
  3: 'Loading Udaan',
}

/** Short things worth knowing, shown one at a time while the splash waits. */
const HINTS = [
  'Press the Windows key to open Start.',
  'Tap Ctrl twice to see all your windows.',
  'Right-click a widget to change its style and size.',
  'Open Help, Udaan Tutorial for a guided tour.',
  'Every part of Udaan can be switched off in Settings.',
]
const HINT_MS = 4800

/**
 * The boot screen: pure black and white. The three real startup stages run underneath (shell setup, a safe
 * performance pass, app paint-readiness) and a single hairline fills as each one completes. When they are
 * done the screen says so and simply waits: it stays until the person presses Skip (or Enter / Escape),
 * then fades into the desktop, and only then is the dock revealed.
 */
export function SplashScreen({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<Phase>('boot')
  const [stage, setStage] = useState<Stage>(1)
  const [subStatus, setSubStatus] = useState<string | null>(null)
  const [slowHint, setSlowHint] = useState(false)
  const [errorHint, setErrorHint] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [hint, setHint] = useState(0)

  useEffect(() => {
    if (phase !== 'boot') return

    let cancelled = false
    let slowTimer: number | undefined

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
      // Stage 1: the same shell setup App.tsx performs; repeating it is idempotent. The dock stays hidden
      // until the person leaves this screen.
      const stage1 = await runStage(1, () => activateShell(false))
      if (cancelled) return
      if (stage1 === 'error' || stage1 === 'timeout') {
        setErrorHint('Desktop setup ran into an issue. Continuing anyway.')
        window.setTimeout(() => setErrorHint(null), 2500)
      }

      // Stage 2: the real performance pass. Its progress lines are queued so each stays readable.
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
        // Non-fatal: the stage still runs, just without granular lines.
      }
      const stage2 = await runStage(2, () => runBootOptimize())
      await subStatusChain
      unlistenProgress?.()
      if (cancelled) return
      if (stage2 === 'error') {
        setErrorHint('Performance check ran into an issue. Continuing anyway.')
        window.setTimeout(() => setErrorHint(null), 2500)
      }
      setSubStatus(null)

      // Stage 3: wallpaper and fonts painted, the taskbar answering a real IPC round trip, data warmed.
      await runStage(3, async () => {
        setSubStatus('Loading Udaan')
        await waitForAppPaintReady()
        if (cancelled) return
        setSubStatus('Checking the taskbar')
        await waitForTaskbarHealthy((attempt) => {
          if (!cancelled && attempt > 1) setSubStatus(`Checking the taskbar (${attempt}/6)`)
        })
        if (cancelled) return
        setSubStatus('Warming up your data')
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

      // Everything is ready. Stay here until the person chooses to continue.
      setSubStatus(null)
      setReady(true)
    }

    void sequence()

    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
    }
  }, [phase])

  // Leaving: reveal the dock (unless the person turned the Udaan dock off), then fade out.
  const skip = useCallback(() => {
    setPhase((p) => {
      if (p !== 'boot') return p
      void getPref('dock.enabled')
        .then((on) => (on ? showDock() : undefined))
        .catch((err) => {
          console.error('[splash] Failed to reveal taskbar dock:', err)
        })
      return 'exiting'
    })
  }, [])

  useEffect(() => {
    if (phase !== 'exiting') return
    const timer = window.setTimeout(() => setPhase('done'), 1100)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Enter or Escape also continue; a stray click or other key does not.
  useEffect(() => {
    if (phase !== 'boot') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, skip])

  useEffect(() => {
    if (phase !== 'boot') return
    const t = window.setInterval(() => setHint((h) => (h + 1) % HINTS.length), HINT_MS)
    return () => window.clearInterval(t)
  }, [phase])

  const visible = phase !== 'done'
  const statusText = ready ? 'Ready' : errorHint ?? subStatus ?? STAGE_LABEL[stage]
  const progress = ready ? 1 : (stage - 1) / 3 + 0.2
  const ease = [0.16, 1, 0.3, 1] as const

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-black"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 1.1, ease: [0.4, 0, 0.2, 1] } }}
            role="dialog"
            aria-label="Starting Udaan"
          >
            <div className="flex flex-col items-center">
              <motion.img
                src="/logo/udaan.png"
                alt=""
                draggable={false}
                width={88}
                height={88}
                className="select-none"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: ready ? 1 : [0.78, 1, 0.78], y: 0 }}
                transition={ready ? { duration: 0.8 } : { opacity: { duration: 4, repeat: Infinity, ease: 'easeInOut' }, y: { delay: 0.4, duration: 1.6, ease } }}
              />
              <motion.p
                className="mt-9 text-[14px] font-light uppercase text-white"
                style={{ fontFamily: "Montserrat, 'Segoe UI', sans-serif" }}
                initial={{ opacity: 0, letterSpacing: '0.75em' }}
                animate={{ opacity: 0.92, letterSpacing: '0.56em' }}
                transition={{ delay: 0.9, duration: 2.2, ease }}
              >
                Udaan
              </motion.p>

              {/* One hairline: it fills as each real stage finishes, and is complete when Udaan is ready. */}
              <motion.div className="mt-12 h-px w-[180px] overflow-hidden rounded-full bg-white/15" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 1 }}>
                <motion.div className="h-full w-full origin-left bg-white" initial={{ scaleX: 0 }} animate={{ scaleX: progress }} transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }} />
              </motion.div>

              <div className="mt-5 flex h-4 items-center justify-center">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p key={statusText} className="text-[12px] font-light tracking-[0.14em] text-white/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
                    {statusText}
                    {!ready && slowHint ? ', taking a little longer' : ''}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>

            {/* A quiet line of advice, one at a time. */}
            <div className="absolute inset-x-0 bottom-[17%] flex h-5 items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={hint} className="text-[13px] font-light text-white/40" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.5 }}>
                  {HINTS[hint]}
                </motion.p>
              </AnimatePresence>
            </div>

            <motion.button
              type="button"
              onClick={skip}
              className="absolute bottom-[7%] rounded-full border border-white/30 px-7 py-2 text-[13px] font-medium tracking-[0.08em] text-white transition-colors hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.8, duration: 1 }}
            >
              Skip
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </>
  )
}
