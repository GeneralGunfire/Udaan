import { describe, expect, it } from 'vitest'
import { evaluate } from './calc'

describe('evaluate', () => {
  it('respects precedence and parentheses', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14)
    expect(evaluate('(2 + 3) * 4')).toBe(20)
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512)
    expect(evaluate('-2 ^ 2')).toBe(-4)
    expect(evaluate('10 % 4')).toBe(2)
  })
  it('handles symbols, functions and constants', () => {
    expect(evaluate('6 × 7')).toBe(42)
    expect(evaluate('9 ÷ 3')).toBe(3)
    expect(evaluate('sqrt(16) + 1')).toBe(5)
    expect(evaluate('2 * pi')).toBeCloseTo(6.283185, 5)
    expect(evaluate('1,000 + 1')).toBe(1001)
  })
  it('refuses things that are not maths', () => {
    expect(evaluate('notepad')).toBeNull()
    expect(evaluate('42')).toBeNull()
    expect(evaluate('2 +')).toBeNull()
    expect(evaluate('alert(1)')).toBeNull()
    expect(evaluate('1 / 0')).toBeNull()
  })
})
