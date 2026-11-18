import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { APP_COMPONENTS, APP_DEFS, type AppId } from '@/os/kernel/registry'
import { loadBounds, saveBounds, shell } from '@/os/kernel/shell'
import { windowMotion } from '@/os/motion/systemMotion'
import { useMotion, windowCloseMotion, windowOpenMotion } from '@/os/motion/config'
import { TitleBar } from './TitleBar'

function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-hairline)] border-t-[var(--color-text-secondary)]" />
    </div>
  )
}

function useWindowState(appId: AppId) {
  const [active, setActive] = useState(() => document.hasFocus())
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    const onFocus = () => setActive(true)
    const onBlur = () => setActive(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)

    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const persist = () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(async () => {
        const [isMax, isMin] = await Promise.all([win.isMaximized(), win.isMinimized()])
        setMaximized(isMax)
        if (isMin) return
        const scale = await win.scaleFactor()
        const [pos, size] = await Promise.all([win.outerPosition(), win.innerSize()])
        if (isMax) {
          // Keep the restored bounds; only remember that it was maximized.
          const prev = await loadBounds(appId)
          if (prev) await saveBounds(appId, { ...prev, maximized: true })
          return
        }
        await saveBounds(appId, {
          x: pos.x / scale,
          y: pos.y / scale,
          width: size.width / scale,
          height: size.height / scale,
          maximized: false,
        })
      }, 350)
    }

    void win.isMaximized().then(setMaximized)
    const unlisteners = [win.onMoved(persist), win.onResized(persist)]
    return () => {
      clearTimeout(saveTimer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      unlisteners.forEach((p) => void p.then((fn) => fn()))
    }
  }, [appId])

  return { active, maximized }
}

function useLaunchArgs() {
  const [args, setArgs] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    let cancelled = false
    const parse = (raw: string | null) => {
      if (!raw || cancelled) return
      try {
        setArgs(JSON.parse(raw) as Record<string, unknown>)
      } catch (err) {
        console.error('[app-window] bad launch args', err)
      }
    }
    void shell.takeAppArgs().then(parse)
    const unlisten = listen<string>('shell://app-args', (e) => parse(e.payload))
    return () => {
      cancelled = true
      void unlisten.then((fn) => fn())
    }
  }, [])
  return args
}

/**
 * Maximise that respects the top bar and dock. A frameless window's native
 * maximise covers the whole monitor, hiding its title bar under the menu
 * bar; instead the window fills the work area. Any native maximise (double
 * click, Win+Up, auto-maximise) is converted the same way.
 */
function useWorkAreaZoom() {
  const [zoomed, setZoomed] = useState(false)
  const saved = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const busy = useRef(false)

  const fill = useCallback(async () => {
    await invoke('shell_snap_self', { zone: { x: 0, y: 0, w: 1, h: 1 } })
    setZoomed(true)
  }, [])

  const remember = async () => {
    const win = getCurrentWindow()
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()])
    saved.current = { x: pos.x, y: pos.y, w: size.width, h: size.height }
  }

  const toggle = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    const win = getCurrentWindow()
    try {
      if (zoomed && saved.current) {
        const b = saved.current
        await win.setSize(new PhysicalSize(b.w, b.h))
        await win.setPosition(new PhysicalPosition(b.x, b.y))
        setZoomed(false)
      } else {
        await remember()
        await fill()
      }
    } finally {
      busy.current = false
    }
  }, [zoomed, fill])

  useEffect(() => {
    const win = getCurrentWindow()
    const fix = async () => {
      if (busy.current || !(await win.isMaximized())) return
      busy.current = true
      try {
        await win.unmaximize()
        if (!saved.current) await remember()
        await fill()
      } finally {
        busy.current = false
      }
    }
    void fix()
    const un = win.onResized(() => void fix())
    return () => void un.then((f) => f())
  }, [fill])

  return { zoomed, toggle }
}

/** Root of an `?window=app&app=<id>` webview: one Udaan app in its own OS window. */
export function AppWindow({ appId }: { appId: AppId }) {
  const def = APP_DEFS[appId]
  const Component = APP_COMPONENTS[appId]
  const { active, maximized: nativeMax } = useWindowState(appId)
  const zoom = useWorkAreaZoom()
  // Full-screen apps (the TV) drop the title bar entirely.
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const w = getCurrentWindow()
    const check = () => void w.isFullscreen().then(setFullscreen, () => {})
    check()
    const un = w.onResized(check)
    return () => void un.then((f) => f())
  }, [])
  const maximized = zoom.zoomed || nativeMax
  const args = useLaunchArgs()
  const shown = useRef(false)
  const reduced = prefersReducedMotion()
  const openMo = useMotion('open')
  const closeMo = useMotion('close')
  const openProps = windowOpenMotion(openMo, openMo.style)
  const controls = useAnimationControls()
  const closing = useRef(false)
  const closedOnce = useRef(false)

  // A window that was closed is only hidden (it stays warm), so when it is shown again the open animation plays again.
  useEffect(() => {
    const replay = () => {
      if (!closedOnce.current) return
      closedOnce.current = false
      closing.current = false
      controls.set(openProps.initial)
      void controls.start(openProps.animate)
    }
    const onVis = () => document.visibilityState === 'visible' && replay()
    document.addEventListener('visibilitychange', onVis)
    const un = getCurrentWindow().onFocusChanged(({ payload }) => payload && replay())
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      void un.then((f) => f())
    }
  }, [controls, openProps])

  useEffect(() => {
    document.title = def.name
    if (shown.current) return
    shown.current = true
    // A pre-warmed window stays hidden until the shell actually opens it.
    if (new URLSearchParams(window.location.search).has('warm')) return
    // Reveal only after the first real paint so the window never flashes blank.
    requestAnimationFrame(() => void getCurrentWindow().show().then(() => getCurrentWindow().setFocus()))
  }, [def.name])

  const win = getCurrentWindow()
  useEffect(() => {
    void controls.start(reduced ? windowMotion.reduced.animate : openProps.animate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Closing hides the window instantly so reopening is immediate. How long it then stays
  // warm is the engine's decision (engine::apps): briefly, capped, and shorter when the PC
  // is short of memory. The TV always closes fully (its players must stop).
  const close = async () => {
    if (appId === 'tv') return void win.close()
    if (closing.current) return
    closing.current = true
    // A short exit first (chosen in Settings → Animations), then the window is hidden.
    const exit = reduced ? null : windowCloseMotion(closeMo, closeMo.style)
    if (exit) await controls.start(exit.animate).catch(() => {})
    closedOnce.current = true
    void invoke('engine_app_closed')
  }
  const content: ReactNode = <Component {...(args ?? {})} onClose={close} />

  return (
    <motion.div
      className="flex h-screen w-screen flex-col overflow-hidden bg-bg-base"
      initial={reduced ? windowMotion.reduced.initial : openProps.initial}
      animate={controls}
      onAnimationComplete={undefined}
    >
      {!fullscreen && <TitleBar
        title={def.name}
        appId={appId}
        active={active}
        maximized={maximized}
        onClose={close}
        onMinimize={() => void win.minimize()}
        onToggleMaximize={() => void zoom.toggle()}
      />}
      {/* Content settles a beat after the frame.
          A window whose chrome and contents arrive on the same frame reads
          as one flat image appearing. Letting the frame land first and the
          content rise into it reads as a window opening and then filling —
          the same staging a real compositor's open animation has. */}
      <motion.main
        className="relative min-h-0 flex-1 overflow-hidden"
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.3, ease: [0.05, 0.7, 0.1, 1] }}
      >
        <Suspense fallback={<Loading />}>{content}</Suspense>
      </motion.main>
    </motion.div>
  )
}
