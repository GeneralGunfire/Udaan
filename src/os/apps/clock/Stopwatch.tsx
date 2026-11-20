import { useEffect, useRef } from 'react'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import {
  KEYS,
  loadStopwatch,
  saveStopwatch,
  type Stopwatch as SW,
} from './store'
import {
  Empty,
  Ico,
  P,
  PaneHeader,
  fmtDuration,
  useKeys,
  useStored,
} from './ui'

const elapsed = (s: SW, now: number) =>
  s.accumulated + (s.running && s.startedAt ? now - s.startedAt : 0)

/**
 * The running time is written straight into the DOM from requestAnimationFrame, and only while
 * running and visible, so React does not render per frame. The start time and banked time are
 * stored, so it keeps counting across tab switches and with the window closed.
 */
export function Stopwatch() {
  const [sw, setSw] = useStored<SW>(
    KEYS.stopwatch,
    loadStopwatch,
    saveStopwatch,
  )
  const big = useRef<HTMLSpanElement>(null)
  const lapLive = useRef<HTMLSpanElement>(null)
  const swRef = useRef(sw)
  swRef.current = sw

  useEffect(() => {
    const paint = () => {
      const s = swRef.current
      const e = elapsed(s, Date.now())
      if (big.current) big.current.textContent = fmtDuration(e, true)
      if (lapLive.current)
        lapLive.current.textContent = fmtDuration(
          e - (s.laps[s.laps.length - 1] ?? 0),
          true,
        )
    }
    paint()
    if (!sw.running) return
    let raf = 0
    const loop = () => {
      paint()
      raf = requestAnimationFrame(loop)
    }
    const onVis = () => {
      cancelAnimationFrame(raf)
      if (document.visibilityState === 'visible') loop()
    }
    if (document.visibilityState === 'visible') loop()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [sw])

  const start = () =>
    setSw((s) =>
      s.running ? s : { ...s, running: true, startedAt: Date.now() },
    )
  const stop = () =>
    setSw((s) =>
      s.running
        ? {
            ...s,
            running: false,
            accumulated: elapsed(s, Date.now()),
            startedAt: null,
          }
        : s,
    )
  const lap = () =>
    setSw((s) =>
      s.running ? { ...s, laps: [...s.laps, elapsed(s, Date.now())] } : s,
    )
  const reset = () =>
    setSw({ running: false, startedAt: null, accumulated: 0, laps: [] })
  const toggle = () => (sw.running ? stop() : start())

  useKeys((e) => {
    if (e.key === ' ') (e.preventDefault(), toggle())
    else if (e.key === 'l' || e.key === 'L') (e.preventDefault(), lap())
    else if (e.key === 'r' || e.key === 'R')
      (e.preventDefault(), !sw.running && reset())
  })

  // Laps as durations, newest first; fastest and slowest marked once there are at least two.
  const splits = sw.laps.map((t, i) => ({
    n: i + 1,
    split: t - (sw.laps[i - 1] ?? 0),
    total: t,
  }))
  const fastest =
    splits.length > 1 ? Math.min(...splits.map((s) => s.split)) : null
  const slowest =
    splits.length > 1 ? Math.max(...splits.map((s) => s.split)) : null
  const hasTime = sw.running || sw.accumulated > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="Stopwatch" />
      <div className="flex shrink-0 flex-col items-center gap-6 px-6 pt-10 pb-6">
        <span
          ref={big}
          className="text-[64px] leading-none font-semibold tracking-tight tabular-nums"
          role="timer"
          aria-live="off"
        >
          {fmtDuration(elapsed(sw, Date.now()), true)}
        </span>
        <div className="flex gap-2">
          <Button
            size="lg"
            variant={sw.running ? 'tinted' : 'accent'}
            onClick={toggle}
            className="w-[120px]"
            title="Start or stop (Space)"
          >
            <Ico d={sw.running ? P.pause : P.play} size={14} />{' '}
            {sw.running ? 'Stop' : hasTime ? 'Resume' : 'Start'}
          </Button>
          {sw.running ? (
            <Button
              size="lg"
              variant="tinted"
              onClick={lap}
              className="w-[120px]"
              title="Lap (L)"
            >
              <Ico d={P.flag} size={14} /> Lap
            </Button>
          ) : (
            <Button
              size="lg"
              variant="tinted"
              onClick={reset}
              disabled={!hasTime}
              className="w-[120px]"
              title="Reset (R)"
            >
              <Ico d={P.reset} size={14} /> Reset
            </Button>
          )}
        </div>
      </div>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto border-t border-(--u-edge) px-5">
        {splits.length === 0 && !sw.running ? (
          <Empty>
            Laps appear here. Space starts and stops, L marks a lap, R resets.
          </Empty>
        ) : (
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="text-left text-[11px] text-(--u-ink-3)">
                <th className="py-2 font-semibold">Lap</th>
                <th className="py-2 text-right font-semibold">Lap time</th>
                <th className="py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {sw.running && (
                <tr className="border-t border-(--u-edge) text-(--u-ink-2)">
                  <td className="py-2">{splits.length + 1}</td>
                  <td className="py-2 text-right">
                    <span ref={lapLive} />
                  </td>
                  <td className="py-2 text-right text-(--u-ink-3)">running</td>
                </tr>
              )}
              {[...splits].reverse().map((s) => {
                const tag =
                  s.split === fastest
                    ? 'Fastest'
                    : s.split === slowest
                      ? 'Slowest'
                      : null
                return (
                  <tr key={s.n} className="border-t border-(--u-edge)">
                    <td className="py-2">
                      {s.n}
                      {tag && (
                        <span
                          className={cn(
                            'ml-2 text-[11px] font-semibold',
                            tag === 'Fastest'
                              ? 'text-(--u-ok)'
                              : 'text-(--u-danger)',
                          )}
                        >
                          {tag}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'py-2 text-right',
                        tag === 'Fastest' && 'text-(--u-ok)',
                        tag === 'Slowest' && 'text-(--u-danger)',
                      )}
                    >
                      {fmtDuration(s.split, true)}
                    </td>
                    <td className="py-2 text-right text-(--u-ink-2)">
                      {fmtDuration(s.total, true)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
