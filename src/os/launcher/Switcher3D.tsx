import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { listen } from '@tauri-apps/api/event'
import { shell, useShell, type ShellWindow } from '@/os/kernel/shell'
import { usePref } from '@/os/kernel/prefs'
import { useMotion } from '@/os/motion/config'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { Wallpaper } from '@/os/desktop/Wallpaper'
import { playSound } from '@/os/sound/sounds'
import { captureSnapshots, iconCache, snapshotCache } from './switcherCache'

const SIZES = { small: 360, medium: 440, large: 540 } as const

/** Stand-in "window" for the desktop card. */
const DESKTOP: ShellWindow = { handle: -1, title: 'Desktop', processName: 'Desktop', exePath: null, isMinimized: false, isMaximized: false, appId: null }

/**
 * THE WINDOW SWITCHER. Every open window as a card on a 3D carousel (or a flat strip, or a plain fade: Settings →
 * Animations → Window switcher), opened by dragging up from the bottom edge past the middle of the screen, or by
 * double-tapping Ctrl, from anywhere.
 *
 * Steering is the same for both ways in: the pointer scrubs along the row of cards, anchored where it was when the
 * switcher opened (so nothing jumps), and the carousel settles on the nearest card a moment after the pointer slows.
 *   - Drag-opened: the button is still held in another window, so the pointer arrives from the native gesture hook
 *     (gesture://move); release opens the card in front.
 *   - Ctrl-opened: the pointer moves over this window; click a card to open it, click empty space or right-click to cancel.
 * Both: arrow keys, Tab, 1 to 9, the wheel, Enter and Esc.
 *
 * It is built to be cheap on this PC: the carousel turns with ONE animated transform on its parent, every card is dimmed
 * by an overlay rather than a blur filter, and only the front card casts a shadow. Pictures come from a cache that is kept
 * warm in the background (switcherCache), so the cards are full the moment it opens.
 */
export function Switcher3D({ origin, onDone }: { origin?: { x: number; y: number } | null; onDone: () => void }) {
  const mo = useMotion('switcher')
  const [sizePref] = usePref('switcher.size')
  const CARD_W = SIZES[sizePref] ?? SIZES.medium
  const CARD_H = Math.round(CARD_W * 0.625)
  const radius = Math.round(CARD_W * 2.05)

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
  const n = windows.length
  const dpr = window.devicePixelRatio || 1

  const [shots, setShots] = useState<Record<number, string>>(() => Object.fromEntries(windows.flatMap((w) => (snapshotCache.has(w.handle) ? [[w.handle, snapshotCache.get(w.handle)!]] : []))))
  const [icons, setIcons] = useState<Record<number, string | null>>(() => Object.fromEntries(iconCache))

  // Whatever is cached shows at once; fresh pictures replace it a moment later.
  const handleKey = windows.map((w) => w.handle).join(',')
  useEffect(() => {
    const live = windows.filter((w) => w !== DESKTOP)
    setShots((prev) => ({ ...Object.fromEntries(live.flatMap((w) => (snapshotCache.has(w.handle) ? [[w.handle, snapshotCache.get(w.handle)!]] : []))), ...prev }))
    void captureSnapshots(live.filter((w) => !w.isMinimized).map((w) => w.handle), CARD_W * dpr).then((next) => setShots((prev) => ({ ...prev, ...next })))
    const need = live.filter((w) => !w.appId && !iconCache.has(w.handle)).map((w) => w.handle)
    if (need.length)
      void shell.windowIcons(need).then((r) => {
        for (const [k, v] of Object.entries(r)) iconCache.set(Number(k), v)
        setIcons(Object.fromEntries(iconCache))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleKey, CARD_W])

  /** Where the carousel is, as a (fractional) card index. The cards turn with one transform off this. */
  const pos = useMotionValue(0)
  const k = mo.on ? mo.k : 1
  const smooth = useSpring(pos, mo.on ? { stiffness: 330 * k * k, damping: 34 * (1.25 - mo.bounce * 0.5) * k, mass: 1 } : { stiffness: 100000, damping: 1000, mass: 1 })
  const step = n > 1 ? Math.min(34, 360 / n) : 0
  const rotateY = useTransform(smooth, (p) => -p * step)
  const [front, setFront] = useState(0)
  const frontRef = useRef(0)

  useMotionValueEvent(smooth, 'change', (p) => {
    if (!n) return
    const idx = Math.max(0, Math.min(n - 1, Math.round(p)))
    if (idx !== frontRef.current) {
      frontRef.current = idx
      setFront(idx)
      playSound('tap')
    }
  })

  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const goTo = useCallback(
    (i: number, instant = false) => {
      const next = Math.max(0, Math.min(n - 1, i))
      clearTimeout(settle.current)
      frontRef.current = next
      setFront(next)
      if (instant) pos.set(next)
      else void animate(pos, next, { duration: 0.16 })
    },
    [n, pos],
  )
  /** After the pointer slows, glide to the nearest card so the carousel always rests square on one. */
  const settleSoon = useCallback(() => {
    clearTimeout(settle.current)
    settle.current = setTimeout(() => void animate(pos, Math.max(0, Math.min(n - 1, Math.round(pos.get()))), { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }), 130)
  }, [n, pos])
  useEffect(() => () => clearTimeout(settle.current), [])

  const open = useCallback(
    (i: number) => {
      const w = windows[i]
      if (!w) return onDone()
      frontRef.current = i
      setFront(i)
      void animate(pos, i, { duration: 0.1 })
      playSound('open')
      // The chosen window comes forward straight away, behind the switcher, so it is already there as the cards leave.
      if (w !== DESKTOP) void shell.focus(w.handle)
      setTimeout(() => {
        onDone()
        if (w === DESKTOP) void shell.toggleDesktop()
      }, 100)
    },
    [windows, pos, onDone],
  )
  const openFront = useCallback(() => open(frontRef.current), [open])

  /** The pointer scrubs along the cards, relative to where it started, so the first movement never jumps. */
  const anchor = useRef<{ x: number; p: number } | null>(null)
  const scrub = useCallback(
    (clientX: number) => {
      if (n < 2) return
      if (!anchor.current) anchor.current = { x: clientX, p: pos.get() }
      const perCard = Math.min(220, Math.max(100, (window.innerWidth * 0.4) / (n - 1)))
      pos.set(Math.max(0, Math.min(n - 1, anchor.current.p + (clientX - anchor.current.x) / perCard)))
      settleSoon()
    },
    [n, pos, settleSoon],
  )

  // Keyboard: arrows and Tab move, 1 to 9 jump, Enter opens the card in front, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = frontRef.current
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) goTo(e.key === 'Tab' && cur >= n - 1 ? 0 : cur + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) goTo(e.key === 'Tab' && cur <= 0 ? n - 1 : cur - 1)
      else if (e.key === 'Home') goTo(0)
      else if (e.key === 'End') goTo(n - 1)
      else if (/^[1-9]$/.test(e.key)) goTo(Number(e.key) - 1)
      else if (e.key === 'Enter') openFront()
      else if (e.key === 'Escape') onDone()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, goTo, openFront, onDone])

  // Drag-opened: the native gesture stream steers it; release opens the card in front.
  useEffect(() => {
    if (!origin) return
    anchor.current = { x: origin.x / dpr, p: pos.get() }
    const subs = [
      listen<{ x: number; y: number }>('gesture://move', (e) => scrub(e.payload.x / dpr)),
      listen('gesture://end', openFront),
      listen('gesture://cancel', () => onDone()),
    ]
    return () => subs.forEach((p) => void p.then((fn) => fn()))
  }, [origin, dpr, pos, scrub, onDone, openFront])

  const onWheel = (e: React.WheelEvent) => goTo(frontRef.current + (e.deltaY + e.deltaX > 0 ? 1 : -1))

  // The hint fades out after a few seconds so nothing stays on screen that is not needed.
  const [hint, setHint] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 3500)
    return () => clearTimeout(t)
  }, [])

  const current = windows[front]
  const style = mo.style
  const quick = mo.on ? 1 / k : 0

  return (
    <motion.div
      className="fixed inset-0 flex select-none flex-col items-center justify-center overflow-hidden"
      initial={mo.on ? { opacity: 0 } : false}
      animate={{ opacity: 1, transition: { duration: 0.22 * quick } }}
      exit={{ opacity: 0, transition: { duration: 0.18 * quick } }}
      style={{ background: 'radial-gradient(ellipse at 50% 58%, rgb(18 21 30 / 0.7), rgb(4 5 8 / 0.92))' }}
      onMouseMove={origin ? undefined : (e) => scrub(e.clientX)}
      onWheel={onWheel}
      onClick={origin ? undefined : () => onDone()}
      onContextMenu={origin ? undefined : (e) => (e.preventDefault(), onDone())}
    >
      {n === 0 ? (
        <p className="text-[18px] text-white/70">No open windows</p>
      ) : (
        <>
          <div style={{ perspective: 2000, perspectiveOrigin: '50% 40%', width: CARD_W, height: CARD_H }} className="relative">
            {style === 'flat' ? (
              <motion.div className="absolute inset-0" initial={mo.on ? { opacity: 0, y: 50 } : false} animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300 * k * k, damping: 30 * k } }}>
                {windows.map((w, i) => (
                  <FlatCard key={w.handle} index={i} smooth={smooth} w={w} shot={shots[w.handle]} icon={icons[w.handle] ?? null} active={i === front} desktop={w === DESKTOP} width={CARD_W} onOpen={() => open(i)} delay={i * 0.025 * quick} />
                ))}
              </motion.div>
            ) : (
              <motion.div
                className="absolute inset-0"
                style={{ transformStyle: 'preserve-3d', rotateY, rotateX: -4, z: -radius, willChange: 'transform' }}
                initial={mo.on ? (style === 'fade' ? { opacity: 0 } : { scale: 0.78, y: 70, opacity: 0 }) : false}
                animate={{ scale: 1, y: 0, opacity: 1, transition: { type: 'spring', stiffness: 250 * k * k, damping: 26 * (1.25 - mo.bounce * 0.5) * k, mass: 0.9 } }}
              >
                {windows.map((w, i) => {
                  // Distance from the front card in positions; the desktop is a plain neighbour like any other.
                  const depth = Math.abs(i - front)
                  return (
                    <div key={w.handle} className="absolute inset-0" style={{ transform: `rotateY(${i * step}deg) translateZ(${radius}px)`, backfaceVisibility: 'hidden' }}>
                      <Card w={w} shot={shots[w.handle]} icon={icons[w.handle] ?? null} active={i === front} depth={depth} desktop={w === DESKTOP} delay={Math.min(depth, 5) * 0.03 * quick} onOpen={() => open(i)} />
                    </div>
                  )
                })}
              </motion.div>
            )}
          </div>

          <div className="pointer-events-none mt-24 flex h-24 flex-col items-center text-white">
            <div className="flex max-w-[640px] items-center gap-2.5">
              {current && (current.appId ? <AppIcon appId={current.appId} size={26} /> : icons[current.handle] ? <img src={icons[current.handle]!} alt="" className="h-[26px] w-[26px]" /> : null)}
              <p className="truncate text-[20px] font-semibold tracking-tight">{current?.title || current?.processName}</p>
            </div>
            <div className="mt-3 flex items-center gap-1.5" aria-hidden>
              {windows.map((w, i) => (
                <motion.span key={w.handle} animate={{ width: i === front ? 18 : 6, opacity: i === front ? 1 : 0.35 }} transition={{ duration: 0.18 }} className="h-1.5 rounded-full bg-white" />
              ))}
            </div>
            <motion.p animate={{ opacity: hint ? 0.5 : 0 }} transition={{ duration: 0.4 }} className="mt-3 text-[12px]">
              {origin ? 'Slide to choose · release to open · right-click to cancel' : 'Move to choose · click a card to open · click outside to cancel'}
            </motion.p>
          </div>
        </>
      )}
    </motion.div>
  )
}

/** The picture (or icon) and name shared by both layouts. */
function Face({ w, shot, icon, desktop }: { w: ShellWindow; shot?: string; icon: string | null; desktop?: boolean }) {
  return (
    <>
      {desktop ? (
        <div className="absolute inset-0">
          <Wallpaper />
        </div>
      ) : shot ? (
        <img src={shot} alt="" draggable={false} className="h-full w-full object-cover object-top" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2a2c33] to-[#17181c]">{w.appId ? <AppIcon appId={w.appId} size={88} /> : icon ? <img src={icon} alt="" className="h-20 w-20" /> : null}</div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-7">
        {w.appId ? <AppIcon appId={w.appId} size={18} /> : icon && <img src={icon} alt="" className="h-[18px] w-[18px]" />}
        <span className="truncate text-[12.5px] font-medium text-white">{w.title || w.processName}</span>
      </div>
    </>
  )
}

const ACTIVE = '0 0 0 2px rgb(255 255 255 / 0.9), 0 26px 64px rgb(0 0 0 / 0.55)'
const IDLE = 'inset 0 0 0 1px rgb(255 255 255 / 0.1)'

/**
 * One card on the carousel. Depth is shown by a dark overlay that grows with distance, which costs almost nothing, instead
 * of a blur filter, which is re-drawn every frame; only the front card carries a shadow.
 */
function Card({ w, shot, icon, active, depth, desktop, delay, onOpen }: { w: ShellWindow; shot?: string; icon: string | null; active: boolean; depth: number; desktop?: boolean; delay: number; onOpen: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 cursor-pointer overflow-hidden rounded-[14px] bg-[var(--surface-base)]"
      initial={{ opacity: 0, y: 36 }}
      animate={{ opacity: 1, y: 0, scale: active ? 1.035 : 1, boxShadow: active ? ACTIVE : IDLE }}
      transition={{ type: 'spring', stiffness: 380, damping: 30, delay: active ? 0 : delay }}
      onClick={(e) => (e.stopPropagation(), onOpen())}
    >
      <Face w={w} shot={shot} icon={icon} desktop={desktop} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-200" style={{ opacity: active ? 0 : Math.min(0.6, 0.18 + depth * 0.14) }} />
    </motion.div>
  )
}

/** The lightest layout: cards in a row that slide and shrink away from the one in front. */
function FlatCard({ index, smooth, w, shot, icon, active, desktop, width, onOpen, delay }: { index: number; smooth: MotionValue<number>; w: ShellWindow; shot?: string; icon: string | null; active: boolean; desktop?: boolean; width: number; onOpen: () => void; delay: number }) {
  const x = useTransform(smooth, (p) => (index - p) * width * 0.62)
  const scale = useTransform(smooth, (p) => Math.max(0.62, 1 - Math.abs(index - p) * 0.14))
  const dim = useTransform(smooth, (p) => Math.min(0.6, Math.abs(index - p) * 0.2))
  const z = useTransform(smooth, (p) => 100 - Math.round(Math.abs(index - p) * 10))
  return (
    <motion.div
      className="absolute inset-0 cursor-pointer overflow-hidden rounded-[14px] bg-[var(--surface-base)]"
      style={{ x, scale, zIndex: z, boxShadow: active ? ACTIVE : IDLE, willChange: 'transform' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay } }}
      onClick={(e) => (e.stopPropagation(), onOpen())}
    >
      <Face w={w} shot={shot} icon={icon} desktop={desktop} />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: dim }} />
    </motion.div>
  )
}
