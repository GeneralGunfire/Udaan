import { spring as makeSpring } from '@/os/motion/physics'

/**
 * In-app motion vocabulary — every spring/duration in app views comes from
 * here. Animate only transform+opacity, never layout properties.
 *
 * These springs are derived from the same physics as the OS motion system
 * (`@/os/motion/physics`): a response time and a damping ratio, not hand-tuned
 * stiffness and damping. The values are the exact equivalents of the numbers
 * they replaced, so nothing changes feel, but there is now one definition of a
 * spring in the whole app.
 */
export const spring = {
  micro: makeSpring(0.25, 0.75, 0.8),
  standard: makeSpring(0.31, 0.78),
  panel: { type: 'tween', duration: 0.18, ease: [0.2, 0, 0, 1] } as const,
  emphasis: makeSpring(0.32, 0.62),
  gentle: makeSpring(0.38, 0.84),
}

export const stagger = {
  tight: 0.025,
  normal: 0.04,
  loose: 0.065,
} as const

export const staggerGroup = {
  hidden: {},
  show: { transition: { staggerChildren: stagger.normal } },
} as const

export const staggerItem = {
  hidden: { opacity: 0, y: 5 },
  show: { opacity: 1, y: 0 },
} as const

export const overlayEnter = {
  initial: { opacity: 0, scale: 0.97, y: 4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 4 },
} as const

export const duration = {
  instant: 0.083,
  micro: 0.12,
  backdrop: 0.12,
  standard: 0.17,
  relaxed: 0.2,
  ambient: 0.35,
} as const

export const ease = {
  standard: [0.2, 0, 0, 1],
  out: [0.2, 0, 0, 1],
} as const

export const pressable = {
  whileHover: { scale: 1.015 },
  whileTap: { scale: 0.97 },
  transition: spring.micro,
}

export const pressableIcon = {
  whileHover: { scale: 1.05 },
  whileTap: { scale: 0.93 },
  transition: spring.micro,
}

export const zIndex = {
  chrome: 20,
  dropdown: 30,
  overlay: 40,
  overlayPanel: 45,
  tooltip: 50,
} as const

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const pageEnter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
} as const

export const contentEnter = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
} as const

export const listRow = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, height: 0, marginTop: 0, marginBottom: 0 },
} as const
