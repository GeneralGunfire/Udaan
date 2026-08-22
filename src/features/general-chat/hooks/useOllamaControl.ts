import { useCallback, useEffect, useState } from 'react'
import { isReachable, startOllama, stopOllama, hasStartedOllama } from '@/integrations/local-model'

const POLL_MS = 3000

/**
 * Start/stop control for the local Ollama daemon, so the user doesn't need
 * a separate terminal open with `ollama serve` running just to use Local
 * mode. Polls reachability rather than assuming state — Ollama can also be
 * started/stopped outside the app (a background service, another
 * terminal), and the button should reflect reality either way.
 */
export function useOllamaControl() {
  const [running, setRunning] = useState(false)
  const [startedByApp, setStartedByApp] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [reachable, startedHere] = await Promise.all([isReachable(), hasStartedOllama()])
    setRunning(reachable)
    setStartedByApp(startedHere)
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
      await startOllama()
      // Give the daemon a moment to bind its port before the first
      // reachability check — an immediate check right after spawn
      // routinely still reads as unreachable.
      await new Promise((r) => setTimeout(r, 800))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }, [refresh])

  const stop = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      await stopOllama()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }, [refresh])

  return { running, startedByApp, pending, error, start, stop, clearError: () => setError(null) }
}
