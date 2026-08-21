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

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi']

/** Opens the native folder picker and returns the chosen path, or null if cancelled. */
export async function pickAssetFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false })
  if (typeof result === 'string') return result
  return null
}

/**
 * Opens the native file picker for one or more individual image/video
 * files (not a whole folder). Returns assets with real filesystem
 * metadata via `asset_library_stat_files`, same shape as a folder scan.
 */
export async function pickAssetFiles(multiple: boolean): Promise<AssetEntry[]> {
  const result = await open({
    multiple,
    filters: [{ name: 'Media', extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] }],
  })
  if (!result) return []
  const paths = Array.isArray(result) ? result : [result]
  if (paths.length === 0) return []
  const raw = await invoke<RawAssetEntry[]>('asset_library_stat_files', { paths })
  return raw.map((entry) => ({
    path: entry.path,
    fileName: entry.file_name,
    sizeBytes: entry.size_bytes,
    kind: toAssetKind(entry.kind),
  }))
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
