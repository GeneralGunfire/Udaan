import { useEffect, useMemo, useState } from 'react'
import { listEvents } from '@/integrations/schedule/client'
import type { ScheduleEvent } from '@/integrations/schedule/types'
import { CATEGORY_COLOUR } from '@/os/launcher/MyDay'
import { openApp } from '@/os/kernel/shell'
import { cn } from '@/shared/lib/cn'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The menu bar clock's popup: a month you can page through, and the chosen day's events from Udaan Calendar. */
export function CalendarPanel({ onClose }: { onClose: () => void }) {
  const today = useMemo(() => new Date(), [])
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [picked, setPicked] = useState(() => iso(today))
  const [events, setEvents] = useState<ScheduleEvent[]>([])

  useEffect(() => {
    void listEvents().then(setEvents, () => setEvents([]))
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>()
    for (const e of events) if (e.date) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return map
  }, [events])

  const lead = (month.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const dayEvents = (byDay.get(picked) ?? []).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const pickedDate = new Date(`${picked}T12:00`)
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div className="flex flex-col text-(--os-text)">
      <div className="px-4 pb-3 pt-4">
        <p className="text-[12px] font-medium text-(--os-text-dim)">{today.toLocaleDateString(undefined, { weekday: 'long' })}</p>
        <p className="text-[20px] font-semibold tracking-tight">{today.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <div className="border-t border-[var(--border-hairline)] px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[13.5px] font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          <span className="flex gap-1">
            {[
              { l: 'Previous month', d: 'M15 6l-6 6 6 6', n: -1 },
              { l: 'Next month', d: 'M9 6l6 6-6 6', n: 1 },
            ].map((b) => (
              <button key={b.n} type="button" aria-label={b.l} onClick={() => shift(b.n)} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-(--os-hover)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={b.d} />
                </svg>
              </button>
            ))}
          </span>
        </div>
        <div className="grid grid-cols-7 text-center">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
            <span key={d} className="pb-1 text-[11px] font-semibold text-(--os-text-dim)">
              {d}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`l${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const key = iso(new Date(month.getFullYear(), month.getMonth(), i + 1))
            const isToday = key === iso(today)
            const has = byDay.get(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPicked(key)}
                className={cn(
                  'relative mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-full text-[13px] tabular-nums transition-colors',
                  isToday ? 'bg-[var(--color-accent)] font-semibold text-white' : key === picked ? 'bg-(--os-hover)' : 'hover:bg-(--os-hover)',
                )}
              >
                {i + 1}
                {has && <span className={cn('absolute bottom-[4px] h-[4px] w-[4px] rounded-full', isToday ? 'bg-white' : 'bg-[var(--color-accent)]')} />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="border-t border-[var(--border-hairline)] px-4 py-3">
        <p className="mb-2 text-[12px] font-semibold text-(--os-text-dim)">{picked === iso(today) ? 'Today' : pickedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        {dayEvents.length === 0 ? (
          <p className="py-1 text-[13px] text-(--os-text-dim)">No events</p>
        ) : (
          <ol className="flex max-h-[180px] flex-col gap-1.5 overflow-y-auto">
            {dayEvents.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-[8px] bg-(--os-hover) px-3 py-2">
                <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: CATEGORY_COLOUR[e.category] }} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[13px] font-medium', e.status === 'done' && 'line-through opacity-60')}>{e.title}</span>
                  <span className="block text-[11.5px] tabular-nums text-(--os-text-dim)">{e.allDay || !e.startTime ? 'All day' : `${e.startTime}${e.endTime ? ` – ${e.endTime}` : ''}`}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          onClose()
          void openApp('calendar')
        }}
        className="flex h-11 items-center justify-center border-t border-[var(--border-hairline)] text-[13px] font-medium text-[var(--color-accent)] hover:bg-(--os-hover)"
      >
        Open Calendar
      </button>
    </div>
  )
}
