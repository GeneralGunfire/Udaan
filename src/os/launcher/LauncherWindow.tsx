import { useCallback, useEffect, useRef, useState } from 'react'
import { onLayoutChange } from '@/os/kernel/uiScale'
import { AnimatePresence } from 'framer-motion'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { StartMenu } from './StartMenu'
import { invoke } from '@tauri-apps/api/core'
import { LockScreen, Screensaver } from './LockScreen'
import { playSound } from '@/os/sound/sounds'
import { onHotkey, shell, subscribeShell, useShell } from '@/os/kernel/shell'
import { Expose } from './Expose'
import { Switcher3D } from './Switcher3D'
import { Tips } from './Tips'
import { WallpaperPicker } from './WallpaperPicker'
import { getPref, setPref, usePref, type CORNER_KEYS } from '@/os/kernel/prefs'

type CornerKey = (typeof CORNER_KEYS)[number]
import { unregisterAllThumbnails } from '@/integrations/taskbar/client'

type Mode = 'idle' | 'launchpad' | 'screensaver' | 'expose' | 'wallpaper' | 'lock' | 'switcher' | 'tips'

const EXIT_MS = 240
const IDLE_POLL_MS = 5_000

/**
 * The topmost full-screen surface for the Start experience and the
 * screensaver. Hidden (and therefore receiving no input) whenever neither
 * is open; the desktop window can't host these because it is pinned
 * beneath every other window.
 */
export function LauncherWindow() {
  const [mode, setMode] = useState<Mode>('idle')
  const [expose, setExpose] = useState<{ title: string; handles: number[] | null } | null>(null)
  const modeRef = useRef<Mode>('idle')
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const fullscreen = useShell((s) => s.fullscreen)
  const [user, setUser] = useState('')
  const [gestureOrigin, setGestureOrigin] = useState<{ x: number; y: number } | null>(null)
  // How long Windows must be untouched before the screensaver starts. usePref listens for changes made
  // in Settings (a different window), so a new delay applies at once. The idle check below reads the ref.
  const [idleSeconds] = usePref('screensaver.idleSeconds')
  const idleSecondsRef = useRef(idleSeconds)
  idleSecondsRef.current = idleSeconds

  useEffect(() => {
    void invoke<string>('shell_user_name').then(setUser, () => {})
  }, [])

  useEffect(() => {
    subscribeShell()
  }, [])

  // Cover the monitor once, and again only if the display changes, so
  // opening Start is a single show() rather than four sequential IPC calls.
  useEffect(() => {
    const win = getCurrentWindow()
    const fit = async () => {
      try {
        const [monitor] = await shell.monitorOf()
        await win.setPosition(new PhysicalPosition(monitor.left, monitor.top))
        await win.setSize(new PhysicalSize(monitor.right - monitor.left, monitor.bottom - monitor.top))
      } catch (err) {
        console.error('[launcher] could not size to monitor', err)
      }
    }
    void fit()
    const un = win.onScaleChanged(() => void fit())
    const offLayout = onLayoutChange(() => void fit())
    return () => {
      offLayout()
      void un.then((fn) => fn())
    }
  }, [])

  const present = useCallback(async (next: Exclude<Mode, 'idle'>) => {
    // Nothing but unlocking takes the place of the lock screen.
    if (modeRef.current === 'lock' && next !== 'lock') return
    clearTimeout(hideTimer.current)
    // No live preview from a previous Exposé may survive into another surface.
    if (next !== 'expose') void unregisterAllThumbnails().catch(() => {})
    const win = getCurrentWindow()
    // Show/focus the OS window before swapping React state: the switcher
    // (and Exposé) start receiving gesture events immediately once the
    // drag begins, so any delay here reads as the carousel eating the
    // first several frames of the drag — the window must already be on
    // screen and focused before its content starts animating, not after.
    await win.show()
    await win.setFocus()
    modeRef.current = next
    setMode(next)
  }, [])

  const dismiss = useCallback(() => {
    if (modeRef.current === 'idle' || modeRef.current === 'lock') return
    modeRef.current = 'idle'
    setMode('idle')
    clearTimeout(hideTimer.current)
    // Let the exit animation play before the window disappears.
    hideTimer.current = setTimeout(() => {
      void unregisterAllThumbnails().catch(() => {})
      void getCurrentWindow().hide()
    }, EXIT_MS)
  }, [])

  const lock = useCallback(() => {
    if (modeRef.current === 'lock') return
    playSound('lock')
    void setPref('lock.active', true)
    void present('lock')
  }, [present])

  const unlock = useCallback(() => {
    void setPref('lock.active', false)
    modeRef.current = 'launchpad' // anything but 'lock', so dismiss runs
    dismiss()
  }, [dismiss])

  // Deliberately NO pre-warming of app windows: it used to create five
  // hidden full webviews (chat, files, calendar, notes, settings) ~8 s after
  // every boot, which cost hundreds of MB on a low-RAM PC. Apps open on
  // demand instead.

  // First run: walk through what Udaan can do, once.
  useEffect(() => {
    const t = setTimeout(() => {
      void getPref('tips.seen').then((seen) => {
        if (seen || modeRef.current !== 'idle') return
        void setPref('tips.seen', true)
        void present('tips')
      })
    }, 6000)
    return () => clearTimeout(t)
  }, [present])

  // A lock survives Udaan restarting.
  useEffect(() => {
    void getPref('lock.active').then((on) => on && lock())
  }, [lock])

  const endScreensaver = useCallback(() => {
    void getPref('lock.afterScreensaver').then((then) => {
      if (then) {
        modeRef.current = 'launchpad'
        lock()
      } else dismiss()
    })
  }, [dismiss, lock])

  const toggleLaunchpad = useCallback(() => {
    if (modeRef.current === 'launchpad') dismiss()
    else void present('launchpad')
  }, [dismiss, present])

  // Win key, Win+S, Ctrl+Space, and the dock's Start button.
  useEffect(() => {
    const subs = [
      onHotkey((id) => {
        if (id.startsWith('corner-')) {
          void getPref(`corners.${id.slice(7)}` as CornerKey).then((action) => {
            if (action === 'task-view') {
              setExpose({ title: 'All windows', handles: null })
              void present('expose')
            } else if (action === 'start') toggleLaunchpad()
            else if (action === 'show-desktop') void shell.toggleDesktop()
            else if (action === 'notifications') void emit('dock:open-notifications')
            else if (action === 'screensaver') void present('screensaver')
          })
        } else if (id === 'start' || id === 'search') toggleLaunchpad()
        else if (id === 'task-view') {
          setExpose({ title: 'All windows', handles: null })
          void present('expose')
        } else if (id === 'switcher-ctrl') {
          // Double-tap Ctrl: open the switcher from anywhere, and again to close it.
          if (modeRef.current === 'switcher') return dismiss()
          if (modeRef.current !== 'idle' && modeRef.current !== 'launchpad') return
          setGestureOrigin(null)
          void present('switcher')
        }
      }),
      listen('global-shortcut:open-launchpad', toggleLaunchpad),
      listen('launcher:toggle', toggleLaunchpad),
      listen('launcher:screensaver', () => void present('screensaver')),
      listen('launcher:lock', lock),
      listen('launcher:tips', () => void present('tips')),
      listen<{ x: number; y: number }>('gesture://start', (e) => {
        if (modeRef.current !== 'idle' && modeRef.current !== 'launchpad') return
        setGestureOrigin(e.payload)
        void present('switcher')
      }),
      listen('launcher:wallpaper', () => void present('wallpaper')),
      listen<{ title: string; handles: number[] }>('launcher:expose', (e) => {
        setExpose(e.payload)
        void present('expose')
      }),
    ]
    return () => subs.forEach((p) => void p.then((fn) => fn()))
  }, [toggleLaunchpad, present, dismiss, lock])

  // Clicking any other window dismisses Start, like the real one.
  useEffect(() => {
    const un = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      // Locked: stay in front. Alt+Tab or a click elsewhere comes straight back.
      if (!focused && modeRef.current === 'lock') {
        setTimeout(() => {
          if (modeRef.current !== 'lock') return
          void invoke('taskbar_force_topmost').catch(() => {})
          void getCurrentWindow().setFocus()
        }, 60)
        return
      }
      if (!focused && (modeRef.current === 'launchpad' || modeRef.current === 'expose' || modeRef.current === 'wallpaper')) dismiss()
    })
    return () => void un.then((fn) => fn())
  }, [dismiss])

  // Session-wide idle (any input anywhere, not just in Udaan). Never
  // interrupts a full-screen app such as a game or a video.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (modeRef.current !== 'idle' || useShell.getState().fullscreen) return
      try {
        if ((await shell.idleMs()) < idleSecondsRef.current * 1000) return
        // Watching TV, a show or music counts as being here.
        const open = await shell.snapshot().then((snap) => snap.windows, () => useShell.getState().windows)
        if (open.some((w) => w.appId === 'tv')) return
        // Watching something counts as being here: no screensaver over a show or music.
        const playing = await invoke<{ playing: boolean } | null>('shell_now_playing').then((p) => !!p?.playing, () => false)
        if (!playing) void present('screensaver')
      } catch {
        /* not fatal */
      }
    }, IDLE_POLL_MS)
    return () => clearInterval(timer)
  }, [present, fullscreen])

  return (
    <div className="fixed inset-0">
      <AnimatePresence>{mode === 'launchpad' && <StartMenu onClose={dismiss} />}</AnimatePresence>
      <AnimatePresence>{mode === 'wallpaper' && <WallpaperPicker onClose={dismiss} />}</AnimatePresence>
      <AnimatePresence>{mode === 'screensaver' && <Screensaver onDismiss={endScreensaver} />}</AnimatePresence>
      <AnimatePresence>{mode === 'tips' && <Tips onClose={dismiss} />}</AnimatePresence>
      <AnimatePresence>{mode === 'switcher' && <Switcher3D origin={gestureOrigin} onDone={dismiss} />}</AnimatePresence>
      <AnimatePresence>{mode === 'lock' && <LockScreen user={user} onUnlock={unlock} />}</AnimatePresence>
      <AnimatePresence>{mode === 'expose' && expose && <Expose key={expose.handles?.join(',') ?? 'all'} title={expose.title} handles={expose.handles} onDone={dismiss} />}</AnimatePresence>
    </div>
  )
}
