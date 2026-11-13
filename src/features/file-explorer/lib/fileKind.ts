export type FileKind = 'folder' | 'image' | 'audio' | 'video' | 'text' | 'pdf' | 'other'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'])
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi'])
const TEXT_EXT = new Set(['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'yml', 'yaml', 'toml', 'rs', 'py', 'log', 'csv', 'xml'])
const PDF_EXT = new Set(['pdf'])

export function fileKind(extension: string, isDir: boolean): FileKind {
  if (isDir) return 'folder'
  const ext = extension.toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (PDF_EXT.has(ext)) return 'pdf'
  if (TEXT_EXT.has(ext)) return 'text'
  return 'other'
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

export function formatModified(ms: number): string {
  if (!ms) return '—'
  const date = new Date(ms)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
