import { pushNotification } from '@/integrations/notifications/client'
import { fmtDay, occurrenceDays, parseDay, parseRule, reminderLabel } from '@/features/calendar/lib/recurrence'
import { listEvents } from './client'

/**
 * Calendar reminders. Started once with the desktop, so they fire whether or not the Calendar is open. Every
 * minute it looks at today's and tomorrow's events (repeating ones included) and, once an event's reminder time
 * has come, raises a notification, once. An event that has already started but not finished still reminds if the
 * app was off at the time; one that is over does not.
 */

const FIRED_KEY = 'udaan.reminders.fired'
const ALL_DAY_HOUR = 9

function readFired(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function remember(list: string[]) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(list.slice(-500)))
  } catch {
    /* not remembered: a reminder may repeat after a restart, which is better than a missed one */
  }
}

export async function checkReminders(now = new Date()): Promise<number> {
  const events = (await listEvents()).filter((e) => e.date && e.reminderMinutes != null && e.status !== 'done')
  if (!events.length) return 0
  const from = fmtDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const to = fmtDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2))
  const fired = readFired()
  let sent = 0
  for (const e of events) {
    const rule = parseRule(e.recurrence)
    const days = rule ? occurrenceDays(e.date, rule, from, to) : e.date >= from && e.date <= to ? [e.date] : []
    for (const day of days) {
      const [h, m] = e.allDay || !e.startTime ? [ALL_DAY_HOUR, 0] : e.startTime.split(':').map(Number)
      const d = parseDay(day)
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime()
      const dur = (e.allDay ? 60 : (e.durationMinutes ?? 30)) * 60_000
      const at = start - (e.reminderMinutes ?? 0) * 60_000
      const key = `${e.id}@${day}@${e.reminderMinutes}`
      if (now.getTime() < at || now.getTime() > start + dur || fired.includes(key)) continue
      fired.push(key)
      sent++
      const mins = Math.round((start - now.getTime()) / 60_000)
      const when = e.allDay ? 'today' : new Date(start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      await pushNotification({
        kind: 'reminder',
        title: e.title,
        body: mins > 1 ? `${when}, in ${mins >= 90 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`}` : mins >= -1 ? `${when}, starting now` : `${when}, started ${Math.abs(mins)} minutes ago`,
        sourceApp: 'calendar',
      }).catch(() => {})
      void reminderLabel
    }
  }
  if (sent) remember(fired)
  return sent
}

let started = false
/** Call once, with the desktop. */
export function startReminderService() {
  if (started) return
  started = true
  const run = () => void checkReminders().catch(() => {})
  setTimeout(run, 8000)
  setInterval(run, 60_000)
}
