import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { AssetEntry, AssetKind } from './types'

/** Raw shape returned by the Rust `asset_library_scan_folder` command (serde snake_case). */
interface RawAssetEntry {
  path: string
  file_name: string
  size_bytes: number
  kind: string
}

function toAssetKind(kind: string): AssetKind {
  return kind === 'image' || kind === 'video' ? kind : 'other'
}

/** Opens the native folder picker and returns the chosen path, or null if cancelled. */
export async function pickAssetFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false })
  if (typeof result === 'string') return result
  return null
}

/** Opens the native save dialog for exporting a file, returns the chosen path or null if cancelled. */
export async function pickSavePath(
  defaultName: string,
  extensions: string[],
): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Image', extensions }],
  })
  return result ?? null
}

/** Non-recursive scan of a folder for supported image/video assets. */
export async function scanAssetFolder(folderPath: string): Promise<AssetEntry[]> {
  const raw = await invoke<RawAssetEntry[]>('asset_library_scan_folder', {
    folderPath,
  })
  return raw.map((entry) => ({
    path: entry.path,
    fileName: entry.file_name,
    sizeBytes: entry.size_bytes,
    kind: toAssetKind(entry.kind),
  }))
}

export async function readAssetFileBytes(filePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('asset_library_read_file', {
    filePath,
  })
  return new Uint8Array(bytes)
}

export async function writeAssetFileBytes(filePath: string, data: Uint8Array): Promise<void> {
  await invoke('asset_library_write_file', {
    filePath,
    data: Array.from(data),
  })
}
