import { useMemo } from 'react'
import { cn } from '@/shared/lib/cn'
import { TAG_CONFIG } from '../lib/tags'
import { toISODate, formatTime12h } from '../lib/dateUtils'
import type { CalendarEvent } from '../lib/types'

/**
 * Agenda: what is coming up as one readable list, grouped by day. Overdue things you have not ticked off
 * sit on top, so nothing slips by just because the grid moved on.
 */
export function AgendaView({
  events,
  today,
  onOpen,
  onToggleDone,
  onCreate,
}: {
  events: CalendarEvent[]
  today: Date
  onOpen: (e: CalendarEvent) => void
  onToggleDone: (id: string) => void
  onCreate: () => void
}) {
  const todayIso = toISODate(today)
  const groups = useMemo(() => {
    const horizon = toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 60))
    const lookBack = toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30))
    const overdue = events.filter((e) => e.date < todayIso && e.date >= lookBack && !e.done)
    const upcoming = events.filter((e) => e.date >= todayIso && e.date <= horizon)
    const byDay = new Map<string, CalendarEvent[]>()
    for (const e of upcoming) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
    const sorted = (l: CalendarEvent[]) => [...l].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.time.localeCompare(b.time))
    return {
      overdue: overdue.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
      days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, list]) => ({ date, list: sorted(list) })),
    }
  }, [events, todayIso, today])

  const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00`)
    const diff = Math.round((d.getTime() - new Date(`${todayIso}T12:00`).getTime()) / 86_400_000)
    const base = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    return diff === 0 ? `Today · ${base}` : diff === 1 ? `Tomorrow · ${base}` : base
  }

  const length = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)

  const row = (e: CalendarEvent, overdue = false) => (
    <div key={e.id} className="group flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-(--u-wash-on)">
      <button
        type="button"
        aria-label={e.done ? 'Mark as not done' : 'Mark as done'}
        onClick={() => onToggleDone(e.id)}
        className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_var(--u-ink-3)]', e.done && 'bg-(--u-accent) shadow-none')}
      >
        {e.done && (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 10 17 19 7" />
          </svg>
        )}
      </button>
      <span className={cn('h-8 w-[3px] shrink-0 rounded-full', TAG_CONFIG[e.tag].dot)} />
      <button type="button" onClick={() => onOpen(e)} className="min-w-0 flex-1 text-left">
        <span className={cn('block truncate text-[14px] font-medium', e.done && 'text-(--u-ink-3) line-through')}>{e.title}</span>
        <span className="block truncate text-[12px] text-(--u-ink-3)">
          {overdue && `${new Date(`${e.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · `}
          {e.allDay ? 'All day' : `${formatTime12h(e.time)}${e.durationMinutes ? ` · ${length(e.durationMinutes)}` : ''}`}
          {e.notes ? ` · ${e.notes}` : ''}
        </span>
      </button>
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', TAG_CONFIG[e.tag].chipBg, TAG_CONFIG[e.tag].chipText)}>{TAG_CONFIG[e.tag].label}</span>
    </div>
  )

  const empty = groups.overdue.length === 0 && groups.days.length === 0

  return (
    <div className="u-scroll h-full overflow-y-auto rounded-2xl border border-(--border-hairline) p-3" style={{ background: 'var(--surface-raised)' }}>
      {empty && (
        <div className="flex h-full flex-col items-center justify-center gap-3 py-20 text-center">
          <p className="text-[16px] font-semibold">Nothing coming up</p>
          <p className="max-w-[300px] text-[13px] text-(--u-ink-3)">The next 60 days are clear. Add an event, or press Ctrl+K and type something like &ldquo;dentist thursday 3pm&rdquo;.</p>
          <button type="button" onClick={onCreate} className="rounded-[8px] bg-accent px-4 py-2 text-[13px] font-medium text-accent-contrast hover:brightness-110">
            New event
          </button>
        </div>
      )}
      {groups.overdue.length > 0 && (
        <section className="mb-3">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--u-danger)">Overdue · {groups.overdue.length}</p>
          {groups.overdue.map((e) => row(e, true))}
        </section>
      )}
      {groups.days.map(({ date, list }) => (
        <section key={date} className="mb-3">
          <p className={cn('px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide', date === todayIso ? 'text-accent' : 'text-(--u-ink-3)')}>{dayLabel(date)}</p>
          {list.map((e) => row(e))}
        </section>
      ))}
    </div>
  )
}
