import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getTodayBrief, type DailyBrief } from '@/integrations/daily-brief'
import { listEvents } from '@/integrations/schedule/client'
import type { ScheduleEvent } from '@/integrations/schedule/types'
import { weatherCodeToGlyph, weatherCodeToLabel } from '@/integrations/weather/weatherClient'
import { buildStories, parseRawItems } from '@/features/news-brief/NewsBriefView'
import { openApp } from '@/os/kernel/shell'
import { useProfile } from '@/os/kernel/profile'
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

/** A glass sub-card: the same family as the popups. */
function Card({ title, action, onAction, children, className = '' }: { title?: string; action?: string; onAction?: () => void; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col rounded-[22px] bg-white/[0.08] p-4 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between">
          <h3 className="pop-label">{title}</h3>
          {action && (
            <button type="button" onClick={onAction} className="pop-btn" style={{ height: 24, fontSize: 11.5 }}>
              {action} <ChevronRightIcon width={11} height={11} />
            </button>
          )}
        </header>
      )}
      {children}
    </section>
  )
}

/** Minutes since midnight for "HH:mm". */
const minutes = (hm?: string) => (hm ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : 0)

/**
 * MY DAY: one calm screen that fits the Start card exactly (no clipping, nothing to scroll).
 *
 *   top      a greeting, the date and a one-line summary
 *   middle   Today as a timeline on the left (with a marker for "now"); the weather on the right
 *   bottom   the news brief as a slim strip of headlines
 * In the Work profile the timeline shows Work events only (the calendar itself is untouched).
 */
export function MyDay({ user, onClose }: { user: string; onClose: () => void }) {
  const now = new Date()
  const profile = useProfile()
  const { weather, error } = useWeather()
  const all = useAgenda()
  const events = useMemo(() => (all && profile === 'work' ? all.filter((e) => e.category === 'work') : all), [all, profile])
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
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const upcoming = events?.filter((e) => !e.allDay && e.status !== 'done' && (e.endTime ?? e.startTime ?? '') >= nowHm) ?? []
  const summary =
    events === null ? '' : events.length === 0 ? 'Nothing scheduled today' : upcoming.length ? `${upcoming.length} still to come · next at ${upcoming[0].startTime ?? 'today'}` : `${events.length} ${events.length === 1 ? 'event' : 'events'} today, all done`
  const firstFuture = events ? events.findIndex((x) => !x.allDay && x.startTime !== undefined && minutes(x.startTime) > nowMin) : -1

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-7 pb-4">
      {/* greeting */}
      <div className="shrink-0">
        <p className="text-[28px] font-extralight leading-tight tracking-tight">
          {greeting(now.getHours())}
          {user ? `, ${user}` : ''}
        </p>
        <p className="mt-0.5 text-[12.5px] text-(--u-ink-2)">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          {profile === 'work' ? ' · Work' : ''}
          {summary && ` · ${summary}`}
        </p>
      </div>

      {/* today + weather */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_246px] gap-3">
        <Card title="Today" action="Calendar" onAction={open(() => void openApp('calendar'))} className="min-h-0 overflow-hidden">
          <div className="pop-scroll -mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
            {events === null ? (
              <p className="text-[13px] text-(--u-ink-3)">Loading…</p>
            ) : events.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[18px]">✓</span>
                <p className="text-[14px] font-medium">A clear day</p>
                <p className="text-[12px] text-(--u-ink-3)">{profile === 'work' ? 'No Work events on your calendar.' : 'No events on your calendar.'}</p>
              </div>
            ) : (
              <ol className="relative flex flex-col pl-3">
                <span aria-hidden className="absolute bottom-1 left-[3px] top-1 w-px bg-white/15" />
                {events.map((e, i) => {
                  const past = !e.allDay && e.endTime !== undefined && e.endTime < nowHm
                  const isNow = !e.allDay && e.startTime !== undefined && minutes(e.startTime) <= nowMin && (e.endTime === undefined || minutes(e.endTime) > nowMin)
                  return (
                    <li key={e.id}>
                      {i === firstFuture && !isNow && (
                        <div className="relative my-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-[#ff6b61]">
                          <span aria-hidden className="absolute -left-[13px] h-[7px] w-[7px] rounded-full bg-[#ff6b61]" />
                          Now · {nowHm}
                          <span className="h-px flex-1 bg-[#ff6b61]/40" />
                        </div>
                      )}
                      <div className={`flex items-start gap-3 rounded-[12px] px-2.5 py-2 ${isNow ? 'bg-white/[0.1]' : ''} ${past || e.status === 'done' ? 'opacity-45' : ''}`}>
                        <span className="w-[60px] shrink-0 pt-px text-[12px] tabular-nums text-(--u-ink-2)">{e.allDay || !e.startTime ? 'All day' : e.startTime}</span>
                        <span aria-hidden className="mt-0.5 h-7 w-[3px] shrink-0 rounded-full" style={{ background: CATEGORY_COLOUR[e.category] }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{e.title}</span>
                          <span className="block truncate text-[11.5px] text-(--u-ink-3)">{isNow ? 'Happening now' : e.endTime && e.startTime ? `${e.startTime} to ${e.endTime}` : e.description || e.category}</span>
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </Card>

        <Card title={weather?.place ?? 'Weather'} className="min-h-0 overflow-hidden">
          {weather ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-3">
                <span className="text-[32px] leading-none">{weatherCodeToGlyph(weather.code)}</span>
                <div>
                  <p className="text-[34px] font-extralight leading-none tabular-nums">{weather.temp}°</p>
                  <p className="mt-0.5 text-[11.5px] text-(--u-ink-2)">{weatherCodeToLabel(weather.code)}</p>
                </div>
              </div>
              <p className="mt-1.5 text-[11.5px] tabular-nums text-(--u-ink-3)">H {weather.high}° · L {weather.low}° · feels {weather.feels}°</p>
              <div className="mt-2 grid grid-cols-5 gap-0.5 border-t border-white/10 pt-2 text-center">
                {weather.hours.slice(0, 5).map((h) => (
                  <div key={h.time} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-(--u-ink-3)">{h.time?.slice(11, 13)}h</span>
                    <span className="text-[14px]">{weatherCodeToGlyph(h.code)}</span>
                    <span className="text-[11.5px] tabular-nums">{h.temp}°</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-5 gap-0.5 border-t border-white/10 pt-2 text-center">
                {weather.days.slice(0, 5).map((d) => (
                  <div key={d.date} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-(--u-ink-3)">{new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                    <span className="text-[14px]">{weatherCodeToGlyph(d.code)}</span>
                    <span className="text-[11px] tabular-nums">{d.high}°<span className="text-(--u-ink-3)"> {d.low}°</span></span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-(--u-ink-3)">{error ? 'Weather is unavailable right now.' : 'Getting the forecast…'}</p>
          )}
        </Card>
      </div>

      {/* news: a slim strip of headlines */}
      <button type="button" onClick={open(() => void openApp('news-brief'))} className="flex h-[74px] shrink-0 items-stretch gap-4 rounded-[22px] bg-white/[0.08] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.12]">
        <span className="flex w-[84px] shrink-0 flex-col justify-center gap-1.5">
          <AppIcon appId="news-brief" size={26} />
          <span className="pop-label">News brief</span>
        </span>
        {stories.length === 0 ? (
          <span className="flex flex-1 items-center text-[12.5px] text-(--u-ink-3)">{brief === undefined ? 'Loading…' : brief?.degraded ? "Today's brief couldn't be written. Open News to retry." : "Today's brief hasn't been written yet. It's generated in the background each morning."}</span>
        ) : (
          stories.slice(0, 3).map((s) => (
            <span key={s.headline} className="flex min-w-0 flex-1 flex-col justify-center border-l border-white/10 pl-4">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-(--u-accent,#3072f0)">{s.section}</span>
              <span className="mt-0.5 line-clamp-2 text-[12.5px] font-medium leading-snug">{s.headline}</span>
            </span>
          ))
        )}
      </button>
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
