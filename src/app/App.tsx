import { Suspense, lazy, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AmbientBackground } from '@/shared/components/AmbientBackground'
import { TopBar } from '@/shared/components/TopBar'
import { Sidebar, type SidebarView } from '@/shared/components/Sidebar'
import { Launchpad } from '@/shared/components/Launchpad'
import { GeneralChatView } from '@/features/general-chat/GeneralChatView'
import { CalendarView } from '@/features/calendar/CalendarView'
import {
  registerStudioLauncher,
  registerOmniFindLauncher,
  registerFileExplorerLauncher,
  registerDocumentReaderLauncher,
  registerNotesLauncher,
  registerAgriTrackLauncher,
  registerStudyLauncher,
  registerCncModSwitcherLauncher,
  registerClaudeUsageLauncher,
  registerPrivatePlayerLauncher,
  registerNewsBriefLauncher,
  registerAudioRecorderLauncher,
} from '@/app/apps'
import { hydrateScheduleCache } from '@/integrations/schedule'
import { initDailyBriefScheduler } from '@/integrations/daily-brief'
import { listen } from '@tauri-apps/api/event'
import { activateUdaanTaskbar } from '@/shared/lib/udaanTaskbarMode'
import { TASKBAR_RESERVED_HEIGHT_PX } from '@/shared/lib/taskbarGeometry'
import { launchAppByExeName } from '@/integrations/installed-apps/client'
import { cn } from '@/shared/lib/cn'
import {
  ClockScreensaver,
  SCREENSAVER_IDLE_MS,
} from '@/features/screensaver/ClockScreensaver'
import { PlayerProvider } from '@/features/private-player/lib/PlayerContext'

// Lazy: Studio's audio-engine module graph (Web Audio setup, sample
// loading) is real weight that only the small fraction of sessions which
// ever open Studio need — no reason to ship or evaluate it on every cold
// start of the main chat/calendar app.
const StudioApp = lazy(() =>
  import('@/apps/studio').then((m) => ({ default: m.StudioApp })),
)
const OmniFindView = lazy(() =>
  import('@/features/omni-find/OmniFindView').then((m) => ({ default: m.OmniFindView })),
)

// Lazy for the same reason as Studio — File Explorer's directory-listing/
// preview code only matters to sessions that actually open it.
const FileExplorerView = lazy(() =>
  import('@/features/file-explorer/FileExplorerView').then((m) => ({
    default: m.FileExplorerView,
  })),
)

// Lazy for the same reason — pdfjs-dist/mammoth/marked are real weight only
// sessions that actually open a document need to pay for.
const DocumentReaderView = lazy(() =>
  import('@/features/document-reader/DocumentReaderView').then((m) => ({
    default: m.DocumentReaderView,
  })),
)

// Lazy for the same reason as the other overlays above — Notes' own module
// graph only matters to sessions that actually open it.
const NotesView = lazy(() =>
  import('@/features/notes/NotesView').then((m) => ({ default: m.NotesView })),
)

const AgriTrackView = lazy(() =>
  import('@/features/agritrack/AgriTrackView').then((m) => ({ default: m.AgriTrackView })),
)

// Lazy for the same reason as the other overlays above. Study additionally
// pulls in the docx parser (mammoth) for its own indexing path, which is
// worth keeping out of the initial bundle for sessions that never open it.
const StudyView = lazy(() =>
  import('@/features/study/StudyView').then((m) => ({ default: m.StudyView })),
)

// Lazy for the same reason as the other overlays above — this only matters
// to sessions that actually have the C&C Generals Zero Hour install plugged
// in and open this panel.
const CncModSwitcherView = lazy(() =>
  import('@/features/cnc-mod-switcher/CncModSwitcherView').then((m) => ({
    default: m.CncModSwitcherView,
  })),
)

// Lazy for the same reason as the other overlays above — this only matters
// to sessions that actually open the usage dashboard.
const ClaudeUsageView = lazy(() =>
  import('@/features/claude-usage/ClaudeUsageView').then((m) => ({
    default: m.ClaudeUsageView,
  })),
)

// Lazy for the same reason as the other overlays above — this only matters
// to sessions that actually open the music player.
const PrivatePlayerView = lazy(() =>
  import('@/features/private-player/PrivatePlayerView').then((m) => ({
    default: m.PrivatePlayerView,
  })),
)

// Lazy for the same reason as the other overlays above — this only matters
// to sessions that actually open the news brief.
const NewsBriefView = lazy(() =>
  import('@/features/news-brief/NewsBriefView').then((m) => ({
    default: m.NewsBriefView,
  })),
)

// Lazy for the same reason as the other overlays above — this only matters
// to sessions that actually open the system audio recorder.
const AudioRecorderView = lazy(() =>
  import('@/features/audio-recorder/AudioRecorderView').then((m) => ({
    default: m.AudioRecorderView,
  })),
)

// Suspense fallback for the lazy-loaded overlays below — `fallback={null}`
// previously left a blank bg-bg-base rect on screen for however long the
// chunk took to fetch/parse, which read as "the app went blank" or "it went
// back to the loading screen" even though nothing was actually wrong.
function OverlayLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
    </div>
  )
}

/**
 * The app has two destinations — General Chat and Calendar — switched via
 * the sidebar icon rail (see Sidebar.tsx). TopBar, Sidebar, and the active
 * view all live inside one glass panel (top bar as its top strip, sidebar
 * as its left strip) rather than as separate floating surfaces.
 *
 * The Launchpad and Studio are launched as overlays above this panel —
 * Studio has no route/window of its own yet, so it's just conditionally
 * mounted full-screen here.
 */
export default function App() {
  const [activeView, setActiveView] = useState<SidebarView>('chat')
  const [launchpadOpen, setLaunchpadOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [omniFindOpen, setOmniFindOpen] = useState(false)
  const [fileExplorerOpen, setFileExplorerOpen] = useState(false)
  const [documentReaderOpen, setDocumentReaderOpen] = useState(false)
  const [documentReaderFilePath, setDocumentReaderFilePath] = useState<
    string | undefined
  >(undefined)
  const [notesOpen, setNotesOpen] = useState(false)
  const [agriTrackOpen, setAgriTrackOpen] = useState(false)
  const [studyOpen, setStudyOpen] = useState(false)
  const [cncModSwitcherOpen, setCncModSwitcherOpen] = useState(false)
  const [claudeUsageOpen, setClaudeUsageOpen] = useState(false)
  const [privatePlayerOpen, setPrivatePlayerOpen] = useState(false)
  const [newsBriefOpen, setNewsBriefOpen] = useState(false)
  const [audioRecorderOpen, setAudioRecorderOpen] = useState(false)
  // Owned here (not just inside TopBar) because it changes how much this
  // root container floats above the desktop — see the comment on the root
  // div below for why.
  const [udaanTaskbarOn, setUdaanTaskbarOn] = useState(false)
  const [screensaverOn, setScreensaverOn] = useState(false)

  useEffect(() => {
    registerStudioLauncher(() => setStudioOpen(true))
    registerOmniFindLauncher(() => setOmniFindOpen(true))
    registerFileExplorerLauncher(() => setFileExplorerOpen(true))
    registerDocumentReaderLauncher((filePath) => {
      setDocumentReaderFilePath(filePath)
      setDocumentReaderOpen(true)
    })
    registerNotesLauncher(() => setNotesOpen(true))
    registerAgriTrackLauncher(() => setAgriTrackOpen(true))
    registerStudyLauncher(() => setStudyOpen(true))
    registerCncModSwitcherLauncher(() => setCncModSwitcherOpen(true))
    registerClaudeUsageLauncher(() => setClaudeUsageOpen(true))
    registerPrivatePlayerLauncher(() => setPrivatePlayerOpen(true))
    registerNewsBriefLauncher(() => setNewsBriefOpen(true))
    registerAudioRecorderLauncher(() => setAudioRecorderOpen(true))
  }, [])

  // Kicks off the daily news brief's own scheduling: generates today's
  // report immediately if nothing has run yet today (covers Udaan starting
  // after 5am with no report generated), then arms a timer for the next
  // 5am so a long-running session also gets tomorrow's brief without a
  // restart. See src/integrations/daily-brief/scheduler.ts.
  useEffect(() => {
    initDailyBriefScheduler()
  }, [])

  // Udaan's own taskbar is the default, always-on experience. This is the
  // ONE place that actually calls activateUdaanTaskbar() on startup — a
  // previous version trusted a sessionStorage flag set by the splash
  // screen's own Stage 1 to skip this call when "already activated," which
  // caused a real bug: if that flag survived somehow across a restart (or
  // the splash's animation was skipped entirely via reduced-motion/
  // already-played-this-session, never running Stage 1 at all), App.tsx
  // would believe the window was already correctly resized to the full
  // monitor and never actually verify/fix it — leaving the window sized to
  // a stale/default work area while the bottom padding below still assumed
  // full-monitor sizing, which is exactly what produced the grey strip.
  // Always calling this directly, unconditionally, on every mount makes
  // App.tsx the single source of truth for "is the window actually
  // correctly sized" — cheap and idempotent (see udaanTaskbarMode.ts), so
  // there's no real cost to calling it again even if the splash also did.
  useEffect(() => {
    let cancelled = false
    // showDock=false: the resize/hide-Explorer's-taskbar work still needs
    // to happen immediately (that's what the grey-strip fix above relies
    // on), but the dock window itself should only become visible once the
    // splash screen is done — see SplashScreen.tsx's own call to
    // showUdaanTaskbarDock(), which is the one place that actually reveals
    // it, timed to the splash's exit.
    activateUdaanTaskbar(false)
      .then(() => {
        if (!cancelled) setUdaanTaskbarOn(true)
      })
      .catch((err) => {
        console.error('Failed to activate Udaan taskbar on startup:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Populates General Chat's schedule-assistant cache at startup. Calendar
  // itself reads/writes SQLite directly (see features/calendar/hooks/useEvents.ts)
  // and refreshes this same cache after its own mutations, so both surfaces
  // stay in sync now that they share one schedule_events table.
  useEffect(() => {
    hydrateScheduleCache().catch((err) => {
      console.error(
        '[schedule] Failed to hydrate schedule cache on startup:',
        err,
      )
    })
  }, [])

  // The taskbar (a separate window — see src/features/taskbar/TaskbarWindow.tsx)
  // has no Launchpad/Calendar UI of its own; its Start button and clock
  // just emit these events for the main window to act on, since the main
  // window is what actually owns Launchpad and the Calendar view.
  useEffect(() => {
    let unlistenLaunchpad: (() => void) | undefined
    let unlistenCalendar: (() => void) | undefined
    let unlistenFocusMain: (() => void) | undefined
    let unlistenMinimizeMain: (() => void) | undefined
    let unlistenNewInstance: (() => void) | undefined
    let cancelled = false

    async function bringMainWindowToFront() {
      if (!('__TAURI_INTERNALS__' in window)) return
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.unminimize()
      await win.setFocus()
    }

    async function minimizeMainWindow() {
      if (!('__TAURI_INTERNALS__' in window)) return
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().minimize()
    }

    async function init() {
      unlistenLaunchpad = await listen('taskbar:open-launchpad', () => {
        void bringMainWindowToFront()
        setLaunchpadOpen(true)
      })
      unlistenCalendar = await listen('taskbar:open-calendar', () => {
        void bringMainWindowToFront()
        setActiveView('calendar')
      })
      // The dock's leftmost icon now acts like any other running app's
      // taskbar entry (focus/restore only) rather than a special Start
      // button — this event is just "bring Udaan forward," with none of
      // Launchpad's own opening behavior.
      unlistenFocusMain = await listen('taskbar:focus-main-window', () => {
        void bringMainWindowToFront()
      })
      // Clicking Udaan's own dock icon while it's already the focused
      // window minimizes it — matches real Windows taskbar behavior for
      // clicking a running+focused app's icon (see TaskbarWindow.tsx).
      unlistenMinimizeMain = await listen('taskbar:minimize-main-window', () => {
        void minimizeMainWindow()
      })
      // Middle-click on a taskbar icon (TaskbarEntry.tsx) — opens a new
      // instance/window of that process, matching real Windows taskbar
      // behavior for apps that support multiple windows. Goes through the
      // same exe-name launch path Launchpad tiles already use rather than
      // trying to "duplicate" a specific HWND, since Windows has no
      // generic way to clone an arbitrary window — starting a fresh
      // process is what a real new instance actually is.
      unlistenNewInstance = await listen<{ processName: string }>('taskbar:new-instance', (event) => {
        void launchAppByExeName(event.payload.processName).catch((err) => {
          console.error('Failed to launch new instance:', err)
        })
      })
      if (cancelled) {
        unlistenLaunchpad()
        unlistenCalendar()
        unlistenFocusMain()
        unlistenMinimizeMain()
        unlistenNewInstance()
      }
    }
    void init()

    return () => {
      cancelled = true
      unlistenLaunchpad?.()
      unlistenCalendar?.()
      unlistenFocusMain?.()
      unlistenMinimizeMain?.()
      unlistenNewInstance?.()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        setLaunchpadOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Screensaver: bare Space (no modifier — Ctrl+Space is already claimed
  // by Launchpad above) activates it on demand from anywhere in the app,
  // matching the "space bar navigation to clock screen" request. Typing
  // into an input/textarea/contenteditable must NOT trigger this, or
  // every space bar keystroke while composing a chat message would launch
  // the screensaver mid-sentence.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.code !== 'Space' ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e.shiftKey
      )
        return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable)
        return
      setScreensaverOn(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Idle-triggered screensaver — resets on any real user input anywhere in
  // the window. Deliberately NOT reset by the screensaver's own dismiss
  // listeners (ClockScreensaver.tsx) to avoid a feedback loop; this timer
  // only tracks activity while the screensaver is off.
  useEffect(() => {
    if (screensaverOn) return
    let idleTimer: ReturnType<typeof setTimeout>
    function resetTimer() {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => setScreensaverOn(true), SCREENSAVER_IDLE_MS)
    }
    resetTimer()
    window.addEventListener('mousemove', resetTimer)
    window.addEventListener('mousedown', resetTimer)
    window.addEventListener('keydown', resetTimer)
    return () => {
      clearTimeout(idleTimer)
      window.removeEventListener('mousemove', resetTimer)
      window.removeEventListener('mousedown', resetTimer)
      window.removeEventListener('keydown', resetTimer)
    }
  }, [screensaverOn])

  // System-wide Start Menu trigger — registered as a real OS global
  // shortcut in src-tauri/src/lib.rs (Ctrl+Space) so it opens Launchpad
  // even when Udaan isn't the focused window, matching how the real Start
  // Menu opens regardless of what currently has focus. The bare Windows
  // key itself is NOT achievable this way — the underlying global-hotkey
  // crate has no support for registering it standalone — documented gap,
  // Ctrl+Space is the real working trigger both here and as the
  // in-window-only listener above.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    async function init() {
      unlisten = await listen('global-shortcut:open-launchpad', () => {
        setLaunchpadOpen((prev) => !prev)
      })
      if (cancelled) unlisten()
    }
    void init()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return (
    // PlayerProvider wraps the whole tree (not just the Private Player
    // overlay) so the shared audio element/engine outlives that overlay
    // being open or closed — see PlayerContext.tsx's doc comment for the
    // duplicate-playback bug this fixes.
    <PlayerProvider>
    {/* The window itself always fills the full monitor bounds once Udaan's
        own taskbar is active (see udaanTaskbarMode's fillMonitorBounds) —
        but the panel inside it should still read as a clearly bounded,
        rectangular surface floating over AmbientBackground, not fused
        edge-to-edge with the screen. Horizontal padding is kept larger than
        vertical (rather than uniform) so the panel keeps a wide rectangular
        shape instead of trending toward square as the inset grows, plus the
        taskbar dock's own reserved height at the bottom. */}
    <motion.div
      className={cn(
        'relative flex h-screen w-screen flex-col',
        udaanTaskbarOn
          ? 'px-24 pt-16 pb-16 md:px-48 md:pt-28 md:pb-28 lg:px-64 lg:pt-32'
          : 'px-16 pt-16 pb-11 md:px-32 md:pt-24 md:pb-20',
      )}
      style={
        udaanTaskbarOn
          ? { paddingBottom: `calc(${TASKBAR_RESERVED_HEIGHT_PX}px + 5rem)` }
          : undefined
      }
      // Mounted underneath the splash from the very start (see main.tsx) so
      // this fade+rise plays in sync with the splash's own dissolve rather
      // than the app just popping in fully-formed the instant the splash
      // disappears — makes the handoff read as one continuous motion
      // instead of two unrelated things happening back to back.
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
    >
      <AmbientBackground />

      <div
        className="glass-surface relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl"
        style={{
          boxShadow: 'var(--shadow-panel)',
          // The main window panel is the one surface in the app that sits
          // directly over AmbientBackground's full-bleed wallpaper, so it
          // is the surface that has to *be* glass rather than imitate it.
          //
          // It was previously an opaque fill (--color-glass-bg, #1a1a1d).
          // That hid the wallpaper completely behind the app's single
          // largest rectangle, which in turn made every glass affordance
          // downstream pointless: .glass-surface's backdrop blur was
          // removed as "visually inert" (correct — nothing translucent was
          // beneath it), and this element's own top-left highlight gradient
          // was disabled because against a flat dark fill it read as a
          // stray light wash. Both were symptoms, not causes. The window
          // rendered as a flat black rectangle pasted onto a photograph.
          //
          // Now it's genuinely translucent and frosted: the wallpaper reads
          // through as tone and luminance without competing with content,
          // the blur does real work, and the highlight gradient reads as a
          // lit edge on a physical pane instead of a smudge. Opacity is
          // high enough (86%) to keep body text at its measured contrast
          // ratios against a bright wallpaper, not just a dark one.
          backgroundColor:
            'color-mix(in srgb, var(--surface-base) 86%, transparent)',
          backdropFilter: 'blur(var(--blur-panel)) saturate(115%)',
          WebkitBackdropFilter: 'blur(var(--blur-panel)) saturate(115%)',
        }}
      >
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <TopBar
            udaanTaskbarOn={udaanTaskbarOn}
            onUdaanTaskbarOnChange={setUdaanTaskbarOn}
          />

          <div className="relative flex min-h-0 flex-1">
            <Sidebar
              activeView={activeView}
              onSelectView={setActiveView}
              onOpenLaunchpad={() => setLaunchpadOpen(true)}
              onOpenScreensaver={() => setScreensaverOn(true)}
            />

            <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {/* Both views stay mounted at all times — switching tabs used
                to unmount GeneralChatView every time, which restarted its
                chat-history fetch and briefly rendered its loading layout
                (different from the empty/populated layout) before
                settling, reading as a jump/reflow on every tab switch.
                Keeping both mounted avoids that remount entirely, and
                preserves scroll position and any in-progress state (e.g.
                an unsent draft) per tab.

                The inactive view used to be toggled with the `hidden`
                class (display:none) — correct for avoiding layout cost,
                but display:none can't be transitioned, so switching tabs
                was a hard instant cut with no visual continuity at all.
                Opacity + a tiny rise now crossfades between them instead;
                `pointer-events-none` + `aria-hidden` on the inactive view
                keeps it inert (unclickable, untabbable) exactly like
                `hidden` did, just without losing the ability to animate. */}
              <motion.div
                className="absolute inset-0 p-8"
                animate={{ opacity: activeView === 'chat' ? 1 : 0, y: activeView === 'chat' ? 0 : 4 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                style={{ pointerEvents: activeView === 'chat' ? 'auto' : 'none' }}
                aria-hidden={activeView !== 'chat'}
              >
                <GeneralChatView />
              </motion.div>
              <motion.div
                className="absolute inset-0 overflow-y-auto p-8"
                animate={{ opacity: activeView === 'calendar' ? 1 : 0, y: activeView === 'calendar' ? 0 : 4 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                style={{ pointerEvents: activeView === 'calendar' ? 'auto' : 'none' }}
                aria-hidden={activeView !== 'calendar'}
              >
                <CalendarView />
              </motion.div>
            </main>
          </div>
        </div>

        {/* OmniFind does NOT paint an opaque ground the way Studio does:
            it is composed on the wallpaper like General Chat, so the app
            panel's own glass must read through it. */}
        {omniFindOpen && (
          <div className="absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <OmniFindView onClose={() => setOmniFindOpen(false)} />
            </Suspense>
          </div>
        )}

        {studioOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <StudioApp onClose={() => setStudioOpen(false)} />
            </Suspense>
          </div>
        )}

        {fileExplorerOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <FileExplorerView onClose={() => setFileExplorerOpen(false)} />
            </Suspense>
          </div>
        )}

        {documentReaderOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <DocumentReaderView
                initialFilePath={documentReaderFilePath}
                onClose={() => {
                  setDocumentReaderOpen(false)
                  setDocumentReaderFilePath(undefined)
                }}
              />
            </Suspense>
          </div>
        )}

        {notesOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <NotesView onClose={() => setNotesOpen(false)} />
            </Suspense>
          </div>
        )}

        {agriTrackOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <AgriTrackView onClose={() => setAgriTrackOpen(false)} />
            </Suspense>
          </div>
        )}

        {studyOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <StudyView onClose={() => setStudyOpen(false)} />
            </Suspense>
          </div>
        )}

        {cncModSwitcherOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <CncModSwitcherView onClose={() => setCncModSwitcherOpen(false)} />
            </Suspense>
          </div>
        )}

        {claudeUsageOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <ClaudeUsageView onClose={() => setClaudeUsageOpen(false)} />
            </Suspense>
          </div>
        )}

        {privatePlayerOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <PrivatePlayerView onClose={() => setPrivatePlayerOpen(false)} />
            </Suspense>
          </div>
        )}

        {newsBriefOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <NewsBriefView onClose={() => setNewsBriefOpen(false)} />
            </Suspense>
          </div>
        )}

        {audioRecorderOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={<OverlayLoading />}>
              <AudioRecorderView onClose={() => setAudioRecorderOpen(false)} />
            </Suspense>
          </div>
        )}
      </div>

      <Launchpad open={launchpadOpen} onOpenChange={setLaunchpadOpen} />

      <AnimatePresence>
        {screensaverOn && (
          <ClockScreensaver onDismiss={() => setScreensaverOn(false)} />
        )}
      </AnimatePresence>
    </motion.div>
    </PlayerProvider>
  )
}
