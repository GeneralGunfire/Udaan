/**
 * Udaan OS motion system. Springs and durations are derived in ./physics.ts
 * from response, damping ratio and a geometric duration scale, not tuned by
 * eye.
 *
 * THE FOUR RULES
 * --------------
 *  1. CONNECTED. Motion shows where something came from and where it went. A
 *     flyout opened from the dock grows *out of the dock*, with its transform
 *     origin on the button that opened it — not from its own centre.
 *  2. PURPOSEFUL. Every animation confirms, orients or delights. Decoration
 *     that does none of those is removed.
 *  3. CONFIDENT. Fast in, gentle out. Entrances may overshoot slightly;
 *     exits never do — an exit that bounces reads as indecision.
 *  4. INTERRUPTIBLE. Springs, not tweens, for anything a person can grab
 *     mid-flight. A tween restarts; a spring redirects from its current
 *     velocity, which is why direct manipulation must always use one.
 *
 * ASYMMETRY. Exits run at roughly half the duration of entrances throughout.
 * This is the single most effective trick for making an interface feel fast:
 * people wait for entrances but only glance at exits.
 *
 * Everything composites on transform and opacity only — never layout
 * properties, which force the main thread to re-layout every frame.
 */

import { durationStep, spring } from './physics'

/* ------------------------------------------------------------------ */
/*  CURVES                                                             */
/* ------------------------------------------------------------------ */

export const curve = {
  /** Standard point-to-point — objects moving between resting positions. */
  pointToPoint: [0.55, 0.55, 0, 1] as const,
  /** Enter: starts fast, decelerates gently to rest. Used for things appearing. */
  decelerate: [0, 0, 0, 1] as const,
  /** Exit: eases away without the dead pause at the start that [1,0,1,1] has, so closes read as immediate. */
  accelerate: [0.3, 0, 0.8, 0.15] as const,
  /** Emphasized decelerate — slightly more dramatic for hero transitions. */
  emphasizedDecelerate: [0.05, 0.7, 0.1, 1] as const,
  /** Snap — near-instant response for direct-manipulation feedback. */
  snap: [0.2, 0.8, 0.2, 1] as const,
  /** A single soft overshoot, for things that "arrive" (badges, confirmations). */
  overshoot: [0.34, 1.4, 0.64, 1] as const,
  /** Anticipate: dips back before moving forward. Launches only — it costs time. */
  anticipate: [0.5, -0.4, 0.2, 1.2] as const,
}

/* ------------------------------------------------------------------ */
/*  DURATIONS                                                          */
/* ------------------------------------------------------------------ */

export const dur = {
  /** Instant feedback: press, toggle, micro-state. */
  instant: durationStep(-1),
  /** Opacity-only changes: fades, crossfades. */
  fade: durationStep(0),
  /** Small controls: buttons, chips, indicators. */
  fast: durationStep(1),
  /** Standard UI: menus, tabs, mode switches. */
  normal: durationStep(2),
  /** Panels, overlays, start menu. */
  medium: durationStep(3),
  /** Large surfaces: windows, full-screen transitions. */
  slow: durationStep(4),
  /** Ambient motion: wallpaper, screensaver. Not UI-grade. */
  ambient: 0.8,
}

/* ------------------------------------------------------------------ */
/*  SPRINGS                                                            */
/* ------------------------------------------------------------------ */

export const springs = {
  /** Quick, precise: icon presses, dot indicators, toggle knobs. */
  micro: spring(0.26, 0.8),
  /** Standard UI spring: dock items, list reorder, panel resize. */
  standard: spring(0.34, 0.85),
  /** Window open/close/move. Slightly under-damped for a subtle settle. */
  window: spring(0.42, 0.82),
  /** Flyouts, dropdowns, popovers: critically damped, no overshoot. */
  flyout: spring(0.3, 1),
  /** Dock magnification on hover. Light mass so it tracks the pointer 1:1. */
  magnify: spring(0.3, 0.7, 0.5),
  /** Playful emphasis: completed actions, launch bounce, success. */
  bounce: spring(0.4, 0.45),
  /** Active indicator pill (e.g. dot under focused dock icon). */
  indicator: spring(0.3, 0.9),
  /** Gentle content entrance: staggered lists, card grids. */
  gentle: spring(0.55, 0.9),
  /** Snappy direct manipulation: drag, press, whileTap. */
  snap: spring(0.24, 1),
  /** Something being carried by the pointer: near-critical, very low mass,
   *  so it never lags behind the cursor in a way that feels like latency. */
  carry: spring(0.2, 0.95, 0.6),
  /** A dropped object settling into place after a drag. */
  settle: spring(0.38, 0.72),
}

/* ------------------------------------------------------------------ */
/*  TRANSFORM ORIGIN HELPERS                                           */
/* ------------------------------------------------------------------ */

/**
 * Where a surface should grow *from*, given the control that opened it and
 * the surface's own box. Rule 1 (Connected) in one function: without this a
 * flyout scales from its own centre and reads as unrelated to the click.
 * Returns a CSS transform-origin string.
 */
export function originFrom(
  anchor: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
): string {
  const x = Math.max(0, Math.min(box.width, anchor.x - box.left))
  const y = Math.max(0, Math.min(box.height, anchor.y - box.top))
  return `${((x / box.width) * 100).toFixed(1)}% ${((y / box.height) * 100).toFixed(1)}%`
}

/* ------------------------------------------------------------------ */
/*  WINDOW MOTION                                                      */
/* ------------------------------------------------------------------ */

export const windowMotion = {
  open: {
    initial: { opacity: 0, scale: 0.94, y: 40 },
    animate: { opacity: 1, scale: 1, y: 0 },
    transition: { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.9 },
  },
  close: {
    exit: { opacity: 0, scale: 0.97, y: 4 },
    transition: { duration: 0.12, ease: curve.accelerate },
  },
  reduced: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: dur.fade },
  },
}

/* ------------------------------------------------------------------ */
/*  FLYOUT / POPOVER MOTION                                            */
/* ------------------------------------------------------------------ */

/**
 * Flyouts grow out of the control that opened them. The caller sets
 * `transformOrigin` from `originFrom()`; the scale here is deliberately
 * mild (0.92, not 0.8) because a large scale-up reads as a zoom rather than
 * an unfold, and at flyout sizes a zoom looks cheap.
 */
export const flyoutMotion = {
  initial: { opacity: 0, scale: 0.92, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 520, damping: 36, mass: 0.8 },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 4,
    transition: { duration: dur.fast, ease: curve.accelerate },
  },
}

export const flyoutMotionReduced = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: dur.fade } },
  exit: { opacity: 0, transition: { duration: dur.fade } },
}

/** Flyout from the menu bar: unfolds downward, so it falls rather than rises. */
export const flyoutFromTop = {
  initial: { opacity: 0, scale: 0.94, y: -10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring' as const, stiffness: 520, damping: 36, mass: 0.8 } },
  exit: { opacity: 0, scale: 0.97, y: -6, transition: { duration: dur.fast, ease: curve.accelerate } },
}

/** Flyout from the dock: rises out of the bar. */
export const flyoutFromBottom = {
  initial: { opacity: 0, scale: 0.94, y: 14 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring' as const, stiffness: 520, damping: 36, mass: 0.8 } },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: dur.fast, ease: curve.accelerate } },
}

/* ------------------------------------------------------------------ */
/*  DOCK MOTION                                                        */
/* ------------------------------------------------------------------ */

/** Launch bounce: decaying hops like macOS, but tighter timing. */
export const launchBounce = {
  y: [0, -16, 0, -8, 0, -3, 0],
  transition: {
    duration: 0.85,
    times: [0, 0.18, 0.36, 0.52, 0.68, 0.82, 1],
    ease: 'easeOut' as const,
  },
}

/** Minimize nudge — icon dips down briefly. */
export const minimizeNudge = {
  y: [0, 5, 0],
  transition: { duration: 0.25, ease: curve.decelerate },
}

/** Restore nudge — icon lifts up briefly. */
export const restoreNudge = {
  y: [0, -5, 0],
  transition: { duration: 0.25, ease: curve.decelerate },
}

/** Focus pop — a single quick scale-up-and-settle when clicking a dock
 *  icon brings its (already open, off-screen-focus) window to the front.
 *  The window itself can't be animated into view (it's a real OS window,
 *  outside this webview's control), so the dock icon carries the "this
 *  just happened" feedback instead — the same role macOS's own dock
 *  bounce plays for a running app. */
export const focusPop = {
  scale: [1, 1.18, 1],
  transition: { duration: 0.22, ease: curve.overshoot },
}

/** A dock icon refusing an action (pinned item that can't be unpinned). */
export const refuse = {
  x: [0, -5, 4, -3, 0],
  transition: { duration: 0.3, ease: 'easeOut' as const },
}

/* ------------------------------------------------------------------ */
/*  START MENU MOTION                                                  */
/* ------------------------------------------------------------------ */

export const startMenuMotion = {
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: dur.fade } },
    exit: { opacity: 0, transition: { duration: dur.fade } },
  },
  panel: {
    initial: { opacity: 0, y: 20, scale: 0.96 },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { type: 'spring' as const, stiffness: 460, damping: 34, mass: 0.85 },
    },
    exit: {
      opacity: 0,
      y: 8,
      scale: 0.98,
      transition: { duration: dur.fast, ease: curve.accelerate },
    },
  },
}

/* ------------------------------------------------------------------ */
/*  LOCK SCREEN MOTION                                                 */
/* ------------------------------------------------------------------ */

export const lockScreenMotion = {
  enter: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.15 },
  },
  pinPanel: {
    initial: { opacity: 0, y: 24, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 16, scale: 0.98 },
    transition: { duration: 0.4, ease: curve.emphasizedDecelerate },
  },
  hint: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 8 },
    transition: { duration: 0.5, ease: curve.decelerate },
  },
}

/* ------------------------------------------------------------------ */
/*  OVERLAY / DIALOG MOTION                                            */
/* ------------------------------------------------------------------ */

export const overlayMotion = {
  initial: { opacity: 0, scale: 0.95, y: 22 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: dur.normal, ease: curve.decelerate },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 4,
    transition: { duration: dur.fast, ease: curve.accelerate },
  },
}

/* ------------------------------------------------------------------ */
/*  TOAST / NOTIFICATION MOTION                                        */
/* ------------------------------------------------------------------ */

/**
 * Toasts slide in from the right edge and leave the same way. The entrance
 * is a spring (it may be interrupted by the next toast arriving); the exit
 * is a short tween, because an exit is never interrupted.
 */
export const toastMotion = {
  initial: { opacity: 0, x: 48, scale: 0.94 },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 460, damping: 34, mass: 0.85 },
  },
  exit: {
    opacity: 0,
    x: 36,
    scale: 0.97,
    transition: { duration: dur.fast, ease: curve.accelerate },
  },
}

/** A toast dismissed by swiping it away — leaves in the direction thrown. */
export const toastFling = (direction: 1 | -1) => ({
  opacity: 0,
  x: direction * 320,
  transition: { duration: dur.normal, ease: curve.accelerate },
})

/* ------------------------------------------------------------------ */
/*  PRESSABLE PRESETS                                                   */
/* ------------------------------------------------------------------ */

/** Standard press feedback — buttons, tiles, interactive cards. */
export const pressable = {
  whileHover: { scale: 1.015 },
  whileTap: { scale: 0.97 },
  transition: springs.snap,
}

/** Icon-only controls — tighter feedback, no layout shift. */
export const pressableIcon = {
  whileHover: { scale: 1.06 },
  whileTap: { scale: 0.92 },
  transition: springs.snap,
}

/** A row in a list: lifts very slightly rather than scaling, because scaling
 *  a full-width row makes its text visibly resample. */
export const pressableRow = {
  whileHover: { x: 2 },
  whileTap: { scale: 0.995 },
  transition: springs.micro,
}

/* ------------------------------------------------------------------ */
/*  STAGGER                                                            */
/* ------------------------------------------------------------------ */

export const stagger = {
  tight: 0.025,
  normal: 0.04,
  loose: 0.065,
} as const

/**
 * Stagger that stops growing after `cap` items. A fixed per-item delay makes
 * a 40-item list take 1.6s to finish appearing, which reads as broken; this
 * compresses the tail so the whole list always lands in about the same time.
 */
export function staggerDelay(index: number, step: number = stagger.normal, cap = 12): number {
  return Math.min(index, cap) * step + Math.max(0, index - cap) * (step / 4)
}

/* ------------------------------------------------------------------ */
/*  PAGE / CONTENT ENTRANCE                                            */
/* ------------------------------------------------------------------ */

export const pageEnter = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: dur.normal, ease: curve.decelerate },
}

export const contentEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: dur.fast, ease: curve.decelerate },
}

/* ------------------------------------------------------------------ */
/*  VALUE TRANSITIONS                                                  */
/* ------------------------------------------------------------------ */

/** A number changing in place (a clock, a counter, a percentage). */
export const valueChange = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: dur.fast, ease: curve.decelerate },
}

/** A badge appearing on an icon — arrives with one soft overshoot. */
export const badgePop = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: { type: 'spring' as const, stiffness: 600, damping: 20, mass: 0.6 } },
  exit: { scale: 0, opacity: 0, transition: { duration: dur.instant } },
}

/* ------------------------------------------------------------------ */
/*  CINEMATIC                                                          */
/* ------------------------------------------------------------------ */

/**
 * The techniques below come from film rather than from UI convention.
 * They are for the OS's "moments" — opening a view, revealing a surface,
 * transitioning between modes — not for ordinary controls, where they
 * would be overbearing and slow.
 */

/**
 * RACK FOCUS. A surface arriving from out of focus, as a camera pulling
 * focus onto it.
 *
 * Blur is expensive to animate (it cannot run on the compositor alone), so
 * this is reserved for one element at a time, over a short distance, and
 * never on a list of items.
 */
export const rackFocus = {
  initial: { opacity: 0, filter: 'blur(12px)', scale: 1.04 },
  animate: {
    opacity: 1,
    filter: 'blur(0px)',
    scale: 1,
    transition: { duration: dur.medium, ease: curve.emphasizedDecelerate },
  },
  exit: {
    opacity: 0,
    filter: 'blur(8px)',
    scale: 0.99,
    transition: { duration: dur.fast, ease: curve.accelerate },
  },
}

/**
 * DOLLY. The camera moving toward the subject: a surface growing from
 * slightly behind the screen plane while the backdrop recedes.
 *
 * Pair with `recede` on whatever sits behind it — the contrast between the
 * two is what creates the sense of depth. Either one alone reads as a
 * simple scale.
 */
export const dolly = {
  initial: { opacity: 0, scale: 0.92, y: 18 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 320, damping: 30, mass: 0.9 },
  },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: dur.fast, ease: curve.accelerate } },
}

/** The backdrop pushing away as something dollies toward the viewer. */
export const recede = {
  animate: { scale: 0.97, filter: 'brightness(0.72)' },
  transition: { duration: dur.medium, ease: curve.emphasizedDecelerate },
}

/**
 * REVEAL. Content wiped into view behind a moving edge, rather than faded.
 *
 * A fade says "this is becoming visible"; a wipe says "this is being
 * uncovered", which is the right reading for something that was already
 * there — a panel sliding open, a section expanding.
 *
 * `direction` is where the edge travels from.
 */
export function reveal(direction: 'up' | 'down' | 'left' | 'right' = 'up') {
  const from = {
    up: 'inset(100% 0 0 0)',
    down: 'inset(0 0 100% 0)',
    left: 'inset(0 0 0 100%)',
    right: 'inset(0 100% 0 0)',
  }[direction]
  return {
    initial: { clipPath: from, opacity: 0 },
    animate: {
      clipPath: 'inset(0 0 0 0)',
      opacity: 1,
      transition: { duration: dur.medium, ease: curve.emphasizedDecelerate },
    },
    exit: { clipPath: from, opacity: 0, transition: { duration: dur.fast, ease: curve.accelerate } },
  }
}

/**
 * PARALLAX. Layers moving at different rates to imply depth.
 *
 * `depth` 0 is the furthest layer (moves least), 1 the nearest (moves
 * most). Returns the offset for a given scroll or pointer displacement.
 */
export function parallax(offset: number, depth: number): number {
  return offset * (0.15 + depth * 0.85)
}

/**
 * TITLE SEQUENCE. Characters rising into place one after another.
 *
 * For a single short heading at a moment that deserves one — a boot
 * screen, an empty state, a first run. Never for body text: animating
 * every character of a paragraph is unreadable and slow.
 */
export const titleChar = {
  initial: { opacity: 0, y: '0.4em', filter: 'blur(4px)' },
  animate: { opacity: 1, y: '0em', filter: 'blur(0px)' },
}

export function titleCharDelay(index: number, step = 0.035): number {
  return index * step
}

/**
 * BREATHE. A slow, barely-perceptible swell, for something at rest that
 * should not look frozen — a logo during a wait, an idle empty state.
 *
 * Six seconds and 3%: fast or large enough to notice is distracting, and
 * this is meant to be felt rather than watched.
 */
export const breathe = {
  animate: { scale: [1, 1.03, 1] },
  transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' as const },
}

/**
 * SHIMMER. A highlight travelling across a surface, for loading states.
 *
 * Better than a pulsing opacity for a skeleton: a sweep implies progress
 * along the content, where a pulse only says "something is happening".
 */
export const shimmer = {
  animate: { backgroundPosition: ['200% 0', '-200% 0'] },
  transition: { duration: 1.6, repeat: Infinity, ease: 'linear' as const },
}
