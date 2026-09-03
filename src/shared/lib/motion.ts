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
  /** Softer and slower: content entrances and staggered list reveals,
   *  where a snappy spring reads as twitchy across many elements. */
  gentle: { type: 'spring', stiffness: 260, damping: 30 } as const,
}

/**
 * Per-child delay for staggered reveals. Keep totals short: a 20-item
 * list at `normal` already costs a full second before the last item
 * lands, so prefer `tight` as lists grow.
 */
export const stagger = {
  tight: 0.03,
  normal: 0.05,
  loose: 0.08,
} as const

/**
 * Shared variant pair for staggered groups. Parent carries `staggerGroup`,
 * each child carries `staggerItem` — items rise and fade in sequence,
 * which gives a list a reading order instead of appearing all at once.
 */
export const staggerGroup = {
  hidden: {},
  show: { transition: { staggerChildren: stagger.normal } },
} as const

export const staggerItem = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0 },
} as const

/**
 * Standard entrance for anything that appears anchored to a trigger
 * (dropdowns, popovers, dialogs): a slight scale-up plus rise, so the
 * panel reads as emerging from its origin rather than materialising.
 */
export const overlayEnter = {
  initial: { opacity: 0, scale: 0.97, y: 4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 4 },
} as const

export const duration = {
  instant: 0.1,
  micro: 0.14,
  /** Overlay backdrops (dialog/dropdown/popover/launchpad fade-in). */
  backdrop: 0.15,
  standard: 0.2,
  /** Slow full-bleed crossfades (wallpaper switch) — deliberately outside UI-chrome pacing. */
  ambient: 0.4,
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

/**
 * Shared z-index scale for anything that portals above the app's own
 * layout (dropdowns, popovers, dialogs, the Launchpad/command palette,
 * tooltips). All of these render via a Radix Portal straight onto
 * `document.body`, so their stacking genuinely competes globally —
 * picking values from one shared scale (rather than each component
 * inventing its own z-40/z-50) is what keeps e.g. a tooltip always
 * readable above a dialog, or a dropdown never fighting a popover, no
 * matter which happens to mount later in the DOM.
 */
export const zIndex = {
  /** In-flow chrome above the base layout but below any portal (TopBar, Sidebar). */
  chrome: 20,
  /** Non-modal floating content anchored to a trigger (dropdown menus). */
  dropdown: 30,
  /** Modal-ish backdrops and their panels (dialog, popover, Launchpad, command palette). */
  overlay: 40,
  overlayPanel: 45,
  /** Always above any open overlay — a tooltip must never be occluded. */
  tooltip: 50,
} as const

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
