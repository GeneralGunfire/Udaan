/**
 * Repeating events, reminders, and the .ics calendar file format.
 *
 * A repeating event is stored ONCE, with a rule. It is expanded into the days it falls on only when shown, so a
 * weekly meeting is one row, not five hundred. Dates are plain local days ("2026-03-02"), never instants, so
 * nothing shifts across daylight-saving changes.
 */

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface Rule {
  freq: Freq
  /** Every N days, weeks, months or years. */
  interval: number
  /** Last day it can happen (inclusive), or none. */
  until?: string | null
  /** For weekly: which days (0 = Sunday), instead of just the start's weekday. */
  weekdays?: number[]
}

export const REMINDER_CHOICES: [number | null, string][] = [
  [null, 'No reminder'],
  [0, 'At the time'],
  [5, '5 minutes before'],
  [10, '10 minutes before'],
  [15, '15 minutes before'],
  [30, '30 minutes before'],
  [60, '1 hour before'],
  [1440, '1 day before'],
]

/* ── days ────────────────────────────────────────────────────────── */

const p2 = (n: number) => String(n).padStart(2, '0')
export const parseDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12)
}
export const fmtDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12)

export function parseRule(json?: string | null): Rule | null {
  if (!json) return null
  try {
    const r = JSON.parse(json) as Rule
    return r && ['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? { ...r, interval: Math.max(1, Number(r.interval) || 1) } : null
  } catch {
    return null
  }
}
export const ruleToJson = (r: Rule | null | undefined) => (r ? JSON.stringify({ freq: r.freq, interval: Math.max(1, r.interval), until: r.until || null, weekdays: r.weekdays?.length ? r.weekdays : undefined }) : null)

/** Every day the event falls on between `from` and `to` (inclusive), starting from its first day. */
export function occurrenceDays(start: string, rule: Rule, from: string, to: string, cap = 1500): string[] {
  const first = parseDay(start)
  const lo = parseDay(from)
  const hi = parseDay(to)
  const end = rule.until ? parseDay(rule.until) : null
  const limit = end && end < hi ? end : hi
  const out: string[] = []
  const take = (d: Date) => {
    if (d >= first && d >= lo && d <= limit && out.length < cap) out.push(fmtDay(d))
  }
  const n = rule.interval
  if (rule.freq === 'daily') {
    for (let d = first, i = 0; d <= limit && i < 20000; d = addDays(d, n), i++) take(d)
  } else if (rule.freq === 'weekly') {
    const days = rule.weekdays?.length ? [...rule.weekdays].sort() : [first.getDay()]
    // The week (Sunday-based) that holds the first day.
    let weekStart = addDays(first, -first.getDay())
    for (let i = 0; weekStart <= limit && i < 5000; weekStart = addDays(weekStart, 7 * n), i++) for (const wd of days) take(addDays(weekStart, wd))
  } else if (rule.freq === 'monthly') {
    for (let k = 0, y = first.getFullYear(), m = first.getMonth(); k < 2400; k += n) {
      const dt = new Date(y, m + k, first.getDate(), 12)
      // A month that has no such day (the 31st) is skipped, as calendars do.
      if (dt.getDate() === first.getDate()) take(dt)
      if (dt > limit) break
    }
  } else {
    for (let k = 0; k < 400; k += n) {
      const dt = new Date(first.getFullYear() + k, first.getMonth(), first.getDate(), 12)
      if (dt.getMonth() === first.getMonth()) take(dt)
      if (dt > limit) break
    }
  }
  return out
}

export function describeRule(r: Rule): string {
  const every = (unit: string) => (r.interval === 1 ? unit : `${r.interval} ${unit}s`.replace('1 ', ''))
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let s = r.freq === 'daily' ? (r.interval === 1 ? 'Every day' : `Every ${r.interval} days`) : r.freq === 'weekly' ? (r.interval === 1 ? 'Every week' : `Every ${r.interval} weeks`) : r.freq === 'monthly' ? (r.interval === 1 ? 'Every month' : `Every ${r.interval} months`) : r.interval === 1 ? 'Every year' : `Every ${r.interval} years`
  void every
  if (r.freq === 'weekly' && r.weekdays?.length) s += ` on ${[...r.weekdays].sort().map((d) => names[d]).join(', ')}`
  if (r.until) s += `, until ${parseDay(r.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
  return s
}

export const reminderLabel = (m?: number | null) => REMINDER_CHOICES.find(([v]) => v === (m ?? null))?.[1] ?? `${m} minutes before`

/* ── the .ics file format ────────────────────────────────────────── */

export interface IcsEvent {
  id: string
  title: string
  date: string
  startTime?: string
  endTime?: string
  description?: string
  allDay?: boolean
  durationMinutes?: number
  recurrence?: string | null
  reminderMinutes?: number | null
  category?: string
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
/** Lines may be at most 75 octets; longer ones continue on the next line after a space. */
const fold = (line: string) => {
  if (line.length <= 73) return line
  const out: string[] = []
  for (let i = 0; i < line.length; i += 73) out.push((i ? ' ' : '') + line.slice(i, i + 73))
  return out.join('\r\n')
}
const stamp = (iso: string) => iso.replace(/-/g, '')
const stampTime = (t: string) => t.replace(':', '') + '00'

export function toIcs(events: IcsEvent[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Udaan//Calendar//EN', 'CALSCALE:GREGORIAN']
  for (const e of events) {
    if (!e.date) continue // an undated to-do has no place in a calendar file
    lines.push('BEGIN:VEVENT', `UID:${e.id}@udaan`, `DTSTAMP:${now}`, fold(`SUMMARY:${esc(e.title)}`))
    if (e.allDay || !e.startTime) {
      lines.push(`DTSTART;VALUE=DATE:${stamp(e.date)}`, `DTEND;VALUE=DATE:${stamp(fmtDay(addDays(parseDay(e.date), 1)))}`)
    } else {
      const [h, m] = e.startTime.split(':').map(Number)
      const end = new Date(parseDay(e.date).getFullYear(), parseDay(e.date).getMonth(), parseDay(e.date).getDate(), h, m + (e.durationMinutes ?? 30))
      lines.push(`DTSTART:${stamp(e.date)}T${stampTime(e.startTime)}`, `DTEND:${fmtDay(end).replace(/-/g, '')}T${p2(end.getHours())}${p2(end.getMinutes())}00`)
    }
    const rule = parseRule(e.recurrence)
    if (rule) {
      const f = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[rule.freq]
      const by = rule.weekdays?.length ? `;BYDAY=${[...rule.weekdays].sort().map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d]).join(',')}` : ''
      lines.push(`RRULE:FREQ=${f};INTERVAL=${rule.interval}${by}${rule.until ? `;UNTIL=${stamp(rule.until)}` : ''}`)
    }
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`))
    if (e.category) lines.push(`CATEGORIES:${esc(e.category)}`)
    if (e.reminderMinutes != null) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${e.reminderMinutes}M`, 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export interface ParsedEvent {
  title: string
  date: string
  startTime?: string
  durationMinutes?: number
  description?: string
  allDay: boolean
  recurrence: string | null
  reminderMinutes: number | null
}

/** "20260115", "20260115T093000" or "...Z" (UTC, converted to local) to a local day and time. */
function parseWhen(value: string): { date: string; time?: string; ms: number } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, , z] = m
  if (h === undefined) return { date: `${y}-${mo}-${d}`, ms: new Date(+y, +mo - 1, +d).getTime() }
  const dt = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)) : new Date(+y, +mo - 1, +d, +h, +mi)
  return { date: fmtDay(dt), time: `${p2(dt.getHours())}:${p2(dt.getMinutes())}`, ms: dt.getTime() }
}

function parseRrule(v: string, start: string): string | null {
  const parts = Object.fromEntries(v.split(';').map((p) => p.split('=') as [string, string]))
  const freq = ({ DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' } as Record<string, Freq>)[parts.FREQ]
  if (!freq) return null
  const rule: Rule = { freq, interval: Math.max(1, Number(parts.INTERVAL) || 1) }
  if (parts.BYDAY && freq === 'weekly') {
    const idx = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
    rule.weekdays = parts.BYDAY.split(',').map((x) => idx.indexOf(x.slice(-2))).filter((i) => i >= 0)
  }
  if (parts.UNTIL) rule.until = parseWhen(parts.UNTIL)?.date ?? null
  else if (parts.COUNT) {
    // COUNT becomes the day of the last occurrence.
    const days = occurrenceDays(start, { ...rule, until: null }, start, fmtDay(addDays(parseDay(start), 366 * 30)), Number(parts.COUNT))
    rule.until = days[days.length - 1] ?? null
  }
  return ruleToJson(rule)
}

export function parseIcs(text: string): ParsedEvent[] {
  // Unfold: a line starting with a space or tab continues the one before.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const out: ParsedEvent[] = []
  let cur: Record<string, { v: string; params: string }> | null = null
  let alarm = false
  let alarmTrigger: string | null = null
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === 'BEGIN:VEVENT') (cur = {}, (alarm = false), (alarmTrigger = null))
    else if (line === 'BEGIN:VALARM') alarm = true
    else if (line === 'END:VALARM') alarm = false
    else if (line === 'END:VEVENT' && cur) {
      const s = cur.DTSTART && parseWhen(cur.DTSTART.v)
      if (s) {
        const e = cur.DTEND && parseWhen(cur.DTEND.v)
        const allDay = s.time === undefined
        const dur = e && !allDay ? Math.max(5, Math.round((e.ms - s.ms) / 60_000)) : undefined
        let reminder: number | null = null
        const t = alarmTrigger && /^-?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(alarmTrigger)
        if (t && alarmTrigger!.startsWith('-')) reminder = (+(t[1] || 0)) * 1440 + (+(t[2] || 0)) * 60 + +(t[3] || 0)
        out.push({
          title: unesc(cur.SUMMARY?.v ?? 'Untitled event').trim() || 'Untitled event',
          date: s.date,
          startTime: s.time,
          durationMinutes: dur,
          description: cur.DESCRIPTION ? unesc(cur.DESCRIPTION.v) : undefined,
          allDay,
          recurrence: cur.RRULE ? parseRrule(cur.RRULE.v, s.date) : null,
          reminderMinutes: reminder,
        })
      }
      cur = null
    } else if (cur) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const [name, ...params] = line.slice(0, i).split(';')
      const key = name.toUpperCase()
      if (alarm) {
        if (key === 'TRIGGER') alarmTrigger = line.slice(i + 1).trim()
      } else if (!(key in cur)) cur[key] = { v: line.slice(i + 1), params: params.join(';') }
    }
  }
  return out
}
