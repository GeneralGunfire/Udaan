import { usePref } from '@/os/kernel/prefs'

/**
 * LIQUID GLASS: the live fluid surface behind the dock and the top bar. These are its settings.
 * They live in one preference (`bars.liquid.config`, JSON) so Settings can edit them and both bars,
 * in every window and in both profiles, follow at once.
 */
export type LiquidLook = 'chrome' | 'water' | 'frost'

export interface BarLiquid {
  look: LiquidLook
  /** Ripple size, 0.3 to 2. */
  amp: number
  /** Motion speed, 0.1 to 2. */
  speed: number
  /** How solid the liquid is, 0.1 to 1. Lower lets the wallpaper show through. */
  opacity: number
  /** Highlight contrast, 0.1 to 1.2. Lower blends the bar into the desktop. */
  contrast: number
  /** Strength of the 1 px edge highlight, 0 to 1.5. */
  edge: number
  /** Opaque and still: nothing shows through, nothing animates, and it costs nothing while idle. */
  solid: boolean
}

export type LiquidRole = 'dock' | 'bar' | 'start' | 'panel'

export interface LiquidConfig {
  /** One frame, then nothing: zero ongoing cost. */
  frozen: boolean
  dock: BarLiquid
  bar: BarLiquid
  /** The Start menu. */
  start: BarLiquid
  /** Popups, menus and notifications: every floating card. */
  panel: BarLiquid
}

/** The dock is livelier (more motion and detail); the top bar is calm so the menu text wins. */
export const LIQUID_DEFAULTS: LiquidConfig = {
  frozen: false,
  dock: { look: 'chrome', amp: 1.2, speed: 0.8, opacity: 0.55, contrast: 0.75, edge: 0.5, solid: false },
  bar: { look: 'chrome', amp: 1.0, speed: 0.35, opacity: 0.3, contrast: 0.3, edge: 0.3, solid: false },
  // Big surfaces hold text, so they are calmer and more solid than the bars.
  // Popups float over arbitrary windows with no blur behind them (an OS blur flashed a plate before the card), so they
  // are mostly solid by default: text underneath must never ghost through. Lower them in Settings for a glassier look.
  start: { look: 'frost', amp: 1.0, speed: 0.4, opacity: 0.92, contrast: 0.5, edge: 0.4, solid: false },
  panel: { look: 'frost', amp: 0.9, speed: 0.35, opacity: 0.94, contrast: 0.45, edge: 0.35, solid: false },
}

export const LIQUID_LOOKS: { value: LiquidLook; label: string; blurb: string }[] = [
  { value: 'chrome', label: 'Chrome', blurb: 'Mercury-like liquid metal' },
  { value: 'water', label: 'Water', blurb: 'Clear dark glass with caustics and glints' },
  { value: 'frost', label: 'Frost', blurb: 'Soft milky gel' },
]

const LOOKS = new Set<string>(['chrome', 'water', 'frost'])
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)

function bar(raw: unknown, d: BarLiquid): BarLiquid {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    look: typeof r.look === 'string' && LOOKS.has(r.look) ? (r.look as LiquidLook) : d.look,
    amp: num(r.amp, 0.3, 2, d.amp),
    speed: num(r.speed, 0.1, 2, d.speed),
    opacity: num(r.opacity, 0.1, 1, d.opacity),
    contrast: num(r.contrast, 0.1, 1.2, d.contrast),
    edge: num(r.edge, 0, 1.5, d.edge),
    solid: r.solid === true,
  }
}

/** Reads the stored JSON; anything missing or damaged falls back to the defaults. */
export function parseLiquid(raw: string): LiquidConfig {
  let r: Record<string, unknown> = {}
  try {
    const p = JSON.parse(raw) as unknown
    if (p && typeof p === 'object') r = p as Record<string, unknown>
  } catch {
    /* defaults */
  }
  return {
    frozen: r.frozen === true,
    dock: bar(r.dock, LIQUID_DEFAULTS.dock),
    bar: bar(r.bar, LIQUID_DEFAULTS.bar),
    start: bar(r.start, LIQUID_DEFAULTS.start),
    panel: bar(r.panel, LIQUID_DEFAULTS.panel),
  }
}

/** The settings for the bars: on/off, and the numbers. Reading only; Settings writes through `useLiquidSettings`. */
export function useLiquid(): { enabled: boolean; config: LiquidConfig } {
  const [enabled] = usePref('bars.liquid')
  const [raw] = usePref('bars.liquid.config')
  // Independent of "Solid surfaces" (which governs menus and panels): the bars get their own switch, so turning
  // the liquid off, not a different setting, is what brings back the plain bars.
  return { enabled, config: parseLiquid(raw) }
}
