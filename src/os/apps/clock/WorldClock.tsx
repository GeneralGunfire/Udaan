import { useMemo, useState } from 'react'
import { usePref } from '@/os/kernel/prefs'
import { Button } from '@/os/ui/controls'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { cn } from '@/shared/lib/cn'
import {
  CITIES,
  cityByName,
  dayRelation,
  offsetLabel,
  wallTime,
} from './cities'
import { KEYS, loadCities, saveCities } from './store'
import {
  Dialog,
  Empty,
  Ico,
  P,
  PaneHeader,
  fmtClock,
  useKeys,
  useNow,
  useStored,
} from './ui'

/** A quiet analogue face: ticks, two hands and a thin seconds hand. */
function Face({ date, size = 168 }: { date: Date; size?: number }) {
  const h = date.getHours() % 12
  const m = date.getMinutes()
  const s = date.getSeconds()
  const hand = (deg: number, len: number, w: number, color: string) => (
    <line
      x1="50"
      y1="50"
      x2="50"
      y2={50 - len}
      stroke={color}
      strokeWidth={w}
      strokeLinecap="round"
      transform={`rotate(${deg} 50 50)`}
    />
  )
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Local time ${date.toLocaleTimeString()}`}
    >
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="var(--u-wash-hover)"
        stroke="var(--u-edge)"
        strokeWidth="0.8"
      />
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1="50"
          y1={i % 5 ? 6 : 5}
          x2="50"
          y2={i % 5 ? 8 : 10}
          stroke={i % 5 ? 'var(--u-ink-3)' : 'var(--u-ink-2)'}
          strokeWidth={i % 5 ? 0.6 : 1.4}
          strokeLinecap="round"
          transform={`rotate(${i * 6} 50 50)`}
        />
      ))}
      {hand((h + m / 60) * 30, 24, 3.2, 'var(--u-ink)')}
      {hand((m + s / 60) * 6, 35, 2.2, 'var(--u-ink)')}
      {hand(s * 6, 38, 0.9, 'var(--u-accent)')}
      <circle cx="50" cy="50" r="2.2" fill="var(--u-accent)" />
    </svg>
  )
}

export function WorldClock() {
  const now = useNow(1000)
  const [clock24] = usePref('menubar.clock24')
  const [cities, setCities] = useStored<string[]>(
    KEYS.cities,
    loadCities,
    saveCities,
  )
  const [adding, setAdding] = useState(false)
  const openMenu = useShellMenu()
  const [sel, setSel] = useState<string | null>(null)
  const date = new Date(now)
  const local = fmtClock(date.getHours(), date.getMinutes(), clock24)
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const move = (name: string, by: -1 | 1) => {
    const i = cities.indexOf(name)
    const j = i + by
    if (i < 0 || j < 0 || j >= cities.length) return
    const next = [...cities]
    ;[next[i], next[j]] = [next[j], next[i]]
    setCities(next)
  }
  const remove = (name: string) => {
    const i = cities.indexOf(name)
    const next = cities.filter((c) => c !== name)
    setCities(next)
    setSel(next[Math.min(i, next.length - 1)] ?? null)
  }

  useKeys((e) => {
    if (e.key === 'n' || e.key === 'N') (e.preventDefault(), setAdding(true))
    else if (e.key === 'Delete' && sel) (e.preventDefault(), remove(sel))
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="World Clock">
        <Button
          size="sm"
          variant="tinted"
          onClick={() => setAdding(true)}
          title="Add a city (N)"
        >
          <Ico d={P.plus} size={13} /> Add city
        </Button>
      </PaneHeader>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto">
        <section className="flex items-center gap-8 px-8 py-7">
          <Face date={date} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-(--u-ink-3)">
              Local time
            </p>
            <p className="mt-1 leading-none font-semibold tracking-tight tabular-nums">
              <span className="text-[52px]">{local.time}</span>
              <span className="ml-1 text-[22px] text-(--u-ink-2)">{`:${String(date.getSeconds()).padStart(2, '0')}`}</span>
              {local.suffix && (
                <span className="ml-2 text-[18px] text-(--u-ink-2)">
                  {local.suffix}
                </span>
              )}
            </p>
            <p className="mt-2 text-[13px] text-(--u-ink-2)">
              {date.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <p className="text-[12px] text-(--u-ink-3)">
              {localZone.replace(/_/g, ' ')}
            </p>
          </div>
        </section>
        <div className="px-3 pb-4">
          {cities.length === 0 && (
            <Empty>
              Add the cities you keep in touch with to see their time at a
              glance.
            </Empty>
          )}
          {cities.map((name, i) => {
            const c = cityByName(name)
            if (!c) return null
            const w = wallTime(c.zone, date)
            const t = fmtClock(w.getHours(), w.getMinutes(), clock24)
            const day = w.getHours() >= 6 && w.getHours() < 18
            return (
              <div
                key={name}
                role="group"
                tabIndex={0}
                aria-label={`${c.name}, ${t.time} ${t.suffix}`}
                data-sel={sel === name}
                onClick={() => setSel(name)}
                onFocus={() => setSel(name)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setSel(name)
                  openMenu(e, [
                    { header: true, label: c.name },
                    { label: 'Copy time', icon: 'copy', onSelect: () => void navigator.clipboard.writeText(`${c.name}: ${t.time}${t.suffix ? ` ${t.suffix}` : ''}`).catch(() => {}) },
                    {},
                    { label: 'Move up', disabled: i === 0, onSelect: () => move(name, -1) },
                    { label: 'Move down', disabled: i === cities.length - 1, onSelect: () => move(name, 1) },
                    {},
                    { label: 'Remove', icon: 'trash', shortcut: 'Del', danger: true, onSelect: () => remove(name) },
                  ])
                }}
                className={cn(
                  'group mb-px flex items-center gap-4 rounded-[10px] px-4 py-3 outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
                  sel === name
                    ? 'bg-(--u-wash-on)'
                    : 'hover:bg-(--u-wash-hover)',
                )}
              >
                <span
                  title={day ? 'Daytime' : 'Night-time'}
                  aria-label={day ? 'Daytime' : 'Night-time'}
                  className="text-(--u-ink-3)"
                >
                  <Ico d={day ? P.sun : P.moon} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {c.name}
                  </span>
                  <span className="block truncate text-[12px] text-(--u-ink-3)">
                    {dayRelation(c.zone, date)}, {offsetLabel(c.zone, date)}
                  </span>
                </span>
                <span className="text-right font-semibold tabular-nums">
                  <span className="text-[24px] tracking-tight">{t.time}</span>
                  {t.suffix && (
                    <span className="ml-1 text-[12px] text-(--u-ink-2)">
                      {t.suffix}
                    </span>
                  )}
                </span>
                <span className="flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 group-data-[sel=true]:opacity-100">
                  <Button
                    icon
                    size="sm"
                    aria-label={`Move ${c.name} up`}
                    disabled={i === 0}
                    onClick={(e) => (e.stopPropagation(), move(name, -1))}
                  >
                    <Ico d={P.up} size={13} />
                  </Button>
                  <Button
                    icon
                    size="sm"
                    aria-label={`Move ${c.name} down`}
                    disabled={i === cities.length - 1}
                    onClick={(e) => (e.stopPropagation(), move(name, 1))}
                  >
                    <Ico d={P.down} size={13} />
                  </Button>
                  <Button
                    icon
                    size="sm"
                    aria-label={`Remove ${c.name}`}
                    title="Remove (Del)"
                    className="hover:text-(--u-danger)"
                    onClick={(e) => (e.stopPropagation(), remove(name))}
                  >
                    <Ico d={P.trash} size={13} />
                  </Button>
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {adding && (
        <AddCity
          existing={cities}
          onClose={() => setAdding(false)}
          onAdd={(n) => (
            setCities([...cities, n]),
            setSel(n),
            setAdding(false)
          )}
        />
      )}
    </div>
  )
}

function AddCity({
  existing,
  onAdd,
  onClose,
}: {
  existing: string[]
  onAdd: (name: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return CITIES.filter(
      (c) =>
        !existing.includes(c.name) &&
        (!s ||
          c.name.toLowerCase().includes(s) ||
          c.country.toLowerCase().includes(s) ||
          c.zone.toLowerCase().includes(s)),
    )
  }, [q, existing])
  const now = new Date()
  return (
    <Dialog title="Add a city" onClose={onClose} width={440}>
      <label className="flex h-9 items-center gap-2 rounded-[8px] bg-(--u-wash-hover) px-2.5 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
        <Ico d={P.search} size={13} className="text-(--u-ink-3)" />
        <input
          value={q}
          onChange={(e) => (setQ(e.target.value), setHi(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown')
              (e.preventDefault(),
                setHi((h) => Math.min(list.length - 1, h + 1)))
            else if (e.key === 'ArrowUp')
              (e.preventDefault(), setHi((h) => Math.max(0, h - 1)))
            else if (e.key === 'Enter' && list[hi])
              (e.preventDefault(), onAdd(list[hi].name))
          }}
          placeholder="Search for a city or country"
          aria-label="Search cities"
          aria-controls="clock-city-list"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-(--u-ink-3)"
        />
      </label>
      <div
        id="clock-city-list"
        role="listbox"
        aria-label="Cities"
        className="u-scroll mt-3 h-[320px] overflow-y-auto"
      >
        {list.length === 0 && <Empty>No city matches.</Empty>}
        {list.map((c, i) => (
          <button
            key={c.name}
            type="button"
            role="option"
            aria-selected={i === hi}
            tabIndex={-1}
            onMouseEnter={() => setHi(i)}
            onClick={() => onAdd(c.name)}
            ref={(el) => {
              if (i === hi && el) el.scrollIntoView({ block: 'nearest' })
            }}
            className={cn(
              'mb-px flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left',
              i === hi ? 'bg-(--u-wash-on)' : '',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {c.name}
              </span>
              <span className="block truncate text-[11.5px] text-(--u-ink-3)">
                {c.country}
              </span>
            </span>
            <span className="text-[11.5px] text-(--u-ink-3)">
              {offsetLabel(c.zone, now)}
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
