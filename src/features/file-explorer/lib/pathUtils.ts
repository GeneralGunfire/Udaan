export interface PathSegment {
  name: string
  path: string
}

/** Splits an absolute path into clickable breadcrumb segments, Windows- and POSIX-aware. */
export function breadcrumbSegments(fullPath: string): PathSegment[] {
  const normalized = fullPath.replace(/\\/g, '/')
  const isWindowsDrive = /^[a-zA-Z]:/.test(normalized)
  const parts = normalized.split('/').filter(Boolean)
  const segments: PathSegment[] = []
  let accumulated = ''

  parts.forEach((part, i) => {
    if (i === 0 && isWindowsDrive) {
      accumulated = `${part}\\`
      segments.push({ name: part, path: accumulated })
      return
    }
    accumulated = accumulated ? `${accumulated}${accumulated.endsWith('\\') || accumulated.endsWith('/') ? '' : '\\'}${part}` : `/${part}`
    segments.push({ name: part, path: accumulated })
  })

  if (!isWindowsDrive && parts.length === 0) {
    segments.push({ name: '/', path: '/' })
  }

  return segments
}

export function parentPath(fullPath: string): string | null {
  const segments = breadcrumbSegments(fullPath)
  if (segments.length <= 1) return null
  return segments[segments.length - 2].path
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`
}
