/**
 * The layout math for the whole OS. Every size in the shell is meant to come
 * from here, not from a literal in a component.
 */

/** 4pt grid: `space(3)` is 12px. Half steps (`space(0.5)` = 2px) are allowed for hairlines and optical nudges only. */
export const GRID = 4
export const space = (n: number): number => n * GRID

/**
 * Concentric corners: a shape nested `inset` px inside a rounded parent
 * has radius `outer - inset`, so the two curves share a centre and the gap
 * between them looks even. Never below 2px.
 */
export const innerRadius = (outer: number, inset: number): number => Math.max(outer - inset, 2)

export const radius = {
  /** Chips, badges, small buttons. */
  sm: 6,
  /** Controls, list rows, menu items. */
  md: 10,
  /** Cards, grouped settings sections, popovers. */
  lg: 14,
  /** Windows, large panels, the start menu. */
  xl: 20,
} as const

/**
 * Type scale: sizes step by roughly ×1.2 from the 13px body size (macOS's
 * default), and each line height is rounded up to the 4pt grid so text rows
 * line up with everything else.
 */
export const TYPE_BASE = 13
export const TYPE_RATIO = 1.2
const snapUp = (px: number) => Math.ceil(px / GRID) * GRID
export const typeStep = (n: number): { size: number; line: number } => {
  const size = Math.round(TYPE_BASE * TYPE_RATIO ** n)
  return { size, line: snapUp(size * 1.3) }
}
export const type = {
  caption: typeStep(-1), // 11 / 16
  body: typeStep(0), // 13 / 20
  title3: typeStep(1), // 16 / 24
  title2: typeStep(2), // 19 / 28
  title1: typeStep(3), // 22 / 32
  display: typeStep(5), // 32 / 44
} as const

/**
 * Elevation: each level doubles the shadow's offset and triples its blur,
 * which is how a light source above a surface really behaves. Opacity eases
 * off as shadows spread so high surfaces don't turn muddy.
 *   level 1 = resting card, 2 = popover, 3 = menu, 4 = window, 5 = modal
 */
export function elevation(level: 1 | 2 | 3 | 4 | 5): string {
  const y = 2 ** level
  const blur = 3 * 2 ** level
  const alpha = Math.max(0.18, 0.36 - level * 0.04)
  return `0 ${y}px ${blur}px rgb(0 0 0 / ${alpha.toFixed(2)}), 0 0 0 0.5px rgb(255 255 255 / 0.08)`
}

/** Minimum pointer target, from Fitts's law practice: 24px on dense desktop UI, 44px for touch. */
export const TARGET = { desktop: 24, touch: 44 } as const
