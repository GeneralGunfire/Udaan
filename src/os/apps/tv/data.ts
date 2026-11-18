import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { createEvent, deleteEvent } from '@/integrations/schedule/client'
import { searchName, type Reminder, type Title } from './types'

/* ── catalogue ───────────────────────────────────────────────────── */

const TTL = 20 * 60_000
const memo = new Map<string, { at: number; p: Promise<Title[]> }>()

function cached(kind: string): Title[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(`tv.cache.${kind}`) ?? 'null')
    return Array.isArray(raw?.items) ? raw.items : null
  } catch {
    return null
  }
}

export function browse(kind: 'movie' | 'show', force = false): Promise<Title[]> {
  const hit = memo.get(kind)
  if (hit && !force && Date.now() - hit.at < TTL) return hit.p
  const p = invoke<Title[]>('tv_browse', { kind }).then((items) => {
    try {
      localStorage.setItem(`tv.cache.${kind}`, JSON.stringify({ items }))
    } catch {
      /* not cached */
    }
    return items
  })
  memo.set(kind, { at: Date.now(), p })
  p.catch(() => memo.delete(kind))
  return p
}

/** This week's top films or series. Shows the last saved list at once, then refreshes it. */
export function useBrowse(kind: 'movie' | 'show') {
  const [state, setState] = useState(() => ({ items: cached(kind) ?? ([] as Title[]), loading: true, error: null as string | null }))
  const load = useCallback(
    (force = false) => {
      setState((s) => ({ ...s, loading: true, error: null }))
      browse(kind, force).then(
        (items) => setState({ items, loading: false, error: null }),
        (e) => setState((s) => ({ ...s, loading: false, error: typeof e === 'string' ? e : ((e as Error)?.message ?? 'Could not load.') })),
      )
    },
    [kind],
  )
  useEffect(() => load(), [load])
  return { ...state, reload: () => load(true) }
}

export const searchTitles = (term: string) => invoke<Title[]>('tv_search', { term })
export const lookupTitle = (id: string) => invoke<Title | null>('tv_lookup', { id })

/* ── reminders (they become Calendar events) ─────────────────────── */

const p2 = (n: number) => String(n).padStart(2, '0')
export const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Sensible times to offer: this evening (when it is still ahead), tomorrow evening, and the weekend. */
export function reminderOptions(now = new Date()): { label: string; at: Date }[] {
  const at = (d: Date, h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m)
  const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
  const out: { label: string; at: Date }[] = []
  const tonight = at(day(0), 20)
  if (tonight.getTime() - now.getTime() > 30 * 60_000) out.push({ label: 'This evening', at: tonight })
  out.push({ label: 'Tomorrow evening', at: at(day(1), 20) })
  const toSat = (6 - now.getDay() + 7) % 7 || 7
  if (toSat > 1) out.push({ label: 'This weekend', at: at(day(toSat), 19) })
  return out
}

export async function addReminder(t: Title, serviceName: string | undefined, at: Date): Promise<Reminder> {
  const dur = t.runtimeMin && t.runtimeMin > 0 ? t.runtimeMin : t.kind === 'show' ? 50 : 120
  const end = new Date(at.getTime() + dur * 60_000)
  const sameDay = end.getDate() === at.getDate()
  const ev = await createEvent({
    title: `Watch ${searchName(t)}`,
    date: `${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())}`,
    startTime: `${p2(at.getHours())}:${p2(at.getMinutes())}`,
    endTime: sameDay ? `${p2(end.getHours())}:${p2(end.getMinutes())}` : '23:59',
    description: serviceName ? `On ${serviceName} (from Udaan TV)` : 'From Udaan TV',
    category: 'personal',
    durationMinutes: dur,
  })
  return { eventId: ev.id, atMs: at.getTime(), label: fmtWhen(at.getTime()) }
}

export const clearReminder = (r: Reminder) => deleteEvent(r.eventId).catch(() => {})
