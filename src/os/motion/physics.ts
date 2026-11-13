/**
 * The math behind every spring and duration in the OS.
 *
 * A spring is described the way a person feels it, by two numbers, instead of
 * by tuning stiffness and damping until it looks right:
 *
 *   response (T)  how long one undamped oscillation takes, in seconds. Smaller
 *                 is snappier.
 *   damping ratio (ζ)  1 settles with no overshoot; below 1 it overshoots and
 *                 rings; 0.7 is a soft settle, 0.5 is playful.
 *
 * For a mass-spring-damper m·x'' + c·x' + k·x = 0:
 *
 *   natural frequency  ω = 2π / T
 *   stiffness          k = m·ω²
 *   critical damping   c_crit = 2·√(k·m) = 2·m·ω
 *   damping            c = ζ · c_crit = 4π·ζ·m / T
 *
 * so `spring(0.35, 0.85)` always produces the same feel, whatever the mass.
 */

export interface SpringConfig {
  readonly type: 'spring'
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
}

const round = (n: number) => Math.round(n * 100) / 100

export function spring(response: number, dampingRatio: number, mass = 1): SpringConfig {
  const omega = (2 * Math.PI) / response
  return {
    type: 'spring',
    stiffness: round(mass * omega * omega),
    damping: round(dampingRatio * 2 * mass * omega),
    mass,
  }
}

/** Overshoot of an underdamped spring as a fraction of the distance travelled: e^(-πζ/√(1-ζ²)). */
export function overshoot(dampingRatio: number): number {
  if (dampingRatio >= 1) return 0
  return Math.exp((-Math.PI * dampingRatio) / Math.sqrt(1 - dampingRatio * dampingRatio))
}

/** Time for the spring to settle within 2% of its target: ≈ 4 / (ζ·ω), in seconds. */
export function settleTime(response: number, dampingRatio: number): number {
  return 4 / (dampingRatio * ((2 * Math.PI) / response))
}

/**
 * Durations form a geometric scale, each step 1.5× the last, so any two
 * neighbouring animations differ by a perceivable but consistent amount.
 *   step(-1) 53ms · step(0) 80ms · step(1) 120ms · step(2) 180ms · step(3) 270ms · step(4) 405ms
 */
export const DURATION_BASE = 0.08
export const DURATION_RATIO = 1.5
export function durationStep(n: number): number {
  return Math.round(DURATION_BASE * DURATION_RATIO ** n * 1000) / 1000
}

/**
 * How long a movement of `px` pixels should take. Longer trips take longer,
 * but sub-linearly (people accept faster speeds over distance):
 * d = 0.12 + 0.07·√(px / 100), clamped to the slowest UI step.
 */
export function durationForDistance(px: number): number {
  const d = 0.12 + 0.07 * Math.sqrt(Math.max(0, px) / 100)
  return Math.min(round(d * 1000) / 1000, durationStep(4))
}
