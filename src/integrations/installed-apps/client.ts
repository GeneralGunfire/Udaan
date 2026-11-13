import { invoke } from '@tauri-apps/api/core'
import type { AppGroup, DetectedApp, FileHandler } from './types'

interface RawFileHandler {
  name: string
  exe_path: string
  is_default: boolean
}

function fromRaw(raw: RawFileHandler): FileHandler {
  return { name: raw.name, exePath: raw.exe_path, isDefault: raw.is_default }
}

/**
 * Single frontend entry point for "which real apps are installed" and
 * "launch/open with one of them" — the same mechanism the Launchpad's
 * Microsoft folder uses (`installed_apps_detect`/`installed_apps_launch`),
 * extended with the OS file-association lookups File Explorer needs.
 * Anything that wants to open a file with a real desktop app should go
 * through this client rather than calling `invoke` directly.
 */
export async function detectApps(group: AppGroup): Promise<DetectedApp[]> {
  return invoke<DetectedApp[]>('installed_apps_detect', { group })
}

export async function launchApp(path: string): Promise<void> {
  await invoke('installed_apps_launch', { path })
}

/** Launches an app by its bare exe name (e.g. "Claude.exe") — resolves the real install path via the same App Paths registry lookup detection uses, without requiring a prior `detectApps` call to have found it first. For Launchpad tiles that are always shown regardless of detection (see `ALWAYS_SHOWN_OTHER_APPS` in app/apps.ts). */
export async function launchAppByExeName(exe: string): Promise<void> {
  await invoke('installed_apps_launch_by_exe_name', { exe })
}

/** The OS's current default handler for a file extension (no dot), or null if none is registered. */
export async function getDefaultHandler(extension: string): Promise<FileHandler | null> {
  const raw = await invoke<RawFileHandler | null>('installed_apps_default_handler', { extension })
  return raw ? fromRaw(raw) : null
}

/** Every handler the OS knows about for a file extension (the "Open with" list), default first. */
export async function getHandlersForExtension(extension: string): Promise<FileHandler[]> {
  const raw = await invoke<RawFileHandler[]>('installed_apps_handlers_for_extension', { extension })
  return raw.map(fromRaw)
}

export async function openFileWith(exePath: string, filePath: string): Promise<void> {
  await invoke('installed_apps_open_file_with', { exePath, filePath })
}
