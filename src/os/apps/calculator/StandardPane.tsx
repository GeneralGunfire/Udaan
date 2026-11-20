import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Segmented } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { evaluate, formatNumber, groupEntry, type AngleMode } from './engine'
import {
  exprDisplay,
  initialKeypad,
  mainDisplay,
  press,
  previewValue,
  type KeyAction,
  type KeypadState,
} from './keypad'
import { Display, Key, flashKey } from './parts'

export interface PaneProps {
  /** Report a finished calculation for the history. */
  onRecord: (expr: string, result: string, value: string) => void
  /** A value chosen from history or memory; `n` changes on every pick so the same value can be reused twice. */
  reuse: { value: string; n: number } | null
  say: (t: string) => void
}

interface Props extends PaneProps {
  scientific: boolean
  angle: AngleMode
  onAngle: (a: AngleMode) => void
  memory: number[]
  onMemory: (m: number[]) => void
}

function reducer(
  state: {
    s: KeypadState
    mode: AngleMode
    last?: { expr: string; result: number; id: number }
  },
  a: KeyAction | { k: 'mode'; mode: AngleMode },
) {
  if (a.k === 'mode') return { ...state, mode: a.mode }
  const r = press(state.s, a, state.mode)
  return {
    ...state,
    s: r.state,
    last: r.record
      ? { ...r.record, id: (state.last?.id ?? 0) + 1 }
      : state.last,
  }
}

/** A number pasted or picked: digits, a decimal point, a sign, an exponent. Grouping commas are dropped. */
export function parsePasted(text: string): number | null {
  const t = text.trim().replace(/[\s,_]/g, '')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable)

export function StandardPane({
  scientific,
  angle,
  onAngle,
  memory,
  onMemory,
  onRecord,
  reuse,
  say,
}: Props) {
  const [st, dispatch] = useReducer(reducer, { s: initialKeypad, mode: angle })
  const [second, setSecond] = useState(false)
  const [hyp, setHyp] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const s = st.s

  useEffect(() => dispatch({ k: 'mode', mode: angle }), [angle])

  // Finished calculations go to the history once each.
  const recorded = useRef(0)
  useEffect(() => {
    if (st.last && st.last.id !== recorded.current) {
      recorded.current = st.last.id
      onRecord(
        st.last.expr,
        formatNumber(st.last.result),
        String(st.last.result),
      )
    }
  }, [st.last, onRecord])

  useEffect(() => {
    if (!reuse) return
    const v = Number(reuse.value)
    if (Number.isFinite(v)) dispatch({ k: 'set', value: v })
  }, [reuse])

  const display = mainDisplay(s, st.mode, groupEntry)
  const exprLine = exprDisplay(s)

  /** The number on screen, for memory and copy. */
  const current = useMemo((): number | null => {
    if (s.error) return null
    if (s.done) return s.result
    if (s.entry) {
      try {
        return evaluate(s.entry.replace(/^-$/, '0'), st.mode)
      } catch {
        return null
      }
    }
    return previewValue(s, st.mode) ?? 0
  }, [s, st.mode])

  const copy = () => {
    if (s.error) return
    void navigator.clipboard.writeText(display.replace(/,/g, '')).then(
      () => say('Copied'),
      () => say('Couldn’t copy'),
    )
  }
  const k = (a: KeyAction) => () => dispatch(a)
  const mem = (op: 'mc' | 'mr' | 'm+' | 'm-' | 'ms') => {
    if (op === 'mc') return onMemory([])
    if (op === 'mr')
      return memory.length
        ? dispatch({ k: 'set', value: memory[0] })
        : undefined
    if (current === null) return
    if (op === 'ms') return onMemory([current, ...memory])
    const top = memory[0] ?? 0
    const next = Number(
      (top + (op === 'm+' ? current : -current)).toPrecision(12),
    )
    onMemory(memory.length ? [next, ...memory.slice(1)] : [next])
  }

  // Keyboard entry. Ctrl+1..4 and Ctrl+H belong to the window; everything else is handled here.
  const paste = (text: string) => {
    const v = parsePasted(text)
    if (v === null) return say('That isn’t a number')
    dispatch({ k: 'set', value: v })
  }
  const latest = useRef({ copy, dispatch, paste })
  latest.current = { copy, dispatch, paste }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return
      const send = (a: KeyAction, id: string) => {
        e.preventDefault()
        latest.current.dispatch(a)
        flashKey(root.current, id)
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
          e.preventDefault()
          latest.current.copy()
        }
        return
      }
      const key = e.key
      if (/^[0-9]$/.test(key)) return send({ k: 'digit', d: key }, key)
      switch (key) {
        case '.':
        case ',':
          return send({ k: 'dot' }, '.')
        case '+':
          return send({ k: 'op', op: '+' }, '+')
        case '-':
          return send({ k: 'op', op: '−' }, '−')
        case '*':
        case 'x':
          return send({ k: 'op', op: '×' }, '×')
        case '/':
          return send({ k: 'op', op: '÷' }, '÷')
        case '^':
          return send({ k: 'op', op: '^' }, '^')
        case '%':
          return send({ k: 'postfix', p: '%' }, '%')
        case '!':
          return send({ k: 'postfix', p: '!' }, '!')
        case '(':
          return send({ k: 'lparen' }, '(')
        case ')':
          return send({ k: 'rparen' }, ')')
        case 'Enter':
        case '=':
          return send({ k: 'equals' }, '=')
        case 'Backspace':
          return send({ k: 'back' }, 'back')
        case 'Delete':
          return send({ k: 'ce' }, 'ce')
        case 'Escape':
          return send({ k: 'clear' }, 'c')
        case 'F9':
          return send({ k: 'negate' }, 'neg')
        case 'p':
          return send({ k: 'const', c: 'π' }, 'pi')
        case 'r':
          return send({ k: 'fn', fn: 'recip' }, 'recip')
        case '@':
          return send({ k: 'fn', fn: 'sqrt' }, 'sqrt')
        case 'q':
          return send({ k: 'fn', fn: 'sqr' }, 'sqr')
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      e.preventDefault()
      latest.current.paste(e.clipboardData?.getData('text') ?? '')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [say])

  const memRow = (
    <div
      className="grid grid-cols-5 gap-1 px-3 pb-1.5"
      role="group"
      aria-label="Memory"
    >
      {(['mc', 'mr', 'm+', 'm-', 'ms'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => mem(m)}
          disabled={(m === 'mc' || m === 'mr') && !memory.length}
          title={
            {
              mc: 'Clear memory',
              mr: 'Recall memory',
              'm+': 'Add to memory',
              'm-': 'Subtract from memory',
              ms: 'Store in memory',
            }[m]
          }
          className="u-btn u-btn--ghost u-btn--sm h-[26px] w-full px-0 text-[11.5px] font-semibold uppercase disabled:opacity-35"
        >
          {m.toUpperCase()}
        </button>
      ))}
    </div>
  )

  const digit = (d: string) => (
    <Key key={d} id={d} tone="digit" onPress={k({ k: 'digit', d })}>
      {d}
    </Key>
  )
  const op = (o: string, label = o) => (
    <Key key={o} id={o} tone="op" label={label} onPress={k({ k: 'op', op: o })}>
      {o}
    </Key>
  )
  const back = (
    <Key key="back" id="back" label="Backspace" onPress={k({ k: 'back' })}>
      <svg
        viewBox="0 0 16 16"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 3.5h7.5v9H6L2.5 8zM8 6l4 4M12 6l-4 4" />
      </svg>
    </Key>
  )
  const tail = [
    digit('7'),
    digit('8'),
    digit('9'),
    op('×', 'Multiply'),
    digit('4'),
    digit('5'),
    digit('6'),
    op('−', 'Subtract'),
    digit('1'),
    digit('2'),
    digit('3'),
    op('+', 'Add'),
    <Key
      key="neg"
      id="neg"
      tone="digit"
      label="Negate (F9)"
      onPress={k({ k: 'negate' })}
    >
      +/−
    </Key>,
    digit('0'),
    <Key
      key="."
      id="."
      tone="digit"
      label="Decimal point"
      onPress={k({ k: 'dot' })}
    >
      .
    </Key>,
    <Key key="=" id="=" tone="eq" label="Equals" onPress={k({ k: 'equals' })}>
      =
    </Key>,
  ]

  if (!scientific) {
    return (
      <div ref={root} className="flex min-h-0 flex-1 flex-col">
        <Display
          expr={exprLine}
          value={display}
          error={!!s.error}
          onCopy={copy}
        />
        {memRow}
        <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-6 gap-1 px-3 pb-3">
          <Key id="%" label="Percent" onPress={k({ k: 'postfix', p: '%' })}>
            %
          </Key>
          <Key id="ce" label="Clear entry (Delete)" onPress={k({ k: 'ce' })}>
            CE
          </Key>
          <Key id="c" label="Clear (Escape)" onPress={k({ k: 'clear' })}>
            C
          </Key>
          {back}
          <Key
            id="recip"
            label="Reciprocal"
            onPress={k({ k: 'fn', fn: 'recip' })}
          >
            1/x
          </Key>
          <Key id="sqr" label="Square" onPress={k({ k: 'fn', fn: 'sqr' })}>
            x²
          </Key>
          <Key
            id="sqrt"
            label="Square root"
            onPress={k({ k: 'fn', fn: 'sqrt' })}
          >
            √x
          </Key>
          {op('÷', 'Divide')}
          {tail}
        </div>
      </div>
    )
  }

  // Scientific: the 2nd key swaps the left column and the trig row for their inverses.
  const fnKey = (id: string, label: string, aria: string, a: KeyAction) => (
    <Key
      key={id}
      id={id}
      label={aria}
      onPress={() => (dispatch(a), second && setSecond(false))}
    >
      {label}
    </Key>
  )
  const trig = (['sin', 'cos', 'tan'] as const).map((f) => {
    const name = `${second ? 'a' : ''}${f}${hyp ? 'h' : ''}`
    const label = `${f}${hyp ? 'h' : ''}${second ? '⁻¹' : ''}`
    return fnKey(name, label, name, { k: 'fn', fn: name })
  })

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      <Display
        expr={exprLine}
        value={display}
        error={!!s.error}
        onCopy={copy}
      />
      <div className="flex items-center gap-2 px-3 pb-2">
        <Segmented<AngleMode>
          value={st.mode}
          onChange={onAngle}
          options={[
            { value: 'deg', label: 'DEG' },
            { value: 'rad', label: 'RAD' },
            { value: 'grad', label: 'GRAD' },
          ]}
        />
        <span className="flex-1" />
        <span className="text-[11.5px] text-(--u-ink-3) tabular-nums">
          {memory.length ? `M ${formatNumber(memory[0])}` : ''}
        </span>
      </div>
      {memRow}
      <div className="grid h-[38px] shrink-0 grid-cols-5 gap-1 px-3 pb-1">
        <Key
          id="2nd"
          active={second}
          label="Second functions"
          onPress={() => setSecond(!second)}
          className={cn(second && 'text-(--u-accent)')}
        >
          2nd
        </Key>
        <Key
          id="hyp"
          active={hyp}
          label="Hyperbolic functions"
          onPress={() => setHyp(!hyp)}
          className={cn(hyp && 'text-(--u-accent)')}
        >
          hyp
        </Key>
        {trig}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-5 grid-rows-7 gap-1 px-3 pb-3">
        {second
          ? fnKey('cube', 'x³', 'Cube', { k: 'fn', fn: 'cube' })
          : fnKey('sqr', 'x²', 'Square', { k: 'fn', fn: 'sqr' })}
        <Key id="pi" label="Pi" onPress={k({ k: 'const', c: 'π' })}>
          π
        </Key>
        <Key id="e" label="Euler's number" onPress={k({ k: 'const', c: 'e' })}>
          e
        </Key>
        <Key id="c" label="Clear (Escape)" onPress={k({ k: 'clear' })}>
          C
        </Key>
        {back}

        {second
          ? fnKey('cbrt', '∛x', 'Cube root', { k: 'fn', fn: 'cbrt' })
          : fnKey('sqrt', '√x', 'Square root', { k: 'fn', fn: 'sqrt' })}
        <Key
          id="recip"
          label="Reciprocal"
          onPress={k({ k: 'fn', fn: 'recip' })}
        >
          1/x
        </Key>
        <Key
          id="abs"
          label="Absolute value"
          onPress={k({ k: 'fn', fn: 'abs' })}
        >
          |x|
        </Key>
        <Key id="ce" label="Clear entry (Delete)" onPress={k({ k: 'ce' })}>
          CE
        </Key>
        <Key id="mod" label="Modulo" onPress={k({ k: 'op', op: 'mod' })}>
          mod
        </Key>

        {second
          ? fnKey('yroot', 'ʸ√x', 'Y-th root', { k: 'op', op: 'yroot' })
          : fnKey('^', 'xʸ', 'Power', { k: 'op', op: '^' })}
        <Key id="(" label="Open parenthesis" onPress={k({ k: 'lparen' })}>
          (
        </Key>
        <Key id=")" label="Close parenthesis" onPress={k({ k: 'rparen' })}>
          )
        </Key>
        <Key id="!" label="Factorial" onPress={k({ k: 'postfix', p: '!' })}>
          n!
        </Key>
        {op('÷', 'Divide')}

        {second
          ? fnKey('exp', 'eˣ', 'e to the power', { k: 'fn', fn: 'exp' })
          : fnKey('pow10', '10ˣ', 'Ten to the power', { k: 'fn', fn: 'pow10' })}
        {tail.slice(0, 4)}
        {second
          ? fnKey('log2', 'log₂', 'Log base 2', { k: 'fn', fn: 'log2' })
          : fnKey('log', 'log', 'Log base 10', { k: 'fn', fn: 'log' })}
        {tail.slice(4, 8)}
        {fnKey('ln', 'ln', 'Natural log', { k: 'fn', fn: 'ln' })}
        {tail.slice(8, 12)}
        <Key id="%" label="Percent" onPress={k({ k: 'postfix', p: '%' })}>
          %
        </Key>
        {tail.slice(12)}
      </div>
    </div>
  )
}
