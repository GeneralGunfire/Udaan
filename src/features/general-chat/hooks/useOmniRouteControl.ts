import { useCallback, useEffect, useState } from 'react'
import { isReachable, startOmniRoute, stopOmniRoute, hasStartedOmniRoute } from '@/integrations/omniroute'

const POLL_MS = 3000

/**
 * Start/stop control for the local OmniRoute daemon, so the user doesn't
 * need a separate terminal open with `omniroute serve` running just to use
 * OmniRoute mode. Mirrors `useOllamaControl` — polls reachability rather
 * than assuming state, since OmniRoute can also be started/stopped outside
 * the app, and the button should reflect reality either way.
 */
export function useOmniRouteControl() {
  const [running, setRunning] = useState(false)
  const [startedByApp, setStartedByApp] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [reachable, startedHere] = await Promise.all([isReachable(), hasStartedOmniRoute()])
    // Guard against redundant state writes — every 3s poll tick would
    // otherwise re-render the composer (and everything under it) even
    // when nothing about OmniRoute's status actually changed.
    setRunning((prev) => (prev === reachable ? prev : reachable))
    setStartedByApp((prev) => (prev === startedHere ? prev : startedHere))
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const start = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      await startOmniRoute()
      // The daemon process exists (per its pidfile, which `startOmniRoute`
      // already waits on server-side) well before its HTTP server is
      // actually listening — confirmed directly: a single reachability
      // check even several seconds after a successful start can still
      // time out. A single fixed 1s delay then one check was exactly what
      // made this read as "click Start, it goes off" — the button
      // correctly reflected `running: false` because the daemon genuinely
      // wasn't reachable YET, not because starting it had failed. Polling
      // for up to ~8s (rather than one guess at how long is "enough")
      // means slower cold starts still resolve to "running" once the
      // port actually opens, instead of the UI giving up early and
      // silently reverting to the Start state.
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        await refresh()
        if (await isReachable()) break
        await new Promise((r) => setTimeout(r, 500))
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }, [refresh])

  /** Stops the instance Udaan itself started. No-op (with an error) if it didn't start one. */
  const stop = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      await stopOmniRoute()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }, [refresh])

  return {
    running,
    startedByApp,
    pending,
    error,
    start,
    stop,
    clearError: () => setError(null),
  }
}
