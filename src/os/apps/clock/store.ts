/**
 * Clock data: alarms, timers, focus sessions, world cities and the stopwatch, kept in
 * localStorage (shared by every Udaan window, so the background alarm service and the Clock
 * window see the same data). Every read survives bad stored JSON; every write survives a full or
 * missing storage. The timing rules are pure functions so they can be tested.
 */

export type AlarmSound = 'notify' | 'success' | 'switch' | 'open'
export const ALARM_SOUNDS: { id: AlarmSound; name: string }[] = [
  { id: 'notify', name: 'Chime' },
  { id: 'success', name: 'Bright' },
  { id: 'switch', name: 'Click' },
  { id: 'open', name: 'Rise' },
]

export interface Alarm {
  id: string
  hour: number
  minute: number
  label: string
  /** Days it repeats on, 0 = Sunday. Empty = once. */
  days: number[]
  enabled: boolean
  snoozeMin: 5 | 10 | 15
  sound: AlarmSound
  /** When it was last switched on or edited: a one-time alarm rings at the first time after this. */
  armedAt: number
  snoozeUntil: number | null
}

export interface Timer {
  id: string
  label: string
  durationMs: number
  state: 'idle' | 'running' | 'paused' | 'done'
  /** While running. */
  endsAt: number | null
  /** While paused or idle. */
  remainingMs: number
}

export type FocusPhase = 'focus' | 'short' | 'long'
export interface FocusSettings {
  focusMin: number
  shortMin: number
  longMin: number
  /** A long break after this many focus sessions. */
  longEvery: number
  autoStart: boolean
}
export interface FocusState {
  phase: FocusPhase
  running: boolean
  endsAt: number | null
  remainingMs: number
  /** Focus sessions finished in the current cycle. */
  cycle: number
  settings: FocusSettings
  /** Local date (YYYY-MM-DD) the totals below belong to. */
  day: string
  todayMs: number
  todaySessions: number
}

export interface Stopwatch {
  running: boolean
  startedAt: number | null
  /** Time banked before the current run. */
  accumulated: number
  /** Total elapsed at each lap. */
  laps: number[]
}

export interface Ringing {
  kind: 'alarm' | 'timer' | 'focus'
  id: string
  title: string
  body: string
  at: number
}

/* ── storage ────────────────────────────────────────────────────── */

export const KEYS = {
  alarms: 'udaan.clock.alarms',
  timers: 'udaan.clock.timers',
  focus: 'udaan.clock.focus',
  cities: 'udaan.clock.cities',
  stopwatch: 'udaan.clock.stopwatch',
  ringing: 'udaan.clock.ringing',
  fired: 'udaan.clock.fired',
  tab: 'udaan.clock.tab',
} as const

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}
function write(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* not saved: storage full or unavailable */
  }
}

const num = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : d
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
const clampInt = (v: unknown, lo: number, hi: number, d: number) =>
  Math.min(hi, Math.max(lo, Math.round(num(v, d))))

function sanitizeAlarm(x: unknown): Alarm | null {
  const a = x as Partial<Alarm> | null
  if (!a || typeof a !== 'object' || typeof a.id !== 'string') return null
  return {
    id: a.id,
    hour: clampInt(a.hour, 0, 23, 7),
    minute: clampInt(a.minute, 0, 59, 0),
    label: str(a.label, ''),
    days: Array.isArray(a.days)
      ? [
          ...new Set(
            a.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
          ),
        ].sort()
      : [],
    enabled: a.enabled !== false,
    snoozeMin: a.snoozeMin === 5 || a.snoozeMin === 15 ? a.snoozeMin : 10,
    sound: ALARM_SOUNDS.some((s) => s.id === a.sound)
      ? (a.sound as AlarmSound)
      : 'notify',
    armedAt: num(a.armedAt, 0),
    snoozeUntil: typeof a.snoozeUntil === 'number' ? a.snoozeUntil : null,
  }
}
function sanitizeTimer(x: unknown): Timer | null {
  const t = x as Partial<Timer> | null
  if (!t || typeof t !== 'object' || typeof t.id !== 'string') return null
  const durationMs = Math.max(1000, num(t.durationMs, 60_000))
  const state =
    t.state === 'running' || t.state === 'paused' || t.state === 'done'
      ? t.state
      : 'idle'
  return {
    id: t.id,
    label: str(t.label, ''),
    durationMs,
    state: state === 'running' && typeof t.endsAt !== 'number' ? 'idle' : state,
    endsAt: typeof t.endsAt === 'number' ? t.endsAt : null,
    remainingMs: Math.min(
      durationMs,
      Math.max(0, num(t.remainingMs, durationMs)),
    ),
  }
}

export const loadAlarms = (): Alarm[] => {
  const v = read(KEYS.alarms)
  return Array.isArray(v)
    ? v.map(sanitizeAlarm).filter((a): a is Alarm => !!a)
    : []
}
export const saveAlarms = (a: Alarm[]) => write(KEYS.alarms, a)

export const loadTimers = (): Timer[] => {
  const v = read(KEYS.timers)
  return Array.isArray(v)
    ? v.map(sanitizeTimer).filter((t): t is Timer => !!t)
    : []
}
export const saveTimers = (t: Timer[]) => write(KEYS.timers, t)

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStart: false,
}
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const phaseMs = (p: FocusPhase, s: FocusSettings) =>
  (p === 'focus' ? s.focusMin : p === 'short' ? s.shortMin : s.longMin) * 60_000

export function loadFocus(now = new Date()): FocusState {
  const v = (read(KEYS.focus) ?? {}) as Partial<FocusState>
  const s = (v.settings ?? {}) as Partial<FocusSettings>
  const settings: FocusSettings = {
    focusMin: clampInt(s.focusMin, 1, 180, 25),
    shortMin: clampInt(s.shortMin, 1, 60, 5),
    longMin: clampInt(s.longMin, 1, 120, 15),
    longEvery: clampInt(s.longEvery, 2, 12, 4),
    autoStart: s.autoStart === true,
  }
  const phase: FocusPhase =
    v.phase === 'short' || v.phase === 'long' ? v.phase : 'focus'
  const running = v.running === true && typeof v.endsAt === 'number'
  const today = dayKey(now)
  const sameDay = v.day === today
  return {
    phase,
    running,
    endsAt: running ? (v.endsAt as number) : null,
    remainingMs: Math.max(
      0,
      Math.min(
        phaseMs(phase, settings),
        num(v.remainingMs, phaseMs(phase, settings)),
      ),
    ),
    cycle: clampInt(v.cycle, 0, 100, 0),
    settings,
    day: today,
    todayMs: sameDay ? Math.max(0, num(v.todayMs, 0)) : 0,
    todaySessions: sameDay ? clampInt(v.todaySessions, 0, 1000, 0) : 0,
  }
}
export const saveFocus = (f: FocusState) => write(KEYS.focus, f)

export function loadStopwatch(): Stopwatch {
  const v = (read(KEYS.stopwatch) ?? {}) as Partial<Stopwatch>
  const running = v.running === true && typeof v.startedAt === 'number'
  return {
    running,
    startedAt: running ? (v.startedAt as number) : null,
    accumulated: Math.max(0, num(v.accumulated, 0)),
    laps: Array.isArray(v.laps)
      ? v.laps
          .filter(
            (n): n is number => typeof n === 'number' && Number.isFinite(n),
          )
          .slice(0, 999)
      : [],
  }
}
export const saveStopwatch = (s: Stopwatch) => write(KEYS.stopwatch, s)

export function loadCities(): string[] {
  const v = read(KEYS.cities)
  return Array.isArray(v)
    ? v.filter((c): c is string => typeof c === 'string')
    : ['London', 'New York', 'Tokyo']
}
export const saveCities = (c: string[]) => write(KEYS.cities, c)

export function loadRinging(): Ringing | null {
  const r = read(KEYS.ringing) as Ringing | null
  return r &&
    typeof r === 'object' &&
    typeof r.id === 'string' &&
    typeof r.at === 'number'
    ? r
    : null
}
export const saveRinging = (r: Ringing | null) => write(KEYS.ringing, r)

export function loadFired(): string[] {
  const v = read(KEYS.fired)
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : []
}
export const saveFired = (f: string[]) => write(KEYS.fired, f.slice(-200))

export const loadTab = () => str(read(KEYS.tab), 'world')
export const saveTab = (t: string) => write(KEYS.tab, t)

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

/* ── alarm timing ───────────────────────────────────────────────── */

/** A ring more than this late (the PC was off or asleep) is skipped instead of going off. */
export const LATE_LIMIT_MS = 2 * 60_000

const at = (base: Date, dayOffset: number, h: number, m: number) =>
  new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    h,
    m,
    0,
    0,
  ).getTime()

/** The next time this alarm rings after `from` (snooze included), or null when it is off. */
export function nextRing(a: Alarm, from: number): number | null {
  if (!a.enabled) return null
  const candidates: number[] = []
  if (a.snoozeUntil && a.snoozeUntil > from) candidates.push(a.snoozeUntil)
  const base = new Date(from)
  if (a.days.length === 0) {
    const after = Math.max(from, a.armedAt)
    const b = new Date(after)
    let t = at(b, 0, a.hour, a.minute)
    if (t <= after) t = at(b, 1, a.hour, a.minute)
    candidates.push(t)
  } else {
    for (let d = 0; d <= 7; d++) {
      const t = at(base, d, a.hour, a.minute)
      if (t > from && a.days.includes(new Date(t).getDay())) {
        candidates.push(t)
        break
      }
    }
  }
  return candidates.length ? Math.min(...candidates) : null
}

/** The scheduled ring at or before `now` (within the late window) that has not fired yet. */
export function dueRing(
  a: Alarm,
  now: number,
  fired: readonly string[],
): { at: number; key: string; snooze: boolean } | null {
  if (!a.enabled) return null
  if (
    a.snoozeUntil &&
    a.snoozeUntil <= now &&
    now - a.snoozeUntil <= LATE_LIMIT_MS
  ) {
    const key = `${a.id}@s${a.snoozeUntil}`
    if (!fired.includes(key)) return { at: a.snoozeUntil, key, snooze: true }
  }
  const base = new Date(now)
  for (const d of [0, -1]) {
    const t = at(base, d, a.hour, a.minute)
    if (t > now || now - t > LATE_LIMIT_MS) continue
    if (t <= a.armedAt) continue
    if (a.days.length && !a.days.includes(new Date(t).getDay())) continue
    const key = `${a.id}@${t}`
    if (!fired.includes(key)) return { at: t, key, snooze: false }
  }
  return null
}

/** A one-time alarm whose time passed while Udaan was off: it is switched off without ringing. */
export function isMissedOneTime(a: Alarm, now: number): boolean {
  if (!a.enabled || a.days.length || a.snoozeUntil) return false
  const first = nextRing({ ...a, snoozeUntil: null }, a.armedAt)
  return first !== null && now - first > LATE_LIMIT_MS
}

export function formatIn(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d) return `${d} d ${h} h`
  if (h) return `${h} h ${m} min`
  return m <= 0 ? 'less than a minute' : `${m} min`
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function repeatLabel(days: number[]): string {
  const s = [...days].sort().join(',')
  if (!days.length) return 'Once'
  if (s === '0,1,2,3,4,5,6') return 'Every day'
  if (s === '1,2,3,4,5') return 'Weekdays'
  if (s === '0,6') return 'Weekends'
  // Monday first, the way the week is shown.
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => days.includes(d))
    .map((d) => DAY_SHORT[d])
    .join(', ')
}

/* ── timers ─────────────────────────────────────────────────────── */

export const timerRemaining = (t: Timer, now: number) =>
  t.state === 'running' && t.endsAt
    ? Math.max(0, t.endsAt - now)
    : t.state === 'done'
      ? 0
      : t.remainingMs

/* ── focus ──────────────────────────────────────────────────────── */

export const focusRemaining = (f: FocusState, now: number) =>
  f.running && f.endsAt ? Math.max(0, f.endsAt - now) : f.remainingMs

/** Moves a running focus session on when its time is up. Returns null when nothing changed. */
export function advanceFocus(
  f: FocusState,
  now: number,
): { state: FocusState; finished: FocusPhase; next: FocusPhase } | null {
  if (!f.running || !f.endsAt || now < f.endsAt) return null
  const finished = f.phase
  let { cycle, todayMs, todaySessions, day } = f
  const today = dayKey(new Date(now))
  if (day !== today) {
    day = today
    todayMs = 0
    todaySessions = 0
  }
  let next: FocusPhase
  if (finished === 'focus') {
    cycle += 1
    todayMs += phaseMs('focus', f.settings)
    todaySessions += 1
    next = cycle % f.settings.longEvery === 0 ? 'long' : 'short'
  } else {
    next = 'focus'
    if (finished === 'long') cycle = 0
  }
  const len = phaseMs(next, f.settings)
  const auto = f.settings.autoStart
  return {
    finished,
    next,
    state: {
      ...f,
      phase: next,
      cycle,
      day,
      todayMs,
      todaySessions,
      running: auto,
      endsAt: auto ? now + len : null,
      remainingMs: len,
    },
  }
}
