/**
 * The calculator's expression engine. A small tokenizer and a recursive-descent parser that
 * evaluates as it parses. Nothing here ever reaches eval or Function: only the grammar below is
 * understood, and anything else is a CalcError.
 *
 *   expr     := add
 *   add      := mul (('+' | '-') mul)*          a + b% means a + a*b/100
 *   mul      := unary (('*' | '/' | 'mod' | 'yroot' | implicit) unary)*
 *   unary    := ('-' | '+') unary | power
 *   power    := postfix ('^' unary)?             right associative, so 2^3^2 = 2^9 and -2^2 = -4
 *   postfix  := primary ('!' | '%')*
 *   primary  := number | constant | func '(' expr ')' | '(' expr ')'
 */

export type AngleMode = 'deg' | 'rad' | 'grad'

export class CalcError extends Error {}

type Tok =
  | { t: 'num'; v: number }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'fn'; v: string }
  | { t: 'const'; v: number }

export const FUNCS = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'ln',
  'log',
  'log2',
  'sqrt',
  'cbrt',
  'abs',
  'exp',
  'pow10',
  'fact',
  'neg',
  'recip',
  'sqr',
  'cube',
] as const
const FUNC_SET = new Set<string>(FUNCS)

const OP_ALIASES: Record<string, string> = {
  '×': '*',
  '÷': '/',
  '−': '-',
  '·': '*',
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const s = src
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === ' ' || c === '\t') {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.,]/.test(s[j])) j++
      // Scientific notation, e.g. 1.5e-7, but not a bare `e` constant after a number.
      if (
        (s[j] === 'e' || s[j] === 'E') &&
        /[0-9+-]/.test(s[j + 1] ?? '') &&
        (/[0-9]/.test(s[j + 1]) || /[0-9]/.test(s[j + 2] ?? ''))
      ) {
        j += 2
        while (j < s.length && /[0-9]/.test(s[j])) j++
      }
      const raw = s.slice(i, j).replace(/,/g, '')
      if ((raw.match(/\./g) ?? []).length > 1)
        throw new CalcError('Invalid number')
      const v = Number(raw)
      if (!Number.isFinite(v)) throw new CalcError('Invalid number')
      out.push({ t: 'num', v })
      i = j
      continue
    }
    if (c === '(') {
      out.push({ t: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      out.push({ t: 'rp' })
      i++
      continue
    }
    if (c === 'π') {
      out.push({ t: 'const', v: Math.PI })
      i++
      continue
    }
    const op = OP_ALIASES[c] ?? c
    if ('+-*/^!%'.includes(op)) {
      out.push({ t: 'op', v: op })
      i++
      continue
    }
    if (/[a-z]/i.test(c)) {
      let j = i
      while (j < s.length && /[a-z0-9]/i.test(s[j])) j++
      const word = s.slice(i, j).toLowerCase()
      if (word === 'pi') out.push({ t: 'const', v: Math.PI })
      else if (word === 'e') out.push({ t: 'const', v: Math.E })
      else if (word === 'mod' || word === 'yroot')
        out.push({ t: 'op', v: word })
      else if (FUNC_SET.has(word)) out.push({ t: 'fn', v: word })
      else throw new CalcError(`Unknown "${word}"`)
      i = j
      continue
    }
    throw new CalcError(`Unexpected "${c}"`)
  }
  return out
}

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) {
    if (n < 0) throw new CalcError('Invalid input')
    return gamma(n + 1)
  }
  if (n > 170) throw new CalcError('Overflow')
  let r = 1
  for (let k = 2; k <= n; k++) r *= k
  return r
}

/** Lanczos approximation, so 0.5! works the way scientific calculators show it. */
function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z))
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

const toRad = (v: number, m: AngleMode) =>
  m === 'deg' ? (v * Math.PI) / 180 : m === 'grad' ? (v * Math.PI) / 200 : v
const fromRad = (v: number, m: AngleMode) =>
  m === 'deg' ? (v * 180) / Math.PI : m === 'grad' ? (v * 200) / Math.PI : v

/** Snaps values that are an artefact of floating point (sin 180 = 1.2e-16) to exact ones. */
function clean(v: number): number {
  if (Math.abs(v) < 1e-14) return 0
  const r = Math.round(v)
  if (Math.abs(v - r) < 1e-12 * Math.max(1, Math.abs(r))) return r
  return v
}

function applyFn(name: string, x: number, mode: AngleMode): number {
  switch (name) {
    case 'sin':
      return clean(Math.sin(toRad(x, mode)))
    case 'cos':
      return clean(Math.cos(toRad(x, mode)))
    case 'tan': {
      const c = clean(Math.cos(toRad(x, mode)))
      if (c === 0) throw new CalcError('Invalid input')
      return clean(Math.tan(toRad(x, mode)))
    }
    case 'asin':
      if (x < -1 || x > 1) throw new CalcError('Invalid input')
      return clean(fromRad(Math.asin(x), mode))
    case 'acos':
      if (x < -1 || x > 1) throw new CalcError('Invalid input')
      return clean(fromRad(Math.acos(x), mode))
    case 'atan':
      return clean(fromRad(Math.atan(x), mode))
    case 'sinh':
      return Math.sinh(x)
    case 'cosh':
      return Math.cosh(x)
    case 'tanh':
      return Math.tanh(x)
    case 'asinh':
      return Math.asinh(x)
    case 'acosh':
      if (x < 1) throw new CalcError('Invalid input')
      return Math.acosh(x)
    case 'atanh':
      if (x <= -1 || x >= 1) throw new CalcError('Invalid input')
      return Math.atanh(x)
    case 'ln':
      if (x <= 0) throw new CalcError('Invalid input')
      return Math.log(x)
    case 'log':
      if (x <= 0) throw new CalcError('Invalid input')
      return clean(Math.log10(x))
    case 'log2':
      if (x <= 0) throw new CalcError('Invalid input')
      return clean(Math.log2(x))
    case 'sqrt':
      if (x < 0) throw new CalcError('Invalid input')
      return Math.sqrt(x)
    case 'cbrt':
      return Math.cbrt(x)
    case 'abs':
      return Math.abs(x)
    case 'exp':
      return Math.exp(x)
    case 'pow10':
      return Math.pow(10, x)
    case 'fact':
      return factorial(x)
    case 'neg':
      return -x
    case 'recip':
      if (x === 0) throw new CalcError('Cannot divide by zero')
      return 1 / x
    case 'sqr':
      return x * x
    case 'cube':
      return x * x * x
  }
  throw new CalcError(`Unknown "${name}"`)
}

interface Val {
  v: number
  /** Ends in %, so `a + b%` can mean a percentage of a. */
  pct: boolean
}

export function evaluate(src: string, mode: AngleMode = 'deg'): number {
  const toks = tokenize(src)
  if (!toks.length) throw new CalcError('Nothing to calculate')
  // Unclosed parentheses are closed at the end, the way people type.
  let depth = 0
  for (const t of toks) {
    if (t.t === 'lp') depth++
    else if (t.t === 'rp' && --depth < 0) throw new CalcError('Unmatched ")"')
  }
  for (; depth > 0; depth--) toks.push({ t: 'rp' })

  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) =>
    peek()?.t === 'op' && (peek() as { v: string }).v === v

  const add = (): Val => {
    let left = mul()
    for (;;) {
      if (isOp('+') || isOp('-')) {
        const op = (toks[p++] as { v: string }).v
        const right = mul()
        const r = right.pct ? left.v * right.v : right.v
        left = { v: op === '+' ? left.v + r : left.v - r, pct: false }
      } else return left
    }
  }
  const startsOperand = () => {
    const t = peek()
    return (
      !!t && (t.t === 'num' || t.t === 'lp' || t.t === 'fn' || t.t === 'const')
    )
  }
  const mul = (): Val => {
    let left = unary()
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('mod') || isOp('yroot')) {
        const op = (toks[p++] as { v: string }).v
        const right = unary().v
        if (op === '*') left = { v: left.v * right, pct: false }
        else if (op === '/') {
          if (right === 0)
            throw new CalcError(
              left.v === 0 ? 'Result is undefined' : 'Cannot divide by zero',
            )
          left = { v: left.v / right, pct: false }
        } else if (op === 'mod') {
          if (right === 0) throw new CalcError('Cannot divide by zero')
          left = { v: left.v - right * Math.floor(left.v / right), pct: false }
        } else {
          if (right === 0) throw new CalcError('Invalid input')
          const x = left.v
          if (x < 0 && Math.abs(right % 2) === 1)
            left = { v: -Math.pow(-x, 1 / right), pct: false }
          else if (x < 0) throw new CalcError('Invalid input')
          else left = { v: clean(Math.pow(x, 1 / right)), pct: false }
        }
      } else if (startsOperand()) {
        // Implicit multiplication: 2π, 3(4), (1+2)(3+4).
        left = { v: left.v * unary().v, pct: false }
      } else return left
    }
  }
  const unary = (): Val => {
    if (isOp('-')) {
      p++
      const r = unary()
      return { v: -r.v, pct: r.pct }
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    return power()
  }
  const power = (): Val => {
    const base = postfix()
    if (isOp('^')) {
      p++
      const e = unary().v
      const v = Math.pow(base.v, e)
      if (Number.isNaN(v)) throw new CalcError('Invalid input')
      return { v, pct: false }
    }
    return base
  }
  const postfix = (): Val => {
    let x: Val = primary()
    for (;;) {
      if (isOp('!')) {
        p++
        x = { v: factorial(x.v), pct: false }
      } else if (isOp('%')) {
        p++
        x = { v: x.v / 100, pct: true }
      } else return x
    }
  }
  const primary = (): Val => {
    const t = toks[p++]
    if (!t) throw new CalcError('Incomplete expression')
    if (t.t === 'num' || t.t === 'const') return { v: t.v, pct: false }
    if (t.t === 'lp') {
      const v = add()
      if (toks[p++]?.t !== 'rp') throw new CalcError('Missing ")"')
      return { v: v.v, pct: false }
    }
    if (t.t === 'fn') {
      if (toks[p]?.t !== 'lp') {
        // sin 30 without parentheses: takes the next postfix operand.
        return { v: applyFn(t.v, postfix().v, mode), pct: false }
      }
      p++
      const v = add()
      if (toks[p++]?.t !== 'rp') throw new CalcError('Missing ")"')
      return { v: applyFn(t.v, v.v, mode), pct: false }
    }
    throw new CalcError('Incomplete expression')
  }

  const out = add()
  if (p < toks.length) throw new CalcError('Unexpected input')
  const v = out.v
  if (Number.isNaN(v)) throw new CalcError('Result is undefined')
  if (!Number.isFinite(v)) throw new CalcError('Overflow')
  return roundSig(v)
}

/** Rounds to 12 significant digits, which removes 0.1 + 0.2 style artefacts. */
export function roundSig(v: number, digits = 12): number {
  if (v === 0 || !Number.isFinite(v)) return v
  return Number(v.toPrecision(digits))
}

/** A number for display: grouped thousands, exponent form for very big or tiny values. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return 'Overflow'
  const r = roundSig(v)
  const a = Math.abs(r)
  if (a !== 0 && (a >= 1e16 || a < 1e-10)) {
    const [m, e] = r.toExponential(11).split('e')
    return `${m.replace(/\.?0+$/, '')}e${e}`
  }
  return r.toLocaleString('en-US', {
    maximumFractionDigits: 12,
    useGrouping: true,
  })
}

/** A number in a form the parser accepts again (no grouping). */
export function plainNumber(v: number): string {
  const s = formatNumber(v).replace(/,/g, '')
  return v < 0 ? `(${s})` : s
}

/** Groups the integer part of a number being typed, keeping the fraction exactly as typed. */
export function groupEntry(entry: string): string {
  const m = /^(-?)(\d+)(\.\d*)?$/.exec(entry)
  if (!m) return entry
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] ?? '')
}

/** For display: ASCII operators shown with their proper glyphs. */
export function prettyExpr(src: string): string {
  return src
    .replace(/\*/g, '×')
    .replace(/\//g, '÷')
    .replace(/(\S)-(?=\S)/g, '$1 − ')
    .replace(/\s+/g, ' ')
    .trim()
}
