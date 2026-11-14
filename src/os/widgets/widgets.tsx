import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { weatherCodeToGlyph, weatherCodeToLabel } from '@/integrations/weather/weatherClient'
import { CATEGORY_COLOUR, useAgenda, useWeather } from '@/os/launcher/MyDay'
import { mediaCommand, sourceName, type NowPlaying } from '@/os/dock/panels/MediaPanel'
import { getPref, setPref, usePref } from '@/os/kernel/prefs'
import { usePoll } from '@/os/kernel/poll'
import { batteryStatus, type BatteryStatus } from '@/integrations/quick-settings/client'
import { listNotes, readNoteBody, saveNoteBody, type NoteMeta } from '@/integrations/notes/client'
import { openApp } from '@/os/kernel/shell'
import { AnalogClock } from '@/os/ui/AnalogClock'
import { playSound } from '@/os/sound/sounds'

export type WidgetKind =
  | 'clock'
  | 'sweep-clock'
  | 'time-date'
  | 'calendar'
  | 'weather'
  | 'world-clock'
  | 'system'
  | 'now-playing'
  | 'agenda'
  | 'battery'
  | 'storage'
  | 'quick-note'
  | 'quick-actions'
  | 'focus-timer'
  | 'progress'

export interface PlacedWidget {
  id: string
  kind: WidgetKind
  x: number
  y: number
}

/** Widget sizes follow the macOS grid: small squares and medium double-width tiles. */
export const WIDGET_CATALOG: Record<WidgetKind, { name: string; description: string; w: number; h: number }> = {
  clock: { name: 'Clock', description: 'An analogue clock with the date.', w: 170, h: 170 },
  'sweep-clock': { name: 'Sweep Clock', description: 'A dark glass analogue clock with a smooth sweeping hand.', w: 220, h: 220 },
  'time-date': { name: 'Time & Date', description: 'Large time, the date, and how far through the day you are.', w: 356, h: 170 },
  'focus-timer': { name: 'Focus Timer', description: 'A countdown ring for focused work sessions.', w: 170, h: 170 },
  progress: { name: 'Progress', description: 'How far through the day, week, month and year.', w: 170, h: 170 },
  calendar: { name: 'Calendar', description: 'This month at a glance.', w: 170, h: 170 },
  weather: { name: 'Weather', description: 'Conditions now and the next hours.', w: 356, h: 170 },
  'world-clock': { name: 'World Clock', description: 'Time in London, New York and Tokyo.', w: 356, h: 170 },
  system: { name: 'System', description: 'Live processor and memory use.', w: 170, h: 170 },
  'now-playing': { name: 'Now Playing', description: 'Whatever is playing, with controls.', w: 356, h: 170 },
  agenda: { name: 'Up Next', description: "Today's events from your calendar.", w: 170, h: 170 },
  battery: { name: 'Battery', description: 'Charge level and status.', w: 170, h: 170 },
  storage: { name: 'Storage', description: 'Free space on your main drive.', w: 170, h: 170 },
  'quick-note': { name: 'Quick Note', description: 'Jot something down without opening Notes.', w: 356, h: 170 },
  'quick-actions': { name: 'Quick Actions', description: 'One-tap shortcuts to common tasks.', w: 356, h: 170 },
}

export function parseWidgets(json: string): PlacedWidget[] {
  try {
    const list = JSON.parse(json)
    return Array.isArray(list) ? list.filter((w) => w && w.kind in WIDGET_CATALOG) : []
  } catch {
    return []
  }
}

export function useWidgets() {
  const [raw, setRaw] = usePref('desktop.widgets')
  const widgets = useMemo(() => parseWidgets(raw), [raw])
  return [widgets, (next: PlacedWidget[]) => setRaw(JSON.stringify(next))] as const
}

/** Adds a widget in the first free slot down the right-hand side of the screen. */
export async function addWidget(kind: WidgetKind) {
  const list = parseWidgets(await getPref('desktop.widgets'))
  const { w, h } = WIDGET_CATALOG[kind]
  const gap = 16
  const right = window.screen.width - 24
  let y = 64
  const overlaps = (x: number, yy: number) =>
    list.some((o) => {
      const s = WIDGET_CATALOG[o.kind]
      return x < o.x + s.w + gap && x + w + gap > o.x && yy < o.y + s.h + gap && yy + h + gap > o.y
    })
  let x = right - w
  while (overlaps(x, y)) {
    y += 170 + gap
    if (y + h > window.screen.height - 120) {
      y = 64
      x -= 356 + gap
    }
  }
  await setPref('desktop.widgets', JSON.stringify([...list, { id: `${kind}-${Date.now().toString(36)}`, kind, x, y }]))
}

/**
 * A widget's surface.
 *
 * Uses the real window material rather than a hardcoded dark tint with
 * `backdrop-blur`: the desktop is a transparent OS window, so a CSS
 * backdrop filter there has nothing of the wallpaper to sample and only
 * costs GPU every frame. The compositor does the blur instead; see
 * os/kernel/material.ts.
 *
 * The tint also had to be hardcoded dark because it was the only way to
 * stay legible, which meant widgets stayed black in light mode. Now they
 * follow the theme like every other surface.
 */
export function Tile({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`os-widget-material os-sheen h-full w-full overflow-hidden rounded-(--os-radius-widget) p-4 text-(--os-text) ${className}`}
    >
      {children}
    </div>
  )
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => new Date())
  usePoll(() => setNow(new Date()), everyMs)
  return now
}

function ClockWidget() {
  const now = useNow(1000)
  const s = now.getSeconds()
  const m = now.getMinutes() + s / 60
  const h = (now.getHours() % 12) + m / 60
  const hand = (deg: number, len: number, width: number, color: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke={color} strokeWidth={width} strokeLinecap="round" />
  )
  return (
    <Tile className="flex items-center justify-center !p-3">
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <circle cx="50" cy="50" r="47" fill="rgb(255 255 255 / 0.96)" />
        {Array.from({ length: 12 }, (_, i) => (
          <text key={i} x={50 + 36 * Math.sin((i + 1) * (Math.PI / 6))} y={50 - 36 * Math.cos((i + 1) * (Math.PI / 6)) + 3.6} textAnchor="middle" fontSize="10" fontWeight="600" fill="#1c1c1e">
            {i + 1}
          </text>
        ))}
        <text x="50" y="68" textAnchor="middle" fontSize="6.5" fill="#8e8e93" fontWeight="600">
          {now.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} {now.getDate()}
        </text>
        {hand(h * 30, 22, 3.4, '#1c1c1e')}
        {hand(m * 6, 33, 2.4, '#1c1c1e')}
        {hand(s * 6, 36, 1, '#ff9500')}
        <circle cx="50" cy="50" r="2.2" fill="#ff9500" />
      </svg>
    </Tile>
  )
}

function CalendarWidget() {
  const now = useNow(60_000)
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  return (
    <Tile className="!p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#ff453a]">{now.toLocaleDateString(undefined, { month: 'long' })}</p>
      <div className="mt-1.5 grid grid-cols-7 gap-y-[3px] text-center text-[9.5px] tabular-nums">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="font-semibold text-[var(--color-text-tertiary)]">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => (
          <span key={i} className={`mx-auto flex h-[16px] w-[16px] items-center justify-center rounded-full ${i + 1 === now.getDate() ? 'bg-[#ff453a] font-bold' : 'text-[var(--color-text-secondary)]'}`}>
            {i + 1}
          </span>
        ))}
      </div>
    </Tile>
  )
}

function WeatherWidget() {
  const { weather, error } = useWeather()
  if (!weather) return <Tile className="flex items-center justify-center text-[13px] text-(--os-text-dim)">{error ? 'Weather unavailable' : 'Loading weather…'}</Tile>
  return (
    <Tile className="bg-gradient-to-b from-[rgb(40_90_160/0.7)] to-[rgb(30_50_100/0.7)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-semibold">{weather.place}</p>
          <p className="text-[40px] font-light leading-none tabular-nums">{weather.temp}°</p>
        </div>
        <div className="text-right">
          <p className="text-[24px]">{weatherCodeToGlyph(weather.code)}</p>
          <p className="text-[12px] font-medium">{weatherCodeToLabel(weather.code)}</p>
          <p className="text-[12px] tabular-nums text-(--os-text-dim)">
            H:{weather.high}° L:{weather.low}°
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-6 text-center text-[11.5px] tabular-nums">
        {weather.hours.map((h) => (
          <div key={h.time} className="flex flex-col items-center gap-0.5">
            <span className="text-(--os-text-dim)">{h.time?.slice(11, 13)}</span>
            <span className="text-[15px]">{weatherCodeToGlyph(h.code)}</span>
            <span>{h.temp}°</span>
          </div>
        ))}
      </div>
    </Tile>
  )
}

const ZONES = [
  { city: 'London', tz: 'Europe/London' },
  { city: 'New York', tz: 'America/New_York' },
  { city: 'Tokyo', tz: 'Asia/Tokyo' },
]

function WorldClockWidget() {
  const now = useNow(15_000)
  return (
    <Tile className="flex items-center justify-around">
      {ZONES.map((z) => {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
        const there = new Date(now.toLocaleString('en-US', { timeZone: z.tz }))
        const here = new Date(now.toLocaleString('en-US'))
        const diff = Math.round((there.getTime() - here.getTime()) / 3_600_000)
        const hour = there.getHours()
        return (
          <div key={z.city} className="flex flex-col items-center gap-1.5">
            <span className={`flex h-16 w-16 items-center justify-center rounded-full text-[17px] font-semibold tabular-nums ${hour >= 7 && hour < 19 ? 'bg-white text-black' : 'bg-black/60 text-white ring-1 ring-white/15'}`}>{parts}</span>
            <span className="text-[12.5px] font-medium">{z.city}</span>
            <span className="text-[11px] text-(--os-text-dim)">{diff === 0 ? 'Same time' : `${diff > 0 ? '+' : ''}${diff}h`}</span>
          </div>
        )
      })}
    </Tile>
  )
}

interface Load {
  cpu: number
  memoryUsed: number
  memoryTotal: number
}

function Ring({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 64 64" width="62" height="62">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value / 100))} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 600ms ease' }} />
        <text x="32" y="36" textAnchor="middle" fontSize="13" fontWeight="600" fill="#fff">
          {Math.round(value)}%
        </text>
      </svg>
      <span className="text-[11px] font-medium text-(--os-text-dim)">{label}</span>
    </div>
  )
}

function SystemWidget() {
  const [load, setLoad] = useState<Load | null>(null)
  usePoll(() => void invoke<Load>('shell_system_load').then(setLoad, () => {}), 3000)
  return (
    <Tile className="flex flex-col !p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-(--os-text-dim)">System</p>
      <div className="flex flex-1 items-center justify-around">
        <Ring value={load?.cpu ?? 0} color="#30d158" label="CPU" />
        <Ring value={load ? (load.memoryUsed / Math.max(1, load.memoryTotal)) * 100 : 0} color="#0a84ff" label="Memory" />
      </div>
    </Tile>
  )
}

function NowPlayingWidget() {
  const [np, setNp] = useState<NowPlaying | null>(null)
  usePoll(() => void invoke<NowPlaying | null>('shell_now_playing').then(setNp, () => {}), 2000)
  return (
    <Tile className="flex items-center gap-4">
      <span className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#fa2d48] to-[#a02bd6] shadow-lg">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="white">
          <path d="M9 17.5a2.5 2.5 0 1 1-2.5-2.5c.4 0 .8.1 1.1.3V5.2L19 3v11.5a2.5 2.5 0 1 1-2.5-2.5c.4 0 .8.1 1.1.3V6.4l-8.6 1.7Z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-(--os-text-dim)">{np ? sourceName(np.source) : 'Now Playing'}</p>
        <p className="mt-0.5 truncate text-[15px] font-semibold">{np?.title || 'Nothing playing'}</p>
        <p className="truncate text-[13px] text-(--os-text-dim)">{np?.artist || ' '}</p>
        <div className="mt-2 flex items-center gap-1">
          {[
            { label: 'Previous', d: 'M18.5 6v12L10 12ZM6 6h2.5v12H6z', cmd: 'previous' as const, off: !np?.canPrevious },
            { label: np?.playing ? 'Pause' : 'Play', d: np?.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l10.5-6.5Z', cmd: 'play-pause' as const, off: !np },
            { label: 'Next', d: 'M5.5 6v12l8.5-6ZM15.5 6h2.5v12h-2.5z', cmd: 'next' as const, off: !np?.canNext },
          ].map((b) => (
            <button key={b.cmd} type="button" aria-label={b.label} disabled={b.off} onClick={() => void mediaCommand(b.cmd)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-(--os-hover) disabled:opacity-30">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d={b.d} />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </Tile>
  )
}

function AgendaWidget() {
  const events = useAgenda()
  const now = useNow(60_000)
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const upcoming = (events ?? []).filter((e) => e.status !== 'done' && (e.allDay || !e.endTime || e.endTime >= hm))
  return (
    <Tile className="flex flex-col !p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#ff453a]">{now.toLocaleDateString(undefined, { weekday: 'long' })}</p>
      <p className="text-[26px] font-light leading-tight">{now.getDate()}</p>
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
        {upcoming.length === 0 ? (
          <p className="text-[12px] text-(--os-text-dim)">No more events today</p>
        ) : (
          upcoming.slice(0, 3).map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="w-[3px] shrink-0 rounded-full" style={{ background: CATEGORY_COLOUR[e.category] }} />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium">{e.title}</span>
                <span className="block text-[10.5px] tabular-nums text-(--os-text-dim)">{e.allDay || !e.startTime ? 'All day' : e.startTime}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </Tile>
  )
}

function BatteryWidget() {
  const [bat, setBat] = useState<BatteryStatus | null>(null)
  usePoll(() => void batteryStatus().then(setBat, () => {}), 15_000)
  const pct = bat?.percent ?? 0
  const low = pct <= 20 && !bat?.isCharging
  const color = low ? '#ff453a' : bat?.isCharging ? '#30d158' : 'rgb(255 255 255 / 0.92)'
  const r = 42
  const c = 2 * Math.PI * r
  return (
    <Tile className="flex flex-col items-center justify-center !p-3">
      {!bat?.hasBattery ? (
        <p className="text-[13px] text-(--os-text-dim)">No battery</p>
      ) : (
        <>
          <svg viewBox="0 0 100 100" width="92" height="92">
            <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="9" />
            <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 600ms ease' }} />
            <text x="50" y="47" textAnchor="middle" fontSize="20" fontWeight="600" fill="#fff">
              {pct}%
            </text>
            <text x="50" y="64" textAnchor="middle" fontSize="9" fill="#8e8e93">
              {bat.isCharging ? 'Charging' : low ? 'Low' : 'Battery'}
            </text>
          </svg>
        </>
      )}
    </Tile>
  )
}

function StorageWidget() {
  const [drive, setDrive] = useState<{ name: string; total: number; free: number } | null>(null)
  usePoll(
    () =>
      void invoke<{ mount: string; name: string; total: number; free: number }[]>('storage_drives').then(
        (drives) => setDrive(drives.find((d) => d.mount.startsWith('C')) ?? drives[0] ?? null),
        () => {},
      ),
    60_000,
  )
  const used = drive ? drive.total - drive.free : 0
  const pct = drive && drive.total > 0 ? Math.round((used / drive.total) * 100) : 0
  const fmt = (b: number) => `${(b / 1_000_000_000).toFixed(0)} GB`
  return (
    <Tile className="flex flex-col !p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-(--os-text-dim)">Storage</p>
      {!drive ? (
        <p className="mt-2 text-[12px] text-(--os-text-dim)">Loading…</p>
      ) : (
        <>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[rgb(255_255_255/0.1)]">
            <div className="h-full rounded-full bg-[#0a84ff]" style={{ width: `${pct}%`, transition: 'width 600ms ease' }} />
          </div>
          <p className="mt-2 text-[13px] font-semibold tabular-nums">{fmt(used)} <span className="font-normal text-(--os-text-dim)">of {fmt(drive.total)}</span></p>
          <p className="mt-0.5 text-[11px] text-(--os-text-dim)">{fmt(drive.free)} free</p>
        </>
      )}
    </Tile>
  )
}

/** Shows (and lets you edit) whichever note was most recently touched. */
function QuickNoteWidget() {
  const [note, setNote] = useState<NoteMeta | null>(null)
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void listNotes().then((notes) => {
      const latest = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
      setNote(latest)
      if (latest) void readNoteBody(latest.id).then(setBody, () => {})
      setLoaded(true)
    }, () => setLoaded(true))
  }, [])

  const commit = (next: string) => {
    setBody(next)
    if (note) void saveNoteBody(note.id, note.title, next)
  }

  return (
    <Tile className="flex flex-col !p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#ffd60a]">{note?.title || 'Quick Note'}</p>
        <button type="button" aria-label="Open in Notes" onClick={() => void openApp('notes')} className="rounded-full px-1.5 py-0.5 text-[11px] text-(--os-text-dim) hover:bg-(--os-hover)">
          Open
        </button>
      </div>
      {!loaded ? (
        <p className="mt-2 text-[12px] text-(--os-text-dim)">Loading…</p>
      ) : note ? (
        <textarea
          value={body}
          onChange={(e) => commit(e.target.value)}
          placeholder="Type a note…"
          className="mt-1.5 flex-1 resize-none bg-transparent text-[12.5px] leading-snug text-(--os-text) outline-none placeholder:text-(--os-text-dim)"
        />
      ) : (
        <p className="mt-2 text-[12px] text-(--os-text-dim)">No notes yet — open Notes to create one.</p>
      )}
    </Tile>
  )
}

const QUICK_ACTIONS = [
  { label: 'Screenshot', run: () => void openApp('screenshot') },
  { label: 'Lock Screen', run: () => void invoke('shell_power', { action: 'lock' }) },
  { label: 'File Explorer', run: () => void openApp('file-explorer') },
  { label: 'Settings', run: () => void openApp('settings') },
] as const

function QuickActionsWidget() {
  return (
    <Tile className="flex flex-col !p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-(--os-text-dim)">Quick Actions</p>
      <div className="mt-2 grid flex-1 grid-cols-2 gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.run}
            className="flex items-center justify-center rounded-[12px] bg-[rgb(255_255_255/0.08)] text-[12.5px] font-medium hover:bg-[rgb(255_255_255/0.14)]"
          >
            {a.label}
          </button>
        ))}
      </div>
    </Tile>
  )
}

function SweepClockWidget() {
  const now = useNow(30_000)
  return (
    <Tile className="relative flex items-center justify-center !p-2.5 !bg-[rgb(10_12_16/0.72)]">
      <AnalogClock size="100%" glass={false} />
      <span className="absolute bottom-[27%] text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
        {now.toLocaleDateString(undefined, { weekday: 'short' })} {now.getDate()}
      </span>
    </Tile>
  )
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)
}

function TimeDateWidget() {
  const now = useNow(1000)
  const hours = now.getHours()
  const hh = String(hours % 12 || 12).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const day = (hours * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86_400
  return (
    <Tile className="flex flex-col justify-between !p-5 !bg-gradient-to-br from-[rgb(30_34_52/0.82)] to-[rgb(12_14_22/0.82)]">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[64px] font-extralight leading-none tracking-tight tabular-nums">
          {hh}
          <span className="text-white/45">:{mm}</span>
        </span>
        <span className="text-[13px] font-medium tabular-nums text-white/55">
          {ss}s · {hours >= 12 ? 'PM' : 'AM'}
        </span>
      </div>
      <div>
        <p className="text-[13px] font-medium text-white/80">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${day * 100}%` }} />
        </div>
        <p className="mt-1 text-[10.5px] text-white/45">
          {Math.round(day * 100)}% of the day · week {isoWeek(now)}
        </p>
      </div>
    </Tile>
  )
}

const FOCUS_PRESETS = [15, 25, 45, 60]

function FocusTimerWidget() {
  const [preset, setPreset] = useState(25)
  const [left, setLeft] = useState(25 * 60_000)
  const [endAt, setEndAt] = useState<number | null>(null)
  const running = endAt !== null
  const total = preset * 60_000

  useEffect(() => {
    if (endAt === null) return
    const t = setInterval(() => {
      const remaining = endAt - Date.now()
      if (remaining <= 0) {
        setEndAt(null)
        setLeft(0)
        playSound('open')
      } else setLeft(remaining)
    }, 250)
    return () => clearInterval(t)
  }, [endAt])

  const idle = !running && left === total
  const done = !running && left === 0
  const r = 52
  const c = 2 * Math.PI * r
  const mins = Math.floor(left / 60_000)
  const secs = Math.floor((left % 60_000) / 1000)
  const cyclePreset = () => {
    if (!idle) return
    const next = FOCUS_PRESETS[(FOCUS_PRESETS.indexOf(preset) + 1) % FOCUS_PRESETS.length]
    setPreset(next)
    setLeft(next * 60_000)
  }
  const toggle = () => {
    if (running) {
      setEndAt(null)
    } else {
      const from = done ? total : left
      setLeft(from)
      setEndAt(Date.now() + from)
    }
  }
  const reset = () => {
    setEndAt(null)
    setLeft(total)
  }

  return (
    <Tile className="relative flex items-center justify-center !p-3">
      <svg viewBox="0 0 120 120" className="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="6" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={done ? '#30d158' : 'var(--color-accent)'} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / total)} style={{ transition: 'stroke-dashoffset 250ms linear' }} />
      </svg>
      <div className="relative flex flex-col items-center">
        <button type="button" onClick={cyclePreset} title={idle ? 'Change length' : undefined} className="text-[26px] font-light leading-none tabular-nums">
          {done ? 'Done' : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
        </button>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/45">{running ? 'Focusing' : idle ? `${preset} min` : done ? 'Nice work' : 'Paused'}</span>
        <div className="mt-2 flex gap-1.5">
          <button type="button" onClick={toggle} aria-label={running ? 'Pause' : 'Start'} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
            {running ? (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>
            )}
          </button>
          {!idle && (
            <button type="button" onClick={reset} aria-label="Reset" className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12a7 7 0 1 0 2.2-5.1M5 4.5v4h4" /></svg>
            </button>
          )}
        </div>
      </div>
    </Tile>
  )
}

function ProgressWidget() {
  const now = useNow(30_000)
  const day = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86_400
  const week = (((now.getDay() + 6) % 7) + day) / 7
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const month = (now.getDate() - 1 + day) / dim
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime()
  const yearLen = (new Date(now.getFullYear() + 1, 0, 1).getTime() - startOfYear) / 86_400_000
  const year = (now.getTime() - startOfYear) / 86_400_000 / yearLen
  const rings = [
    { r: 54, v: year, color: '#bf5af2' },
    { r: 43, v: month, color: '#0a84ff' },
    { r: 32, v: week, color: '#30d158' },
    { r: 21, v: day, color: '#ff9f0a' },
  ]
  return (
    <Tile className="relative flex items-center justify-center !p-3">
      <svg viewBox="0 0 130 130" className="h-full w-full -rotate-90">
        {rings.map(({ r, v, color }) => {
          const c = 2 * Math.PI * r
          return (
            <g key={r}>
              <circle cx="65" cy="65" r={r} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="7" />
              <circle cx="65" cy="65" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
            </g>
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[17px] font-semibold tabular-nums leading-none">{Math.round(year * 100)}%</span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/45">{now.getFullYear()}</span>
      </div>
    </Tile>
  )
}

export const WIDGET_VIEWS: Record<WidgetKind, () => ReactNode> = {
  'sweep-clock': SweepClockWidget,
  'time-date': TimeDateWidget,
  'focus-timer': FocusTimerWidget,
  progress: ProgressWidget,
  clock: ClockWidget,
  calendar: CalendarWidget,
  weather: WeatherWidget,
  'world-clock': WorldClockWidget,
  system: SystemWidget,
  'now-playing': NowPlayingWidget,
  battery: BatteryWidget,
  storage: StorageWidget,
  'quick-note': QuickNoteWidget,
  'quick-actions': QuickActionsWidget,
  agenda: AgendaWidget,
}
