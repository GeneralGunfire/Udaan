import { describe, expect, it } from 'vitest'
import { durationForDistance, durationStep, overshoot, settleTime, spring } from './physics'
import { elevation, innerRadius, magnification, space, type, typeStep } from '../design/scale'

describe('spring', () => {
  it('is critically damped at ratio 1', () => {
    const s = spring(0.35, 1)
    // c = 2·√(k·m)
    expect(s.damping).toBeCloseTo(2 * Math.sqrt(s.stiffness * s.mass), 1)
  })

  it('gets stiffer as response shrinks', () => {
    expect(spring(0.25, 0.9).stiffness).toBeGreaterThan(spring(0.5, 0.9).stiffness)
  })

  it('keeps the same feel at any mass', () => {
    const a = spring(0.35, 0.8, 1)
    const b = spring(0.35, 0.8, 2)
    expect(b.stiffness / b.mass).toBeCloseTo(a.stiffness / a.mass, 0)
    expect(b.damping / b.mass).toBeCloseTo(a.damping / a.mass, 0)
  })

  it('overshoots only when underdamped', () => {
    expect(overshoot(1)).toBe(0)
    expect(overshoot(0.5)).toBeCloseTo(0.163, 2)
    expect(overshoot(0.8)).toBeLessThan(overshoot(0.5))
  })

  it('settles sooner with a faster response', () => {
    expect(settleTime(0.25, 0.9)).toBeLessThan(settleTime(0.5, 0.9))
  })
})

describe('durations', () => {
  it('steps by 1.5×', () => {
    expect(durationStep(0)).toBe(0.08)
    expect(durationStep(2)).toBe(0.18)
    expect(durationStep(3)).toBe(0.27)
  })

  it('grows with distance, sub-linearly, and is capped', () => {
    expect(durationForDistance(0)).toBe(0.12)
    expect(durationForDistance(400)).toBeLessThan(durationForDistance(100) * 4)
    expect(durationForDistance(1e6)).toBe(durationStep(4))
  })
})

describe('layout scale', () => {
  it('uses a 4pt grid', () => {
    expect(space(3)).toBe(12)
  })

  it('nests corners concentrically', () => {
    expect(innerRadius(20, 8)).toBe(12)
    expect(innerRadius(6, 20)).toBe(2)
  })

  it('snaps line heights to the grid', () => {
    expect(type.body).toEqual({ size: 13, line: 20 })
    for (let n = -2; n <= 6; n++) expect(typeStep(n).line % 4).toBe(0)
  })

  it('doubles shadow offset per elevation level', () => {
    expect(elevation(2)).toContain('0 4px 12px')
    expect(elevation(3)).toContain('0 8px 24px')
  })

  it('magnifies smoothly: peak under the pointer, none beyond reach', () => {
    expect(magnification(0)).toBeCloseTo(1.6)
    expect(magnification(2.5)).toBe(1)
    expect(magnification(1)).toBeGreaterThan(magnification(2))
  })
})
