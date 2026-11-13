import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getTodayBrief, type DailyBrief } from '@/integrations/daily-brief'
import { listEvents } from '@/integrations/schedule/client'
import type { ScheduleEvent } from '@/integrations/schedule/types'
import { weatherCodeToGlyph, weatherCodeToLabel } from '@/integrations/weather/weatherClient'
import { buildStories, parseRawItems } from '@/features/news-brief/NewsBriefView'
import { openApp } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { ChevronRightIcon } from '@/shared/icons'

interface Weather {
  place: string
  temp: number
  feels: number
  code: number
  high: number
  low: number
  rainChance: number
  hours: { time: string; temp: number; code: number }[]
  days: { date: string; high: number; low: number; code: number }[]
}

const CACHE_KEY = 'myday.weather'
const PLACE_KEY = 'myday.place'

/** Where the device is; the last good fix is remembered so the card fills instantly next time. */
async function locate(): Promise<{ lat: number; lon: number; label: string }> {
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, maximumAge: 60 * 60 * 1000 }),
    )
    const place = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Your location' }
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify(place))
    } catch {
      /* storage unavailable */
    }
    return place
  } catch {
    try {
      const saved = localStorage.getItem(PLACE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {
      /* storage unavailable */
    }
    // No location service: the time zone is the best honest guess.
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Johannesburg') return { lat: -26.2, lon: 28.05, label: 'Johannesburg' }
    throw new Error('Location unavailable')
  }
}

async function fetchWeather(): Promise<Weather> {
  const at = await locate()
  const params = new URLSearchParams({
    latitude: String(at.lat),
    longitude: String(at.lon),
    current: 'temperature_2m,apparent_temperature,weather_code',
    hourly: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '6',
    timezone: 'auto',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error('Weather request failed')
  const d = await res.json()
  const nowIso = (d.current.time as string).slice(0, 13)
  const start = Math.max(0, (d.hourly.time as string[]).findIndex((t) => t.slice(0, 13) === nowIso))
  return {
    place: at.label,
    temp: Math.round(d.current.temperature_2m),
    feels: Math.round(d.current.apparent_temperature),
    code: d.current.weather_code,
    high: Math.round(d.daily.temperature_2m_max[0]),
    low: Math.round(d.daily.temperature_2m_min[0]),
    rainChance: Math.round(d.daily.precipitation_probability_max?.[0] ?? 0),
    hours: [1, 2, 3, 4, 5, 6].map((k) => ({
      time: d.hourly.time[start + k * 2],
      temp: Math.round(d.hourly.temperature_2m[start + k * 2]),
      code: d.hourly.weather_code[start + k * 2],
    })),
    days: (d.daily.time as string[]).slice(1).map((date, i) => ({
      date,
      high: Math.round(d.daily.temperature_2m_max[i + 1]),
      low: Math.round(d.daily.temperature_2m_min[i + 1]),
      code: d.daily.weather_code[i + 1],
    })),
  }
}

export function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      return raw ? (JSON.parse(raw) as Weather) : null
    } catch {
      return null
    }
  })
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    void fetchWeather().then(
      (w) => {
        if (cancelled) return
        setWeather(w)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(w))
        } catch {
          /* storage unavailable */
        }
      },
      () => !cancelled && setError(true),
    )
    return () => {
      cancelled = true
    }
  }, [])
  return { weather, error }
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function useAgenda() {
  const [events, setEvents] = useState<ScheduleEvent[] | null>(null)
  useEffect(() => {
    const today = localDate()
    void listEvents().then(
      (all) => setEvents(all.filter((e) => e.date === today).sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))),
      () => setEvents([]),
    )
  }, [])
  return events
}

function useBrief() {
  const [brief, setBrief] = useState<DailyBrief | null | undefined>(undefined)
  useEffect(() => {
    void getTodayBrief().then(setBrief, () => setBrief(null))
  }, [])
  return brief
}

function greeting(h: number) {
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Card({ title, action, onAction, children, className = '' }: { title: string; action?: string; onAction?: () => void; children: ReactNode; className?: string }) {
  return (
    <section className={`flex shrink-0 flex-col rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-4 ${className}`}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-(--os-text-dim)">{title}</h3>
        {action && (
          <button type="button" onClick={onAction} className="flex items-center gap-0.5 rounded-[6px] px-2 py-0.5 text-[12px] text-(--os-text-dim) hover:bg-(--os-hover) hover:text-(--os-text)">
            {action}
            <ChevronRightIcon width={12} height={12} />
          </button>
        )}
      </header>
      {children}
    </section>
  )
}

export function MyDay({ user, onClose }: { user: string; onClose: () => void }) {
  const now = new Date()
  const { weather, error } = useWeather()
  const events = useAgenda()
  const brief = useBrief()
  const stories = useMemo(() => {
    if (!brief) return []
    const { sections } = buildStories(brief, parseRawItems(brief.raw_items_json))
    // One lead story per section first, then second stories, until six.
    const out = []
    for (let round = 0; out.length < 6 && round < 3; round++) for (const s of sections) if (s.stories[round] && out.length < 6) out.push(s.stories[round])
    return out
  }, [brief])
  const open = (fn: () => void) => () => {
    onClose()
    fn()
  }
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-5">
      <div className="pb-1">
        <p className="text-[24px] font-semibold tracking-tight">
          {greeting(now.getHours())}
          {user ? `, ${user}` : ''}
        </p>
        <p className="text-[13px] text-(--os-text-dim)">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          {events && ` · ${events.length === 0 ? 'Nothing scheduled' : `${events.length} ${events.length === 1 ? 'event' : 'events'} today`}`}
        </p>
      </div>

      <div className="grid grid-cols-[1.15fr_1fr] gap-3">
        <Card title={weather?.place ?? 'Weather'}>
          {weather ? (
            <>
              <div className="flex items-center gap-4">
                <span className="text-[44px] leading-none">{weatherCodeToGlyph(weather.code)}</span>
                <div>
                  <p className="text-[34px] font-light leading-none tabular-nums">{weather.temp}°</p>
                  <p className="mt-1 text-[12.5px] text-(--os-text-dim)">
                    {weatherCodeToLabel(weather.code)} · feels {weather.feels}°
                  </p>
                </div>
                <div className="ml-auto text-right text-[12.5px] tabular-nums text-(--os-text-dim)">
                  <p>
                    H {weather.high}° · L {weather.low}°
                  </p>
                  <p>{weather.rainChance}% rain</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-6 gap-1 border-t border-[var(--border-hairline)] pt-3 text-center">
                {weather.hours.map((h) => (
                  <div key={h.time} className="flex flex-col items-center gap-1">
                    <span className="text-[11px] text-(--os-text-dim)">{h.time?.slice(11, 16)}</span>
                    <span className="text-[16px]">{weatherCodeToGlyph(h.code)}</span>
                    <span className="text-[12.5px] tabular-nums">{h.temp}°</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between border-t border-[var(--border-hairline)] pt-3">
                {weather.days.map((d) => (
                  <div key={d.date} className="flex flex-col items-center gap-0.5 text-[12px] tabular-nums">
                    <span className="text-[11px] text-(--os-text-dim)">{new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                    <span className="text-[15px]">{weatherCodeToGlyph(d.code)}</span>
                    <span>
                      {d.high}° <span className="text-(--os-text-dim)">{d.low}°</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-(--os-text-dim)">{error ? 'Weather is unavailable right now.' : 'Getting the forecast…'}</p>
          )}
        </Card>

        <Card title="Today" action="Calendar" onAction={open(() => void openApp('calendar'))}>
          {events === null ? (
            <p className="text-[13px] text-(--os-text-dim)">Loading…</p>
          ) : events.length === 0 ? (
            <div className="flex flex-1 flex-col items-start justify-center gap-2">
              <p className="text-[14px]">A clear day.</p>
              <p className="text-[12.5px] text-(--os-text-dim)">No events on your calendar.</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-1.5 overflow-y-auto">
              {events.slice(0, 6).map((e) => {
                const past = !e.allDay && e.endTime !== undefined && e.endTime < nowHm
                return (
                  <li key={e.id} className={`flex items-start gap-3 rounded-[8px] bg-[var(--surface-raised)] px-3 py-2 ${past || e.status === 'done' ? 'opacity-50' : ''}`}>
                    <span className="mt-[3px] h-8 w-[3px] shrink-0 rounded-full" style={{ background: CATEGORY_COLOUR[e.category] }} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{e.title}</span>
                      <span className="block text-[11.5px] tabular-nums text-(--os-text-dim)">{e.allDay || !e.startTime ? 'All day' : `${e.startTime}${e.endTime ? ` – ${e.endTime}` : ''}`}</span>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Your news brief" action="Open News" onAction={open(() => void openApp('news-brief'))}>
        {brief === undefined ? (
          <p className="text-[13px] text-(--os-text-dim)">Loading…</p>
        ) : stories.length === 0 ? (
          <div className="flex items-center gap-3">
            <AppIcon appId="news-brief" size={32} />
            <p className="text-[13px] text-(--os-text-dim)">{brief?.degraded ? "Today's brief couldn't be written — open News to retry." : "Today's brief hasn't been written yet. It's generated in the background each morning."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[1.1fr_1fr] gap-4">
            {stories[0] && (
              <button type="button" onClick={open(() => void openApp('news-brief'))} className="group flex flex-col overflow-hidden rounded-[10px] bg-[var(--surface-raised)] text-left transition-colors hover:bg-(--os-hover)">
                {stories[0].image ? (
                  <img src={stories[0].image} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-[16/9] w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                ) : (
                  <div className="aspect-[16/9] w-full bg-gradient-to-br from-[#2a3550] to-[#1b1c20]" />
                )}
                <span className="block p-3">
                  <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">{stories[0].section}</span>
                  <span className="mt-1 line-clamp-2 block text-[15px] font-semibold leading-snug">{stories[0].headline}</span>
                  {stories[0].body[0] && <span className="mt-1.5 line-clamp-3 block text-[12.5px] leading-snug text-(--os-text-dim)">{stories[0].body[0].replace(/\*/g, '')}</span>}
                </span>
              </button>
            )}
            <div className="flex min-w-0 flex-col divide-y divide-[var(--border-hairline)]">
              {stories.slice(1, 5).map((s) => (
                <button key={s.headline} type="button" onClick={open(() => void openApp('news-brief'))} className="flex min-w-0 gap-3 py-2.5 text-left first:pt-0 hover:opacity-80">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">{s.section}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] font-medium leading-snug">{s.headline}</span>
                  </span>
                  {s.image && <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-[52px] w-[70px] shrink-0 rounded-[6px] object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

export const CATEGORY_COLOUR: Record<ScheduleEvent['category'], string> = {
  school: '#5ac8fa',
  work: '#4f8cff',
  creativity: '#bf5af2',
  general: '#8e8e93',
  personal: '#34c759',
}
