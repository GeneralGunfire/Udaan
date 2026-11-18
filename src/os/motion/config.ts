import { useMemo } from 'react'
import type { Transition } from 'framer-motion'
import { usePref } from '@/os/kernel/prefs'

/**
 * THE ANIMATION SETTINGS. One preference (`motion.config`, JSON) holds a global speed and, per part of the OS, whether
 * it animates, in which style, how fast, and how springy. Settings → Animations edits it; every window follows live.
 * "Animations off" (`motion.off`, Settings → Desktop & Dock) still wins over everything here.
 *
 * Everything is built from transform and opacity (plus one clip-path for the iris) so it stays on the compositor.
 */

export type MotionPart = 'lock' | 'profile' | 'start' | 'switcher' | 'open' | 'close' | 'menus' | 'notifications'

export interface PartMotion {
  on: boolean
  style: string
  /** 0.5 (slower) to 2 (faster), on top of the global speed. */
  speed: number
  /** 0 (firm, no overshoot) to 1 (lively). */
  bounce: number
}
export interface MotionConfig {
  /** 0.5 to 2: every animation at once. */
  speed: number
  parts: Record<MotionPart, PartMotion>
}

export const MOTION_PARTS: { id: MotionPart; label: string; blurb: string; styles: { value: string; label: string }[] }[] = [
  { id: 'lock', label: 'Lock screen', blurb: 'How the lock screen and the Work lock arrive and leave.', styles: [{ value: 'curtain', label: 'Curtain (drops from the top)' }, { value: 'rise', label: 'Rise (from the bottom)' }, { value: 'iris', label: 'Iris (opens from the bottom)' }, { value: 'fade', label: 'Fade' }] },
  { id: 'profile', label: 'Switching profile', blurb: 'The cover that crosses the screen while Personal and Work swap.', styles: [{ value: 'sweep', label: 'Sweep across' }, { value: 'drop', label: 'Drop from the top' }, { value: 'fade', label: 'Fade' }] },
  { id: 'start', label: 'Start menu', blurb: 'How Start opens and closes, and how its apps arrive.', styles: [{ value: 'grow', label: 'Grow from the dock' }, { value: 'drop', label: 'Drop from the top' }, { value: 'fade', label: 'Fade' }] },
  { id: 'switcher', label: 'Window switcher', blurb: 'The 3D switcher you open by dragging up from the bottom or double-tapping Ctrl.', styles: [{ value: 'carousel', label: '3D carousel' }, { value: 'flat', label: 'Flat strip (lightest)' }, { value: 'fade', label: 'Fade' }] },
  { id: 'open', label: 'Opening an app', blurb: 'How an app window fills in when it opens.', styles: [{ value: 'zoom', label: 'Zoom and settle' }, { value: 'rise', label: 'Rise from below' }, { value: 'fade', label: 'Fade' }] },
  { id: 'close', label: 'Closing an app', blurb: 'The short exit before an app window goes away.', styles: [{ value: 'shrink', label: 'Shrink away' }, { value: 'sink', label: 'Sink down' }, { value: 'fade', label: 'Fade' }] },
  { id: 'menus', label: 'Menus and popups', blurb: 'Right-click menus, top bar popups and the Notification Center.', styles: [{ value: 'spring', label: 'Spring in' }, { value: 'fade', label: 'Fade' }] },
  { id: 'notifications', label: 'Notification banners', blurb: 'How banners slide in and out.', styles: [{ value: 'slide', label: 'Slide in' }, { value: 'drop', label: 'Drop from the top' }, { value: 'fade', label: 'Fade' }] },
]

const part = (style: string, bounce = 0.5): PartMotion => ({ on: true, style, speed: 1, bounce })

export const MOTION_DEFAULTS: MotionConfig = {
  speed: 1,
  parts: {
    lock: part('curtain'),
    profile: part('sweep', 0.2),
    start: part('grow'),
    switcher: part('carousel', 0.35),
    open: part('zoom'),
    close: part('shrink', 0.2),
    menus: part('spring', 0.4),
    notifications: part('slide'),
  },
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback)

/** The stored JSON; anything missing or damaged falls back to the defaults. */
export function parseMotion(raw: string): MotionConfig {
  const out: MotionConfig = { speed: MOTION_DEFAULTS.speed, parts: { ...MOTION_DEFAULTS.parts } }
  if (!raw) return out
  try {
    const p = JSON.parse(raw) as Partial<MotionConfig>
    out.speed = clamp(p.speed, 0.5, 2, 1)
    for (const def of MOTION_PARTS) {
      const d = MOTION_DEFAULTS.parts[def.id]
      const s = (p.parts as Record<string, Partial<PartMotion>> | undefined)?.[def.id]
      if (!s) continue
      out.parts[def.id] = {
        on: typeof s.on === 'boolean' ? s.on : d.on,
        style: def.styles.some((x) => x.value === s.style) ? (s.style as string) : d.style,
        speed: clamp(s.speed, 0.5, 2, 1),
        bounce: clamp(s.bounce, 0, 1, d.bounce),
      }
    }
  } catch {
    /* damaged JSON: defaults */
  }
  return out
}

export function useMotionConfig(): MotionConfig {
  const [raw] = usePref('motion.config')
  return useMemo(() => parseMotion(raw), [raw])
}

/** What a component needs to animate itself: whether to, which style, and its own speed and springiness. */
export interface Resolved {
  on: boolean
  style: string
  /** Time scale: 2 = twice as fast. Durations divide by it; springs are rescaled so the shape stays the same. */
  k: number
  bounce: number
}

export function useMotion(id: MotionPart): Resolved {
  const cfg = useMotionConfig()
  const p = cfg.parts[id]
  return { on: p.on, style: p.style, k: cfg.speed * p.speed, bounce: p.bounce }
}

/** A spring with its stiffness and damping rescaled for speed, and its damping eased by the bounce setting. */
export function spring(m: Pick<Resolved, 'k' | 'bounce'>, stiffness: number, damping: number, mass = 1): Transition {
  const d = damping * (1.25 - m.bounce * 0.5)
  return { type: 'spring', stiffness: stiffness * m.k * m.k, damping: d * m.k, mass }
}
export function tween(m: Pick<Resolved, 'k'>, seconds: number, ease: [number, number, number, number] = [0.16, 1, 0.3, 1]): Transition {
  return { duration: seconds / m.k, ease }
}
const OUT: [number, number, number, number] = [0.5, 0, 0.9, 0.3]

/** Motion props for a full-screen surface (the lock screens, the profile cover). */
export function coverMotion(m: Resolved, style: string, enterSeconds = 0.6) {
  if (!m.on) return { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } }
  const exit = (v: object) => ({ ...v, transition: tween(m, 0.5, OUT) })
  switch (style) {
    case 'curtain':
      return { initial: { y: '-100%' }, animate: { y: 0, transition: spring(m, 150, 22, 1.1) }, exit: exit({ y: '-104%' }) }
    case 'rise':
      return { initial: { y: '100%' }, animate: { y: 0, transition: spring(m, 150, 22, 1.1) }, exit: exit({ y: '104%' }) }
    case 'sweep':
      return { initial: { x: '-100%' }, animate: { x: 0, transition: tween(m, 0.5, [0.7, 0, 0.2, 1]) }, exit: { x: '100%', transition: tween(m, 0.55, [0.7, 0, 0.2, 1]) } }
    case 'drop':
      return { initial: { y: '-100%' }, animate: { y: 0, transition: tween(m, 0.5, [0.7, 0, 0.2, 1]) }, exit: { y: '100%', transition: tween(m, 0.5, [0.7, 0, 0.2, 1]) } }
    case 'iris':
      return { initial: { clipPath: 'circle(0% at 50% 100%)' }, animate: { clipPath: 'circle(150% at 50% 100%)', transition: tween(m, 0.9, [0.2, 0.8, 0.2, 1]) }, exit: { clipPath: 'circle(0% at 50% 100%)', transition: tween(m, 0.55, OUT) } }
    default:
      return { initial: { opacity: 0 }, animate: { opacity: 1, transition: tween(m, enterSeconds) }, exit: { opacity: 0, transition: tween(m, 0.3) } }
  }
}

/** How long a cover's exit takes, so the launcher window is not hidden mid-animation. */
export function coverExitMs(m: Resolved): number {
  return m.on ? Math.round((0.6 / m.k) * 1000) + 60 : 0
}

/** A surface that opens from a point and closes back (Start, big sheets). */
export function sheetMotion(m: Resolved, style: string) {
  if (!m.on) return { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } }
  const out = { duration: 0.18 / m.k, ease: [0.3, 0, 0.8, 0.15] as [number, number, number, number] }
  switch (style) {
    case 'drop':
      return { initial: { opacity: 0, y: -90 }, animate: { opacity: 1, y: 0, transition: tween(m, 0.42) }, exit: { opacity: 0, y: -60, transition: out } }
    case 'fade':
      return { initial: { opacity: 0 }, animate: { opacity: 1, transition: tween(m, 0.2, [0.2, 0.8, 0.2, 1]) }, exit: { opacity: 0, transition: out } }
    default:
      return { initial: { opacity: 0, scale: 0.88, y: 44 }, animate: { opacity: 1, scale: 1, y: 0, transition: spring(m, 360, 30) }, exit: { opacity: 0, scale: 0.95, y: 18, transition: out } }
  }
}

/** An app window filling in when it opens. */
export function windowOpenMotion(m: Resolved, style: string) {
  if (!m.on) return { initial: { opacity: 1 }, animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0 } } }
  switch (style) {
    case 'rise':
      return { initial: { opacity: 0, y: 60, scale: 0.99 }, animate: { opacity: 1, y: 0, scale: 1, transition: spring(m, 220, 26) } }
    case 'fade':
      return { initial: { opacity: 0, scale: 1, y: 0 }, animate: { opacity: 1, scale: 1, y: 0, transition: tween(m, 0.22, [0.2, 0.8, 0.2, 1]) } }
    default:
      return { initial: { opacity: 0, scale: 0.94, y: 28 }, animate: { opacity: 1, scale: 1, y: 0, transition: spring(m, 380, 32, 0.9) } }
  }
}

/** The short exit played before a window is hidden. Returns null when closing should be immediate. */
export function windowCloseMotion(m: Resolved, style: string) {
  if (!m.on) return null
  const t = { duration: 0.16 / m.k, ease: [0.3, 0, 0.8, 0.15] as [number, number, number, number] }
  switch (style) {
    case 'sink':
      return { animate: { opacity: 0, y: 36, scale: 0.98, transition: t }, ms: Math.round((0.16 / m.k) * 1000) }
    case 'fade':
      return { animate: { opacity: 0, transition: t }, ms: Math.round((0.16 / m.k) * 1000) }
    default:
      return { animate: { opacity: 0, scale: 0.94, y: 6, transition: t }, ms: Math.round((0.16 / m.k) * 1000) }
  }
}
