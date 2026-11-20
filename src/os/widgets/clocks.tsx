import { useState } from 'react'
import { usePoll } from '@/os/kernel/poll'
import { Tile, type WidgetOpts } from './widgets'

/**
 * The clock widget and its looks. One widget, several faces: the person picks the face from the
 * widget's right-click menu or from Settings, so adding a clock never means adding another kind.
 *
 * Sizing: every face is drawn against its own container (`cqmin` / `cqw` units), so the same widget
 * stays sharp and in proportion at the small, default and large sizes.
 */

export const CLOCK_STYLES = [
  { id: 'classic', name: 'Classic' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'bold', name: 'Bold' },
  { id: 'rings', name: 'Rings' },
  { id: 'orbit', name: 'Orbit' },
  { id: 'digital', name: 'Digital' },
  { id: 'flip', name: 'Flip' },
  { id: 'words', name: 'Words' },
] as const

export type ClockStyle = (typeof CLOCK_STYLES)[number]['id']

/** Faces drawn with hands; the rest are text. Decides the default for the seconds option. */
export const ANALOG_STYLES: ClockStyle[] = ['classic', 'minimal', 'bold', 'rings', 'orbit']

const INK = 'var(--u-ink)'
const DIM = 'var(--u-ink-3)'
const ACCENT = 'var(--w-accent, var(--color-accent))'

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => new Date())
  usePoll(() => setNow(new Date()), everyMs)
  return now
}

function point(deg: number, r: number, c = 50) {
  const a = (deg * Math.PI) / 180
  return { x: c + r * Math.sin(a), y: c - r * Math.cos(a) }
}

function Hand({ deg, len, width, color, tail = 0 }: { deg: number; len: number; width: number; color: string; tail?: number }) {
  const a = point(deg, len)
  const b = point(deg + 180, tail)
  return <line x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke={color} strokeWidth={width} strokeLinecap="round" />
}

function dateLabel(now: Date) {
  return `${now.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${now.getDate()}`
}

/* ── Analogue faces ────────────────────────────────────────────── */

function Face({ style, now, seconds }: { style: ClockStyle; now: Date; seconds: boolean }) {
  const s = now.getSeconds()
  const m = now.getMinutes() + s / 60
  const h = (now.getHours() % 12) + m / 60

  if (style === 'minimal') {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {Array.from({ length: 60 }, (_, i) => {
          const major = i % 5 === 0
          const a = point(i * 6, 46)
          const b = point(i * 6, major ? 40 : 43.5)
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={major ? INK : DIM} strokeOpacity={major ? 0.9 : 0.5} strokeWidth={major ? 1.2 : 0.5} strokeLinecap="round" />
        })}
        <Hand deg={h * 30} len={24} width={2.4} color={INK} />
        <Hand deg={m * 6} len={36} width={1.6} color={INK} />
        {seconds && <Hand deg={s * 6} len={40} width={0.8} color={ACCENT} tail={8} />}
        <circle cx="50" cy="50" r="2" fill={ACCENT} />
      </svg>
    )
  }

  if (style === 'bold') {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {[12, 3, 6, 9].map((n) => {
          const p = point((n % 12) * 30, 37)
          return (
            <text key={n} x={p.x} y={p.y + 5.6} textAnchor="middle" fontSize="16" fontWeight="700" fill={INK}>
              {n}
            </text>
          )
        })}
        {Array.from({ length: 12 }, (_, i) => {
          if (i % 3 === 0) return null
          const p = point(i * 30, 41)
          return <circle key={i} cx={p.x} cy={p.y} r="1.6" fill={DIM} />
        })}
        <Hand deg={h * 30} len={23} width={5.2} color={INK} />
        <Hand deg={m * 6} len={34} width={3.4} color={INK} />
        {seconds && <Hand deg={s * 6} len={38} width={1.3} color={ACCENT} tail={9} />}
        <circle cx="50" cy="50" r="3.6" fill={ACCENT} />
        <circle cx="50" cy="50" r="1.3" fill="var(--u-surface, #111)" />
      </svg>
    )
  }

  if (style === 'rings') {
    const ring = (r: number, frac: number, color: string, width: number) => {
      const c = 2 * Math.PI * r
      return (
        <g key={r}>
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth={width} />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.001, frac))} transform="rotate(-90 50 50)" />
        </g>
      )
    }
    const hh = now.getHours() % 12 || 12
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {ring(44, h / 12, ACCENT, 5)}
        {ring(35, m / 60, INK, 5)}
        {seconds && ring(26, s / 60, DIM, 5)}
        <text x="50" y="55" textAnchor="middle" fontSize={seconds ? 15 : 22} fontWeight="300" fill={INK} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {hh}:{String(now.getMinutes()).padStart(2, '0')}
        </text>
      </svg>
    )
  }

  if (style === 'orbit') {
    const hour = now.getHours() % 12
    const mp = point(m * 6, 41)
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <circle cx="50" cy="50" r="41" fill="none" stroke={DIM} strokeOpacity="0.25" strokeWidth="0.6" />
        {Array.from({ length: 12 }, (_, i) => {
          const p = point(i * 30, 41)
          const now_ = i === hour
          return <circle key={i} cx={p.x} cy={p.y} r={now_ ? 4.4 : 1.7} fill={now_ ? ACCENT : DIM} fillOpacity={now_ ? 1 : 0.6} />
        })}
        <circle cx={mp.x} cy={mp.y} r="2.6" fill={INK} />
        {seconds && (() => {
          const sp = point(s * 6, 30)
          return <circle cx={sp.x} cy={sp.y} r="1.3" fill={ACCENT} />
        })()}
        <text x="50" y="50" textAnchor="middle" fontSize="7" fontWeight="600" letterSpacing="0.6" fill={DIM}>
          {now.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}
        </text>
        <text x="50" y="63" textAnchor="middle" fontSize="15" fontWeight="300" fill={INK}>
          {now.getDate()}
        </text>
      </svg>
    )
  }

  // classic
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <circle cx="50" cy="50" r="47" fill="none" stroke={DIM} strokeOpacity="0.4" strokeWidth="0.6" />
      {Array.from({ length: 12 }, (_, i) => {
        const p = point((i + 1) * 30, 36)
        return (
          <text key={i} x={p.x} y={p.y + 3.4} textAnchor="middle" fontSize="8.5" fontWeight="500" fill={INK} fillOpacity="0.9">
            {i + 1}
          </text>
        )
      })}
      <text x="50" y="68" textAnchor="middle" fontSize="6" fontWeight="600" letterSpacing="0.4" fill={DIM}>
        {dateLabel(now)}
      </text>
      <Hand deg={h * 30} len={22} width={3.2} color={INK} />
      <Hand deg={m * 6} len={33} width={2.2} color={INK} />
      {seconds && <Hand deg={s * 6} len={36} width={0.9} color={ACCENT} />}
      <circle cx="50" cy="50" r="2" fill={ACCENT} />
    </svg>
  )
}

/* ── Text faces ────────────────────────────────────────────────── */

function parts(now: Date, hour24: boolean) {
  const hours = now.getHours()
  const hh = hour24 ? String(hours).padStart(2, '0') : String(hours % 12 || 12)
  return { hh, mm: String(now.getMinutes()).padStart(2, '0'), ss: String(now.getSeconds()).padStart(2, '0'), pm: hours >= 12 }
}

function DigitalFace({ now, hour24, seconds }: { now: Date; hour24: boolean; seconds: boolean }) {
  const { hh, mm, ss, pm } = parts(now, hour24)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <p className="font-extralight leading-none tabular-nums" style={{ fontSize: '30cqmin', letterSpacing: '-0.02em' }}>
        {hh}
        <span style={{ color: ACCENT }}>:</span>
        {mm}
      </p>
      <p className="mt-[5cqmin] font-medium uppercase tabular-nums" style={{ fontSize: '7.5cqmin', letterSpacing: '0.16em', color: DIM }}>
        {seconds ? `${ss}s` : ''}
        {seconds && !hour24 ? '  ' : ''}
        {!hour24 ? (pm ? 'PM' : 'AM') : ''}
      </p>
      <p className="mt-[3cqmin] font-medium" style={{ fontSize: '8cqmin', color: INK, opacity: 0.8 }}>
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
      </p>
    </div>
  )
}

function FlipCard({ text }: { text: string }) {
  return (
    <span
      className="relative flex items-center justify-center overflow-hidden font-light tabular-nums"
      style={{ width: '20cqmin', height: '32cqmin', fontSize: '24cqmin', borderRadius: '6cqmin', background: 'var(--u-wash-on)', boxShadow: 'inset 0 0 0 1px var(--u-edge)' }}
    >
      {text}
      <span className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'var(--u-edge)', boxShadow: '0 1px 0 rgb(0 0 0 / 25%)' }} />
    </span>
  )
}

function FlipFace({ now, hour24 }: { now: Date; hour24: boolean }) {
  const { hh, mm, pm } = parts(now, hour24)
  const padded = hh.padStart(2, '0')
  return (
    <div className="flex h-full w-full flex-col items-center justify-center" style={{ gap: '5cqmin' }}>
      <div className="flex items-center" style={{ gap: '2.5cqmin' }}>
        <FlipCard text={padded[0]} />
        <FlipCard text={padded[1]} />
        <span style={{ width: '1cqmin' }} />
        <FlipCard text={mm[0]} />
        <FlipCard text={mm[1]} />
      </div>
      {!hour24 && (
        <span className="font-semibold uppercase" style={{ fontSize: '7cqmin', letterSpacing: '0.2em', color: ACCENT }}>
          {pm ? 'PM' : 'AM'}
        </span>
      )}
    </div>
  )
}

const HOUR_WORDS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven']
const MINUTE_WORDS: Record<number, string> = { 5: 'five past', 10: 'ten past', 15: 'quarter past', 20: 'twenty past', 25: 'twenty-five past', 30: 'half past', 35: 'twenty-five to', 40: 'twenty to', 45: 'quarter to', 50: 'ten to', 55: 'five to' }

export function timeInWords(now: Date): { lead: string; hour: string } {
  const rounded = Math.round(now.getMinutes() / 5) * 5
  const toNext = rounded > 30 && rounded < 60
  const hourIndex = (now.getHours() + (toNext || rounded === 60 ? 1 : 0)) % 12
  if (rounded === 0 || rounded === 60) return { lead: '', hour: `${HOUR_WORDS[hourIndex]} o'clock` }
  return { lead: MINUTE_WORDS[rounded], hour: HOUR_WORDS[hourIndex] }
}

function WordsFace({ now }: { now: Date }) {
  const { lead, hour } = timeInWords(now)
  return (
    <div className="flex h-full w-full flex-col items-start justify-center" style={{ paddingInline: '8cqmin' }}>
      <p className="font-medium uppercase" style={{ fontSize: '6.5cqmin', letterSpacing: '0.2em', color: DIM }}>
        It is
      </p>
      {lead && (
        <p className="font-light leading-tight" style={{ fontSize: '12cqmin', color: DIM }}>
          {lead}
        </p>
      )}
      <p className="font-semibold leading-tight" style={{ fontSize: '14cqmin', color: INK }}>
        {hour}
      </p>
      <span className="mt-[5cqmin] block h-[0.8cqmin] w-[14cqmin] rounded-full" style={{ background: ACCENT }} />
      <p className="mt-[4cqmin] font-medium" style={{ fontSize: '6.5cqmin', color: DIM }}>
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
    </div>
  )
}

/* ── The widget ────────────────────────────────────────────────── */

export function ClockWidget({ opts }: { opts?: WidgetOpts }) {
  const style = (CLOCK_STYLES.find((c) => c.id === opts?.style)?.id ?? 'classic') as ClockStyle
  const analog = ANALOG_STYLES.includes(style)
  const seconds = opts?.seconds ?? analog
  const hour24 = opts?.hour24 ?? false
  const now = useNow(seconds || style === 'flip' ? 1000 : 15_000)
  return (
    <Tile className="!p-0">
      <div className="h-full w-full" style={{ containerType: 'size', padding: analog ? '4%' : 0 }}>
        {analog && <Face style={style} now={now} seconds={seconds} />}
        {style === 'digital' && <DigitalFace now={now} hour24={hour24} seconds={seconds} />}
        {style === 'flip' && <FlipFace now={now} hour24={hour24} />}
        {style === 'words' && <WordsFace now={now} />}
      </div>
    </Tile>
  )
}
