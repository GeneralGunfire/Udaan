import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { APP_COMPONENTS, APP_DEFS, type AppId } from '@/os/kernel/registry'
import { loadBounds, saveBounds, shell } from '@/os/kernel/shell'
import { windowMotion } from '@/os/motion/systemMotion'
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
  // Closing hides the window instantly and keeps it warm for a few minutes,
  // so reopening is immediate; after that it is destroyed to free memory.
  // The TV always closes fully (its players must stop).
  const reap = useRef<ReturnType<typeof setTimeout>>(undefined)
  const close = () => {
    if (appId === 'tv') return void win.close()
    void win.hide()
    clearTimeout(reap.current)
    reap.current = setTimeout(() => void win.destroy(), 180_000)
  }
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && clearTimeout(reap.current)
    document.addEventListener('visibilitychange', onVisible)
    const un = getCurrentWindow().onFocusChanged(({ payload }) => payload && clearTimeout(reap.current))
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void un.then((f) => f())
    }
  }, [])
  const content: ReactNode = <Component {...(args ?? {})} onClose={close} />

  return (
    <motion.div
      className="flex h-screen w-screen flex-col overflow-hidden bg-bg-base"
      {...(reduced ? windowMotion.reduced : windowMotion.open)}
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
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<Loading />}>{content}</Suspense>
      </main>
    </motion.div>
  )
}
