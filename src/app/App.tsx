import { Suspense, lazy, useEffect, useState } from 'react'
import { AmbientBackground } from '@/shared/components/AmbientBackground'
import { TopBar } from '@/shared/components/TopBar'
import { Sidebar, type SidebarView } from '@/shared/components/Sidebar'
import { Launchpad } from '@/shared/components/Launchpad'
import { GeneralChatView } from '@/features/general-chat/GeneralChatView'
import { CalendarView } from '@/features/calendar/CalendarView'
import { registerStudioLauncher, registerFileExplorerLauncher, registerDocumentReaderLauncher } from '@/app/apps'
import { hydrateScheduleCache } from '@/integrations/schedule'
import { listen } from '@tauri-apps/api/event'
import { activateUdaanTaskbar } from '@/shared/lib/udaanTaskbarMode'
import { TASKBAR_RESERVED_HEIGHT_PX } from '@/shared/lib/taskbarGeometry'

// Lazy: Studio's audio-engine module graph (Web Audio setup, sample
// loading) is real weight that only the small fraction of sessions which
// ever open Studio need — no reason to ship or evaluate it on every cold
// start of the main chat/calendar app.
const StudioApp = lazy(() => import('@/apps/studio').then((m) => ({ default: m.StudioApp })))

// Lazy for the same reason as Studio — File Explorer's directory-listing/
// preview code only matters to sessions that actually open it.
const FileExplorerView = lazy(() =>
  import('@/features/file-explorer/FileExplorerView').then((m) => ({ default: m.FileExplorerView })),
)

// Lazy for the same reason — pdfjs-dist/mammoth/marked are real weight only
// sessions that actually open a document need to pay for.
const DocumentReaderView = lazy(() =>
  import('@/features/document-reader/DocumentReaderView').then((m) => ({ default: m.DocumentReaderView })),
)

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
  const [fileExplorerOpen, setFileExplorerOpen] = useState(false)
  const [documentReaderOpen, setDocumentReaderOpen] = useState(false)
  const [documentReaderFilePath, setDocumentReaderFilePath] = useState<string | undefined>(undefined)
  // Owned here (not just inside TopBar) because it changes how much this
  // root container floats above the desktop — see the comment on the root
  // div below for why.
  const [udaanTaskbarOn, setUdaanTaskbarOn] = useState(false)

  useEffect(() => {
    registerStudioLauncher(() => setStudioOpen(true))
    registerFileExplorerLauncher(() => setFileExplorerOpen(true))
    registerDocumentReaderLauncher((filePath) => {
      setDocumentReaderFilePath(filePath)
      setDocumentReaderOpen(true)
    })
  }, [])

  // Udaan's own taskbar is the default, always-on experience now — not
  // something the user has to re-enable by hand every session via
  // TopBar's toggle. Activated once on startup; the toggle button still
  // exists for the rare case of wanting Explorer's taskbar back.
  useEffect(() => {
    let cancelled = false
    activateUdaanTaskbar()
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
      console.error('[schedule] Failed to hydrate schedule cache on startup:', err)
    })
  }, [])

  // The taskbar (a separate window — see src/features/taskbar/TaskbarWindow.tsx)
  // has no Launchpad/Calendar UI of its own; its Start button and clock
  // just emit these events for the main window to act on, since the main
  // window is what actually owns Launchpad and the Calendar view.
  useEffect(() => {
    let unlistenLaunchpad: (() => void) | undefined
    let unlistenCalendar: (() => void) | undefined
    let cancelled = false

    async function bringMainWindowToFront() {
      if (!('__TAURI_INTERNALS__' in window)) return
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.unminimize()
      await win.setFocus()
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
      if (cancelled) {
        unlistenLaunchpad()
        unlistenCalendar()
      }
    }
    void init()

    return () => {
      cancelled = true
      unlistenLaunchpad?.()
      unlistenCalendar?.()
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
    // The floating-card padding (gap on every side, revealing
    // AmbientBackground behind the panel) only makes sense when this
    // window is sized to the OS work area under Explorer's own taskbar —
    // that's the normal case the padding was designed for. Once Udaan's
    // own taskbar is active, the main window is deliberately resized to
    // the FULL monitor bounds (see udaanTaskbarMode's fillMonitorBounds)
    // since Udaan's taskbar is a floating overlay with no work-area
    // reservation of its own.
    //
    // The bottom inset in that mode is NOT zero, though — it's exactly
    // TASKBAR_RESERVED_HEIGHT_PX (the floating dock's own height plus its
    // margin off the true screen edge, shared from taskbarGeometry.ts so
    // this can never drift out of sync with the dock's real size). Zeroing
    // it entirely let the panel run flush to the true bottom of the
    // screen, underneath/behind where the dock floats — this reserves
    // just enough space for the dock to sit in its own clear strip below
    // the panel, the same way Explorer's taskbar naturally gets its own
    // strip via the OS work area.
    <div
      className="relative flex h-screen w-screen flex-col px-16 pt-16 pb-11 md:px-32 md:pt-24 md:pb-20"
      style={udaanTaskbarOn ? { paddingBottom: TASKBAR_RESERVED_HEIGHT_PX } : undefined}
    >
      <AmbientBackground />

      <div
        className="glass-surface border-glass-border relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border"
        style={{
          boxShadow: 'var(--shadow-panel)',
          // Darker and more opaque than the shared `.glass-surface` default
          // (which is tuned for transient popovers/dropdowns) — this is the
          // app's main shell, so it should read as a solid surface rather
          // than a light frosted one. `background-color` is a longhand of
          // `.glass-surface`'s `background` shorthand, so this inline value
          // overrides just the color while keeping its highlight gradient.
          backgroundColor: 'rgb(4 6 10 / 97%)',
        }}
      >
        <TopBar udaanTaskbarOn={udaanTaskbarOn} onUdaanTaskbarOnChange={setUdaanTaskbarOn} />

        <div className="relative flex min-h-0 flex-1">
          <Sidebar
            activeView={activeView}
            onSelectView={setActiveView}
            onOpenLaunchpad={() => setLaunchpadOpen(true)}
          />

          <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {/* Both views stay mounted and are toggled with `hidden` rather
                than conditionally rendered — switching tabs used to unmount
                GeneralChatView every time, which restarted its chat-history
                fetch and briefly rendered its loading layout (different
                from the empty/populated layout) before settling, reading as
                a jump/reflow on every tab switch. Keeping both mounted
                avoids that remount entirely, and preserves scroll position
                and any in-progress state (e.g. an unsent draft) per tab. */}
            <div className={`absolute inset-0 p-8 ${activeView === 'chat' ? '' : 'hidden'}`}>
              <GeneralChatView />
            </div>
            <div className={`absolute inset-0 overflow-y-auto p-8 ${activeView === 'calendar' ? '' : 'hidden'}`}>
              <CalendarView />
            </div>
          </main>
        </div>

        {studioOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={null}>
              <StudioApp onClose={() => setStudioOpen(false)} />
            </Suspense>
          </div>
        )}

        {fileExplorerOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={null}>
              <FileExplorerView onClose={() => setFileExplorerOpen(false)} />
            </Suspense>
          </div>
        )}

        {documentReaderOpen && (
          <div className="bg-bg-base absolute inset-0 z-30">
            <Suspense fallback={null}>
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
      </div>

      <Launchpad open={launchpadOpen} onOpenChange={setLaunchpadOpen} />
    </div>
  )
}
