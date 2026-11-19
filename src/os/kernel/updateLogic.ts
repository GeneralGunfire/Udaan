/** The parts of the update check that need no Tauri, so they can be tested on their own. */
export interface Installer {
  url: string | null
  size: string | null
  sha256: string | null
}
export interface ReleaseFile {
  version: string
  date: string
  installers: Record<'10' | '11', Installer>
  updates: { date: string; kind: string; version?: string; title: string; body?: string; notes?: string[] }[]
}
export interface Available {
  version: string
  date: string
  notes: string[]
  url: string
  sha256: string
  size: string | null
}

/** 1 if a is newer than b, -1 if older, 0 if the same. Compares 1.2.3 style numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/** Picks the right installer out of the release file, or null when this version is not newer or has no installer yet. */
export function pickUpdate(file: ReleaseFile, current: string, flavour: '10' | '11'): Available | null {
  if (compareVersions(file.version, current) <= 0) return null
  const inst = file.installers?.[flavour]
  if (!inst?.url || !inst.sha256) return null
  const entry = file.updates?.find((u) => u.version === file.version)
  return { version: file.version, date: file.date, notes: entry?.notes ?? (entry?.title ? [entry.title] : []), url: inst.url, sha256: inst.sha256, size: inst.size }
}

