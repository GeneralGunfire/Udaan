/**
 * Spotlight calculator: a small recursive-descent parser (never `eval`).
 * Supports + - * / % ^, parentheses, unary minus, implicit ×/÷ symbols,
 * constants (pi, e) and common functions.
 */

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
}
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E }

export function evaluate(input: string): number | null {
  const src = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').trim().toLowerCase()
  // Only worth answering if it's clearly maths, not a word that happens to parse.
  if (!src || !/[\d)]/.test(src) || !/[+\-*/^%(]|sqrt|\d\s*[a-z]/.test(src)) return null
  let i = 0
  const peek = () => src[i]
  const skip = () => {
    while (src[i] === ' ') i++
  }
  const fail = (): never => {
    throw new Error('parse')
  }

  function number(): number {
    skip()
    const m = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/.exec(src.slice(i))
    if (m) {
      i += m[0].length
      return parseFloat(m[0])
    }
    const w = /^[a-z]+/.exec(src.slice(i))
    if (w) {
      i += w[0].length
      if (w[0] in CONSTS) return CONSTS[w[0]]
      const f = FUNCS[w[0]]
      if (!f) fail()
      return f(unary())
    }
    if (peek() === '(') {
      i++
      const v = expr()
      skip()
      if (peek() !== ')') fail()
      i++
      return v
    }
    return fail()
  }
  function unary(): number {
    skip()
    if (peek() === '-') {
      i++
      return -unary()
    }
    if (peek() === '+') {
      i++
      return unary()
    }
    return power()
  }
  function power(): number {
    const base = number()
    skip()
    if (peek() === '^') {
      i++
      return base ** unary()
    }
    return base
  }
  function term(): number {
    let v = unary()
    for (;;) {
      skip()
      const op = peek()
      if (op !== '*' && op !== '/' && op !== '%') return v
      i++
      const r = unary()
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
  }
  function expr(): number {
    let v = term()
    for (;;) {
      skip()
      const op = peek()
      if (op !== '+' && op !== '-') return v
      i++
      const r = term()
      v = op === '+' ? v + r : v - r
    }
  }

  try {
    const v = expr()
    skip()
    if (i !== src.length || !Number.isFinite(v)) return null
    return v
  } catch {
    return null
  }
}

export function formatResult(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString()
  return Number(v.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: 10 })
}
