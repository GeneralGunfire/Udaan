import type { ComponentType, SVGProps } from 'react'
import {
  WaveformIcon,
  ExplorerIcon,
  BookOpenIcon,
  FileTextIcon,
  DiscIcon,
  GaugeIcon,
  NewspaperIcon,
  RecordIcon,
  GraduationCapIcon,
  SearchIcon,
  DatabaseIcon,
} from '@/shared/icons'
import { detectApps, launchApp, launchAppByExeName, openFileWith } from '@/integrations/installed-apps/client'
import wordIcon from '@/assets/app-icons/word.svg'
import excelIcon from '@/assets/app-icons/excel.svg'
import powerpointIcon from '@/assets/app-icons/powerpoint.svg'
import outlookIcon from '@/assets/app-icons/outlook.svg'
import onedriveIcon from '@/assets/app-icons/onedrive.svg'
import powerbiIcon from '@/assets/app-icons/powerbi.svg'
import storeIcon from '@/assets/app-icons/store.svg'
import onenoteIcon from '@/assets/app-icons/onenote.svg'
import todoIcon from '@/assets/app-icons/todo.svg'
import outlookNewIcon from '@/assets/app-icons/outlook-new.svg'
import claudeIcon from '@/assets/app-icons/claude-code.png'
import vscodeIcon from '@/assets/app-icons/vscode.png'
import snippingToolIcon from '@/assets/app-icons/snipping-tool.svg'
import nortonPrivateBrowserIcon from '@/assets/app-icons/norton-private-browser.svg'
import nortonIcon from '@/assets/app-icons/norton.svg'
import teamviewerIcon from '@/assets/app-icons/teamviewer.svg'
import wikipediaIcon from '@/assets/app-icons/wikipedia.svg'
import disneyPlusIcon from '@/assets/app-icons/disney-plus.svg'

/**
 * Every real app-logo asset used by a Launchpad tile, in one place —
 * decoded eagerly below rather than left to load lazily the first time
 * each tile's `<img>` actually mounts (i.e. the first time a folder is
 * opened), which is what made some icons visibly pop in a beat late on
 * first open. Vite resolves these imports to real URLs at build time, but
 * the browser doesn't fetch/decode the bytes until something renders an
 * `<img src>` for them — preloading kicks that off immediately at app
 * startup instead, so by the time Launchpad (or a folder inside it) is
 * ever opened every icon is already sitting decoded in the image cache.
 */
const ALL_APP_ICON_SRCS = [
  wordIcon,
  excelIcon,
  powerpointIcon,
  outlookIcon,
  onedriveIcon,
  powerbiIcon,
  storeIcon,
  onenoteIcon,
  todoIcon,
  outlookNewIcon,
  claudeIcon,
  vscodeIcon,
  snippingToolIcon,
  nortonPrivateBrowserIcon,
  nortonIcon,
  teamviewerIcon,
  wikipediaIcon,
  disneyPlusIcon,
]

if (typeof window !== 'undefined') {
  for (const src of ALL_APP_ICON_SRCS) {
    const img = new Image()
    img.src = src
  }
}

export interface AppDefinition {
  id: string
  name: string
  /** Stroke-icon fallback — always required so a tile never renders empty. */
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Real app logo, when we have one (see src/assets/app-icons/) — takes priority over `icon` in the tile. */
  iconSrc?: string
  /** May return a promise (e.g. launching a real external process) — callers should await it to surface a real failure instead of assuming a synchronous void call always succeeds. */
  launch: () => void | Promise<void>
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
  /** Up to 4 logos shown in the closed folder tile's stacked preview — known ahead of detection since these are just the group's iconography, not the detected/launchable set. */
  previewIconSrcs?: string[]
}

let launchStudio: (() => void) | null = null
let launchFileExplorer: (() => void) | null = null
let launchDocumentReader: ((filePath?: string) => void) | null = null
let launchNotes: (() => void) | null = null
let launchAgriTrack: (() => void) | null = null
let launchCncModSwitcher: (() => void) | null = null
let launchClaudeUsage: (() => void) | null = null
let launchPrivatePlayer: (() => void) | null = null
let launchNewsBrief: (() => void) | null = null
let launchAudioRecorder: (() => void) | null = null
let launchStudy: (() => void) | null = null
let launchOmniFind: (() => void) | null = null

/** Registered by whatever owns Studio's open/close state (App.tsx) once mounted. */
export function registerStudioLauncher(fn: () => void) {
  launchStudio = fn
}

/** Registered by whatever owns OmniFind's open/close state (App.tsx) once mounted. */
export function registerOmniFindLauncher(fn: () => void) {
  launchOmniFind = fn
}

/** Registered by whatever owns File Explorer's open/close state (App.tsx) once mounted. */
export function registerFileExplorerLauncher(fn: () => void) {
  launchFileExplorer = fn
}

/** Registered by whatever owns Document Reader's open/close state (App.tsx) once mounted. Accepts an optional file path so File Explorer's "Read Aloud" action can open a specific document directly. */
export function registerDocumentReaderLauncher(fn: (filePath?: string) => void) {
  launchDocumentReader = fn
}

/** Registered by whatever owns the C&C mod switcher's open/close state (App.tsx) once mounted. */
export function registerCncModSwitcherLauncher(fn: () => void) {
  launchCncModSwitcher = fn
}

/** Opens Document Reader, optionally with a document already loaded — used by both the Launchpad tile (no path) and File Explorer's "Read Aloud" context menu action (with a path). */
export function openDocumentReader(filePath?: string) {
  launchDocumentReader?.(filePath)
}

/** Registered by whatever owns Notes' open/close state (App.tsx) once mounted — same lazy full-screen overlay pattern as Studio/File Explorer/Document Reader. */
export function registerNotesLauncher(fn: () => void) {
  launchNotes = fn
}

/** Registered by whatever owns AgriTrack's open/close state (App.tsx) once mounted — same lazy full-screen overlay pattern as Notes. */
export function registerAgriTrackLauncher(fn: () => void) {
  launchAgriTrack = fn
}

/** Registered by whatever owns the Claude Code usage dashboard's open/close state (App.tsx) once mounted — same lazy full-screen overlay pattern as Notes. */
export function registerClaudeUsageLauncher(fn: () => void) {
  launchClaudeUsage = fn
}

/** Registered by whatever owns Private Player's open/close state (App.tsx) once mounted — same lazy full-screen overlay pattern as Notes. */
export function registerPrivatePlayerLauncher(fn: () => void) {
  launchPrivatePlayer = fn
}

/** Opens Private Player — used by both the Launchpad tile and the TopBar's now-playing chip (clicking the chip should reopen the full view). */
export function openPrivatePlayer() {
  launchPrivatePlayer?.()
}

/** Registered by whatever owns the News Brief app's open/close state (App.tsx) once mounted — same lazy full-screen overlay pattern as Notes/Private Player. */
export function registerNewsBriefLauncher(fn: () => void) {
  launchNewsBrief = fn
}

/** Opens the News Brief app to today's report — used by both the Launchpad tile and General Chat's news-brief button. */
export function openNewsBrief() {
  launchNewsBrief?.()
}

/** Registered by whatever owns the System Audio Recorder's open/close state (App.tsx) once mounted — same lazy full-screen overlay pattern as Notes/Private Player. */
export function registerAudioRecorderLauncher(fn: () => void) {
  launchAudioRecorder = fn
}

/** Opens the System Audio Recorder — used by both the Launchpad tile and the taskbar's quick-record toggle. */
export function openAudioRecorder() {
  launchAudioRecorder?.()
}

/** Registered by whatever owns Study's open/close state (App.tsx) once mounted — same lazy full-screen overlay pattern as Notes/Private Player. */
export function registerStudyLauncher(fn: () => void) {
  launchStudy = fn
}

/** Opens Study — used by the Launchpad tile. */
export function openStudy() {
  launchStudy?.()
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
    iconSrc: claudeIcon,
    launch: () => launchAppByExeName('Claude.exe'),
  },
  {
    id: 'norton',
    name: 'Norton',
    icon: ExplorerIcon,
    iconSrc: nortonIcon,
    launch: () => launchAppByExeName('NortonSecurity.exe'),
  },
  {
    id: 'norton-private-browser',
    name: 'Norton Private Browser',
    icon: ExplorerIcon,
    iconSrc: nortonPrivateBrowserIcon,
    launch: () => launchAppByExeName('NortonPrivateBrowser.exe'),
  },
  {
    id: 'teamviewer',
    name: 'TeamViewer',
    icon: ExplorerIcon,
    iconSrc: teamviewerIcon,
    launch: () => launchAppByExeName('TeamViewer.exe'),
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
 */
const UDAAN_APPS: AppDefinition[] = [
  {
    id: 'omni-find',
    name: 'OmniFind',
    icon: SearchIcon,
    launch: () => launchOmniFind?.(),
  },
  {
    id: 'studio',
    name: 'Studio',
    icon: WaveformIcon,
    launch: () => launchStudio?.(),
  },
  {
    id: 'file-explorer',
    name: 'File Explorer',
    icon: ExplorerIcon,
    launch: () => launchFileExplorer?.(),
  },
  {
    id: 'document-reader',
    name: 'Document Reader',
    icon: BookOpenIcon,
    launch: () => openDocumentReader(),
  },
  {
    id: 'notes',
    name: 'Notes',
    icon: FileTextIcon,
    launch: () => launchNotes?.(),
  },
  {
    id: 'agritrack',
    name: 'AgriTrack',
    icon: DatabaseIcon,
    launch: () => launchAgriTrack?.(),
  },
  {
    id: 'cnc-mod-switcher',
    name: 'C&C Generals Mods',
    icon: DiscIcon,
    launch: () => launchCncModSwitcher?.(),
  },
  {
    id: 'claude-usage',
    name: 'Claude Code Usage',
    icon: GaugeIcon,
    launch: () => launchClaudeUsage?.(),
  },
  {
    id: 'private-player',
    name: 'Private Player',
    icon: DiscIcon,
    launch: () => launchPrivatePlayer?.(),
  },
  {
    id: 'news-brief',
    name: 'Daily News Brief',
    icon: NewspaperIcon,
    launch: () => openNewsBrief(),
  },
  {
    id: 'audio-recorder',
    name: 'System Audio Recorder',
    icon: RecordIcon,
    launch: () => openAudioRecorder(),
  },
  {
    id: 'study',
    name: 'Study',
    icon: GraduationCapIcon,
    launch: () => openStudy(),
  },
]

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
    iconSrc: wikipediaIcon,
    launch: () => launchApp('https://www.wikipedia.org'),
  },
  ...ALWAYS_SHOWN_OTHER_APPS,
]

/** Real Microsoft app logos (see src/assets/app-icons/) — keyed by the `id` src-tauri/src/installed_apps/mod.rs's `known_apps_for_group` assigns each app, so a detected app with no entry here is a real gap to fix, not expected. */
const MICROSOFT_APP_ICONS: Record<string, string> = {
  word: wordIcon,
  excel: excelIcon,
  powerpoint: powerpointIcon,
  outlook: outlookIcon,
  onenote: onenoteIcon,
  onedrive: onedriveIcon,
  powerbi: powerbiIcon,
  store: storeIcon,
  todo: todoIcon,
  'outlook-new': outlookNewIcon,
}

async function loadMicrosoftApps(): Promise<AppDefinition[]> {
  const detected = await detectApps('microsoft')
  return detected.map((app) => ({
    id: `microsoft-${app.id}`,
    name: app.name,
    icon: ExplorerIcon,
    iconSrc: MICROSOFT_APP_ICONS[app.id],
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
    previewIconSrcs: [wordIcon, excelIcon, powerpointIcon, outlookIcon],
  },
]

/** Real logos for the standalone apps pinned at Launchpad's top level (not grouped into a folder) — keyed by the `id` src-tauri/src/installed_apps/mod.rs's `AppGroup::Other` assigns each app. Claude/Norton/Norton Private Browser/TeamViewer are no longer detection-based (see `ALWAYS_SHOWN_OTHER_APPS` above), so they're not looked up through this map — their icons are set directly on their static `AppDefinition` entries instead. */
const OTHER_APP_ICONS: Record<string, string> = {
  vscode: vscodeIcon,
  'snipping-tool': snippingToolIcon,
  'disney-plus': disneyPlusIcon,
}

/**
 * Only VS Code needs a pre-launch step (pick which folder to open as the
 * workspace) — every other standalone app just launches directly. Kept as
 * a lookup by app id rather than a per-app flag on `AppDefinition` since
 * this is the only entry with special pre-launch behavior; a second one
 * showing up would be the moment to generalize this into a real field.
 */
async function launchVsCodeWithFolderPicker(exePath: string): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const folder = await open({ directory: true, multiple: false, title: 'Open Folder in VS Code' })
  if (!folder || Array.isArray(folder)) return
  await openFileWith(exePath, folder)
}

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
    iconSrc: OTHER_APP_ICONS[app.id],
    launch: async () => {
      try {
        if (app.id === 'vscode') {
          await launchVsCodeWithFolderPicker(app.path)
        } else {
          await launchApp(app.path)
        }
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
