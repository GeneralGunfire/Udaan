import { Button, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import {
  KEYS,
  focusRemaining,
  loadFocus,
  phaseMs,
  saveFocus,
  type FocusPhase,
  type FocusSettings,
  type FocusState,
} from './store'
import {
  Ico,
  P,
  PaneHeader,
  Ring,
  fmtDuration,
  useKeys,
  useNow,
  useStored,
} from './ui'

const PHASES: { id: FocusPhase; name: string }[] = [
  { id: 'focus', name: 'Focus' },
  { id: 'short', name: 'Short break' },
  { id: 'long', name: 'Long break' },
]

const loadNow = () => loadFocus()

/** Pomodoro-style sessions. Switching phase when time is up is done by the background service, so it works closed. */
export function Focus() {
  const now = useNow(1000)
  const [f, setF] = useStored<FocusState>(KEYS.focus, loadNow, saveFocus)
  const left = focusRemaining(f, now)
  const total = phaseMs(f.phase, f.settings)

  const start = () =>
    setF((s) =>
      s.running
        ? s
        : {
            ...s,
            running: true,
            endsAt:
              Date.now() +
              (s.remainingMs > 0
                ? s.remainingMs
                : phaseMs(s.phase, s.settings)),
          },
    )
  const pause = () =>
    setF((s) =>
      s.running
        ? {
            ...s,
            running: false,
            endsAt: null,
            remainingMs: focusRemaining(s, Date.now()),
          }
        : s,
    )
  const reset = () =>
    setF((s) => ({
      ...s,
      running: false,
      endsAt: null,
      remainingMs: phaseMs(s.phase, s.settings),
    }))
  const choose = (p: FocusPhase) =>
    setF((s) => ({
      ...s,
      phase: p,
      running: false,
      endsAt: null,
      remainingMs: phaseMs(p, s.settings),
    }))
  const skip = () => {
    const next: FocusPhase =
      f.phase === 'focus'
        ? (f.cycle + 1) % f.settings.longEvery === 0
          ? 'long'
          : 'short'
        : 'focus'
    choose(next)
  }
  const setting = (patch: Partial<FocusSettings>) =>
    setF((s) => {
      const settings = { ...s.settings, ...patch }
      // A change to the length of the phase that is not running applies straight away.
      return s.running
        ? { ...s, settings }
        : { ...s, settings, remainingMs: phaseMs(s.phase, settings) }
    })

  useKeys((e) => {
    if (e.key === ' ') (e.preventDefault(), f.running ? pause() : start())
    else if (e.key === 'r' || e.key === 'R') (e.preventDefault(), reset())
  })

  const stepper = (
    label: string,
    value: number,
    min: number,
    max: number,
    set: (n: number) => void,
  ) => (
    <div className="flex items-center gap-3 py-2">
      <span className="flex-1 text-[13px]">{label}</span>
      <Button
        icon
        size="sm"
        variant="tinted"
        aria-label={`Less ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        <Ico d="M3 8h10" size={12} />
      </Button>
      <span
        className="w-[56px] text-center text-[13px] tabular-nums"
        aria-live="polite"
      >
        {value} min
      </span>
      <Button
        icon
        size="sm"
        variant="tinted"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        <Ico d={P.plus} size={12} />
      </Button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="Focus" />
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-5 px-6 pt-6 pb-6">
          <div className="u-seg" role="tablist" aria-label="Session">
            {PHASES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={f.phase === p.id}
                data-state={f.phase === p.id ? 'on' : 'off'}
                onClick={() => choose(p.id)}
                className="u-seg__item"
              >
                {p.name}
              </button>
            ))}
          </div>
          <Ring fraction={total ? left / total : 0} size={200} stroke={7}>
            <span
              className="text-[44px] leading-none font-semibold tracking-tight tabular-nums"
              role="timer"
            >
              {fmtDuration(Math.ceil(left / 1000) * 1000)}
            </span>
            <span className="mt-2 text-[12px] text-(--u-ink-3)">
              {f.running
                ? f.phase === 'focus'
                  ? 'Focusing'
                  : 'On a break'
                : 'Paused'}
            </span>
          </Ring>
          <div className="flex gap-2">
            <Button
              size="lg"
              variant={f.running ? 'tinted' : 'accent'}
              onClick={f.running ? pause : start}
              className="w-[120px]"
              title="Start or pause (Space)"
            >
              <Ico d={f.running ? P.pause : P.play} size={14} />{' '}
              {f.running ? 'Pause' : 'Start'}
            </Button>
            <Button
              size="lg"
              variant="tinted"
              onClick={reset}
              title="Reset (R)"
            >
              <Ico d={P.reset} size={14} /> Reset
            </Button>
            <Button size="lg" variant="ghost" onClick={skip}>
              Skip
            </Button>
          </div>
          <div
            className="flex gap-1.5"
            aria-label={`Session ${(f.cycle % f.settings.longEvery) + 1} of ${f.settings.longEvery}`}
          >
            {Array.from({ length: f.settings.longEvery }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-6 rounded-full',
                  i < f.cycle % f.settings.longEvery
                    ? 'bg-(--u-accent)'
                    : 'bg-(--u-wash-press)',
                )}
              />
            ))}
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-[520px] grid-cols-2 gap-3 px-6">
          <div className="rounded-[12px] bg-(--u-wash-hover) p-4 shadow-[inset_0_0_0_1px_var(--u-edge)]">
            <p className="u-label">Focused today</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">
              {fmtHours(f.todayMs)}
            </p>
          </div>
          <div className="rounded-[12px] bg-(--u-wash-hover) p-4 shadow-[inset_0_0_0_1px_var(--u-edge)]">
            <p className="u-label">Sessions today</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">
              {f.todaySessions}
            </p>
          </div>
        </div>

        <section className="mx-auto mt-5 w-full max-w-[520px] px-6 pb-8">
          <p className="u-label pb-1">Lengths</p>
          {stepper('Focus', f.settings.focusMin, 1, 180, (n) =>
            setting({ focusMin: n }),
          )}
          {stepper('Short break', f.settings.shortMin, 1, 60, (n) =>
            setting({ shortMin: n }),
          )}
          {stepper('Long break', f.settings.longMin, 1, 120, (n) =>
            setting({ longMin: n }),
          )}
          <div className="flex items-center gap-3 py-2">
            <span className="flex-1 text-[13px]">Long break after</span>
            <Button
              icon
              size="sm"
              variant="tinted"
              aria-label="Fewer sessions"
              disabled={f.settings.longEvery <= 2}
              onClick={() => setting({ longEvery: f.settings.longEvery - 1 })}
            >
              <Ico d="M3 8h10" size={12} />
            </Button>
            <span className="w-[56px] text-center text-[13px] tabular-nums">
              {f.settings.longEvery} sessions
            </span>
            <Button
              icon
              size="sm"
              variant="tinted"
              aria-label="More sessions"
              disabled={f.settings.longEvery >= 12}
              onClick={() => setting({ longEvery: f.settings.longEvery + 1 })}
            >
              <Ico d={P.plus} size={12} />
            </Button>
          </div>
          <label className="flex items-center gap-3 py-2">
            <span className="flex-1">
              <span className="block text-[13px]">
                Start the next one automatically
              </span>
              <span className="block text-[12px] text-(--u-ink-3)">
                A notification marks every switch either way.
              </span>
            </span>
            <Switch
              checked={f.settings.autoStart}
              onChange={(v) => setting({ autoStart: v })}
              label="Start the next session automatically"
            />
          </label>
        </section>
      </div>
    </div>
  )
}

function fmtHours(ms: number) {
  const mins = Math.round(ms / 60_000)
  const h = Math.floor(mins / 60)
  return h ? `${h} h ${mins % 60} min` : `${mins} min`
}
