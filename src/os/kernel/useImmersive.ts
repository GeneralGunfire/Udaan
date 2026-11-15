import { useEffect, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { useShell } from './shell'

/** An app (the TV) asking the shell bars to step aside while it is full screen. */
export function setImmersive(on: boolean) {
  void emit('shell://immersive', on)
}

/** True while an app has asked for the screen to itself — and only while
 * that app's window still exists, so a crash or forced close can't leave
 * the bars hidden. */
export function useImmersive() {
  const [on, setOn] = useState(false)
  const tvOpen = useShell((s) => s.windows.some((w) => w.appId === 'tv' && !w.isMinimized))
  useEffect(() => {
    const un = listen<boolean>('shell://immersive', (e) => setOn(!!e.payload))
    return () => void un.then((f) => f())
  }, [])
  return on && tvOpen
}

/**
 * True while a lock screen or the screensaver covers the whole screen. The bars HIDE for it, nothing more:
 * they keep their reserved strip, so the desktop never reflows when a lock comes or goes. (Full-screen apps are
 * different: those give the strip back, see `useImmersive`.)
 */
export function useCovered() {
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    const un = listen<boolean>('shell://cover', (e) => setCovered(!!e.payload))
    // A bar that starts after the cover went up asks the launcher to say again.
    void emit('shell://cover-query')
    return () => void un.then((f) => f())
  }, [])
  return covered
}
