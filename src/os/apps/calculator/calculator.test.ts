import { describe, expect, it } from 'vitest'
import { CalcError, evaluate, formatNumber, groupEntry } from './engine'
import {
  initialKeypad,
  press,
  type KeyAction,
  type KeypadState,
} from './keypad'
import {
  appendDigit,
  applyBinary,
  bitNot,
  normalize,
  toRadix,
  toggleBit,
} from './programmer'
import { convert } from './units'

const run = (actions: KeyAction[]): KeypadState =>
  actions.reduce((s, a) => press(s, a, 'deg').state, initialKeypad)
const digits = (s: string): KeyAction[] =>
  [...s].map((d) => (d === '.' ? { k: 'dot' } : { k: 'digit', d }))

describe('expression engine', () => {
  it('respects precedence and parentheses', () => {
    expect(evaluate('2 + 3 × 4')).toBe(14)
    expect(evaluate('(2 + 3) × 4')).toBe(20)
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512)
    expect(evaluate('10 − 4 − 3')).toBe(3)
    expect(evaluate('100 ÷ 10 ÷ 2')).toBe(5)
    expect(evaluate('2(3 + 1)')).toBe(8)
    expect(evaluate('(1 + 2')).toBe(3)
  })
  it('handles unary minus', () => {
    expect(evaluate('-2 ^ 2')).toBe(-4)
    expect(evaluate('(-2) ^ 2')).toBe(4)
    expect(evaluate('3 × -2')).toBe(-6)
    expect(evaluate('--5')).toBe(5)
  })
  it('handles percent', () => {
    expect(evaluate('200 + 10%')).toBe(220)
    expect(evaluate('200 − 25%')).toBe(150)
    expect(evaluate('50 × 10%')).toBe(5)
    expect(evaluate('10%')).toBe(0.1)
  })
  it('avoids floating point artefacts', () => {
    expect(evaluate('0.1 + 0.2')).toBe(0.3)
    expect(evaluate('1.1 × 1.1')).toBe(1.21)
  })
  it('computes factorial, roots, mod and logs', () => {
    expect(evaluate('5!')).toBe(120)
    expect(evaluate('fact(0)')).toBe(1)
    expect(evaluate('27 yroot 3')).toBe(3)
    expect(evaluate('-8 yroot 3')).toBe(-2)
    expect(evaluate('17 mod 5')).toBe(2)
    expect(evaluate('-7 mod 3')).toBe(2)
    expect(evaluate('log(1000)')).toBe(3)
    expect(evaluate('log2(1024)')).toBe(10)
    expect(evaluate('ln(e)')).toBe(1)
    expect(evaluate('sqrt(16) + sqr(3)')).toBe(13)
  })
  it('does trig in each angle mode', () => {
    expect(evaluate('sin(30)', 'deg')).toBe(0.5)
    expect(evaluate('sin(180)', 'deg')).toBe(0)
    expect(evaluate('cos(π)', 'rad')).toBe(-1)
    expect(evaluate('sin(100)', 'grad')).toBe(1)
    expect(evaluate('asin(1)', 'deg')).toBe(90)
    expect(evaluate('atan(1)', 'grad')).toBe(50)
    expect(() => evaluate('tan(90)', 'deg')).toThrow(CalcError)
  })
  it('reports errors instead of crashing', () => {
    expect(() => evaluate('1 ÷ 0')).toThrow('Cannot divide by zero')
    expect(() => evaluate('0 ÷ 0')).toThrow('Result is undefined')
    expect(() => evaluate('sqrt(-1)')).toThrow(CalcError)
    expect(() => evaluate('2 +')).toThrow(CalcError)
    expect(() => evaluate('alert(1)')).toThrow(CalcError)
    expect(() => evaluate('171!')).toThrow('Overflow')
  })
  it('formats numbers', () => {
    expect(formatNumber(1234567.5)).toBe('1,234,567.5')
    expect(formatNumber(1e20)).toBe('1e+20')
    expect(groupEntry('1234567.50')).toBe('1,234,567.50')
  })
})

describe('keypad', () => {
  it('chains with precedence and repeats equals', () => {
    let s = run([
      ...digits('2'),
      { k: 'op', op: '+' },
      ...digits('3'),
      { k: 'op', op: '×' },
      ...digits('4'),
      { k: 'equals' },
    ])
    expect(s.result).toBe(14)
    s = run([
      ...digits('5'),
      { k: 'op', op: '+' },
      ...digits('3'),
      { k: 'equals' },
      { k: 'equals' },
      { k: 'equals' },
    ])
    expect(s.result).toBe(14)
  })
  it('continues from a result and starts over on a digit', () => {
    let s = run([
      ...digits('6'),
      { k: 'op', op: '×' },
      ...digits('7'),
      { k: 'equals' },
      { k: 'op', op: '+' },
      ...digits('1'),
      { k: 'equals' },
    ])
    expect(s.result).toBe(43)
    s = run([...digits('6'), { k: 'equals' }, ...digits('9'), { k: 'equals' }])
    expect(s.result).toBe(9)
  })
  it('applies functions to the entry and shows divide by zero', () => {
    let s = run([
      ...digits('9'),
      { k: 'fn', fn: 'sqrt' },
      { k: 'op', op: '+' },
      ...digits('1'),
      { k: 'equals' },
    ])
    expect(s.result).toBe(4)
    s = run([
      ...digits('1'),
      { k: 'op', op: '÷' },
      ...digits('0'),
      { k: 'equals' },
    ])
    expect(s.error).toBe('Cannot divide by zero')
    s = press(s, { k: 'digit', d: '3' }, 'deg').state
    expect(s.error).toBeNull()
    expect(s.entry).toBe('3')
  })
  it('negates and handles percent', () => {
    let s = run([
      ...digits('8'),
      { k: 'negate' },
      { k: 'op', op: '×' },
      ...digits('2'),
      { k: 'equals' },
    ])
    expect(s.result).toBe(-16)
    s = run([
      ...digits('200'),
      { k: 'op', op: '+' },
      ...digits('10'),
      { k: 'postfix', p: '%' },
      { k: 'equals' },
    ])
    expect(s.result).toBe(220)
  })
})

describe('programmer', () => {
  it('wraps to the word size', () => {
    expect(normalize(255n, 8, true)).toBe(-1n)
    expect(normalize(256n, 8, false)).toBe(0n)
    expect(toRadix(-1n, 16, 16, true)).toBe('FFFF')
    expect(toRadix(-1n, 10, 64, false)).toBe('18446744073709551615')
  })
  it('does big 64-bit arithmetic exactly', () => {
    const max = (1n << 63n) - 1n
    expect(applyBinary('+', max, 1n, 64, true)).toBe(-(1n << 63n))
    expect(applyBinary('*', 0xffffffffn, 0xffffffffn, 64, false)).toBe(
      0xfffffffe00000001n,
    )
  })
  it('does bitwise operations, shifts and rotates', () => {
    expect(applyBinary('and', 0b1100n, 0b1010n, 8, false)).toBe(0b1000n)
    expect(applyBinary('or', 0b1100n, 0b1010n, 8, false)).toBe(0b1110n)
    expect(applyBinary('xor', 0b1100n, 0b1010n, 8, false)).toBe(0b0110n)
    expect(applyBinary('nand', 0b1100n, 0b1010n, 8, false)).toBe(0b11110111n)
    expect(applyBinary('nor', 0n, 0n, 8, false)).toBe(255n)
    expect(bitNot(0n, 8, true)).toBe(-1n)
    expect(applyBinary('lsh', 1n, 7n, 8, false)).toBe(128n)
    expect(applyBinary('rsh', -8n, 1n, 8, true)).toBe(-4n)
    expect(applyBinary('rsh', 248n, 1n, 8, false)).toBe(124n)
    expect(applyBinary('rol', 0b10000001n, 1n, 8, false)).toBe(0b00000011n)
    expect(applyBinary('ror', 0b10000001n, 1n, 8, false)).toBe(0b11000000n)
    expect(toggleBit(0n, 3, 8, false)).toBe(8n)
    expect(() => applyBinary('/', 1n, 0n, 32, true)).toThrow()
  })
  it('refuses digits that overflow the word', () => {
    expect(appendDigit(25n, '5', 10, 8, false)).toBe(255n)
    expect(appendDigit(25n, '6', 10, 8, false)).toBe(25n)
    expect(appendDigit(0xfn, 'F', 16, 8, false)).toBe(0xffn)
    expect(appendDigit(0xffn, 'F', 16, 8, false)).toBe(0xffn)
  })
})

describe('unit conversion', () => {
  it('converts temperature', () => {
    expect(convert('temperature', 'c', 'f', 100)).toBe(212)
    expect(convert('temperature', 'f', 'c', 32)).toBe(0)
    expect(convert('temperature', 'k', 'c', 0)).toBe(-273.15)
    expect(convert('temperature', 'c', 'k', 25)).toBe(298.15)
  })
  it('converts linear units', () => {
    expect(convert('length', 'km', 'm', 1.5)).toBe(1500)
    expect(convert('length', 'ft', 'in', 1)).toBe(12)
    expect(convert('length', 'mi', 'km', 1)).toBeCloseTo(1.609344, 9)
    expect(convert('mass', 'kg', 'lb', 1)).toBeCloseTo(2.20462262185, 9)
    expect(convert('data', 'GiB', 'MiB', 1)).toBe(1024)
    expect(convert('time', 'h', 'min', 2)).toBe(120)
    expect(convert('angle', 'turn', 'deg', 1)).toBe(360)
    expect(convert('speed', 'kmh', 'ms', 36)).toBe(10)
    expect(convert('pressure', 'atm', 'Pa', 1)).toBe(101325)
    expect(convert('energy', 'kcal', 'J', 1)).toBe(4184)
    expect(convert('area', 'ha', 'm2', 1)).toBe(10000)
    expect(convert('volume', 'l', 'ml', 1)).toBe(1000)
  })
})
