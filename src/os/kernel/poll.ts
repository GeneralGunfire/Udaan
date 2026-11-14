import { useEffect } from 'react'
import { useLatest } from '@/os/ui/useLatest'

/**
 * The only way shell code should poll. The engine's governor tells every webview the
 * truth about whether its window can be seen (hidden, minimised, or covered by a
 * maximised window), so a poller that stops while hidden costs nothing instead of
 * waking the renderer, the IPC bridge and the process on the other side every tick.
 *
 * Runs `fn` immediately when the window becomes visible, then every `ms` while it stays
 * visible. Stops completely while hidden. `fn` is read through a ref, so a new closure
 * each render never restarts the timer.
 */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  const latest = useLatest(fn)
  useEffect(() => {
    if (!enabled) return
    let id: number | undefined
    const start = () => {
      if (id !== undefined) return
      latest.current()
      id = window.setInterval(() => latest.current(), ms)
    }
    const stop = () => {
      if (id === undefined) return
      window.clearInterval(id)
      id = undefined
    }
    const sync = () => (document.visibilityState === 'visible' ? start() : stop())
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      stop()
    }
  }, [ms, enabled, latest])
}
