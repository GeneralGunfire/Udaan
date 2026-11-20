import { describe, expect, it } from 'vitest'
import { CITIES, offsetLabel, zoneOffsetMin } from './cities'
import {
  DEFAULT_FOCUS_SETTINGS,
  advanceFocus,
  dueRing,
  formatIn,
  isMissedOneTime,
  nextRing,
  repeatLabel,
  type Alarm,
  type FocusState,
} from './store'

const alarm = (p: Partial<Alarm>): Alarm => ({
  id: 'a',
  hour: 7,
  minute: 30,
  label: '',
  days: [],
  enabled: true,
  snoozeMin: 10,
  sound: 'notify',
  armedAt: 0,
  snoozeUntil: null,
  ...p,
})
const t = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime()

describe('alarms', () => {
  it('finds the next ring for one-time and repeating alarms', () => {
    const now = t(2026, 11, 20, 8, 0) // a Friday
    expect(nextRing(alarm({ armedAt: now }), now)).toBe(t(2026, 11, 21, 7, 30))
    expect(nextRing(alarm({ armedAt: now, hour: 9 }), now)).toBe(
      t(2026, 11, 20, 9, 30),
    )
    // Weekdays only: Friday 8:00 -> Monday 7:30.
    expect(nextRing(alarm({ days: [1, 2, 3, 4, 5] }), now)).toBe(
      t(2026, 11, 23, 7, 30),
    )
    expect(nextRing(alarm({ enabled: false }), now)).toBeNull()
    expect(
      nextRing(alarm({ armedAt: now, snoozeUntil: now + 5 * 60_000 }), now),
    ).toBe(now + 5 * 60_000)
  })
  it('rings once when due, and not when too late', () => {
    const armed = t(2026, 11, 20, 6, 0)
    const a = alarm({ armedAt: armed })
    const due = dueRing(a, t(2026, 11, 20, 7, 30, 10), [])
    expect(due?.at).toBe(t(2026, 11, 20, 7, 30))
    expect(dueRing(a, t(2026, 11, 20, 7, 30, 10), [due!.key])).toBeNull()
    expect(dueRing(a, t(2026, 11, 20, 7, 33), [])).toBeNull()
    expect(dueRing(a, t(2026, 11, 20, 7, 29), [])).toBeNull()
  })
  it('does not ring for a time before it was set', () => {
    const a = alarm({ armedAt: t(2026, 11, 20, 7, 31) })
    expect(dueRing(a, t(2026, 11, 20, 7, 31, 30), [])).toBeNull()
  })
  it('skips days a repeating alarm is not on', () => {
    const a = alarm({ days: [6, 0] }) // weekends; the 20th is a Friday
    expect(dueRing(a, t(2026, 11, 20, 7, 30, 5), [])).toBeNull()
    expect(dueRing(a, t(2026, 11, 21, 7, 30, 5), [])).not.toBeNull()
  })
  it('rings a snooze', () => {
    const s = t(2026, 11, 20, 7, 40)
    const due = dueRing(
      alarm({ snoozeUntil: s, armedAt: t(2026, 11, 20, 7, 0) }),
      s + 1000,
      [],
    )
    expect(due?.snooze).toBe(true)
  })
  it('treats a one-time alarm missed while off as missed', () => {
    const a = alarm({ armedAt: t(2026, 11, 19, 22, 0) })
    expect(isMissedOneTime(a, t(2026, 11, 20, 7, 31))).toBe(false)
    expect(isMissedOneTime(a, t(2026, 11, 20, 9, 0))).toBe(true)
  })
  it('labels repeats and durations', () => {
    expect(repeatLabel([])).toBe('Once')
    expect(repeatLabel([1, 2, 3, 4, 5])).toBe('Weekdays')
    expect(repeatLabel([0, 6])).toBe('Weekends')
    expect(repeatLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
    expect(repeatLabel([0, 3])).toBe('Wed, Sun')
    expect(formatIn((6 * 60 + 12) * 60_000)).toBe('6 h 12 min')
  })
})

describe('focus', () => {
  const base: FocusState = {
    phase: 'focus',
    running: true,
    endsAt: 1000,
    remainingMs: 0,
    cycle: 0,
    settings: DEFAULT_FOCUS_SETTINGS,
    day: '2026-11-20',
    todayMs: 0,
    todaySessions: 0,
  }
  it('moves from focus to a short break, counting the time', () => {
    const r = advanceFocus(base, t(2026, 11, 20, 10, 0))!
    expect(r.next).toBe('short')
    expect(r.state.todaySessions).toBe(1)
    expect(r.state.todayMs).toBe(25 * 60_000)
    expect(r.state.running).toBe(false)
  })
  it('takes a long break after four sessions and auto-starts when asked', () => {
    const r = advanceFocus(
      {
        ...base,
        cycle: 3,
        settings: { ...DEFAULT_FOCUS_SETTINGS, autoStart: true },
      },
      t(2026, 11, 20, 10, 0),
    )!
    expect(r.next).toBe('long')
    expect(r.state.running).toBe(true)
  })
  it('does nothing before the time is up', () => {
    expect(
      advanceFocus(
        { ...base, endsAt: t(2030, 1, 1, 0, 0) },
        t(2026, 11, 20, 10, 0),
      ),
    ).toBeNull()
  })
})

describe('world clock', () => {
  it('has many cities with valid zones', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(150)
  })
  it('computes zone offsets', () => {
    const jan = new Date(Date.UTC(2026, 0, 15, 12))
    expect(zoneOffsetMin('Asia/Kolkata', jan)).toBe(330)
    expect(zoneOffsetMin('America/New_York', jan)).toBe(-300)
    expect(zoneOffsetMin('UTC', jan)).toBe(0)
    expect(typeof offsetLabel('Asia/Tokyo', jan)).toBe('string')
  })
})
