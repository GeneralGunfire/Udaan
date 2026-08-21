import { invoke } from '@tauri-apps/api/core'

export interface NewFileEntry {
  path: string
  fileName: string
}

interface RawNewFileEntry {
  path: string
  file_name: string
}

/**
 * Polls a folder for files that appeared since the last poll of that
 * same folder (per-folder snapshot diff, tracked in Rust state). The
 * first poll for a given folder always returns empty — it establishes
 * the baseline rather than reporting every existing file as "new".
 */
export async function pollFolderForNewFiles(folderPath: string): Promise<NewFileEntry[]> {
  const raw = await invoke<RawNewFileEntry[]>('folder_watcher_poll', { folderPath })
  return raw.map((e) => ({ path: e.path, fileName: e.file_name }))
}
