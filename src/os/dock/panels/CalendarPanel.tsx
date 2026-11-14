import { useEffect, useMemo, useState } from 'react'
import { listEvents } from '@/integrations/schedule/client'
import type { ScheduleEvent } from '@/integrations/schedule/types'
import { CATEGORY_COLOUR } from '@/os/launcher/MyDay'
import { openApp } from '@/os/kernel/shell'
import { Button } from '@/os/ui/controls'
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
  const dayEvents = [...(byDay.get(picked) ?? [])].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const pickedDate = new Date(`${picked}T12:00`)
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))
  const todayKey = iso(today)

  return (
    <div className="flex flex-col">
      <div className="px-4 pb-3 pt-4">
        <p className="u-label">{today.toLocaleDateString(undefined, { weekday: 'long' })}</p>
        <p className="mt-0.5 text-[22px] font-light tracking-tight">{today.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      <div className="border-t border-(--u-edge) px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between pl-1">
          <span className="text-[13.5px] font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          <span className="flex gap-0.5">
            {[
              { l: 'Previous month', d: 'M15 6l-6 6 6 6', n: -1 },
              { l: 'Next month', d: 'M9 6l6 6-6 6', n: 1 },
            ].map((b) => (
              <Button key={b.n} icon aria-label={b.l} onClick={() => shift(b.n)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={b.d} />
                </svg>
              </Button>
            ))}
          </span>
        </div>
        <div className="grid grid-cols-7 text-center">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
            <span key={d} className="pb-1 text-[11px] font-semibold text-(--u-ink-3)">
              {d}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`l${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const key = iso(new Date(month.getFullYear(), month.getMonth(), i + 1))
            const isToday = key === todayKey
            const has = byDay.get(key)
            return (
              <Button
                key={key}
                pill
                icon
                variant={isToday ? 'accent' : 'ghost'}
                data-on={!isToday && key === picked ? 'true' : undefined}
                onClick={() => setPicked(key)}
                className={cn('mx-auto h-9 w-9 text-[13px] tabular-nums', !isToday && 'text-(--u-ink)')}
              >
                {i + 1}
                {has && <span className={cn('absolute bottom-1 h-1 w-1 rounded-full', isToday ? 'bg-white' : 'bg-(--u-accent)')} />}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-(--u-edge) px-4 py-3">
        <p className="u-label mb-2">{picked === todayKey ? 'Today' : pickedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        {dayEvents.length === 0 ? (
          <p className="py-1 text-[13px] text-(--u-ink-3)">No events</p>
        ) : (
          <ol className="u-scroll flex max-h-[180px] flex-col gap-1.5 overflow-y-auto">
            {dayEvents.map((e) => (
              <li key={e.id} className="u-surface--card flex items-center gap-3 px-3 py-2">
                <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: CATEGORY_COLOUR[e.category] }} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[13px] font-medium', e.status === 'done' && 'line-through opacity-60')}>{e.title}</span>
                  <span className="block text-[11.5px] tabular-nums text-(--u-ink-3)">{e.allDay || !e.startTime ? 'All day' : `${e.startTime}${e.endTime ? ` – ${e.endTime}` : ''}`}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-(--u-edge) p-2">
        <Button
          variant="tinted"
          className="w-full"
          onClick={() => {
            onClose()
            void openApp('calendar')
          }}
        >
          Open Calendar
        </Button>
      </div>
    </div>
  )
}
