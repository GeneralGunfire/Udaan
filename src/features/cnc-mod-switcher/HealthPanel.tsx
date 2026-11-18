import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/shared/components/ui/button'

interface Check {
  id: string
  title: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}
interface Health {
  checks: Check[]
  active_mod: string | null
}

const DOT = { ok: '#4cd37b', warn: '#d9a13b', fail: '#ff6a5f' } as const

/* ── a short log of what you did here ────────────────────────────── */

const ACTIVITY_KEY = 'udaan.cnc.activity'
interface Activity {
  at: number
  text: string
}
export function logActivity(text: string) {
  try {
    const list = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]') as Activity[]
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify([{ at: Date.now(), text }, ...list].slice(0, 30)))
  } catch {
    /* not remembered */
  }
}
const readActivity = (): Activity[] => {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]') as Activity[]
  } catch {
    return []
  }
}

/**
 * Health check and activity. The check only reads: it never changes the game install. It also finds which mod is
 * really active from the links on disk, so the Active badge is right even after Udaan was closed and reopened.
 */
export function HealthPanel({ refreshKey, onActive }: { refreshKey: number; onActive: (mod: string | null) => void }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<Activity[]>(readActivity)
  // The parent hands in a fresh function every render; keeping it in a ref stops that from re-running the check.
  const onActiveRef = useRef(onActive)
  useEffect(() => {
    onActiveRef.current = onActive
  }, [onActive])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const h = await invoke<Health>('cnc_health_check')
      setHealth(h)
      onActiveRef.current(h.active_mod)
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'The check could not run.')
    }
    setBusy(false)
    setActivity(readActivity())
  }, [])
  useEffect(() => void run(), [run, refreshKey])

  const problems = health?.checks.filter((c) => c.status !== 'ok').length ?? 0

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text-primary text-sm font-medium">Health check</h2>
          <p className="text-text-tertiary text-xs">{!health ? (busy ? 'Checking…' : '') : problems === 0 ? 'Everything looks good.' : `${problems} thing${problems === 1 ? '' : 's'} to look at.`} It only reads; it never changes your game.</p>
        </div>
        <Button type="button" variant="ghost" size="pill-sm" onClick={() => void run()} disabled={busy} className="rounded-lg">
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}
      {health && (
        <ul className="border-hairline overflow-hidden rounded-2xl border" style={{ background: 'var(--surface-raised)' }}>
          {health.checks.map((c, i) => (
            <li key={c.id} className={`flex items-start gap-3 px-4 py-2.5 ${i ? 'border-hairline border-t' : ''}`}>
              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[c.status] }} aria-label={c.status === 'ok' ? 'Fine' : c.status === 'warn' ? 'Needs a look' : 'Problem'} />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-[13px] font-medium">{c.title}</p>
                <p className="text-text-secondary text-xs leading-relaxed">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {activity.length > 0 && (
        <div>
          <h3 className="text-text-tertiary mb-1.5 mt-2 text-2xs font-semibold uppercase tracking-wide">Recent activity</h3>
          <ul className="flex flex-col gap-1">
            {activity.slice(0, 6).map((a) => (
              <li key={a.at} className="text-text-secondary flex justify-between gap-3 text-xs">
                <span className="truncate">{a.text}</span>
                <span className="text-text-tertiary shrink-0">{new Date(a.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
