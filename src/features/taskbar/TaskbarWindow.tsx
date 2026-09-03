import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow, PhysicalPosition, PhysicalSize, currentMonitor } from '@tauri-apps/api/window'
import { emit, listen } from '@tauri-apps/api/event'
import { cn } from '@/shared/lib/cn'
import { pressableIcon } from '@/shared/lib/motion'
import { motion } from 'framer-motion'
import { BatteryIcon, BatteryChargingIcon, VolumeIcon, VolumeMuteIcon, BellIcon, StopIcon } from '@/shared/icons'
import udaanMark from '@/assets/udaan-mark.png'
import {
  listOpenWindows,
  focusWindow,
  minimizeWindow,
  foregroundWindow,
  forceTopmost,
  cursorPosition,
  type OpenWindow,
} from '@/integrations/taskbar/client'
import { batteryStatus, sendVolumeCommand, type BatteryStatus } from '@/integrations/quick-settings/client'
import { getStatus as getRecorderStatus, stopRecording, onRecorderEvent } from '@/integrations/audio-recorder/client'
import { formatElapsed } from '@/shared/lib/formatElapsed'
import { TaskbarEntry, TASKBAR_ICON_BUTTON, TASKBAR_ICON_GLYPH, type WindowGroup } from './TaskbarEntry'
import { TASKBAR_BAR_HEIGHT_PX, TASKBAR_BOTTOM_MARGIN_PX, AUTO_HIDE_TASKBAR_PREF_KEY } from '@/shared/lib/taskbarGeometry'
import { getTaskbarPref } from '@/integrations/taskbar-prefs/client'
import type { ShowNotificationsPanelPayload } from './taskbarPopupTypes'

const WINDOW_POLL_MS = 700
const QUICK_SETTINGS_POLL_MS = 10_000
// Explorer's own taskbar (and any other topmost window) can win a z-order
// fight against a topmost window that only asserted HWND_TOPMOST once —
// re-asserting periodically is what keeps Udaan's dock from intermittently
// sinking behind it. Tightened from an original 4000ms (too slow — left a
// multi-second window where a click could land on a window that had
// genuinely come to the front of the dock), but NOT tightened all the way
// down to every 700ms poll tick — that turned out too aggressive: forcing
// HWND_TOPMOST that often measurably increased the odds of the reassert
// landing mid-click and interfering with focusing/interacting with other
// apps' windows (reported as "can't interact with open apps"). 1500ms is
// the middle ground — frequent enough to close the original gap, not so
// frequent it fights real-time user input.
const TOPMOST_REASSERT_MS = 1500

// --- Auto-hide -------------------------------------------------------
// The dock slides almost fully off the bottom edge when idle, leaving a
// thin sliver poking up so it's still discoverable, and slides back up
// the instant the cursor approaches. Real Windows' own auto-hide taskbar
// works the same way. Implemented by moving the ACTUAL OS window's Y
// position (not a CSS transform) — the window's SIZE never changes, only
// where it sits — which is the one thing that matters for the
// click-through lesson this session already learned twice: a window that
// changes visual size while its real OS rect stays large-and-invisible
// is what caused that bug. Sliding the whole window (fixed size) instead
// of resizing it means there is never a moment where the OS rect is
// bigger than what's actually visible.
/** How much of the dock's own height stays poking up above the true screen edge while hidden — enough to be visible/discoverable, not so much it looks like a glitch. */
const AUTO_HIDE_PEEK_PX = 6
/** Cursor must be within this many px of the screen's bottom edge (or already over the dock's own shown bounds) to trigger a reveal. */
const AUTO_HIDE_TRIGGER_ZONE_PX = 48
/** How long the cursor must stay away from the dock before it hides again — mirrors the taskbar popup's own hide-debounce reasoning: prevents a flicker from a cursor pixel that only brushed past the trigger zone on its way elsewhere. */
const AUTO_HIDE_LEAVE_DELAY_MS = 500
/** Cursor-position poll cadence while the dock is HIDDEN — needs to be tight so a reveal reads as instant/responsive rather than laggy. */
const AUTO_HIDE_POLL_MS_HIDDEN = 100
/** Cursor-position poll cadence while the dock is already REVEALED and idle — only needs to notice "the cursor wandered off" eventually (the leave-delay debounce already adds its own grace period on top), so this can be much slower without the dock ever feeling sluggish to hide. Running the fast 100ms poll unconditionally forever was a real cost: a Tauri IPC round-trip 10x/second even while the dock sat open and untouched, which is exactly the kind of constant background work that shows up as general app sluggishness. */
const AUTO_HIDE_POLL_MS_REVEALED = 400
/** Slide animation duration. */
const AUTO_HIDE_SLIDE_MS = 220

/**
 * Cheap per-field equality for the fields the taskbar UI actually renders —
 * used to skip `setWindows` when a 700ms poll tick reports the same window
 * list, so the whole taskbar tree doesn't re-render 1.4x/second regardless
 * of whether anything visible changed.
 */
function windowListsEqual(a: OpenWindow[], b: OpenWindow[]): boolean {
  if (a.length !== b.length) return false
  // Compare by handle, not by index: EnumWindows returns Z-order, so
  // focusing a different app reshuffles the raw list's positions without
  // anything the taskbar actually renders having changed. An index-wise
  // comparison saw that reshuffle as "different" and installed the
  // reordered array on every focus switch — which is what let two apps'
  // icons visibly swap positions when nothing about them had changed.
  const byHandle = new Map(b.map((w) => [w.handle, w]))
  for (const x of a) {
    const y = byHandle.get(x.handle)
    if (
      !y ||
      x.title !== y.title ||
      x.processName !== y.processName ||
      x.isMinimized !== y.isMinimized ||
      x.iconDataUrl !== y.iconDataUrl
    ) {
      return false
    }
  }
  return true
}

/**
 * Orders windows by first-seen position rather than whatever order
 * `EnumWindows` returns them in (which follows Z-order and reshuffles
 * every time focus changes) — without this, every window on the taskbar
 * would visibly swap positions on every click, which is exactly the
 * "apps move around" complaint a real taskbar never has. New windows are
 * appended at the end; closed windows are dropped from the order map so
 * it doesn't grow forever.
 *
 * The order map itself lives in a ref (mutated only inside an effect,
 * never during render — React's rules disallow ref writes in the render
 * path since concurrent rendering can call it more than once per commit)
 * while the *sorted output* is plain derived state, recomputed whenever
 * `windows` or the order map's version changes.
 */
function useStableWindowOrder(windows: OpenWindow[]): OpenWindow[] {
  const orderRef = useRef<Map<number, number>>(new Map())
  const nextIndexRef = useRef(0)
  const [orderVersion, setOrderVersion] = useState(0)

  useEffect(() => {
    const seenHandles = new Set(windows.map((w) => w.handle))
    let changed = false
    for (const handle of orderRef.current.keys()) {
      if (!seenHandles.has(handle)) {
        orderRef.current.delete(handle)
        changed = true
      }
    }
    for (const win of windows) {
      if (!orderRef.current.has(win.handle)) {
        orderRef.current.set(win.handle, nextIndexRef.current++)
        changed = true
      }
    }
    if (changed) setOrderVersion((v) => v + 1)
    // orderVersion deliberately omitted — this effect only reacts to
    // `windows` changing, not to its own version bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows])

  // Referencing orderVersion makes the dependency on that state explicit
  // (it exists purely to trigger this re-render when the effect above
  // mutates orderRef) even though the sort itself reads from the ref.
  // Memoized so a poll tick that changes `windows` identity but not its
  // actual order-relevant content (e.g. only `iconDataUrl` changed) — or
  // any other re-render entirely unrelated to windows — doesn't re-sort
  // and reallocate a new array every single time.
  return useMemo(
    () => {
      // A window not yet in the order map is BRAND NEW, so it belongs at
      // the end — `?? 0` sorted it to the FRONT instead (0 is the lowest
      // rank), which is what made a just-registered window visibly jump
      // ahead of long-open ones for the one frame before the effect above
      // assigned it a real index.
      const rank = (h: number) => orderRef.current.get(h) ?? Number.MAX_SAFE_INTEGER
      return [...windows].sort(
        // Tie-break on the handle itself so this is a TOTAL order: two
        // windows tied on rank (both unranked on the same tick) would
        // otherwise fall back to Array.sort's stability, i.e. whatever
        // order they arrived in `windows` — raw EnumWindows Z-order, which
        // is exactly the reshuffle-on-focus this hook exists to prevent.
        (a, b) => rank(a.handle) - rank(b.handle) || a.handle - b.handle,
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windows, orderVersion],
  )
}

/**
 * Groups windows by process name — the same collapsing behavior the real
 * Windows taskbar uses when multiple windows from one app are open (e.g.
 * three Explorer windows become one icon with a badge and a hover
 * flyout, rather than three separate icons). Group order follows the
 * position of each group's first-seen window in `orderedWindows`, so
 * groups don't reshuffle either.
 */
function groupByProcess(orderedWindows: OpenWindow[]): WindowGroup[] {
  const groups = new Map<string, OpenWindow[]>()
  for (const win of orderedWindows) {
    const list = groups.get(win.processName) ?? []
    list.push(win)
    groups.set(win.processName, list)
  }
  return [...groups.entries()].map(([processName, windows]) => ({ processName, windows }))
}

/**
 * The dedicated taskbar window (mounted via `?window=taskbar`, see
 * main.tsx and tauri.conf.json's second window entry) — a compact,
 * floating, always-on-top dock centered near the bottom edge, NOT a
 * full-width Windows AppBar. Deliberately dropped the earlier
 * `SHAppBarMessage`/work-area-reservation approach: reserving screen
 * space system-wide caused persistent conflicts with the real Windows
 * taskbar (z-order fights, disappearing) for comparatively little
 * benefit at dock width. As a floating overlay, other windows use the
 * full screen height right up to the true bottom edge, and this bar just
 * sits on top — the same visual model as macOS's dock, positioned and
 * sized once on mount rather than negotiated with the OS shell.
 *
 * Visual model: one confident, near-opaque dark panel — no decorative
 * gradient ring (tried and cut; against the desktop it read as a "neon
 * outline" gimmick rather than premium chrome). Depth comes from a soft
 * drop shadow and a single hairline border, matching how the rest of the
 * app's glass surfaces (sidebar, dialogs) establish elevation.
 *
 * Real per-window icons (extracted server-side via WM_GETICON) instead
 * of text labels. Talks to the main app window (which owns the
 * Launchpad) via Tauri's cross-window event system rather than
 * duplicating Launchpad's own state/UI here.
 */
export function TaskbarWindow() {
  const [windows, setWindows] = useState<OpenWindow[]>([])
  const [foreground, setForeground] = useState<number>(0)
  // The main "Udaan" window is excluded from the running-apps row (see the
  // poll below) since it's represented by the dock's own leftmost icon
  // instead — but that icon still needs to show the same active/minimized
  // state feedback every other running app's icon gets, so its focus
  // state is tracked separately here rather than just being dropped.
  const [udaanIsForeground, setUdaanIsForeground] = useState(false)
  const [udaanIsMinimizedOnly, setUdaanIsMinimizedOnly] = useState(false)
  const [udaanIconHovered, setUdaanIconHovered] = useState(false)
  const [udaanIconPressed, setUdaanIconPressed] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [battery, setBattery] = useState<BatteryStatus | null>(null)
  const [muted, setMuted] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false)
  const notificationsButtonRef = useRef<HTMLButtonElement>(null)

  // Keeps notificationsPanelOpen accurate even when the popup closes some
  // way OTHER than clicking this same button again (mouse moved away, an
  // action inside it closed it) — the popup broadcasts this whenever it
  // actually finishes hiding, regardless of cause (see
  // TaskbarPopupWindow.tsx's hideSelf/the taskbar-popup:hide listener).
  //
  // Also tracked here for auto-hide: a hover preview/context menu/
  // notifications panel floats ABOVE the dock's own shown rect, outside
  // the cursor-proximity check the auto-hide poll otherwise uses — without
  // this, moving the cursor up into an open popup could fall outside that
  // check and slide the dock away while the popup (anchored to an icon on
  // it) is still open, stranding the popup with nothing to point at.
  const popupOpenRef = useRef(false)
  useEffect(() => {
    let unlistenShow: (() => void) | undefined
    let unlistenHidden: (() => void) | undefined
    let cancelled = false
    listen('taskbar-popup:show', () => {
      popupOpenRef.current = true
    }).then((fn) => {
      if (cancelled) fn()
      else unlistenShow = fn
    })
    listen('taskbar-popup:hidden', () => {
      popupOpenRef.current = false
      setNotificationsPanelOpen(false)
    }).then((fn) => {
      if (cancelled) fn()
      else unlistenHidden = fn
    })
    return () => {
      cancelled = true
      unlistenShow?.()
      unlistenHidden?.()
    }
  }, [])

  // System audio recorder: sync initial state on mount (in case a
  // recording was already started from the Launchpad overlay before this
  // window rendered), then stay in sync via the same broadcast event both
  // surfaces share — see useRecorder.ts's doc comment for why this is
  // event-driven rather than polled. Elapsed time is tracked here too
  // (not just in the Launchpad overlay) so the taskbar's own recording
  // pill can show a live timer without the overlay needing to be open —
  // "no way of closing it"/no visibility into duration from the taskbar
  // alone was the reported gap this fixes.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    getRecorderStatus()
      .then((status) => {
        if (!cancelled) {
          setRecording(status.state === 'recording')
          setRecordingElapsed(status.elapsedSeconds)
        }
      })
      .catch((err) => console.error('Failed to read recorder status:', err))

    onRecorderEvent((event) => {
      if (event.kind === 'started') {
        setRecording(true)
        setRecordingElapsed(0)
      } else if (event.kind === 'progress') {
        setRecordingElapsed(event.elapsedSeconds)
      } else if (event.kind === 'stopped' || event.kind === 'error') {
        setRecording(false)
      }
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // Popup-headroom + click-through-tracking for hover previews/context
  // menus was tried in this session and reverted: a taller transparent
  // window (even with mouse-position-based setIgnoreCursorEvents
  // toggling) intermittently stole clicks meant for whatever real app sat
  // underneath it — a severe, hard-to-fully-eliminate bug given Tauri has
  // no per-pixel hit-testing and the toggle is inherently async/racy
  // against other periodic effects (forceTopmost, window polling). The
  // real fix: hover preview/the right-click context menu now render in a
  // SEPARATE, on-demand Tauri window (see TaskbarPopupWindow.tsx and
  // TaskbarEntry.tsx's doc comment) rather than inside this window at
  // all, so this window is back to being sized EXACTLY to the visible
  // dock, nothing more, with zero risk of stealing clicks meant for
  // another app.

  // Shared with the auto-hide effect below: the dock's current "shown"
  // geometry (screen-relative X, shown-Y, width, and the screen's true
  // bottom edge) — recomputed whenever the monitor setup/reposition logic
  // runs, read from whenever auto-hide needs to know where "fully
  // revealed" and "mostly hidden" actually are for the CURRENT monitor.
  // A ref, not state, since nothing here needs to re-render on it — it's
  // consumed by imperative setPosition calls only.
  const dockGeometryRef = useRef({ x: 0, shownY: 0, width: 0, screenBottom: 0, peekPhys: AUTO_HIDE_PEEK_PX })
  const autoHideEnabledRef = useRef(false)
  const isRevealedRef = useRef(true)

  useEffect(() => {
    let cancelled = false

    async function setup() {
      const win = getCurrentWindow()
      try {
        const monitor = await currentMonitor()
        if (cancelled) return
        if (monitor) {
          const { size, position } = monitor
          const width = await win.outerSize().then((s) => s.width)
          // TASKBAR_BAR_HEIGHT_PX/TASKBAR_BOTTOM_MARGIN_PX are LOGICAL/CSS
          // pixel design constants (they size a Tailwind-styled DOM
          // layout), but `size`/`position` from currentMonitor() and
          // PhysicalSize/PhysicalPosition are all PHYSICAL pixels — same
          // unit mismatch as TaskbarPopupWindow.tsx's popups had, and the
          // real root cause behind the popup looking "cut off/overlapping
          // the dock": on a scaled display, the dock's real OS window was
          // sized shorter than its own CSS content actually needed,
          // shifting the dock's true screen position (and therefore every
          // popup anchored to an icon on it) away from where the math
          // assumed. Converted here via this window's own scale factor
          // before anything touches Physical*.
          const scale = await win.scaleFactor()
          const barHeightPhys = Math.round(TASKBAR_BAR_HEIGHT_PX * scale)
          const bottomMarginPhys = Math.round(TASKBAR_BOTTOM_MARGIN_PX * scale)
          const x = position.x + Math.round((size.width - width) / 2)
          const y = position.y + size.height - barHeightPhys - bottomMarginPhys
          dockGeometryRef.current = {
            x,
            shownY: y,
            width,
            screenBottom: position.y + size.height,
            peekPhys: Math.round(AUTO_HIDE_PEEK_PX * scale),
          }
          await win.setPosition(new PhysicalPosition(x, y))
          await win.setSize(new PhysicalSize(width, barHeightPhys))
        }
        await win.show()
      } catch (err) {
        console.error('Failed to position the taskbar dock:', err)
        try {
          await win.show()
        } catch (showErr) {
          console.error('Also failed to show the taskbar window at all:', showErr)
        }
      }
    }

    void setup()
  }, [])

  // Reposition dock on monitor changes (e.g. plugging in a second monitor,
  // display resolution change, DPI scaling change) — keeps it centered at
  // the bottom of the active monitor rather than drifting to a stale
  // position from the initial mount. Curved ultra-wide monitors especially
  // benefit from this since their "center" can shift if the OS treats them
  // as a single logical display with asymmetric usable area.
  //
  // While auto-hide is enabled AND currently hidden, this intentionally
  // skips writing the shown-Y position — doing so would yank the dock back
  // into view every 2 seconds regardless of cursor position, fighting the
  // auto-hide effect below. The geometry (screen bounds, shown-Y) is still
  // recomputed and stored either way, so auto-hide always has an
  // up-to-date target to reveal TO once the cursor actually approaches.
  useEffect(() => {
    let cancelled = false

    async function reposition() {
      try {
        const win = getCurrentWindow()
        const monitor = await currentMonitor()
        if (!monitor || cancelled) return
        const { size, position } = monitor
        const width = await win.outerSize().then((s) => s.width)
        const scale = await win.scaleFactor()
        const barHeightPhys = Math.round(TASKBAR_BAR_HEIGHT_PX * scale)
        const bottomMarginPhys = Math.round(TASKBAR_BOTTOM_MARGIN_PX * scale)
        const x = position.x + Math.round((size.width - width) / 2)
        const y = position.y + size.height - barHeightPhys - bottomMarginPhys
        const prev = dockGeometryRef.current
        const geometryChanged = prev.x !== x || prev.shownY !== y || prev.width !== width
        dockGeometryRef.current = {
          x,
          shownY: y,
          width,
          screenBottom: position.y + size.height,
          peekPhys: Math.round(AUTO_HIDE_PEEK_PX * scale),
        }
        // Skip the actual `setPosition` syscall when nothing about the
        // target geometry changed since last tick — on a static single-
        // monitor setup (the overwhelmingly common case) this poll used to
        // move the real OS window to the exact position it was already at,
        // every 2 seconds, forever. The monitor/size/scale reads above
        // still run every tick (cheap, and needed to detect a real change
        // like plugging in a display), only the write is now conditional.
        if (geometryChanged && (!autoHideEnabledRef.current || isRevealedRef.current)) {
          await win.setPosition(new PhysicalPosition(x, y))
        }
      } catch (err) {
        console.error('Failed to reposition taskbar dock:', err)
      }
    }

    const interval = setInterval(reposition, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const pollWindowsRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const [rawList, fg] = await Promise.all([listOpenWindows(), foregroundWindow()])
        const udaanWindow = rawList.find((w) => w.title === 'Udaan')
        // The main "Udaan" window is deliberately excluded from the
        // running-apps row — it's already represented by the dock's own
        // leftmost icon — so listing it a second time here would show
        // Udaan twice. Its focus/minimized state is still captured above
        // (udaanWindow) before this filter drops it, so the leftmost icon
        // can carry the same active/running indicator every other entry
        // gets, instead of losing that state entirely.
        const list = rawList.filter((w) => w.title !== 'Udaan')
        if (!cancelled) {
          setWindows((prev) => (windowListsEqual(prev, list) ? prev : list))
          setForeground((prev) => (prev === fg ? prev : fg))
          setUdaanIsForeground(udaanWindow?.handle === fg && !udaanWindow.isMinimized)
          setUdaanIsMinimizedOnly(udaanWindow?.handle === fg && !!udaanWindow.isMinimized)
        }
      } catch (err) {
        console.error('Failed to poll open windows:', err)
      }
    }
    pollWindowsRef.current = poll
    void poll()
    const interval = setInterval(poll, WINDOW_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // The popup window (TaskbarPopupWindow.tsx, a SEPARATE Tauri window)
  // emits this after closing a window from the hover preview/context
  // menu, so this window's list updates immediately instead of waiting up
  // to WINDOW_POLL_MS for the next scheduled poll tick to reflect it.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    listen('taskbar-popup:window-closed', () => {
      void pollWindowsRef.current()
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // Explorer's own taskbar is ALSO topmost and can still win transient
  // z-order fights against a window that was only made topmost once at
  // creation — periodically re-asserting is what keeps Udaan's dock from
  // intermittently sinking behind it.
  useEffect(() => {
    let cancelled = false
    async function reassert() {
      try {
        if (!cancelled) await forceTopmost()
      } catch (err) {
        console.error('Failed to reassert topmost:', err)
      }
    }
    void reassert()
    const interval = setInterval(reassert, TOPMOST_REASSERT_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // --- Auto-hide ---------------------------------------------------
  // Loads the persisted preference on mount and stays live-synced with
  // WorkspaceSettingsPanel.tsx's toggle (a DIFFERENT window) via the
  // 'taskbar:auto-hide-changed' broadcast, exactly the same cross-window
  // pattern the Udaan-taskbar-switch toggle already uses elsewhere.
  // Defaults to ON — auto-hide is the expected default behavior, not an
  // opt-in most people would ever go find in Settings. `getTaskbarPref`
  // returns null for a key that was never explicitly set, which is
  // distinguished from an explicit "false" (the user turned it off via
  // WorkspaceSettingsPanel.tsx) below — only a real 'false' should ever
  // disable it.
  const [autoHideEnabled, setAutoHideEnabled] = useState(true)
  useEffect(() => {
    autoHideEnabledRef.current = autoHideEnabled
  }, [autoHideEnabled])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    getTaskbarPref(AUTO_HIDE_TASKBAR_PREF_KEY)
      .then((value) => {
        // null = never explicitly set → stays at the default (true,
        // above). Only an explicit 'false' turns it off.
        if (!cancelled && value !== null) setAutoHideEnabled(value === 'true')
      })
      .catch((err) => console.error('Failed to load auto-hide-taskbar preference:', err))
    listen<{ enabled: boolean }>('taskbar:auto-hide-changed', (event) => {
      setAutoHideEnabled(event.payload.enabled)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // Animates the dock's real Y position between "shown" and "mostly
  // hidden" — see the AUTO_HIDE_* constants' doc comment for why this
  // moves the actual OS window (fixed size, sliding position) rather than
  // resizing anything. A simple eased tween driven by requestAnimationFrame
  // rather than Framer Motion, since Framer only animates the DOM/CSS layer
  // — it has no way to drive a real Tauri `setPosition` call.
  const slideAnimRef = useRef<number | null>(null)
  function slideDockTo(targetY: number) {
    if (slideAnimRef.current !== null) cancelAnimationFrame(slideAnimRef.current)
    const win = getCurrentWindow()
    const { x } = dockGeometryRef.current
    // Reads the window's REAL current position rather than trusting
    // whichever end-state (shown/hidden) was last recorded — a rapid
    // reveal/hide toggle fired mid-animation would otherwise make the new
    // tween jump from a stale guessed start point instead of wherever the
    // dock actually is on screen right now.
    void win.outerPosition().then((pos) => {
      const from = pos.y
      const startTime = performance.now()
      function tick(now: number) {
        const elapsed = now - startTime
        const t = Math.min(1, elapsed / AUTO_HIDE_SLIDE_MS)
        // Ease-out cubic — matches the app's general preference for snappy
        // arrival over a bouncy spring for a system-chrome-level animation.
        const eased = 1 - Math.pow(1 - t, 3)
        const y = Math.round(from + (targetY - from) * eased)
        void win.setPosition(new PhysicalPosition(x, y))
        if (t < 1) {
          slideAnimRef.current = requestAnimationFrame(tick)
        } else {
          slideAnimRef.current = null
        }
      }
      slideAnimRef.current = requestAnimationFrame(tick)
    })
  }

  useEffect(() => {
    if (!autoHideEnabled) {
      // Turning auto-hide off should always leave the dock fully visible,
      // not stranded mid-slide or hidden from whatever state it was last in.
      if (!isRevealedRef.current) {
        isRevealedRef.current = true
        slideDockTo(dockGeometryRef.current.shownY)
      }
      return
    }

    let cancelled = false
    let leaveTimer: ReturnType<typeof setTimeout> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    function scheduleNext() {
      if (cancelled) return
      const delay = isRevealedRef.current ? AUTO_HIDE_POLL_MS_REVEALED : AUTO_HIDE_POLL_MS_HIDDEN
      timer = setTimeout(() => {
        void poll()
      }, delay)
    }

    async function poll() {
      try {
        const [cx, cy] = await cursorPosition()
        if (cancelled) return
        const { x, width, screenBottom, shownY } = dockGeometryRef.current
        // Real monitor geometry hasn't landed yet (the async setup()
        // effect that populates dockGeometryRef is still in flight, e.g.
        // on the very first poll tick right after mount) — width stays 0
        // until it has. Skip this tick entirely rather than acting on
        // all-zero placeholder geometry, which could otherwise slide the
        // window to a bogus (0, -6)-ish position for a frame before the
        // real values arrive.
        if (width === 0) return
        const nearDockX = cx >= x - AUTO_HIDE_TRIGGER_ZONE_PX && cx <= x + width + AUTO_HIDE_TRIGGER_ZONE_PX
        // Two different Y checks depending on current state: while HIDDEN,
        // "should reveal" means the cursor approached the bottom screen
        // edge (the only part of the dock poking up to find). While
        // ALREADY REVEALED, that same bottom-edge check would be wrong —
        // the shown dock sits well above the true bottom edge, so a
        // cursor resting on/inside the dock itself (using it) could be
        // farther from screenBottom than the trigger zone, hiding the
        // dock out from under an active interaction. So once revealed,
        // "stay revealed" instead checks proximity to the dock's OWN
        // shown rect, not the screen edge.
        const nearBottomEdge = screenBottom - cy <= AUTO_HIDE_TRIGGER_ZONE_PX
        const nearShownDock = cy >= shownY - AUTO_HIDE_TRIGGER_ZONE_PX && cy <= screenBottom
        const shouldReveal =
          popupOpenRef.current || (isRevealedRef.current ? nearDockX && nearShownDock : nearDockX && nearBottomEdge)

        if (shouldReveal) {
          if (leaveTimer) {
            clearTimeout(leaveTimer)
            leaveTimer = null
          }
          if (!isRevealedRef.current) {
            isRevealedRef.current = true
            slideDockTo(dockGeometryRef.current.shownY)
          }
        } else if (isRevealedRef.current && !leaveTimer) {
          // Debounced, same reasoning as the taskbar popup's own
          // hide-on-mouse-leave grace period: a cursor pixel that only
          // brushed the trigger zone on its way elsewhere shouldn't cause
          // a visible flicker.
          leaveTimer = setTimeout(() => {
            leaveTimer = null
            if (!autoHideEnabledRef.current) return
            isRevealedRef.current = false
            slideDockTo(dockGeometryRef.current.screenBottom - dockGeometryRef.current.peekPhys)
          }, AUTO_HIDE_LEAVE_DELAY_MS)
        }
      } catch (err) {
        console.error('Failed to poll cursor position for auto-hide:', err)
      } finally {
        scheduleNext()
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (leaveTimer) clearTimeout(leaveTimer)
    }
  }, [autoHideEnabled])

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const b = await batteryStatus()
        if (!cancelled) {
          setBattery((prev) =>
            prev &&
            b &&
            prev.hasBattery === b.hasBattery &&
            prev.percent === b.percent &&
            prev.isCharging === b.isCharging
              ? prev
              : b,
          )
        }
      } catch (err) {
        console.error('Failed to poll quick settings:', err)
      }
    }
    void poll()
    const interval = setInterval(poll, QUICK_SETTINGS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 15_000)
    return () => clearInterval(interval)
  }, [])

  const orderedWindows = useStableWindowOrder(windows)
  const windowGroups = groupByProcess(orderedWindows)

  function handleEntryClick(win: OpenWindow) {
    // Optimistic: move the active-indicator and un-minimize the clicked
    // entry immediately rather than waiting up to WINDOW_POLL_MS for the
    // next poll to confirm it — the actual OS call still happens below,
    // this just makes the UI feel instant instead of laggy. The next
    // poll tick reconciles with ground truth either way.
    if (win.handle === foreground && !win.isMinimized) {
      setForeground(0)
      setWindows((prev) => prev.map((w) => (w.handle === win.handle ? { ...w, isMinimized: true } : w)))
      void minimizeWindow(win.handle)
    } else {
      setForeground(win.handle)
      setWindows((prev) => prev.map((w) => (w.handle === win.handle ? { ...w, isMinimized: false } : w)))
      void focusWindow(win.handle)
      // NOTE: deliberately NOT reasserting forceTopmost() here. Doing so
      // immediately after asking a different window to focus raced the OS's
      // own focus/z-order handling — pulling HWND_TOPMOST back onto the
      // dock right as the just-clicked app's window was becoming active
      // could re-cover it, which read as "clicking an app doesn't work"
      // (the taskbar's own 84px-tall rect sitting back on top of/blocking
      // input to the window that was supposed to come to front). The
      // periodic reassert on WINDOW_POLL_MS (below) still keeps the dock
      // from sinking behind Explorer's taskbar over time, just without
      // racing the exact instant of a user-initiated focus change.
    }
  }

  async function toggleMute() {
    await sendVolumeCommand('mute')
    setMuted((prev) => !prev)
  }

  async function handleStopRecording() {
    try {
      await stopRecording()
      // Real state transition arrives via the audio-recorder:event
      // subscription below (the "stopped" event) — this just requests it.
    } catch (err) {
      console.error('Failed to stop system audio recording:', err)
    }
  }

  function openCalendar() {
    void emit('taskbar:open-calendar')
  }

  // Both open the same on-demand popup window used for hover-previews/the
  // context menu (see TaskbarEntry.tsx and TaskbarPopupWindow.tsx's doc
  // comment for why a separate window, not a local Radix popover, is
  // required here — this taskbar window is only 86px tall and a popover
  // rendered inside it would just be clipped/invisible).
  function anchorPointFor(el: HTMLButtonElement | null) {
    const rect = el?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: window.screenX + rect.left + rect.width / 2, y: window.screenY + rect.top }
  }

  function toggleNotificationsPanel() {
    if (notificationsPanelOpen) {
      setNotificationsPanelOpen(false)
      void emit('taskbar-popup:hide')
      return
    }
    const { x, y } = anchorPointFor(notificationsButtonRef.current)
    const payload: ShowNotificationsPanelPayload = { kind: 'notifications-panel', x, y }
    setNotificationsPanelOpen(true)
    void emit('taskbar-popup:show', payload)
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-2">
      {/* Mounts with the same rise+fade the main window uses (see App.tsx)
          so the dock reads as part of one continuous boot sequence rather
          than a separate widget popping in on its own timing. Flat, sleek
          dark surface — no hairline/glow bezel — with a confident soft
          shadow doing all the elevation work instead. */}
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="relative flex h-[calc(100%-8px)] items-center gap-3 overflow-hidden rounded-[26px] border px-4"
        style={{
          // A quiet top-edge highlight gradient (not the fuller
          // .glass-surface diagonal wash — this bar stays flatter than
          // that on purpose) so the pill reads as a lit, real physical
          // strip rather than a single flat fill with nothing above it.
          background: 'linear-gradient(180deg, rgb(255 255 255 / 4%) 0%, transparent 40%), var(--color-bg-base)',
          borderColor: 'rgb(255 255 255 / 8%)',
          boxShadow:
            '0 24px 56px rgb(0 0 0 / 62%), 0 3px 12px rgb(0 0 0 / 48%), inset 0 1px 0 rgb(255 255 255 / 7%)',
        }}
      >
        {/* Leftmost dock icon — Udaan's own app icon, same slot/size as
            every other running-app entry rather than a visually distinct
            "Start" button. Clicking it just focuses/restores the main
            Udaan window (same as clicking any other app's taskbar icon),
            not a launcher. The real "Udaan" window is excluded from the
            running-apps row above (see the poll filter) to avoid showing
            Udaan twice, but its active/minimized state is carried over
            here (udaanIsForeground/udaanIsMinimizedOnly) so this icon gets
            the exact same inset highlight box + bottom indicator bar every
            other running app's icon gets — same visual language, not a
            state-less bare icon. */}
        <motion.button
          type="button"
          onClick={() => {
            // Same click semantics as every other taskbar entry: clicking
            // the icon for the app that's already running AND focused
            // minimizes it, rather than doing nothing/re-focusing itself —
            // matches real Windows taskbar behavior instead of being a
            // special case just because it's Udaan's own icon.
            if (udaanIsForeground) {
              void emit('taskbar:minimize-main-window')
            } else {
              void emit('taskbar:focus-main-window')
            }
          }}
          onMouseEnter={() => setUdaanIconHovered(true)}
          onMouseLeave={() => {
            setUdaanIconHovered(false)
            setUdaanIconPressed(false)
          }}
          onPointerDown={(e) => {
            if (e.button === 0) setUdaanIconPressed(true)
          }}
          onPointerUp={() => setUdaanIconPressed(false)}
          onPointerCancel={() => {
            setUdaanIconHovered(false)
            setUdaanIconPressed(false)
          }}
          onFocus={() => setUdaanIconHovered(true)}
          onBlur={() => {
            setUdaanIconHovered(false)
            setUdaanIconPressed(false)
          }}
          aria-label="Udaan"
          aria-pressed={udaanIsForeground}
          whileHover={pressableIcon.whileHover}
          whileTap={pressableIcon.whileTap}
          transition={pressableIcon.transition}
          className={cn(
            TASKBAR_ICON_BUTTON,
            'relative flex shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/40',
          )}
        >
          {/* Explicit isHovered/isPressed state, not CSS :hover/group-hover
              — see TaskbarEntry.tsx's isHovered doc comment for why: a
              cross-window focus change (exactly what clicking this icon
              causes) can leave a CSS-only hover state visually stuck. */}
          <span
            className={cn(
              'pointer-events-none absolute inset-1.5 rounded-xl border transition-colors duration-150',
              udaanIsForeground
                ? udaanIconPressed
                  ? 'bg-white/18 border-white/16'
                  : 'bg-white/14 border-white/12'
                : udaanIsMinimizedOnly
                  ? 'bg-white/7 border-transparent'
                  : udaanIconHovered
                    ? 'bg-white/10 border-white/10'
                    : 'border-transparent bg-transparent',
            )}
            aria-hidden
          />
          <img
            src={udaanMark}
            alt=""
            className="relative h-7 w-7 object-contain"
            draggable={false}
          />
          {(udaanIsForeground || udaanIsMinimizedOnly) && (
            <span
              className={cn(
                'absolute -bottom-1.5 left-1/2 h-1 -translate-x-1/2 rounded-full',
                udaanIsForeground ? 'w-6 bg-brand-cyan' : 'w-2.5 bg-white/35',
              )}
              aria-hidden
            />
          )}
        </motion.button>

        <div
          className="mx-1 h-10 w-px shrink-0"
          style={{ background: 'linear-gradient(180deg, transparent, rgb(255 255 255 / 9%) 30%, rgb(255 255 255 / 9%) 70%, transparent)' }}
        />

        {/* Running windows — overflow-x-auto with the scrollbar itself
            hidden (not just thinned): a floating dock has no room for a
            visible scrollbar track without it reading as clutter, and
            the row still scrolls via trackpad/shift-wheel if it ever
            genuinely overflows. */}
        <div
          className="taskbar-window-list flex min-w-0 items-center gap-2.5 overflow-x-auto px-0.5"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <style>{`.taskbar-window-list::-webkit-scrollbar { display: none; }`}</style>
          {windowGroups.length === 0 && (
            <span className="text-text-tertiary px-3 text-base">Nothing open</span>
          )}
          {windowGroups.map((group) => (
            <TaskbarEntry
              key={group.processName}
              group={group}
              foreground={foreground}
              onEntryClick={handleEntryClick}
            />
          ))}
        </div>

        <div
          className="h-10 w-px shrink-0"
          style={{ background: 'rgb(255 255 255 / 9%)' }}
        />

        {/* Quick-settings + clock — flat and icon-only, no pill backing.
            Kept slim (no background chrome of its own) so it reads as part
            of the same uniform row as the running-app icons rather than a
            separate boxed-in "widget" sitting at the edge. */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Only shown while a recording is actually running — no
              always-present idle record button. Starting a recording
              happens from the Launchpad app; the taskbar's only job here
              is showing that one IS running (with a live timer) and
              giving a clear way to stop it, per explicit request: an idle
              icon that's always there is exactly what should NOT be
              displayed. */}
          {recording && (
            <motion.button
              type="button"
              onClick={handleStopRecording}
              whileHover={pressableIcon.whileHover}
              whileTap={pressableIcon.whileTap}
              transition={pressableIcon.transition}
              aria-label="Stop recording system audio"
              title="Stop recording system audio"
              className="bg-danger/10 hover:bg-danger/15 text-danger flex h-10 items-center gap-2 rounded-full pr-3 pl-2.5 transition-colors duration-150"
            >
              <span className="bg-danger h-2 w-2 shrink-0 animate-pulse rounded-full" />
              <span className="text-sm font-medium tabular-nums">{formatElapsed(recordingElapsed)}</span>
              <StopIcon width={13} height={13} />
            </motion.button>
          )}

          <motion.button
            type="button"
            onClick={toggleMute}
            whileHover={pressableIcon.whileHover}
            whileTap={pressableIcon.whileTap}
            transition={pressableIcon.transition}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className={cn(
              TASKBAR_ICON_BUTTON,
              'text-text-secondary hover:bg-white/8 hover:text-text-primary flex items-center justify-center rounded-xl transition-colors duration-150',
            )}
          >
            {muted ? <VolumeMuteIcon className={TASKBAR_ICON_GLYPH} /> : <VolumeIcon className={TASKBAR_ICON_GLYPH} />}
          </motion.button>

          <motion.button
            ref={notificationsButtonRef}
            type="button"
            onClick={toggleNotificationsPanel}
            whileHover={pressableIcon.whileHover}
            whileTap={pressableIcon.whileTap}
            transition={pressableIcon.transition}
            aria-label="Notifications"
            className={cn(
              TASKBAR_ICON_BUTTON,
              'flex items-center justify-center rounded-xl transition-colors duration-150',
              notificationsPanelOpen
                ? 'bg-white/10 text-text-primary'
                : 'text-text-secondary hover:bg-white/8 hover:text-text-primary',
            )}
          >
            <BellIcon className={TASKBAR_ICON_GLYPH} />
          </motion.button>

          {battery?.hasBattery && (
            <span
              className="text-text-secondary flex h-14 items-center gap-1.5 px-2 text-base font-medium tabular-nums"
              title={battery.isCharging ? 'Charging' : `${battery.percent}%`}
            >
              {battery.isCharging ? (
                <BatteryChargingIcon width={22} height={22} />
              ) : (
                <BatteryIcon width={22} height={22} />
              )}
              {battery.percent}%
            </span>
          )}

          <motion.button
            type="button"
            onClick={openCalendar}
            whileHover={pressableIcon.whileHover}
            whileTap={pressableIcon.whileTap}
            transition={pressableIcon.transition}
            className="hover:bg-white/8 flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-right transition-colors duration-150"
          >
            <span className="text-text-primary text-md font-semibold tabular-nums">
              {clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
            <span className="text-text-tertiary text-sm tabular-nums">
              {clock.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
            </span>
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}
