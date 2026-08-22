/**
 * Centralized motion vocabulary. Every spring/duration value in the app
 * should come from here rather than being invented per component — keeps
 * the whole interface feeling like it was animated by one designer.
 *
 * Springs are tuned toward "precise," not "playful": high stiffness, high
 * damping, minimal overshoot. Reserve `spring.emphasis` for the rare case
 * that actually wants a little life (e.g. a completed action).
 */
export const spring = {
  /** Micro-interactions: pressed states, tiny icon transitions. */
  micro: { type: 'spring', stiffness: 500, damping: 36 } as const,
  /** Standard UI motion: menus, mode pills, hover-driven layout shifts. */
  standard: { type: 'spring', stiffness: 420, damping: 34 } as const,
  /** Panels/overlays: sidebar width, dropdown/command palette enter-exit. */
  panel: { type: 'spring', stiffness: 380, damping: 34 } as const,
  /** The rare emphasized moment — use sparingly. */
  emphasis: { type: 'spring', stiffness: 340, damping: 26 } as const,
}

export const duration = {
  instant: 0.1,
  micro: 0.14,
  standard: 0.2,
} as const

export const ease = {
  standard: [0.2, 0, 0, 1],
} as const

/** Subtle, felt-not-seen press feedback — never a visible "shrink." */
export const pressable = {
  whileHover: { scale: 1.01 },
  whileTap: { scale: 0.985 },
  transition: spring.micro,
}

/** Even more restrained — for icon-only controls where scale reads as jitter. */
export const pressableIcon = {
  whileHover: { scale: 1.03 },
  whileTap: { scale: 0.97 },
  transition: spring.micro,
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
