import { useState } from 'react'
import { Button } from '@/os/ui/controls'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { cn } from '@/shared/lib/cn'
import {
  KEYS,
  loadTimers,
  saveTimers,
  timerRemaining,
  uid,
  type Timer,
} from './store'
import {
  Dialog,
  Empty,
  Ico,
  P,
  PaneHeader,
  Ring,
  fmtDuration,
  useKeys,
  useNow,
  useStored,
} from './ui'

const PRESETS: [string, number][] = [
  ['1 min', 1],
  ['5 min', 5],
  ['10 min', 10],
  ['15 min', 15],
  ['30 min', 30],
  ['1 hour', 60],
]

/** Several timers at once. They count against a stored end time, so they keep going with the window closed. */
export function Timers() {
  const now = useNow(1000)
  const [timers, setTimers] = useStored<Timer[]>(
    KEYS.timers,
    loadTimers,
    saveTimers,
  )
  const [sel, setSel] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const openMenu = useShellMenu()

  const patch = (id: string, f: (t: Timer) => Timer) =>
    setTimers((list) => list.map((t) => (t.id === id ? f(t) : t)))
  const startT = (t: Timer): Timer => {
    const left =
      t.state === 'done' || t.remainingMs <= 0 ? t.durationMs : t.remainingMs
    return {
      ...t,
      state: 'running',
      endsAt: Date.now() + left,
      remainingMs: left,
    }
  }
  const pauseT = (t: Timer): Timer => ({
    ...t,
    state: 'paused',
    endsAt: null,
    remainingMs: timerRemaining(t, Date.now()),
  })
  const resetT = (t: Timer): Timer => ({
    ...t,
    state: 'idle',
    endsAt: null,
    remainingMs: t.durationMs,
  })
  const toggle = (t: Timer) =>
    patch(t.id, (x) => (x.state === 'running' ? pauseT(x) : startT(x)))
  const add = (durationMs: number, label: string, run = true) => {
    const t: Timer = {
      id: uid(),
      label,
      durationMs,
      state: 'idle',
      endsAt: null,
      remainingMs: durationMs,
    }
    setTimers((list) => [...list, run ? startT(t) : t])
    setSel(t.id)
  }
  const remove = (id: string) =>
    setTimers((list) => list.filter((t) => t.id !== id))

  const selected = timers.find((t) => t.id === sel) ?? null
  useKeys((e) => {
    if (e.key === 'n' || e.key === 'N') (e.preventDefault(), setAdding(true))
    else if (!selected) return
    else if (e.key === ' ') (e.preventDefault(), toggle(selected))
    else if (e.key === 'r' || e.key === 'R')
      (e.preventDefault(), patch(selected.id, resetT))
    else if (e.key === 'Delete') (e.preventDefault(), remove(selected.id))
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="Timers">
        <Button
          size="sm"
          variant="tinted"
          onClick={() => setAdding(true)}
          title="New timer (N)"
        >
          <Ico d={P.plus} size={13} /> New timer
        </Button>
      </PaneHeader>
      <div
        className="flex shrink-0 flex-wrap gap-1.5 px-5 pt-3"
        role="group"
        aria-label="Quick timers"
      >
        {PRESETS.map(([label, min]) => (
          <Button
            key={label}
            size="sm"
            variant="tinted"
            onClick={() =>
              add(
                min * 60_000,
                label === '1 hour' ? '1 hour' : `${min} minutes`,
              )
            }
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {timers.length === 0 && (
          <Empty>
            Start a quick timer above, or make one with its own length and name.
            They ring even with this window closed.
          </Empty>
        )}
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          }}
        >
          {timers.map((t) => {
            const left = timerRemaining(t, now)
            const done = t.state === 'done'
            return (
              <div
                key={t.id}
                role="group"
                aria-label={`${t.label || 'Timer'}, ${fmtDuration(left)} left`}
                tabIndex={0}
                onFocus={() => setSel(t.id)}
                onClick={() => setSel(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setSel(t.id)
                  openMenu(e, [
                    { label: t.state === 'running' ? 'Pause' : t.state === 'paused' ? 'Resume' : 'Start', icon: t.state === 'running' ? 'pause' : 'play', shortcut: 'Space', onSelect: () => toggle(t) },
                    { label: 'Reset', icon: 'refresh', shortcut: 'R', disabled: t.state === 'idle', onSelect: () => patch(t.id, resetT) },
                    { label: 'Duplicate', icon: 'copy', onSelect: () => add(t.durationMs, t.label, false) },
                    {},
                    { label: 'Delete', icon: 'trash', shortcut: 'Del', danger: true, onSelect: () => remove(t.id) },
                  ])
                }}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-[14px] p-4 shadow-[inset_0_0_0_1px_var(--u-edge)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
                  sel === t.id ? 'bg-(--u-wash-on)' : 'bg-(--u-wash-hover)',
                )}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {t.label || 'Timer'}
                  </span>
                  <Button
                    icon
                    size="sm"
                    aria-label="Delete timer"
                    title="Delete (Del)"
                    className="hover:text-(--u-danger)"
                    onClick={(e) => (e.stopPropagation(), remove(t.id))}
                  >
                    <Ico d={P.close} size={12} />
                  </Button>
                </div>
                <Ring fraction={done ? 0 : left / t.durationMs} size={136}>
                  <span
                    className={cn(
                      'text-[26px] font-semibold tracking-tight tabular-nums',
                      done && 'text-(--u-accent)',
                    )}
                  >
                    {done ? 'Done' : fmtDuration(Math.ceil(left / 1000) * 1000)}
                  </span>
                  <span className="text-[11px] text-(--u-ink-3)">
                    {fmtDuration(t.durationMs)}
                  </span>
                </Ring>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant={t.state === 'running' ? 'tinted' : 'accent'}
                    onClick={(e) => (e.stopPropagation(), toggle(t))}
                    className="w-[84px]"
                  >
                    <Ico
                      d={t.state === 'running' ? P.pause : P.play}
                      size={12}
                    />{' '}
                    {t.state === 'running'
                      ? 'Pause'
                      : t.state === 'paused'
                        ? 'Resume'
                        : done
                          ? 'Restart'
                          : 'Start'}
                  </Button>
                  <Button
                    size="sm"
                    variant="tinted"
                    disabled={t.state === 'idle'}
                    onClick={(e) => (e.stopPropagation(), patch(t.id, resetT))}
                  >
                    <Ico d={P.reset} size={12} /> Reset
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {adding && (
        <NewTimer
          onClose={() => setAdding(false)}
          onAdd={(ms, label) => (add(ms, label), setAdding(false))}
        />
      )}
    </div>
  )
}

function NewTimer({
  onAdd,
  onClose,
}: {
  onAdd: (ms: number, label: string) => void
  onClose: () => void
}) {
  const [h, setH] = useState(0)
  const [m, setM] = useState(10)
  const [s, setS] = useState(0)
  const [label, setLabel] = useState('')
  const ms = ((h * 60 + m) * 60 + s) * 1000
  const box = (
    name: string,
    v: number,
    set: (n: number) => void,
    max: number,
  ) => (
    <label className="flex flex-col items-center gap-1">
      <input
        aria-label={name}
        inputMode="numeric"
        value={String(v).padStart(2, '0')}
        onChange={(e) =>
          set(
            Math.min(
              max,
              Math.max(
                0,
                Number(e.target.value.replace(/\D/g, '').slice(-2)) || 0,
              ),
            ),
          )
        }
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp')
            (e.preventDefault(), set(Math.min(max, v + 1)))
          else if (e.key === 'ArrowDown')
            (e.preventDefault(), set(Math.max(0, v - 1)))
          else if (e.key === 'Enter' && ms > 0)
            (e.preventDefault(), onAdd(ms, label))
        }}
        className="u-field h-12 w-[72px] text-center text-[24px] font-semibold tabular-nums"
      />
      <span className="text-[11px] text-(--u-ink-3)">{name}</span>
    </label>
  )
  return (
    <Dialog
      title="New timer"
      onClose={onClose}
      width={380}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={ms <= 0}
            onClick={() => onAdd(ms, label.trim())}
          >
            Start
          </Button>
        </>
      }
    >
      <div className="flex items-start justify-center gap-2">
        {box('Hours', h, setH, 99)}
        <span className="pt-2 text-[24px] font-semibold text-(--u-ink-3)">
          :
        </span>
        {box('Minutes', m, setM, 59)}
        <span className="pt-2 text-[24px] font-semibold text-(--u-ink-3)">
          :
        </span>
        {box('Seconds', s, setS, 59)}
      </div>
      <label className="mt-5 block">
        <span className="u-label">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 40))}
          onKeyDown={(e) =>
            e.key === 'Enter' && ms > 0 && onAdd(ms, label.trim())
          }
          placeholder="Timer"
          className="u-field mt-1.5 w-full"
        />
      </label>
    </Dialog>
  )
}
