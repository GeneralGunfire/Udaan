import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, type Transition, type Variants } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { AppIcon } from '@/os/ui/icons/AppIcon'

/**
 * MOTION LAB (browser preview only). Candidate animations for the lock screens, profile switch and Start, judged for
 * feel and cost before anything is ported. Rules: transform + opacity only (compositor), springs for anything
 * interruptible, exits ~half the entrance, one large animated layer at a time. Speed buttons slow everything down so
 * the shape of the motion can be judged; the FPS readout shows whether it stays smooth on this machine.
 */

/** Springs rescaled so 0.25x really is 4x slower with the same shape. */
function sp(k: number, stiffness: number, damping: number, mass = 1): Transition {
  return { type: 'spring', stiffness: stiffness * k * k, damping: damping * k, mass }
}
const ease = (k: number, duration: number, e: number[] = [0.16, 1, 0.3, 1]): Transition => ({ duration: duration / k, ease: e })

function Fps() {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    let raf = 0, n = 0, t0 = performance.now()
    const loop = (t: number) => {
      n++
      if (t - t0 >= 500) { setFps(Math.round((n * 1000) / (t - t0))); n = 0; t0 = t }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <span className={cn('tabular-nums', fps < 40 ? 'text-red-300' : 'text-emerald-300')}>{fps} fps</span>
}

/* Ambient graphics: soft drifting light blobs (transform only), cheaper and calmer than a shader. */
function Aurora({ hue = 215 }: { hue?: number }) {
  const blobs = [
    { x: ['-10%', '12%', '-10%'], y: ['-8%', '10%', '-8%'], c: `hsl(${hue} 80% 55% / .55)`, s: 62, d: 26 },
    { x: ['40%', '18%', '40%'], y: ['30%', '55%', '30%'], c: `hsl(${hue + 50} 75% 50% / .45)`, s: 54, d: 32 },
    { x: ['55%', '70%', '55%'], y: ['-12%', '8%', '-12%'], c: `hsl(${hue - 40} 85% 60% / .4)`, s: 46, d: 38 },
  ]
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-[#070a12]">
      {blobs.map((b, i) => (
        <motion.div key={i} className="absolute rounded-full" style={{ width: `${b.s}vmax`, height: `${b.s}vmax`, background: `radial-gradient(circle, ${b.c}, transparent 65%)`, willChange: 'transform' }} animate={{ left: b.x, top: b.y }} transition={{ duration: b.d, repeat: Infinity, ease: 'easeInOut' }} />
      ))}
    </div>
  )
}

function Clock({ k, delay = 0 }: { k: number; delay?: number }) {
  const v: Variants = { hidden: { opacity: 0, y: 28, filter: 'blur(8px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)' } }
  return (
    <motion.div initial="hidden" animate="show" transition={{ staggerChildren: 0.09 / k, delayChildren: delay / k }} className="flex flex-col items-center text-white">
      <motion.p variants={v} transition={ease(k, 0.9)} className="text-[15px] font-medium tracking-wide opacity-75">Tuesday 18 November</motion.p>
      <motion.p variants={v} transition={ease(k, 1.1)} className="text-[118px] font-extralight leading-none tracking-tight">9:41</motion.p>
    </motion.div>
  )
}

/* ── 1. LOCK SCREEN ───────────────────────────────────────────────── */

type LockStyle = 'curtain' | 'shutter' | 'iris'
function LockDemo({ k }: { k: number }) {
  const [locked, setLocked] = useState(true)
  const [style, setStyle] = useState<LockStyle>('curtain')
  return (
    <Stage title="Lock screen" note="Locking brings the screen down from the top with a settle. Unlocking is not a fade: the screen lifts away and the desktop is revealed beneath, scaling up into place.">
      <div className="absolute inset-0"><Desktop /></div>
      <AnimatePresence>
        {locked && style === 'curtain' && (
          <motion.div key="c" className="absolute inset-0 overflow-hidden" style={{ willChange: 'transform' }} initial={{ y: '-100%' }} animate={{ y: 0, transition: sp(k, 150, 22, 1.1) }} exit={{ y: '-104%', transition: ease(k, 0.55, [0.7, 0, 0.84, 0]) }}>
            <Aurora /><Clock k={k} delay={0.35} /><div className="absolute inset-0 flex items-end justify-center pb-[9vh]"><Unlock k={k} onClick={() => setLocked(false)} /></div>
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/25" />
          </motion.div>
        )}
        {locked && style === 'shutter' && [0, 1].map((i) => (
          <motion.div key={'s' + i} className="absolute inset-x-0 overflow-hidden" style={{ [i ? 'bottom' : 'top']: 0, height: '50%', willChange: 'transform' }} initial={{ y: i ? '100%' : '-100%' }} animate={{ y: 0, transition: sp(k, 170, 24, 1) }} exit={{ y: i ? '100%' : '-100%', transition: ease(k, 0.6, [0.7, 0, 0.84, 0]) }}>
            <div className="absolute inset-x-0 h-[100vh]" style={{ [i ? 'bottom' : 'top']: 0 }}><Aurora hue={265} /></div>
            {i === 0 && <div className="absolute inset-x-0 bottom-0 top-0 flex items-end justify-center pb-4"><Clock k={k} delay={0.4} /></div>}
            {i === 1 && <div className="absolute inset-0 flex items-start justify-center pt-12"><Unlock k={k} onClick={() => setLocked(false)} /></div>}
          </motion.div>
        ))}
        {locked && style === 'iris' && (
          <motion.div key="i" className="absolute inset-0 overflow-hidden" initial={{ clipPath: 'circle(0% at 50% 100%)' }} animate={{ clipPath: 'circle(150% at 50% 100%)', transition: ease(k, 0.9, [0.2, 0.8, 0.2, 1]) }} exit={{ clipPath: 'circle(0% at 50% 100%)', transition: ease(k, 0.6, [0.7, 0, 0.84, 0]) }}>
            <Aurora hue={170} /><Clock k={k} delay={0.4} /><div className="absolute inset-0 flex items-end justify-center pb-[9vh]"><Unlock k={k} onClick={() => setLocked(false)} /></div>
          </motion.div>
        )}
      </AnimatePresence>
      <Controls>
        {(['curtain', 'shutter', 'iris'] as LockStyle[]).map((s) => <Pill key={s} on={style === s} onClick={() => { setStyle(s); setLocked(false); setTimeout(() => setLocked(true), 60) }}>{s}</Pill>)}
        <Pill on={false} onClick={() => setLocked((l) => !l)}>{locked ? 'Unlock' : 'Lock'}</Pill>
      </Controls>
    </Stage>
  )
}

function Unlock({ k, onClick }: { k: number; onClick: () => void }) {
  return (
    <motion.button type="button" onClick={onClick} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0, transition: { ...ease(k, 0.8), delay: 1 / k } }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="rounded-full bg-white/15 px-7 py-3 text-[14px] text-white backdrop-blur-md">
      Click to unlock
    </motion.button>
  )
}

function Desktop() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#1b2c4a] via-[#31507f] to-[#8a6a9e]">
      <div className="absolute inset-x-0 top-0 h-7 bg-black/30" />
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-[22px] bg-white/15 p-2 backdrop-blur-md">
        {['file-explorer', 'calendar', 'settings', 'tv'].map((a) => <AppIcon key={a} appId={a} size={44} />)}
      </div>
    </div>
  )
}

/* ── 2. PROFILE SWITCH ────────────────────────────────────────────── */

function ProfileDemo({ k }: { k: number }) {
  const [work, setWork] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sweep, setSweep] = useState<0 | 1>(0)
  const go = () => {
    if (busy) return
    setBusy(true); setSweep(1)
    setTimeout(() => setWork((w) => !w), 520 / k)
    setTimeout(() => { setSweep(0); setBusy(false) }, 1300 / k)
  }
  const dir = work ? -1 : 1
  return (
    <Stage title="Profile switch" note="A tinted panel sweeps across carrying the profile's mark; the world changes behind it while it covers the screen, then it exits the other side. Wallpaper and dock content cross-slide with a small parallax.">
      <motion.div key={String(work)} className="absolute inset-0" initial={{ x: 60 * dir, opacity: 0 }} animate={{ x: 0, opacity: 1, transition: sp(k, 120, 20) }}>
        {work ? <div className="absolute inset-0 bg-gradient-to-br from-[#e8edf3] via-[#d4dce8] to-[#b8c6da]"><div className="absolute inset-x-0 top-0 h-7 bg-white/60" /><div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-[22px] bg-white/60 p-2">{['file-explorer', 'calendar', 'settings'].map((a) => <AppIcon key={a} appId={a} size={44} />)}</div></div> : <Desktop />}
      </motion.div>
      <AnimatePresence>
        {sweep === 1 && (
          <motion.div key="sw" className="absolute inset-0 z-10 flex items-center justify-center" style={{ willChange: 'transform', background: work ? 'linear-gradient(120deg,#1b2c4a,#31507f)' : 'linear-gradient(120deg,#0f3d3a,#1f7a6c)' }} initial={{ x: `${-100 * dir}%` }} animate={{ x: 0, transition: ease(k, 0.52, [0.7, 0, 0.2, 1]) }} exit={{ x: `${100 * dir}%`, transition: ease(k, 0.55, [0.7, 0, 0.2, 1]) }}>
            <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1, transition: { ...sp(k, 260, 18), delay: 0.2 / k } }} className="flex flex-col items-center gap-3 text-white">
              <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-white/15 text-[34px] font-light">{work ? 'P' : 'W'}</div>
              <p className="text-[18px] font-light tracking-wide">{work ? 'Personal' : 'Work'}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Controls><Pill on={false} onClick={go}>Switch to {work ? 'Personal' : 'Work'}</Pill></Controls>
    </Stage>
  )
}

/* ── 3. START MENU ────────────────────────────────────────────────── */

function StartDemo({ k }: { k: number }) {
  const [open, setOpen] = useState(true)
  const apps = ['file-explorer', 'calendar', 'settings', 'tv', 'file-explorer', 'calendar', 'settings', 'tv', 'file-explorer', 'calendar', 'settings', 'tv']
  const grid: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.028 / k, delayChildren: 0.12 / k } } }
  const item: Variants = { hidden: { opacity: 0, y: 14, scale: 0.9 }, show: { opacity: 1, y: 0, scale: 1, transition: sp(k, 420, 26) } }
  return (
    <Stage title="Start menu" note="Grows out of the dock button (origin bottom-centre), content follows in a tight stagger so the eye is led through the grid. Exit is a quick reverse with no stagger.">
      <div className="absolute inset-0"><Desktop /></div>
      <AnimatePresence>
        {open && (
          <motion.div key="start" className="absolute bottom-[84px] left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-[22px] border border-white/10 bg-[#14181f]/90 p-6 backdrop-blur-xl" style={{ transformOrigin: '50% 100%', willChange: 'transform' }} initial={{ opacity: 0, scale: 0.86, y: 40 }} animate={{ opacity: 1, scale: 1, y: 0, transition: sp(k, 360, 30) }} exit={{ opacity: 0, scale: 0.94, y: 16, transition: ease(k, 0.16, [0.3, 0, 0.8, 0.15]) }}>
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.1 / k } }} className="mb-5 h-10 rounded-full bg-white/10" />
            <motion.div variants={grid} initial="hidden" animate="show" className="grid grid-cols-6 gap-x-3 gap-y-5">
              {apps.map((a, i) => <motion.div key={i} variants={item} className="flex flex-col items-center gap-1.5 text-[11px] text-white/80"><AppIcon appId={a} size={40} />App {i + 1}</motion.div>)}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Controls><Pill on={false} onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Open'} Start</Pill></Controls>
    </Stage>
  )
}

/* ── 4. APP OPEN / CLOSE / MINIMIZE ───────────────────────────────── */

type AppStyle = 'dock' | 'zoom' | 'rise'
type Leave = 'close' | 'minimize'
const DOCK_APPS = ['file-explorer', 'calendar', 'settings', 'tv']

function AppDemo({ k }: { k: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const [leave, setLeave] = useState<Leave>('close')
  const [style, setStyle] = useState<AppStyle>('dock')
  // Where the icon is, relative to the window's centre, so the window can grow out of it and fly back into it.
  const from = (i: number) => ({ x: (i - 1.5) * 52, y: 150 })
  const v: Variants = {
    initial: (i: number) => (style === 'dock' ? { opacity: 0, scale: 0.1, ...from(i) } : style === 'zoom' ? { opacity: 0, scale: 0.9, y: 22 } : { opacity: 0, y: 90, scale: 0.98 }),
    animate: { opacity: 1, scale: 1, x: 0, y: 0, transition: style === 'dock' ? sp(k, 230, 24, 1) : style === 'zoom' ? sp(k, 380, 30, 0.9) : sp(k, 200, 26) },
    exit: ({ i, mode }: { i: number; mode: Leave }) =>
      mode === 'minimize'
        ? { opacity: 0, scale: 0.1, ...from(i), transition: ease(k, 0.4, [0.5, 0, 0.9, 0.4]) }
        : style === 'rise'
          ? { opacity: 0, y: 70, transition: ease(k, 0.22, [0.3, 0, 0.8, 0.15]) }
          : { opacity: 0, scale: 0.94, y: 6, transition: ease(k, 0.18, [0.3, 0, 0.8, 0.15]) },
  }
  const line: Variants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: sp(k, 360, 28) } }
  const go = (m: Leave) => { setLeave(m); setTimeout(() => setOpen(null), 0) }
  return (
    <Stage title="App open, close and minimize" note="Click a dock icon. 'Grow from dock' opens the window out of its icon and sends it back there on minimize. Close is a quick, short shrink with no bounce. Content lines arrive after the frame so the window feels built, not dropped.">
      <div className="absolute inset-0"><Desktop /></div>
      <div className="absolute inset-x-0 top-7 bottom-[76px] flex items-center justify-center">
        <AnimatePresence custom={{ i: open ?? 0, mode: leave }}>
          {open !== null && (
            <motion.div key={open} custom={open} variants={v} initial="initial" animate="animate" exit="exit" style={{ willChange: 'transform, opacity', transformOrigin: '50% 50%' }} className="flex h-[200px] w-[380px] flex-col overflow-hidden rounded-[12px] border border-white/10 bg-[#1b1e25] shadow-[0_18px_44px_rgb(0_0_0/.45)]">
              <div className="flex h-8 shrink-0 items-center gap-1.5 bg-black/25 px-3">
                <button type="button" aria-label="Close" onClick={() => go('close')} className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <button type="button" aria-label="Minimize" onClick={() => go('minimize')} className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]/60" />
                <span className="ml-3 text-[11px] text-white/60">{DOCK_APPS[open]}</span>
              </div>
              <motion.div initial="hidden" animate="show" transition={{ staggerChildren: 0.06 / k, delayChildren: 0.18 / k }} className="flex flex-1 flex-col gap-2.5 p-4">
                {[90, 70, 82, 50].map((w, i) => <motion.div key={i} variants={line} className="h-3 rounded-full bg-white/15" style={{ width: `${w}%` }} />)}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* clickable dock hit areas over the fake dock icons */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 p-2">
        {DOCK_APPS.map((a, i) => (
          <motion.button key={a} type="button" aria-label={a} whileTap={{ scale: 0.88 }} onClick={() => { setLeave('close'); setOpen((o) => (o === i ? null : i)) }} className="relative h-11 w-11 rounded-[12px]">
            {open === i && <motion.span layoutId="run-dot" className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />}
          </motion.button>
        ))}
      </div>
      <Controls>
        {(['dock', 'zoom', 'rise'] as AppStyle[]).map((s) => <Pill key={s} on={style === s} onClick={() => setStyle(s)}>{s === 'dock' ? 'Grow from dock' : s}</Pill>)}
      </Controls>
    </Stage>
  )
}

/* ── chrome ───────────────────────────────────────────────────────── */

function Stage({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between"><h3 className="text-[15px] font-medium text-white">{title}</h3></div>
      <p className="max-w-[560px] text-[11.5px] leading-snug text-white/55">{note}</p>
      <div className="relative h-[340px] w-[600px] overflow-hidden rounded-[16px] border border-white/10 bg-black">{children}</div>
    </section>
  )
}
const Controls = ({ children }: { children: ReactNode }) => <div className="absolute bottom-2 left-2 z-20 flex gap-1 rounded-full bg-black/55 p-1 backdrop-blur-md">{children}</div>
const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className={cn('h-7 rounded-full px-3 text-[11.5px] font-medium capitalize', on ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20')}>{children}</button>
)

export function MotionLab() {
  const [k, setK] = useState(1)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className="absolute inset-0 overflow-y-auto bg-[#0c0e12] px-8 pb-24 pt-16">
      <div className="mx-auto mb-5 flex max-w-[1260px] items-center gap-3 text-[12px] text-white/70">
        <span>Speed</span>
        {[1, 0.5, 0.25].map((s) => <button key={s} type="button" onClick={() => setK(s)} className={cn('h-7 rounded-full px-3', k === s ? 'bg-white text-black' : 'bg-white/10')}>{s === 1 ? 'Real time' : `${s}x`}</button>)}
        <Fps />
      </div>
      <div className="mx-auto flex max-w-[1260px] flex-wrap justify-center gap-x-10 gap-y-10">
        <LockDemo k={k} />
        <ProfileDemo k={k} />
        <StartDemo k={k} />
        <AppDemo k={k} />
      </div>
    </div>
  )
}
