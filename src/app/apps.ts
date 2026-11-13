import type { ComponentType, SVGProps } from 'react'
import { ExplorerIcon } from '@/shared/icons'
import { detectApps, launchApp, launchAppByExeName } from '@/integrations/installed-apps/client'
import { openApp } from '@/os/kernel/shell'
import { APP_DEFS, type AppId } from '@/os/kernel/registry'

export interface AppDefinition {
  id: string
  name: string
  /** Stroke-icon fallback — always required so a tile never renders empty. */
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /**
   * The app's own file on disk. Its real icon is extracted from it at
   * render time (see useAppIcon), which is why Udaan ships no redrawn
   * brand logos: a hand-drawn imitation of another product's mark is not
   * that mark, and it reads as wrong beside the genuine icons Windows
   * supplies for every other app.
   */
  iconPath?: string
  /** An already-resolved icon URL, for the rare app with no file to read. */
  iconSrc?: string
  /** May return a promise (e.g. launching a real external process) — callers should await it to surface a real failure instead of assuming a synchronous void call always succeeds. */
  launch: () => void | Promise<void>
  /**
   * The real file path or `shell:AppsFolder\<id>` launch target, when one
   * exists — lets the right-click menu offer "Run as administrator"
   * (`shell.invokeVerb(path, 'runas')`) and "Properties". Absent for
   * Udaan's own built-in apps (React views with nothing on disk to elevate).
   */
  path?: string
}

/**
 * A group of related apps shown as one folder tile in the Launchpad grid
 * (Start-Menu-folder style) — clicking it expands to that group's own tile
 * grid rather than launching anything directly. `Microsoft` is the first
 * instance; the shape is generic so a future group (Adobe, Dev Tools, ...)
 * is just another entry in `APP_FOLDERS`, no rearchitecting needed.
 */
export interface AppFolderDefinition {
  id: string
  name: string
  /** Loads this folder's real app tiles on demand (e.g. a Tauri detection call) — not pre-populated, since what's inside can depend on what's actually installed on this machine. */
  loadApps: () => Promise<AppDefinition[]>
  /**
   * Set only when this folder's contents are already known synchronously
   * (e.g. Udaan's own bundled apps — always present, nothing to detect) —
   * lets the Launchpad render the folder's tiles immediately on open
   * instead of showing a "Looking for installed apps…" loading state for
   * a result that was never actually asynchronous to begin with.
   */
  staticApps?: AppDefinition[]
  /**
   * Up to 4 icons shown in the closed folder tile's stacked preview.
   *
   * These are resolved from the folder's real contents once it has been
   * loaded, not hardcoded: the preview used to be a fixed list of redrawn
   * brand logos, which meant the Microsoft folder showed Word, Excel,
   * PowerPoint and Outlook whether or not any of them were installed.
   */
  previewIconSrcs?: string[]
}

/** Opens Private Player — used by both the Launchpad tile and the TopBar's now-playing chip (clicking the chip should reopen the full view). */
export function openPrivatePlayer() {
  void openApp('private-player')
}

/** Opens the News Brief app to today's report — used by both the Launchpad tile and General Chat's news-brief button. */
export function openNewsBrief() {
  void openApp('news-brief')
}

/**
 * Claude/Norton/Norton Private Browser/TeamViewer used to only appear as
 * tiles once `loadOtherApps()` (below) confirmed each one's real exe via
 * the Windows App Paths registry key — correct in principle, but on this
 * machine none of the guessed exe names (Claude.exe, NortonSecurity.exe,
 * NortonPrivateBrowser.exe, TeamViewer.exe) resolved, so the tiles simply
 * never rendered with no visible explanation why. Pinning them statically
 * here instead guarantees the tile always shows; `launch` still calls the
 * real `installed_apps_launch` command with the bare exe name (not a
 * fabricated path) — Windows' own `ShellExecute` (what `opener::open`
 * shells out to) resolves a bare registered exe name via the SAME App
 * Paths key on its own, so this still launches the real app when it's
 * actually installed, and surfaces Launchpad's existing launch-failure
 * message (see `launch()` in Launchpad.tsx) if it genuinely isn't.
 *
 * Declared ABOVE `PINNED_APPS` (which spreads this array) rather than
 * below it — `const` bindings are not hoisted the way `function`
 * declarations are, so referencing this before its own declaration line
 * threw "Cannot access 'ALWAYS_SHOWN_OTHER_APPS' before initialization"
 * on every single module load, crashing the whole React tree before it
 * could render anything. That's what was actually behind the app window
 * never becoming visible — nothing to do with window sizing/positioning.
 */
const ALWAYS_SHOWN_OTHER_APPS: AppDefinition[] = [
  {
    id: 'claude',
    name: 'Claude',
    icon: ExplorerIcon,
    launch: () => launchAppByExeName('Claude.exe'),
  },
  {
    id: 'teamviewer',
    name: 'TeamViewer',
    icon: ExplorerIcon,
    launch: () => launchAppByExeName('TeamViewer.exe'),
  },
  {
    // Snipping Tool is also already detected via loadOtherApps() below
    // (AppGroup::Other in the backend), but pinned here too for the same
    // reason as Claude/Norton/TeamViewer: on a machine where the
    // detection pass doesn't find it, the tile would otherwise just never
    // render with no visible explanation. A genuinely-not-installed click
    // still surfaces Launchpad's existing launch-failure message instead
    // of pretending the tile isn't real.
    id: 'snipping-tool',
    name: 'Snipping Tool',
    icon: ExplorerIcon,
    launch: () => launchAppByExeName('SnippingTool.exe'),
  },
  {
    // Windows' own File Explorer (explorer.exe) — distinct from Udaan's
    // built-in `file-explorer` tile above, which stays the in-app browser.
    // This one launches the real OS shell explorer for anyone who wants
    // it instead. explorer.exe is a core OS component and does register a
    // normal App Paths entry, so no backend change was needed.
    id: 'windows-explorer',
    name: 'Windows File Explorer',
    icon: ExplorerIcon,
    launch: () => launchAppByExeName('explorer.exe'),
  },
]

/**
 * Udaan's own built-in, custom-made overlay apps (Studio/File Explorer/
 * Document Reader/Notes) — grouped into their own Launchpad folder rather
 * than pinned individually at the top level, same "Start-Menu folder" shape
 * as the Microsoft group below. Unlike Microsoft's folder these don't need
 * detection (they always exist, bundled with Udaan itself), so `loadApps`
 * just resolves immediately with this fixed list.
 *
 * Every `launch` calls the window manager's `openApp` directly with the
 * app's registry id (see src/app/window-manager/registry.ts) — this used
 * to go through a per-app mutable-singleton `register*Launcher`/`launch*`
 * pair that only worked once App.tsx had mounted and run its registration
 * effect; `openApp` reads the zustand store directly, so it works the
 * instant this module loads.
 */
const udaanApp = (id: AppId): AppDefinition => ({ id, name: APP_DEFS[id].name, icon: APP_DEFS[id].icon, launch: () => openApp(id) })

const UDAAN_APPS: AppDefinition[] = (
  ['file-explorer', 'chat', 'calendar', 'private-player', 'notes', 'studio', 'omni-find', 'news-brief', 'audio-recorder', 'claude-usage', 'cnc-mod-switcher', 'viewer-3d', 'settings'] as AppId[]
).map(udaanApp)

export const PINNED_APPS: AppDefinition[] = [
  {
    // Wikipedia isn't a real installed desktop app — there's no exe/App
    // Paths entry to detect, so unlike everything in `loadOtherApps()`
    // below this is a static pinned entry that's always present and just
    // opens the site in the system's default browser. Reuses
    // `installed_apps_launch` directly (not a new command): that command
    // already special-cases anything with a multi-character URI scheme
    // before its first ':' (a real Windows file path's ':' is always at
    // index 1) to skip the file-existence check and hand it straight to
    // `opener::open`, which is exactly the "open this URL" behavior a web
    // link needs — no backend change required.
    id: 'wikipedia',
    name: 'Wikipedia',
    icon: ExplorerIcon,
    launch: () => launchApp('https://www.wikipedia.org'),
  },
  ...ALWAYS_SHOWN_OTHER_APPS,
]

async function loadMicrosoftApps(): Promise<AppDefinition[]> {
  const detected = await detectApps('microsoft')
  return detected.map((app) => ({
    id: `microsoft-${app.id}`,
    name: app.name,
    icon: ExplorerIcon,
    iconPath: app.path,
    launch: async () => {
      try {
        await launchApp(app.path)
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : `Couldn't open ${app.name}.`,
        )
      }
    },
  }))
}

export const APP_FOLDERS: AppFolderDefinition[] = [
  {
    id: 'udaan',
    name: 'Udaan',
    staticApps: UDAAN_APPS,
    loadApps: () => Promise.resolve(UDAAN_APPS),
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    loadApps: loadMicrosoftApps,
  },
]

/**
 * Standalone apps at Launchpad's top level, detected the same way the
 * Microsoft folder's contents are (via `installed_apps_detect`/
 * `AppGroup::Other` — src-tauri/src/installed_apps/mod.rs) rather than
 * unconditionally listed in `PINNED_APPS`, so a tile only ever appears
 * for something actually installed on this machine.
 */
export async function loadOtherApps(): Promise<AppDefinition[]> {
  const detected = await detectApps('other')
  return detected.map((app) => ({
    id: `other-${app.id}`,
    name: app.name,
    icon: ExplorerIcon,
    iconPath: app.path,
    launch: async () => {
      try {
        await launchApp(app.path)
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : `Couldn't open ${app.name}.`,
        )
      }
    },
  }))
}
