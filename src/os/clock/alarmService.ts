import { pushNotification } from '@/integrations/notifications/client'
import { openApp } from '@/os/kernel/shell'
import { playSound, type SoundId } from '@/os/sound/sounds'
import {
  advanceFocus,
  dueRing,
  nextRing,
  isMissedOneTime,
  loadAlarms,
  loadFired,
  loadFocus,
  loadRinging,
  loadTimers,
  saveAlarms,
  saveFired,
  saveFocus,
  saveRinging,
  saveTimers,
  type FocusPhase,
  type Ringing,
} from '@/os/apps/clock/store'

/**
 * Alarms, timers and focus sessions, in the background. Started once with the desktop, so they go
 * off whether or not the Clock is open. Every 15 seconds it looks at what is due, rings it once
 * (notification + sound), and records that so no other check rings it again. An alarm more than
 * two minutes late (Udaan was off) is skipped, and a one-time alarm that was missed switches off.
 */

const CHECK_MS = 15_000
const PHASE_NAME: Record<FocusPhase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
}

const fmtTime = (h: number, m: number) =>
  new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

function notify(title: string, body: string) {
  void pushNotification({
    kind: 'reminder',
    title,
    body,
    sourceApp: 'clock',
  }).catch(() => {})
}
function sound(id: SoundId) {
  void Promise.resolve()
    .then(() => playSound(id))
    .catch(() => {})
}
function ring(r: Ringing, openWindow: boolean) {
  saveRinging(r)
  if (openWindow) void openApp('clock').catch(() => {})
}

export function checkClock(now = Date.now()): void {
  /* alarms */
  const alarms = loadAlarms()
  const fired = loadFired()
  let alarmsChanged = false
  let firedChanged = false
  for (const a of alarms) {
    const due = dueRing(a, now, fired)
    if (due) {
      fired.push(due.key)
      firedChanged = true
      if (due.snooze) a.snoozeUntil = null
      if (!a.days.length) a.enabled = false
      alarmsChanged = true
      const title = a.label || 'Alarm'
      const body = `${fmtTime(a.hour, a.minute)}${due.snooze ? ' (snoozed)' : ''}`
      notify(title, body)
      sound(a.sound)
      ring({ kind: 'alarm', id: a.id, title, body, at: now }, true)
    } else if (isMissedOneTime(a, now)) {
      a.enabled = false
      alarmsChanged = true
    } else if (a.snoozeUntil && now - a.snoozeUntil > 2 * 60_000) {
      a.snoozeUntil = null
      alarmsChanged = true
    }
  }
  if (alarmsChanged) saveAlarms(alarms)
  if (firedChanged) saveFired(fired)

  /* timers */
  const timers = loadTimers()
  let timersChanged = false
  for (const t of timers) {
    if (t.state === 'running' && t.endsAt && now >= t.endsAt) {
      t.state = 'done'
      t.remainingMs = 0
      timersChanged = true
      const title = t.label || 'Timer'
      notify(title, 'Time is up')
      sound('notify')
      ring(
        { kind: 'timer', id: t.id, title, body: 'Time is up', at: now },
        false,
      )
    }
  }
  if (timersChanged) saveTimers(timers)

  /* focus */
  const step = advanceFocus(loadFocus(new Date(now)), now)
  if (step) {
    saveFocus(step.state)
    const title =
      step.finished === 'focus'
        ? 'Focus session done'
        : `${PHASE_NAME[step.finished]} over`
    const body = step.state.running
      ? `${PHASE_NAME[step.next]} has started`
      : `Next: ${PHASE_NAME[step.next]}`
    notify(title, body)
    sound(step.finished === 'focus' ? 'success' : 'notify')
    ring({ kind: 'focus', id: 'focus', title, body, at: now }, false)
  }

  /* an alarm still ringing rings again, for up to a minute */
  const r = loadRinging()
  if (
    r &&
    r.kind === 'alarm' &&
    now - r.at >= CHECK_MS &&
    now - r.at < 60_000
  ) {
    const a = alarms.find((x) => x.id === r.id)
    sound(a?.sound ?? 'notify')
  }
}

/** The soonest thing due before the next regular check, so it rings on the second rather than up to 15 s late. */
function soonestDue(now: number): number | null {
  const times: number[] = []
  for (const t of loadTimers())
    if (t.state === 'running' && t.endsAt) times.push(t.endsAt)
  const f = loadFocus(new Date(now))
  if (f.running && f.endsAt) times.push(f.endsAt)
  for (const a of loadAlarms()) {
    const n = nextRing(a, now - 1)
    if (n !== null) times.push(n)
  }
  const near = times.filter((t) => t - now < CHECK_MS)
  return near.length ? Math.min(...near) : null
}

let started = false
let precise: ReturnType<typeof setTimeout> | undefined
/** Call once, with the desktop. Safe to call again; never throws. */
export function startAlarmService() {
  if (started) return
  started = true
  const run = () => {
    try {
      checkClock()
      clearTimeout(precise)
      const now = Date.now()
      const due = soonestDue(now)
      if (due !== null) precise = setTimeout(run, Math.max(0, due - now) + 50)
    } catch {
      /* one bad check must not stop the next */
    }
  }
  // A change from the Clock window (a timer started) is looked at straight away.
  try {
    window.addEventListener('storage', (e) => {
      if (
        e.key &&
        e.key.startsWith('udaan.clock.') &&
        e.key !== 'udaan.clock.ringing' &&
        e.key !== 'udaan.clock.fired'
      )
        run()
    })
  } catch {
    /* no window: the regular check still runs */
  }
  try {
    setTimeout(run, 3000)
    setInterval(run, CHECK_MS)
  } catch {
    started = false
  }
}
