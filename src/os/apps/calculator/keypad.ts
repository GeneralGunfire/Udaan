import {
  CalcError,
  evaluate,
  formatNumber,
  plainNumber,
  type AngleMode,
} from './engine'

/**
 * Standard and Scientific input, as a pure reducer. The expression is kept as text the engine
 * parses (with display glyphs), so precedence comes from the engine, not from button order.
 *   expr   what is committed so far, e.g. "12 + sqrt(9) × "
 *   entry  the operand being typed, e.g. "3.5", or a wrapped one such as "sqr(4)" (locked)
 */
export interface KeypadState {
  expr: string
  entry: string
  /** The entry is a finished operand (a function result, a constant): typing a digit replaces it. */
  locked: boolean
  /** The last thing shown as a result. */
  result: number | null
  /** Just pressed =; the next digit starts over, the next operator continues from the result. */
  done: boolean
  /** The trailing "+ 3" of the last =, so pressing = again repeats it. */
  repeat: string | null
  error: string | null
  /** The full expression of the last =, shown above the result. */
  shownExpr: string
}

export const initialKeypad: KeypadState = {
  expr: '',
  entry: '',
  locked: false,
  result: null,
  done: false,
  repeat: null,
  error: null,
  shownExpr: '',
}

export type KeyAction =
  | { k: 'digit'; d: string }
  | { k: 'dot' }
  | { k: 'op'; op: string }
  | { k: 'fn'; fn: string }
  | { k: 'const'; c: 'π' | 'e' }
  | { k: 'postfix'; p: '!' | '%' }
  | { k: 'lparen' }
  | { k: 'rparen' }
  | { k: 'negate' }
  | { k: 'back' }
  | { k: 'ce' }
  | { k: 'clear' }
  | { k: 'equals' }
  | { k: 'set'; value: number }

export const OPS = ['+', '−', '×', '÷', '^', 'mod', 'yroot'] as const
const OP_TAIL = /\s(\+|−|×|÷|\^|mod|yroot)\s$/

export interface Evaluated {
  state: KeypadState
  /** A finished calculation, for the history. */
  record?: { expr: string; result: number }
}

const endsWithOp = (s: string) => OP_TAIL.test(s)
const endsWithClose = (s: string) => /\)\s*$/.test(s)

/** The operand the next function applies to. */
function currentOperand(s: KeypadState): string {
  if (s.entry) return s.entry
  if (s.done && s.result !== null) return plainNumber(s.result)
  return '0'
}

function freshAfterDone(s: KeypadState): KeypadState {
  return s.done || s.error ? { ...initialKeypad } : s
}

export function previewValue(s: KeypadState, mode: AngleMode): number | null {
  const text = (s.expr + s.entry).replace(OP_TAIL, '')
  if (!text.trim()) return null
  try {
    return evaluate(text, mode)
  } catch {
    return null
  }
}

export function press(
  s0: KeypadState,
  a: KeyAction,
  mode: AngleMode,
): Evaluated {
  let s = s0
  switch (a.k) {
    case 'digit': {
      s = freshAfterDone(s)
      if (s.locked) s = { ...s, entry: '', locked: false }
      if (s.entry.replace(/[^0-9]/g, '').length >= 16) return { state: s }
      const entry =
        s.entry === '0' ? a.d : s.entry === '-0' ? `-${a.d}` : s.entry + a.d
      // A digit straight after ")" multiplies: (1+2)3 reads as (1+2) × 3.
      const expr = !s.entry && endsWithClose(s.expr) ? `${s.expr} × ` : s.expr
      return { state: { ...s, expr, entry } }
    }
    case 'dot': {
      s = freshAfterDone(s)
      if (s.locked) s = { ...s, entry: '', locked: false }
      if (s.entry.includes('.')) return { state: s }
      return { state: { ...s, entry: (s.entry || '0') + '.' } }
    }
    case 'set': {
      s = freshAfterDone(s)
      return { state: { ...s, entry: plainNumber(a.value), locked: true } }
    }
    case 'const': {
      s = freshAfterDone(s)
      const expr = s.entry && !s.locked ? `${s.expr}${s.entry} × ` : s.expr
      return { state: { ...s, expr, entry: a.c, locked: true } }
    }
    case 'op': {
      if (s.error) return { state: s }
      if (s.done && s.result !== null)
        return {
          state: {
            ...initialKeypad,
            expr: `${plainNumber(s.result)} ${a.op} `,
          },
        }
      if (!s.entry) {
        if (endsWithOp(s.expr))
          return { state: { ...s, expr: s.expr.replace(OP_TAIL, ` ${a.op} `) } }
        if (!s.expr.trim() || /\($/.test(s.expr.trim())) {
          // An operator with nothing before it starts from 0 (or makes a negative after "(").
          if (a.op === '−')
            return { state: { ...s, entry: '-', locked: false } }
          return { state: { ...s, expr: `${s.expr}0 ${a.op} ` } }
        }
        return { state: { ...s, expr: `${s.expr} ${a.op} ` } }
      }
      if (s.entry === '-') return { state: s }
      return {
        state: {
          ...s,
          expr: `${s.expr}${s.entry} ${a.op} `,
          entry: '',
          locked: false,
        },
      }
    }
    case 'fn': {
      if (s.error) s = { ...initialKeypad }
      const operand = currentOperand(s)
      const base = s.done ? { ...initialKeypad } : s
      const wrapped = a.fn === 'sqr' ? `sqr(${operand})` : `${a.fn}(${operand})`
      return { state: { ...base, entry: wrapped, locked: true } }
    }
    case 'postfix': {
      if (s.error) return { state: s }
      const operand = currentOperand(s)
      const base = s.done ? { ...initialKeypad } : s
      if (!s.entry && endsWithClose(s.expr))
        return { state: { ...s, expr: `${s.expr}${a.p}` } }
      return { state: { ...base, entry: `${operand}${a.p}`, locked: true } }
    }
    case 'lparen': {
      s = freshAfterDone(s)
      if (s.entry && s.entry !== '-')
        return {
          state: {
            ...s,
            expr: `${s.expr}${s.entry} × (`,
            entry: '',
            locked: false,
          },
        }
      if (s.entry === '-')
        return { state: { ...s, expr: `${s.expr}-(`, entry: '' } }
      if (endsWithClose(s.expr))
        return { state: { ...s, expr: `${s.expr} × (` } }
      return { state: { ...s, expr: `${s.expr}(` } }
    }
    case 'rparen': {
      if (s.error || s.done) return { state: s }
      const open =
        (s.expr.match(/\(/g) ?? []).length - (s.expr.match(/\)/g) ?? []).length
      if (open <= 0) return { state: s }
      if (!s.entry && endsWithOp(s.expr)) return { state: s }
      return {
        state: { ...s, expr: `${s.expr}${s.entry})`, entry: '', locked: false },
      }
    }
    case 'negate': {
      if (s.error) return { state: s }
      if (s.done && s.result !== null)
        return {
          state: {
            ...initialKeypad,
            entry: plainNumber(-s.result).replace(/^\((.*)\)$/, '$1'),
            locked: true,
          },
        }
      if (!s.entry) return { state: { ...s, entry: '-' } }
      if (/^-?[0-9.]+$/.test(s.entry))
        return {
          state: {
            ...s,
            entry: s.entry.startsWith('-') ? s.entry.slice(1) : `-${s.entry}`,
          },
        }
      if (s.entry === '-') return { state: { ...s, entry: '' } }
      const neg = /^neg\((.*)\)$/.exec(s.entry)
      return {
        state: { ...s, entry: neg ? neg[1] : `neg(${s.entry})`, locked: true },
      }
    }
    case 'back': {
      if (s.error) return { state: { ...initialKeypad } }
      if (s.done) return { state: { ...s, shownExpr: '' } }
      if (s.locked) return { state: { ...s, entry: '', locked: false } }
      if (s.entry) return { state: { ...s, entry: s.entry.slice(0, -1) } }
      // Nothing being typed: take back the last operator or parenthesis.
      if (endsWithOp(s.expr)) {
        const expr = s.expr.replace(OP_TAIL, '')
        const m = /(-?[0-9.]+)$/.exec(expr)
        return {
          state: m
            ? { ...s, expr: expr.slice(0, -m[1].length), entry: m[1] }
            : { ...s, expr },
        }
      }
      return { state: { ...s, expr: s.expr.slice(0, -1) } }
    }
    case 'ce':
      if (s.error || s.done) return { state: { ...initialKeypad } }
      return { state: { ...s, entry: '', locked: false } }
    case 'clear':
      return { state: { ...initialKeypad } }
    case 'equals': {
      if (s.error) return { state: { ...initialKeypad } }
      let text: string
      let repeat = s.repeat
      if (s.done) {
        if (s.result === null || !s.repeat) return { state: s }
        text = `${plainNumber(s.result)}${s.repeat}`
      } else {
        const body = s.entry ? s.expr + s.entry : s.expr.replace(OP_TAIL, '')
        if (!body.trim()) return { state: s }
        text = body
        const open =
          (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length
        if (open > 0) text += ')'.repeat(open)
        repeat = null
        if (s.entry && open <= 0) {
          const m = OP_TAIL.exec(s.expr)
          // Only a top-level trailing operator can be repeated.
          const before = s.expr.slice(0, m ? m.index : 0)
          const depth =
            (before.match(/\(/g) ?? []).length -
            (before.match(/\)/g) ?? []).length
          if (m && depth === 0) repeat = ` ${m[1]} ${s.entry}`
        }
      }
      try {
        const v = evaluate(text, mode)
        return {
          state: {
            ...initialKeypad,
            result: v,
            done: true,
            repeat,
            shownExpr: `${text} =`,
          },
          record: { expr: text, result: v },
        }
      } catch (e) {
        const msg = e instanceof CalcError ? e.message : 'Error'
        return {
          state: { ...initialKeypad, error: msg, shownExpr: `${text} =` },
        }
      }
    }
  }
}

/** What the big line shows. */
export function mainDisplay(
  s: KeypadState,
  mode: AngleMode,
  groupEntry: (e: string) => string,
): string {
  if (s.error) return s.error
  if (s.done && s.result !== null) return formatNumber(s.result)
  if (s.entry && !s.locked) return groupEntry(s.entry)
  if (s.entry && s.locked) {
    try {
      return formatNumber(evaluate(s.entry, mode))
    } catch {
      return s.entry
    }
  }
  const p = previewValue(s, mode)
  return p === null ? '0' : formatNumber(p)
}

/** What the small line above shows. */
export function exprDisplay(s: KeypadState): string {
  if (s.done || s.error) return s.shownExpr
  return (s.expr + (s.locked ? s.entry : '')).trim()
}
