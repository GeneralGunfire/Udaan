import type { ComponentType, SVGProps } from 'react'
import { WaveformIcon, ExplorerIcon, BookOpenIcon } from '@/shared/icons'
import { detectApps, launchApp, openFileWith } from '@/integrations/installed-apps/client'
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
  /** Up to 4 logos shown in the closed folder tile's stacked preview — known ahead of detection since these are just the group's iconography, not the detected/launchable set. */
  previewIconSrcs?: string[]
}

let launchStudio: (() => void) | null = null
let launchFileExplorer: (() => void) | null = null
let launchDocumentReader: ((filePath?: string) => void) | null = null

/** Registered by whatever owns Studio's open/close state (App.tsx) once mounted. */
export function registerStudioLauncher(fn: () => void) {
  launchStudio = fn
}

/** Registered by whatever owns File Explorer's open/close state (App.tsx) once mounted. */
export function registerFileExplorerLauncher(fn: () => void) {
  launchFileExplorer = fn
}

/** Registered by whatever owns Document Reader's open/close state (App.tsx) once mounted. Accepts an optional file path so File Explorer's "Read Aloud" action can open a specific document directly. */
export function registerDocumentReaderLauncher(fn: (filePath?: string) => void) {
  launchDocumentReader = fn
}

/** Opens Document Reader, optionally with a document already loaded — used by both the Launchpad tile (no path) and File Explorer's "Read Aloud" context menu action (with a path). */
export function openDocumentReader(filePath?: string) {
  launchDocumentReader?.(filePath)
}

export const PINNED_APPS: AppDefinition[] = [
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
    id: 'microsoft',
    name: 'Microsoft',
    loadApps: loadMicrosoftApps,
    previewIconSrcs: [wordIcon, excelIcon, powerpointIcon, outlookIcon],
  },
]

/** Real logos for the standalone apps pinned at Launchpad's top level (not grouped into a folder) — keyed by the `id` src-tauri/src/installed_apps/mod.rs's `AppGroup::Other` assigns each app. */
const OTHER_APP_ICONS: Record<string, string> = {
  claude: claudeIcon,
  vscode: vscodeIcon,
  'snipping-tool': snippingToolIcon,
  'norton-private-browser': nortonPrivateBrowserIcon,
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

/** Visual placeholders for apps to come later — no functionality behind them yet. */
export const COMING_SOON_SLOTS = 3
