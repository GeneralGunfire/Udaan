import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Wordmark } from './Wordmark'
import {
  TitleBarMinimizeIcon,
  TitleBarMaximizeIcon,
  TitleBarRestoreIcon,
  TitleBarCloseIcon,
} from './TopBarIcons'
import { Button } from './ui/button'
import { cn } from '@/shared/lib/cn'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import { WallpaperPicker } from './WallpaperPicker'
import { ShellSafetyPanel } from './ShellSafetyPanel'
import { WorkspaceSettingsPanel } from './WorkspaceSettingsPanel'
import { fillMonitorBounds } from '@/shared/lib/udaanTaskbarMode'
import { NowPlayingChip } from '@/features/private-player/components/NowPlayingChip'

/**
 * Lazily resolves the Tauri window handle. Only ever called from click
 * handlers (never at module load), so running the frontend outside Tauri
 * (e.g. `pnpm dev` in a browser) doesn't crash on import — the buttons
 * just no-op with a console warning instead.
 */
async function withAppWindow(
  action: (win: import('@tauri-apps/api/window').Window) => void | Promise<void>,
) {
  if (!('__TAURI_INTERNALS__' in window)) {
    console.warn('Window controls are only available inside the Tauri app.')
    return
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  try {
    await action(getCurrentWindow())
  } catch (err) {
    console.error('Window control failed — check src-tauri capabilities:', err)
  }
}

/**
 * Windows 11 caption-button geometry: 46x32, square corners, flush to the
 * window edge. These deliberately do NOT use the app's `Button` — a
 * caption control belongs to the window chrome, not the app's own
 * interaction language, and giving it the same lift/radius as an in-app
 * button made the three of them read as ordinary toolbar actions.
 */
const captionButton = [
  'inline-flex h-full w-[46px] shrink-0 items-center justify-center',
  'text-text-secondary transition-colors duration-100',
  'hover:bg-(--surface-raised) hover:text-text-primary',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
].join(' ')

export interface TopBarProps {
  /** Whether Udaan's own floating taskbar (vs. Explorer's) is currently active — owned by App.tsx since it also affects the root layout's padding. See App.tsx's root div comment. */
  udaanTaskbarOn: boolean
  onUdaanTaskbarOnChange: (on: boolean) => void
}

/**
 * Title bar — the top strip of the app's one shared panel (App.tsx), not
 * its own floating surface. Native OS decorations are disabled (see
 * tauri.conf.json), so this row owns window drag, minimize, maximize and
 * close via `data-tauri-drag-region` + the Tauri window API.
 *
 * Laid out as three zones — brand, session context, window controls —
 * with a single divider before the controls. The previous version put a
 * divider between every individual control, which grouped nothing and
 * read as a row of unrelated icons.
 */
export function TopBar({ udaanTaskbarOn, onUdaanTaskbarOnChange }: TopBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [shellSafetyOpen, setShellSafetyOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    async function init() {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const sync = () => win.isMaximized().then((v) => !cancelled && setIsMaximized(v))
      await sync()
      unlisten = await win.onResized(sync)
    }
    void init()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  async function runGuarded(action: (win: import('@tauri-apps/api/window').Window) => void | Promise<void>) {
    if (pendingRef.current) return
    pendingRef.current = true
    try {
      await withAppWindow(action)
    } finally {
      pendingRef.current = false
    }
  }

  return (
    <header
      data-tauri-drag-region
      className="relative z-20 flex h-14 shrink-0 items-center border-b border-(--border-hairline) pr-0 pl-3"
    >
      {/* Zone 1 — brand. Also the primary drag handle. */}
      <div data-tauri-drag-region className="flex items-center gap-2 px-2">
        <Wordmark size="md" />
      </div>

      {/* Spacer — draggable, so the whole bar moves the window, not just
          the brand corner. */}
      <div data-tauri-drag-region className="h-full flex-1" />

      {/* Zone 2 — session context: what's playing, what it looks like,
          how the workspace is configured. Grouped tightly together and
          separated from the window controls by a single divider, rather
          than every control floating between its own pair of dividers. */}
      <div className="flex shrink-0 items-center gap-1 pr-2">
        <NowPlayingChip />
        <WallpaperPicker />
        <WorkspaceSettingsPanel
          udaanTaskbarOn={udaanTaskbarOn}
          onUdaanTaskbarOnChange={onUdaanTaskbarOnChange}
          onOpenShellSafety={() => setShellSafetyOpen(true)}
        />
      </div>
      <ShellSafetyPanel open={shellSafetyOpen} onOpenChange={setShellSafetyOpen} />

      <div className="mx-1 h-5 w-px bg-(--border-hairline)" />

      {/* Zone 3 — window controls. Sized to the Windows 11 caption-button
          convention (46x32, flush to the top-right corner with no gap or
          rounding) so they land where muscle memory expects, rather than
          reading as three more app buttons that happen to sit at the end
          of the row. */}
      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => runGuarded((win) => win.minimize())}
          className={captionButton}
        >
          <TitleBarMinimizeIcon width={14} height={14} />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          onClick={() =>
            // With the Udaan taskbar active, "maximize" means the full
            // monitor (fillMonitorBounds) since there's no reserved
            // Explorer strip to respect — a plain toggleMaximize() would
            // otherwise snap back to the stale, taskbar-shrunk work area.
            runGuarded((win) => (udaanTaskbarOn ? fillMonitorBounds() : win.toggleMaximize()))
          }
          className={captionButton}
        >
          {isMaximized ? (
            <TitleBarRestoreIcon width={14} height={14} />
          ) : (
            <TitleBarMaximizeIcon width={14} height={14} />
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setCloseConfirmOpen(true)}
          className={cn(
            captionButton,
            // The one red in the app, and only on hover: a close button
            // that is permanently red reads as a warning state rather
            // than a control.
            'hover:bg-[#e5484d] hover:text-white focus-visible:bg-[#e5484d] focus-visible:text-white',
          )}
        >
          <TitleBarCloseIcon width={14} height={14} />
        </button>
      </div>

      {/* Closing this window ends the whole Udaan session (it's replacing
          Explorer's shell, not just one app), so it gets the same
          confirm-before-destructive-action treatment as deleting a file
          rather than closing on the first click. */}
      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AnimatePresence>
          {closeConfirmOpen && (
            <DialogContent>
              <DialogTitle className="text-text-primary text-[15px] font-semibold">Close Udaan?</DialogTitle>
              <DialogDescription className="text-text-secondary mt-1.5 text-[13px]">
                Everything running underneath — open apps, the dock, background tasks — closes with it.
              </DialogDescription>
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="pill" onClick={() => setCloseConfirmOpen(false)}>
                  Stay open
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="pill"
                  onClick={() => {
                    setCloseConfirmOpen(false)
                    void runGuarded((win) => win.close())
                  }}
                >
                  Close Udaan
                </Button>
              </div>
            </DialogContent>
          )}
        </AnimatePresence>
      </Dialog>
    </header>
  )
}
