import { useCallback, useEffect, useRef, useState } from 'react'
import { coverExitMs, coverMotion, useMotion } from '@/os/motion/config'
import { onLayoutChange } from '@/os/kernel/uiScale'
import { AnimatePresence, motion } from 'framer-motion'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { StartMenu } from './StartMenu'
import { invoke } from '@tauri-apps/api/core'
import { LockScreen, Screensaver } from './LockScreen'
import { WorkLock } from './WorkLock'
import { gestureLive, warmSwitcher } from './switcherCache'
import { applyProfile, loadProfile, switchProfile, useProfile, WORK_IDLE_LOCK_MS } from '@/os/kernel/profile'
import { playSound } from '@/os/sound/sounds'
import { onHotkey, shell, subscribeShell, useShell } from '@/os/kernel/shell'
import { Expose } from './Expose'
import { Switcher3D } from './Switcher3D'
import { Tutorial } from './Tutorial'
import { WallpaperPicker } from './WallpaperPicker'
import { getPref, setPref, usePref, type CORNER_KEYS } from '@/os/kernel/prefs'
import { FirstRunScreen } from './FirstRunScreen'
import { checkForUpdate } from '@/os/kernel/updates'
import { toast } from '@/os/ui/toasts'

type CornerKey = (typeof CORNER_KEYS)[number]
import { unregisterAllThumbnails } from '@/integrations/taskbar/client'

type Mode = 'idle' | 'launchpad' | 'screensaver' | 'expose' | 'wallpaper' | 'lock' | 'switcher' | 'tips' | 'work-lock' | 'veil'

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
  const lockMo = useMotion('lock')
  const profileMo = useMotion('profile')
  const lockMoRef = useRef(lockMo)
  lockMoRef.current = lockMo
  const profileMoRef = useRef(profileMo)
  profileMoRef.current = profileMo
  // How long the next dismiss keeps the window up so a longer exit animation can finish.
  const exitMsRef = useRef<number | undefined>(undefined)
  const profile = useProfile()
  const profileRef = useRef(profile)
  profileRef.current = profile
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

  // The top bar and dock step aside for a lock screen or the screensaver (see useImmersive).
  const covering = mode === 'lock' || mode === 'work-lock' || mode === 'screensaver'
  const coveringRef = useRef(false)
  coveringRef.current = covering
  useEffect(() => {
    void emit('shell://cover', covering)
  }, [covering])
  // Anvil drops every result and filter the moment Work locks.
  useEffect(() => {
    if (mode === 'work-lock') void emit('work://locked')
  }, [mode])
  useEffect(() => {
    const un = listen('shell://cover-query', () => void emit('shell://cover', coveringRef.current))
    return () => void un.then((fn) => fn())
  }, [])

  const lastSwitcherRequest = useRef(0)
  // Settings → Window Switcher: the Ctrl double-tap switch, and the drag gesture's switch and distance (told to the engine).
  const [switcherCtrl] = usePref('switcher.ctrl')
  const switcherCtrlRef = useRef(switcherCtrl)
  switcherCtrlRef.current = switcherCtrl
  const [switcherDrag] = usePref('switcher.drag')
  const [dragPercent] = usePref('switcher.dragPercent')
  const [ctrlGap] = usePref('switcher.ctrlGapMs')
  useEffect(() => {
    void invoke('shell_set_gesture', { enabled: switcherDrag }).catch(() => {})
    void invoke('shell_set_gesture_distance', { percent: dragPercent }).catch(() => {})
    void invoke('shell_set_ctrl_gap', { ms: ctrlGap }).catch(() => {})
  }, [switcherDrag, dragPercent, ctrlGap])
  // Keep the switcher's pictures fresh in the background so it opens already full.
  const foreground = useShell((x) => x.foreground)
  useEffect(() => {
    if (modeRef.current === 'idle') warmSwitcher()
  }, [foreground])

  const present = useCallback(async (next: Exclude<Mode, 'idle'>) => {
    // Nothing but unlocking takes the place of the lock screen.
    if ((modeRef.current === 'lock' || modeRef.current === 'work-lock') && next !== 'lock' && next !== 'work-lock') return
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
    if (modeRef.current === 'idle' || modeRef.current === 'lock' || modeRef.current === 'work-lock') return
    modeRef.current = 'idle'
    setMode('idle')
    clearTimeout(hideTimer.current)
    // Let the exit animation play before the window disappears.
    const wait = exitMsRef.current ?? EXIT_MS
    exitMsRef.current = undefined
    hideTimer.current = setTimeout(() => {
      void unregisterAllThumbnails().catch(() => {})
      void getCurrentWindow().hide()
    }, wait)
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
    exitMsRef.current = Math.max(EXIT_MS, coverExitMs(lockMoRef.current))
    dismiss()
  }, [dismiss])

  // WORK. Opening it shows its own lock; the profile only changes once the password is right, behind the
  // lock's full-screen cover. Going back to Personal covers the screen for one short veil while the desktop
  // swaps. Work is always locked again on the way in.
  const openWork = useCallback(() => {
    void getPref('work.enabled').then((on) => on && void present('work-lock'))
  }, [present])
  const unlockWork = useCallback(async () => {
    if (profileRef.current !== 'work') await switchProfile('work')
    modeRef.current = 'launchpad'
    exitMsRef.current = Math.max(EXIT_MS, coverExitMs(lockMoRef.current))
    dismiss()
  }, [dismiss])
  const leaveWork = useCallback(async () => {
    modeRef.current = 'launchpad'
    await present('veil')
    // Let the cover finish crossing the screen before the desktop underneath changes.
    if (profileMoRef.current.on) await new Promise((r) => setTimeout(r, Math.round((0.5 / profileMoRef.current.k) * 1000) + 40))
    await switchProfile('personal')
    exitMsRef.current = Math.max(EXIT_MS, coverExitMs(profileMoRef.current))
    dismiss()
  }, [present, dismiss])
  const backFromWorkLock = useCallback(() => {
    if (profileRef.current === 'work') void leaveWork()
    else {
      modeRef.current = 'launchpad'
      dismiss()
    }
  }, [leaveWork, dismiss])

  // Looks for a newer version a little after start, and when the website's "Check my version" button asks.
  useEffect(() => {
    const look = (said: boolean) =>
      void checkForUpdate().then(
        (a) => (a ? toast(`Udaan ${a.version} is available`, 'Open Settings, then Updates, to install it. Your data is kept.') : said && toast('Udaan is up to date')),
        () => said && toast('Could not check for updates', 'Try again in a moment.'),
      )
    const t = setTimeout(() => look(false), 30_000)
    const off = listen('update://check', () => look(true))
    return () => {
      clearTimeout(t)
      void off.then((fn) => fn())
    }
  }, [])

  // Udaan restarting while in Work comes back locked, and the Notes and Clipboard stores follow the profile.
  useEffect(() => {
    void loadProfile().then((p) => {
      void applyProfile(p)
      if (p === 'work') openWork()
    })
  }, [openWork])

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
          // The system-wide hook and the in-window detector (os/kernel/
          // doubleCtrl) can both report the same double-tap. Take the first
          // and ignore any other that follows within the time it takes a
          // person to tap again, or they would open and then close it.
          if (!switcherCtrlRef.current) return
          const at = performance.now()
          if (at - lastSwitcherRequest.current < 700) return
          lastSwitcherRequest.current = at
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
      listen('launcher:work', openWork),
      listen('launcher:personal', () => void leaveWork()),
      listen('launcher:tips', () => void present('tips')),
      listen<{ x: number; y: number }>('gesture://start', (e) => {
        if (modeRef.current !== 'idle' && modeRef.current !== 'launchpad') return
        gestureLive.ended = false
        setGestureOrigin(e.payload)
        void present('switcher')
      }),
      // Always listening, so a release that lands before the switcher has mounted is not lost.
      listen('gesture://end', () => void (gestureLive.ended = true)),
      listen('gesture://cancel', () => void (gestureLive.ended = true)),
      listen('launcher:wallpaper', () => void present('wallpaper')),
      listen<{ title: string; handles: number[] }>('launcher:expose', (e) => {
        setExpose(e.payload)
        void present('expose')
      }),
    ]
    return () => subs.forEach((p) => void p.then((fn) => fn()))
  }, [toggleLaunchpad, present, dismiss, lock, openWork, leaveWork])

  // Start's own menus (the power menu, a tile's right-click menu) are windows too: while one is open, Start
  // losing focus to it must not close Start.
  const popupOpen = useRef(false)
  useEffect(() => {
    let closedAt = 0
    const subs = [
      listen('taskbar-popup:show', () => {
        popupOpen.current = true
      }),
      listen('taskbar-popup:hidden', () => {
        closedAt = Date.now()
        // Keep the guard a moment past the close: focus returns to Start a beat later.
        setTimeout(() => {
          if (Date.now() - closedAt >= 350) popupOpen.current = false
        }, 400)
      }),
    ]
    return () => subs.forEach((p) => void p.then((fn) => fn()))
  }, [])

  // Clicking any other window dismisses Start, like the real one.
  useEffect(() => {
    const un = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && popupOpen.current) return
      // Locked: stay in front. Alt+Tab or a click elsewhere comes straight back.
      if (!focused && (modeRef.current === 'lock' || modeRef.current === 'work-lock')) {
        setTimeout(() => {
          if (modeRef.current !== 'lock' && modeRef.current !== 'work-lock') return
          void invoke('engine_raise_topmost').catch(() => {})
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
      if (useShell.getState().fullscreen) return
      // Work locks itself after 3 idle minutes (even if the screensaver has already come on).
      if (profileRef.current === 'work' && (modeRef.current === 'idle' || modeRef.current === 'screensaver')) {
        try {
          if ((await shell.idleMs()) >= WORK_IDLE_LOCK_MS) return void present('work-lock')
        } catch {
          /* not fatal */
        }
      }
      if (modeRef.current !== 'idle') return
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
      <AnimatePresence>{mode === 'tips' && <Tutorial onClose={dismiss} />}</AnimatePresence>
      <AnimatePresence>{mode === 'switcher' && <Switcher3D origin={gestureOrigin} onDone={dismiss} />}</AnimatePresence>
      <AnimatePresence>{mode === 'lock' && <LockScreen user={user} onUnlock={unlock} />}</AnimatePresence>
      <FirstRunScreen />
      <AnimatePresence>{mode === 'work-lock' && <WorkLock inWork={profile === 'work'} onUnlock={unlockWork} onBack={backFromWorkLock} />}</AnimatePresence>
      <AnimatePresence>
        {mode === 'veil' && (
          <motion.div className="fixed inset-0 z-[110] flex items-center justify-center bg-[radial-gradient(120%_90%_at_50%_30%,#16213a,#0a0e18)]" style={{ willChange: 'transform, opacity' }} {...coverMotion(profileMo, profileMo.style, 0.15)}>
            <div className="flex flex-col items-center gap-5">
              <img src="/logo/udaan-128.png" alt="" draggable={false} className="h-16 w-16 rounded-[18px] shadow-[0_8px_30px_rgb(0_0_0/.45)]" />
              <p className="text-[15px] font-medium tracking-[0.18em] text-white/75">PERSONAL</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{mode === 'expose' && expose && <Expose key={expose.handles?.join(',') ?? 'all'} title={expose.title} handles={expose.handles} onDone={dismiss} />}</AnimatePresence>
    </div>
  )
}
