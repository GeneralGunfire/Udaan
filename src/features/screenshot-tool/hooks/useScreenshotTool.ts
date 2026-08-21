import { useCallback, useEffect, useState } from 'react'
import {
  listMonitors,
  listCapturableWindows,
  captureScreen,
  captureWindow,
  captureRegion,
  listScreenshotHistory,
  copyScreenshotToClipboard,
  type ScreenshotEntry,
  type MonitorInfo,
  type WindowInfo,
} from '@/integrations/screenshot-tool'

export function useScreenshotTool() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [history, setHistory] = useState<ScreenshotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastCapture, setLastCapture] = useState<ScreenshotEntry | null>(null)

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listScreenshotHistory())
    } catch (err) {
      console.error('Failed to load screenshot history', err)
    }
  }, [])

  const refreshTargets = useCallback(async () => {
    try {
      const [foundMonitors, foundWindows] = await Promise.all([listMonitors(), listCapturableWindows()])
      setMonitors(foundMonitors)
      setWindows(foundWindows)
    } catch (err) {
      console.error('Failed to enumerate capture targets', err)
    }
  }, [])

  useEffect(() => {
    Promise.all([refreshTargets(), refreshHistory()]).finally(() => setLoading(false))
  }, [refreshTargets, refreshHistory])

  const runCapture = useCallback(
    async (fn: () => Promise<ScreenshotEntry>) => {
      setError(null)
      setCapturing(true)
      try {
        const entry = await fn()
        setLastCapture(entry)
        setHistory((prev) => [entry, ...prev])
        return entry
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setCapturing(false)
      }
    },
    [],
  )

  const captureFullScreen = useCallback(
    (monitorIndex: number) => runCapture(() => captureScreen(monitorIndex)),
    [runCapture],
  )

  const captureOneWindow = useCallback(
    (windowIndex: number) => runCapture(() => captureWindow(windowIndex)),
    [runCapture],
  )

  const captureScreenRegion = useCallback(
    (monitorIndex: number, x: number, y: number, width: number, height: number) =>
      runCapture(() => captureRegion(monitorIndex, x, y, width, height)),
    [runCapture],
  )

  const copyToClipboard = useCallback(async (entry: ScreenshotEntry) => {
    try {
      await copyScreenshotToClipboard(entry.path)
    } catch (err) {
      console.error('Failed to copy screenshot to clipboard', err)
    }
  }, [])

  return {
    monitors,
    windows,
    history,
    loading,
    capturing,
    error,
    lastCapture,
    captureFullScreen,
    captureOneWindow,
    captureScreenRegion,
    copyToClipboard,
  }
}
