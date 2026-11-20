import { useEffect, useState } from 'react'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { Alarms } from './Alarms'
import { Focus } from './Focus'
import { Stopwatch } from './Stopwatch'
import {
  KEYS,
  loadAlarms,
  loadRinging,
  loadTab,
  saveAlarms,
  saveRinging,
  saveTab,
  type Ringing,
} from './store'
import { Timers } from './Timers'
import { Dialog, Ico, P, announce } from './ui'
import { WorldClock } from './WorldClock'

type Tab = 'world' | 'alarms' | 'stopwatch' | 'timer' | 'focus'
const TABS: [Tab, string, string][] = [
  ['world', 'World Clock', P.globe],
  ['alarms', 'Alarms', P.alarm],
  ['stopwatch', 'Stopwatch', P.stopwatch],
  ['timer', 'Timers', P.timer],
  ['focus', 'Focus', P.focus],
]
const isTab = (t: string): t is Tab => TABS.some(([id]) => id === t)

/** How long a ring stays on screen if nobody answers it. */
const RING_SHOWN_MS = 10 * 60_000

/**
 * CLOCK. World clock, alarms, stopwatch, timers and focus sessions. Alarms, timers and focus
 * switches are rung by a background service on the desktop, so they work with this window closed.
 *   Ctrl+1..5 tabs    Space start/stop    L lap    R reset    N new    Del remove    Esc close
 */
export function ClockApp(_props: { onClose: () => void }) {
  const [tab, setTabState] = useState<Tab>(() => {
    const t = loadTab()
    return isTab(t) ? t : 'world'
  })
  const [ringing, setRinging] = useState<Ringing | null>(loadRinging)

  const setTab = (t: Tab) => {
    setTabState(t)
    saveTab(t)
  }

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEYS.ringing || e.key === null) setRinging(loadRinging())
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) {
        e.preventDefault()
        setTab(TABS[n - 1][0])
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // A ring that came and went long ago is not shown.
  const live =
    ringing && Date.now() - ringing.at < RING_SHOWN_MS ? ringing : null
  const stop = () => {
    saveRinging(null)
    setRinging(null)
  }
  const snoozeAlarm =
    live?.kind === 'alarm'
      ? loadAlarms().find((a) => a.id === live.id)
      : undefined
  const snooze = () => {
    if (!snoozeAlarm) return stop()
    const until = Date.now() + snoozeAlarm.snoozeMin * 60_000
    saveAlarms(
      loadAlarms().map((a) =>
        a.id === snoozeAlarm.id
          ? { ...a, enabled: true, snoozeUntil: until }
          : a,
      ),
    )
    announce(KEYS.alarms)
    stop()
  }

  return (
    <div className="relative flex h-full text-(--u-ink)">
      <nav
        className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r border-(--u-edge) px-2.5 py-4"
        aria-label="Clock"
      >
        <h1 className="px-2.5 pb-3 text-[18px] font-semibold tracking-tight">
          Clock
        </h1>
        {TABS.map(([id, label, icon], i) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            title={`${label} (Ctrl+${i + 1})`}
            className={cn(
              'flex h-[32px] items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
              tab === id
                ? 'bg-(--u-wash-on) font-medium'
                : 'text-(--u-ink-2) hover:bg-(--u-wash-hover) hover:text-(--u-ink)',
            )}
          >
            <Ico d={icon} size={14} />
            <span className="flex-1">{label}</span>
          </button>
        ))}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {tab === 'world' && <WorldClock />}
        {tab === 'alarms' && <Alarms />}
        {tab === 'stopwatch' && <Stopwatch />}
        {tab === 'timer' && <Timers />}
        {tab === 'focus' && <Focus />}
      </main>

      {live && (
        <Dialog
          title={
            live.kind === 'alarm'
              ? 'Alarm'
              : live.kind === 'timer'
                ? 'Timer'
                : 'Focus'
          }
          onClose={stop}
          width={340}
          footer={
            <>
              {snoozeAlarm && (
                <Button variant="tinted" onClick={snooze}>
                  Snooze {snoozeAlarm.snoozeMin} min
                </Button>
              )}
              <Button variant="accent" onClick={stop}>
                {live.kind === 'alarm' ? 'Stop' : 'OK'}
              </Button>
            </>
          }
        >
          <div className="flex items-center gap-4" role="alert">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--u-wash-on) text-(--u-accent)">
              <Ico
                d={
                  live.kind === 'alarm'
                    ? P.alarm
                    : live.kind === 'timer'
                      ? P.timer
                      : P.focus
                }
                size={20}
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">
                {live.title}
              </span>
              <span className="block text-[13px] text-(--u-ink-2)">
                {live.body}
              </span>
            </span>
          </div>
        </Dialog>
      )}
    </div>
  )
}
