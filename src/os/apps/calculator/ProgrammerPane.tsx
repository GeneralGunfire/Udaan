import { useEffect, useRef, useState } from 'react'
import { Segmented, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { Display, Key, flashKey } from './parts'
import type { PaneProps } from './StandardPane'
import {
  OP_LABEL,
  ProgError,
  RADIX_NAME,
  appendDigit,
  applyBinary,
  bitAt,
  bitNot,
  digitAllowed,
  groupDigits,
  negate,
  normalize,
  removeDigit,
  toRadix,
  toggleBit,
  type BinOp,
  type Radix,
  type Width,
} from './programmer'

interface Props extends PaneProps {
  radix: Radix
  width: Width
  signed: boolean
  onSettings: (p: { radix: Radix; width: Width; signed: boolean }) => void
}

interface PState {
  value: bigint
  /** A pending binary operation and its left side. */
  pending: { op: BinOp; left: bigint } | null
  /** The next digit starts a new number. */
  fresh: boolean
  error: string | null
  exprLine: string
  last: { op: BinOp; right: bigint } | null
}

const START: PState = {
  value: 0n,
  pending: null,
  fresh: true,
  error: null,
  exprLine: '',
  last: null,
}
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/**
 * Programmer mode. Operations run left to right as they are entered, the way programmer
 * calculators work, on an exact fixed-width word.
 */
export function ProgrammerPane({
  radix,
  width,
  signed,
  onSettings,
  onRecord,
  reuse,
  say,
}: Props) {
  const [st, setSt] = useState<PState>(START)
  const root = useRef<HTMLDivElement>(null)
  const fmt = (v: bigint, r: Radix = radix) => toRadix(v, r, width, signed)

  // Changing word size or signedness re-wraps the value.
  useEffect(
    () => setSt((s) => ({ ...s, value: normalize(s.value, width, signed) })),
    [width, signed],
  )

  useEffect(() => {
    if (!reuse) return
    try {
      setSt((s) => ({
        ...s,
        value: normalize(BigInt(reuse.value), width, signed),
        fresh: true,
        error: null,
      }))
    } catch {
      say('That value can’t be used here')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reuse])

  const run = (s: PState): PState => {
    if (!s.pending) return s
    try {
      const v = applyBinary(
        s.pending.op,
        s.pending.left,
        s.value,
        width,
        signed,
      )
      return { ...s, value: v, pending: null, fresh: true }
    } catch (e) {
      return { ...START, error: e instanceof ProgError ? e.message : 'Error' }
    }
  }

  const act = {
    digit: (d: string) =>
      setSt((s) => {
        if (!digitAllowed(d, radix)) return s
        const base = s.error ? START : s
        const v = base.fresh ? 0n : base.value
        return {
          ...base,
          value: appendDigit(v, d, radix, width, signed),
          fresh: false,
          error: null,
        }
      }),
    op: (op: BinOp) =>
      setSt((s) => {
        if (s.error) return s
        const r = s.pending && !s.fresh ? run(s) : s
        if (r.error) return r
        return {
          ...r,
          pending: { op, left: r.value },
          fresh: true,
          exprLine: `${groupDigits(fmt(r.value), radix)} ${OP_LABEL[op]}`,
        }
      }),
    // Not an updater: it reports to the history, which must happen exactly once.
    equals: () => {
      const s = st
      if (s.error) return setSt(START)
      if (!s.pending) {
        if (!s.last) return
        const again = run({
          ...s,
          value: s.last.right,
          pending: { op: s.last.op, left: s.value },
        })
        if (!again.error)
          onRecord(
            `${fmt(s.value)} ${OP_LABEL[s.last.op]} ${fmt(s.last.right)} (${RADIX_NAME[radix]})`,
            fmt(again.value),
            again.value.toString(),
          )
        return setSt({
          ...again,
          exprLine: `${groupDigits(fmt(s.value), radix)} ${OP_LABEL[s.last.op]} ${groupDigits(fmt(s.last.right), radix)} =`,
          last: s.last,
        })
      }
      const r = run(s)
      if (r.error) return setSt(r)
      const line = `${groupDigits(fmt(s.pending.left), radix)} ${OP_LABEL[s.pending.op]} ${groupDigits(fmt(s.value), radix)} =`
      onRecord(
        `${fmt(s.pending.left)} ${OP_LABEL[s.pending.op]} ${fmt(s.value)} (${RADIX_NAME[radix]})`,
        fmt(r.value),
        r.value.toString(),
      )
      setSt({
        ...r,
        exprLine: line,
        last: { op: s.pending.op, right: s.value },
      })
    },
    not: () =>
      setSt((s) =>
        s.error
          ? s
          : { ...s, value: bitNot(s.value, width, signed), fresh: true },
      ),
    neg: () =>
      setSt((s) =>
        s.error
          ? s
          : { ...s, value: negate(s.value, width, signed), fresh: true },
      ),
    back: () =>
      setSt((s) =>
        s.error
          ? START
          : s.fresh
            ? s
            : { ...s, value: removeDigit(s.value, radix, width, signed) },
      ),
    ce: () => setSt((s) => ({ ...s, value: 0n, fresh: true, error: null })),
    clear: () => setSt(START),
    bit: (b: number) =>
      setSt((s) =>
        s.error
          ? s
          : { ...s, value: toggleBit(s.value, b, width, signed), fresh: false },
      ),
  }

  const copy = () => {
    if (st.error) return
    void navigator.clipboard.writeText(fmt(st.value)).then(
      () => say('Copied'),
      () => say('Couldn’t copy'),
    )
  }

  const latest = useRef({ act, copy, radix })
  latest.current = { act, copy, radix }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return
      const { act: a, copy: c, radix: r } = latest.current
      const send = (fn: () => void, id: string) => {
        e.preventDefault()
        fn()
        flashKey(root.current, id)
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
          e.preventDefault()
          c()
        }
        return
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
      if (/^[0-9A-F]$/.test(key) && digitAllowed(key, r))
        return send(() => a.digit(key), key)
      switch (e.key) {
        case '+':
          return send(() => a.op('+'), '+')
        case '-':
          return send(() => a.op('-'), '-')
        case '*':
          return send(() => a.op('*'), '*')
        case '/':
          return send(() => a.op('/'), '/')
        case '%':
          return send(() => a.op('mod'), 'mod')
        case '&':
          return send(() => a.op('and'), 'and')
        case '|':
          return send(() => a.op('or'), 'or')
        case '^':
          return send(() => a.op('xor'), 'xor')
        case '~':
          return send(a.not, 'not')
        case '<':
          return send(() => a.op('lsh'), 'lsh')
        case '>':
          return send(() => a.op('rsh'), 'rsh')
        case 'Enter':
        case '=':
          return send(a.equals, '=')
        case 'Backspace':
          return send(a.back, 'back')
        case 'Delete':
          return send(a.ce, 'ce')
        case 'Escape':
          return send(a.clear, 'c')
        case 'F9':
          return send(a.neg, 'neg')
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const raw = (e.clipboardData?.getData('text') ?? '')
        .trim()
        .replace(/[\s,_]/g, '')
      const { radix: r } = latest.current
      const prefixed = /^0x[0-9a-f]+$/i.test(raw)
        ? raw
        : /^0b[01]+$/i.test(raw)
          ? raw
          : /^0o[0-7]+$/i.test(raw)
            ? raw
            : null
      try {
        let v: bigint
        if (prefixed) v = BigInt(prefixed)
        else if (r === 10 && /^-?\d+$/.test(raw)) v = BigInt(raw)
        else if (
          r !== 10 &&
          [...raw.toUpperCase()].every((d) => digitAllowed(d, r)) &&
          raw
        )
          v = BigInt((r === 16 ? '0x' : r === 8 ? '0o' : '0b') + raw)
        else throw new Error('nan')
        e.preventDefault()
        setSt((s) => ({
          ...s,
          value: normalize(v, width, signed),
          fresh: true,
          error: null,
        }))
      } catch {
        say('That isn’t a number in this base')
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [say, width, signed])

  const key = (
    id: string,
    label: string,
    fn: () => void,
    tone: 'digit' | 'fn' | 'op' | 'eq' = 'fn',
    aria?: string,
    disabled?: boolean,
  ) => (
    <Key
      key={id}
      id={id}
      tone={tone}
      label={aria ?? label}
      onPress={fn}
      disabled={disabled}
    >
      {label}
    </Key>
  )
  const dig = (d: string) =>
    key(d, d, () => act.digit(d), 'digit', undefined, !digitAllowed(d, radix))
  const binop = (
    op: BinOp,
    id: string,
    aria: string,
    tone: 'fn' | 'op' = 'fn',
  ) => key(id, OP_LABEL[op], () => act.op(op), tone, aria)

  const rows: Radix[] = [16, 10, 8, 2]
  const bitsList = Array.from({ length: width }, (_, i) => width - 1 - i)

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      <Display
        expr={st.exprLine}
        value={st.error ?? groupDigits(fmt(st.value), radix)}
        error={!!st.error}
        onCopy={copy}
      />
      <div
        className="flex flex-col gap-0.5 px-3 pb-2"
        role="radiogroup"
        aria-label="Number base"
      >
        {rows.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={radix === r}
            onClick={() => onSettings({ radix: r, width, signed })}
            className={cn(
              'flex h-[24px] items-center gap-3 rounded-[7px] px-2 text-left outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
              radix === r ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)',
            )}
          >
            <span
              className={cn(
                'w-8 text-[11px] font-semibold',
                radix === r ? 'text-(--u-accent)' : 'text-(--u-ink-3)',
              )}
            >
              {RADIX_NAME[r]}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-(--u-ink-2)">
              {st.error ? '' : groupDigits(fmt(st.value, r), r)}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <Segmented<string>
          value={String(width)}
          onChange={(v) =>
            onSettings({ radix, width: Number(v) as Width, signed })
          }
          options={[
            { value: '64', label: 'QWORD' },
            { value: '32', label: 'DWORD' },
            { value: '16', label: 'WORD' },
            { value: '8', label: 'BYTE' },
          ]}
        />
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[12px] text-(--u-ink-2)">
          Signed
          <Switch
            checked={signed}
            onChange={(v) => onSettings({ radix, width, signed: v })}
            label="Signed"
          />
        </label>
      </div>
      <div
        className="grid gap-x-1 gap-y-1 px-3 pb-2"
        style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}
        role="group"
        aria-label="Bits"
      >
        {bitsList.map((b) => {
          const on = bitAt(st.value, b, width)
          return (
            <button
              key={b}
              type="button"
              onClick={() => act.bit(b)}
              aria-label={`Bit ${b}, ${on ? 'on' : 'off'}`}
              aria-pressed={on}
              title={`Bit ${b}`}
              className={cn(
                'flex h-[20px] flex-col items-center justify-center rounded-[5px] font-mono text-[11px] leading-none outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
                on
                  ? 'bg-(--u-wash-on) text-(--u-ink)'
                  : 'text-(--u-ink-3) hover:bg-(--u-wash-hover)',
              )}
            >
              {on ? 1 : 0}
            </button>
          )
        })}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-6 grid-rows-6 gap-1 px-3 pb-3">
        {binop('and', 'and', 'Bitwise AND')}
        {binop('or', 'or', 'Bitwise OR')}
        {binop('xor', 'xor', 'Bitwise XOR')}
        {key('not', 'NOT', act.not, 'fn', 'Bitwise NOT')}
        {binop('nand', 'nand', 'Bitwise NAND')}
        {binop('nor', 'nor', 'Bitwise NOR')}
        {binop('lsh', 'lsh', 'Shift left')}
        {binop('rsh', 'rsh', 'Shift right')}
        {binop('rol', 'rol', 'Rotate left')}
        {binop('ror', 'ror', 'Rotate right')}
        {key('ce', 'CE', act.ce, 'fn', 'Clear entry (Delete)')}
        {key('c', 'C', act.clear, 'fn', 'Clear (Escape)')}
        {dig('A')}
        {dig('B')}
        {dig('7')}
        {dig('8')}
        {dig('9')}
        {binop('/', '/', 'Divide', 'op')}
        {dig('C')}
        {dig('D')}
        {dig('4')}
        {dig('5')}
        {dig('6')}
        {binop('*', '*', 'Multiply', 'op')}
        {dig('E')}
        {dig('F')}
        {dig('1')}
        {dig('2')}
        {dig('3')}
        {binop('-', '-', 'Subtract', 'op')}
        {binop('mod', 'mod', 'Modulo')}
        {key('back', '⌫', act.back, 'fn', 'Backspace')}
        {key('neg', '+/−', act.neg, 'digit', 'Negate (F9)')}
        {dig('0')}
        {key('=', '=', act.equals, 'eq', 'Equals')}
        {binop('+', '+', 'Add', 'op')}
      </div>
    </div>
  )
}
