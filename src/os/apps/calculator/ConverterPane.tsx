import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/os/ui/controls'
import { ShellSelect } from '@/os/ui/ShellSelect'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from './engine'
import { Ico, P } from './parts'
import type { PaneProps } from './StandardPane'
import { CATEGORIES, categoryById, convert } from './units'

interface Props extends PaneProps {
  category: string
  from: string
  to: string
  onSettings: (c: { category: string; from: string; to: string }) => void
}

const parse = (t: string) => {
  const v = Number(t.replace(/[\s,]/g, ''))
  return t.trim() && Number.isFinite(v) ? v : null
}
const show = (v: number) =>
  Number.isFinite(v) ? formatNumber(v).replace(/,/g, '') : ''

/**
 * Two linked fields. Typing in either converts into the other instantly; the last one typed in
 * is the source, so swapping units keeps what you typed.
 */
export function ConverterPane({
  category,
  from,
  to,
  onSettings,
  onRecord,
  reuse,
  say,
}: Props) {
  const cat = categoryById(category)
  const fromU =
    cat.units.find((u) => u.id === from) ??
    cat.units.find((u) => u.id === cat.pair[0])!
  const toU =
    cat.units.find((u) => u.id === to) ??
    cat.units.find((u) => u.id === cat.pair[1])!
  const [text, setText] = useState('1')
  const [side, setSide] = useState<'a' | 'b'>('a')

  useEffect(() => {
    if (reuse && Number.isFinite(Number(reuse.value))) {
      setText(show(Number(reuse.value)))
      setSide('a')
    }
  }, [reuse])

  const [a, b] = useMemo(() => {
    const v = parse(text)
    if (v === null) return side === 'a' ? [text, ''] : ['', text]
    return side === 'a'
      ? [text, show(convert(cat.id, fromU.id, toU.id, v))]
      : [show(convert(cat.id, toU.id, fromU.id, v)), text]
  }, [text, side, cat.id, fromU.id, toU.id])

  // A settled conversion goes into the history after a pause in typing.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(timer.current)
    if (!a || !b) return
    timer.current = setTimeout(
      () => onRecord(`${a} ${fromU.symbol}`, `${b} ${toU.symbol}`, b),
      1500,
    )
    return () => clearTimeout(timer.current)
  }, [a, b, fromU.symbol, toU.symbol, onRecord])

  const copy = (v: string) =>
    v &&
    void navigator.clipboard.writeText(v).then(
      () => say('Copied'),
      () => say('Couldn’t copy'),
    )

  const latest = useRef({ b, copy })
  latest.current = { b, copy }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'c' &&
        !typing &&
        !window.getSelection()?.toString()
      ) {
        e.preventDefault()
        latest.current.copy(latest.current.b)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const field = (
    which: 'a' | 'b',
    value: string,
    unitId: string,
    onUnit: (id: string) => void,
  ) => (
    <div className="rounded-[12px] bg-(--u-wash-hover) p-3 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
      <input
        value={value}
        inputMode="decimal"
        aria-label={which === 'a' ? 'Convert from value' : 'Convert to value'}
        onChange={(e) => (setText(e.target.value), setSide(which))}
        onKeyDown={(e) => e.key === 'Escape' && (setText(''), setSide(which))}
        className="w-full bg-transparent text-[28px] font-semibold tracking-tight tabular-nums outline-none placeholder:text-(--u-ink-3)"
        placeholder="0"
      />
      <div className="mt-1 flex items-center gap-2">
        <ShellSelect
          value={unitId}
          onChange={onUnit}
          ariaLabel={which === 'a' ? 'From unit' : 'To unit'}
          className="h-8 min-w-0 flex-1"
          options={cat.units.map((u) => ({ value: u.id, label: u.name, hint: u.symbol }))}
        />
        <Button
          icon
          size="sm"
          aria-label="Copy value"
          title="Copy"
          onClick={() => copy(value)}
        >
          <Ico d={P.copy} size={13} />
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="u-scroll flex shrink-0 gap-1 overflow-x-auto px-3 pt-1 pb-2"
        role="tablist"
        aria-label="What to convert"
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === cat.id}
            onClick={() =>
              onSettings({ category: c.id, from: c.pair[0], to: c.pair[1] })
            }
            className={cn(
              'h-[28px] shrink-0 rounded-[8px] px-2.5 text-[12.5px] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
              c.id === cat.id
                ? 'bg-(--u-wash-on) font-medium'
                : 'text-(--u-ink-2) hover:bg-(--u-wash-hover) hover:text-(--u-ink)',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 px-3 pt-2 pb-3">
        {field('a', a, fromU.id, (id) =>
          onSettings({ category: cat.id, from: id, to: toU.id }),
        )}
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="tinted"
            onClick={() =>
              onSettings({ category: cat.id, from: toU.id, to: fromU.id })
            }
            aria-label="Swap units"
            title="Swap units"
          >
            <Ico d={P.swap} size={13} /> Swap
          </Button>
        </div>
        {field('b', b, toU.id, (id) =>
          onSettings({ category: cat.id, from: fromU.id, to: id }),
        )}
        {a && b && (
          <p className="mt-2 text-center text-[12.5px] text-(--u-ink-3)">
            1 {fromU.symbol} = {show(convert(cat.id, fromU.id, toU.id, 1))}{' '}
            {toU.symbol}
          </p>
        )}
      </div>
    </div>
  )
}
