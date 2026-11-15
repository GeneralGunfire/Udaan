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
  const [covered, setCovered] = useState(false)
  const tvOpen = useShell((s) => s.windows.some((w) => w.appId === 'tv' && !w.isMinimized))
  useEffect(() => {
    const un = listen<boolean>('shell://immersive', (e) => setOn(!!e.payload))
    // A lock screen or screensaver covers the whole screen: nothing of the shell may show over or beside it.
    const unCover = listen<boolean>('shell://cover', (e) => setCovered(!!e.payload))
    // A bar that starts after the cover went up asks the launcher to say again.
    void emit('shell://cover-query')
    return () => {
      void un.then((f) => f())
      void unCover.then((f) => f())
    }
  }, [])
  return (on && tvOpen) || covered
}
