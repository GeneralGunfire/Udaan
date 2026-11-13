/** MIME type used for both file-row drag sources and folder drop targets (sidebar pin, folder row) within File Explorer. */
export const FILE_DRAG_MIME = 'application/x-udaan-file-explorer-paths'

export function encodeDragPaths(paths: string[]): string {
  return JSON.stringify(paths)
}

export function decodeDragPaths(dataTransfer: DataTransfer): string[] {
  try {
    const raw = dataTransfer.getData(FILE_DRAG_MIME)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}
