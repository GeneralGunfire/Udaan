import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useSpring } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { shell, useShell, type ShellWindow } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { Wallpaper } from '@/os/desktop/Wallpaper'
import { playSound } from '@/os/sound/sounds'

const CARD_W = 440
const CARD_H = 275
/** Degrees of carousel turn per pixel of horizontal drag. */
const DEG_PER_PX = 0.32

/** Stand-in "window" for the desktop card. */
const DESKTOP: ShellWindow = { handle: -1, title: 'Desktop', processName: 'Desktop', exePath: null, isMinimized: false, isMaximized: false, appId: null }

const snapshotCache = new Map<number, string>()
const iconCache = new Map<number, string | null>()

/**
 * The window switcher: open windows on a 3D carousel, triggered either by
 * dragging up from the bottom edge, or by double-tapping Ctrl.
 *
 * Two independent input paths feed the same `turn` motion value:
 *  - Drag-triggered (`origin` set): the pointer is still held in whatever
 *    window the press started in, so movement arrives from the native
 *    gesture hook (gesture://move/end/cancel) rather than as DOM events —
 *    dragging sideways turns the carousel, releasing opens the front card.
 *  - Ctrl-triggered (`origin` undefined): there's no held button or native
 *    drag to continue, so plain mouse movement over this window turns the
 *    carousel instead, and a plain click opens the front card. This path is
 *    pointer-relative (delta since last move), not an absolute drag like
 *    the gesture path, since there's no "start" point to measure from.
 */
export function Switcher3D({ origin, onDone }: { origin?: { x: number; y: number } | null; onDone: () => void }) {
  const storeWindows = useShell((s) => s.windows)
  const storeForeground = useShell((s) => s.foreground)
  // Ask for the live list on open rather than trusting a possibly stale store.
  const [fresh, setFresh] = useState<{ windows: ShellWindow[]; foreground: number } | null>(null)
  useEffect(() => {
    void shell.snapshot().then((snap) => setFresh({ windows: snap.windows, foreground: snap.foreground }), () => {})
  }, [])
  const all = fresh?.windows.length ? fresh.windows : storeWindows
  const foreground = fresh?.foreground ?? storeForeground
  const windows = useMemo(() => {
    const list = [...all]
    const i = list.findIndex((w) => w.handle === foreground)
    if (i > 0) list.unshift(...list.splice(i, 1))
    // The desktop is always the last card, one flick away.
    return [...list.slice(0, 11), DESKTOP]
  }, [all, foreground])
  const [shots, setShots] = useState<Record<number, string>>(() => Object.fromEntries(windows.flatMap((w) => (snapshotCache.has(w.handle) ? [[w.handle, snapshotCache.get(w.handle)!]] : []))))
  const [icons, setIcons] = useState<Record<number, string | null>>({})
  const turn = useMotionValue(0)
  const smooth = useSpring(turn, { stiffness: 260, damping: 32 })
  const [front, setFront] = useState(0)
  const frontRef = useRef(0)
  const n = windows.length
  // A tight arc, not a full ring: neighbours stay in view on either side.
  const step = n > 0 ? Math.min(34, 360 / n) : 0
  const radius = 900
  const dpr = window.devicePixelRatio || 1

  // Fresh pictures of every window (the cache shows last time's instantly).
  useEffect(() => {
    const handles = windows.filter((w) => w !== DESKTOP).map((w) => w.handle)
    if (!handles.length) return
    void invoke<Record<string, string | null>>('shell_window_snapshots', { handles, maxWidth: Math.round(CARD_W * dpr) }).then((r) => {
      const next: Record<number, string> = {}
      for (const [k, v] of Object.entries(r)) if (v) next[Number(k)] = v
      for (const [k, v] of Object.entries(next)) snapshotCache.set(Number(k), v)
      setShots((prev) => ({ ...prev, ...next }))
    })
    const needIcons = windows.filter((w) => w !== DESKTOP && !w.appId && !iconCache.has(w.handle)).map((w) => w.handle)
    if (needIcons.length)
      void shell.windowIcons(needIcons).then((r) => {
        for (const [k, v] of Object.entries(r)) iconCache.set(Number(k), v)
        setIcons(Object.fromEntries(iconCache))
      })
    else setIcons(Object.fromEntries(iconCache))
    // When the switcher opens, and again once the live window list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows.map((w) => w.handle).join(',')])

  useMotionValueEvent(smooth, 'change', (deg) => {
    if (!n) return
    const idx = ((Math.round(-deg / step) % n) + n) % n
    if (idx !== frontRef.current) {
      frontRef.current = idx
      setFront(idx)
      playSound('tap')
    }
  })

  const openFront = useCallback(() => {
    const w = windows[frontRef.current]
    // Settle the carousel on the chosen card, then switch.
    void animate(turn, -frontRef.current * step, { duration: 0.18 })
    setTimeout(() => {
      onDone()
      if (w === DESKTOP) {
        playSound('open')
        void shell.toggleDesktop()
      } else if (w) {
        playSound('open')
        void shell.focus(w.handle)
      }
    }, 140)
  }, [windows, turn, step, onDone])

  // Keyboard: arrows turn to the neighbouring card, Enter opens the one in front,
  // Esc closes. The front index is updated at once (not when the spring catches up),
  // so pressing Enter right after an arrow opens the card you just selected.
  useEffect(() => {
    const go = (dir: number) => {
      if (!n) return
      const current = Math.round(-turn.get() / step)
      const next = Math.max(0, Math.min(n - 1, current + dir))
      turn.set(-next * step)
      frontRef.current = next
      setFront(next)
      if (next !== current) playSound('tap')
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1)
      else if (e.key === 'Home') go(-n)
      else if (e.key === 'End') go(n)
      else if (e.key === 'Enter') openFront()
      else if (e.key === 'Escape') onDone()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, step, turn, openFront, onDone])

  // Drag-triggered open: the native gesture stream drives the carousel.
  useEffect(() => {
    if (!origin) return
    const subs = [
      listen<{ x: number; y: number }>('gesture://move', (e) => {
        // Dragging right brings the next card round; the ends resist.
        const raw = -((e.payload.x - origin.x) / dpr) * DEG_PER_PX
        const min = -(n - 1) * step
        const over = raw > 0 ? raw : raw < min ? raw - min : 0
        turn.set((raw > 0 ? 0 : raw < min ? min : raw) + over * 0.15)
      }),
      listen('gesture://end', openFront),
      listen('gesture://cancel', () => onDone()),
    ]
    return () => subs.forEach((p) => void p.then((fn) => fn()))
  }, [origin, dpr, turn, step, n, onDone, openFront])

  // Ctrl-triggered open: no held button or native drag to continue, so
  // plain mouse movement over this window turns the carousel instead, and a
  // plain click (not a drag) opens the front card. Pointer-relative
  // (compares against the previous move), since there's no fixed drag
  // origin the way the gesture path has.
  const lastXRef = useRef<number | null>(null)
  const onHoverMove = useCallback(
    (e: React.MouseEvent) => {
      if (origin) return
      const lastX = lastXRef.current
      lastXRef.current = e.clientX
      if (lastX === null) return
      const dx = e.clientX - lastX
      const raw = turn.get() - dx * DEG_PER_PX
      const min = -(n - 1) * step
      const over = raw > 0 ? raw : raw < min ? raw - min : 0
      turn.set((raw > 0 ? 0 : raw < min ? min : raw) + over * 0.15)
    },
    [origin, turn, step, n],
  )
  const onHoverClick = useCallback(() => {
    if (origin) return
    openFront()
  }, [origin, openFront])

  const current = windows[front]

  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0, y: 110 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 80, transition: { duration: 0.2, ease: [1, 0, 1, 1] } }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
      style={{ background: 'radial-gradient(ellipse at 50% 60%, rgb(20 24 34 / 0.72), rgb(5 6 9 / 0.9))' }}
      onMouseMove={origin ? undefined : onHoverMove}
      onClick={origin ? undefined : onHoverClick}
      onContextMenu={
        origin
          ? undefined
          : (e) => {
              e.preventDefault()
              onDone()
            }
      }
    >
      {n === 0 ? (
        <p className="text-[18px] text-white/70">No open windows</p>
      ) : (
        <>
          <div style={{ perspective: 2000, perspectiveOrigin: '50% 40%', width: CARD_W, height: CARD_H }} className="relative">
            <motion.div
              className="absolute inset-0"
              style={{ transformStyle: 'preserve-3d', rotateY: smooth, rotateX: -5, z: -radius }}
              initial={{ scale: 0.72, y: 60 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 24, mass: 0.9 }}
            >
              {windows.map((w, i) => (
                <Card key={w.handle} desktop={w === DESKTOP} w={w} shot={shots[w.handle]} icon={icons[w.handle] ?? null} active={i === front} transform={`rotateY(${i * step}deg) translateZ(${radius}px)`} />
              ))}
            </motion.div>
          </div>
          <div className="mt-24 flex h-16 flex-col items-center text-white">
            <p className="max-w-[640px] truncate text-[20px] font-semibold">{current?.title || current?.processName}</p>
            <p className="mt-1 text-[13px] text-white/50">
              {origin ? 'Drag sideways to turn · release to open · right-click to cancel' : 'Move the mouse to turn · click to open · right-click to cancel'}
            </p>
          </div>
        </>
      )}
    </motion.div>
  )
}

function Card({ w, shot, icon, active, transform, desktop }: { w: ShellWindow; shot?: string; icon: string | null; active: boolean; transform: string; desktop?: boolean }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[12px] bg-[var(--surface-base)] transition-[box-shadow,filter] duration-200"
      style={{
        transform,
        backfaceVisibility: 'hidden',
        boxShadow: active ? '0 0 0 3px var(--color-accent), 0 30px 80px rgb(0 0 0 / 0.6)' : '0 20px 60px rgb(0 0 0 / 0.5)',
        filter: active ? 'none' : 'brightness(0.6)',
      }}
    >
      {desktop ? (
        <div className="absolute inset-0">
          <Wallpaper />
        </div>
      ) : shot ? (
        <img src={shot} alt="" draggable={false} className="h-full w-full object-cover object-top" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2a2c33] to-[#17181c]">
          {w.appId ? <AppIcon appId={w.appId} size={88} /> : icon ? <img src={icon} alt="" className="h-20 w-20" /> : null}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6">
        {w.appId ? <AppIcon appId={w.appId} size={18} /> : icon && <img src={icon} alt="" className="h-[18px] w-[18px]" />}
        <span className="truncate text-[12.5px] font-medium text-white">{w.title || w.processName}</span>
      </div>
    </div>
  )
}
