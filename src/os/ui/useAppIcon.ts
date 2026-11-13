import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { shell } from '@/os/kernel/shell'

/**
 * An installed app's own icon, extracted from the app itself.
 *
 * WHY THIS EXISTS
 * ---------------
 * Udaan used to ship hand-drawn SVG approximations of other companies'
 * logos — Claude, Word, Excel, Outlook, OneDrive, VS Code and a dozen more
 * — matched by a regex on the app's name and pinned into several separate
 * lookup tables. Every one was wrong in the same way: a redrawn mark is not
 * that product's mark. They were close enough to be recognisable and far
 * enough off to look counterfeit, which was especially obvious next to the
 * genuine icons Windows supplies for everything else.
 *
 * Windows already holds the real icon for every installed program, in the
 * executable's resource table or the AppsFolder entry for a packaged app.
 * This hook reads it. There is no fallback to a drawn logo: where no icon
 * can be read, callers draw a neutral monogram tile, which is honest about
 * not knowing rather than guessing wrong.
 *
 * Results are cached across every caller and every mount, because icon
 * extraction crosses into Win32 and a Launchpad grid may ask for sixty at
 * once.
 */

const cache = new Map<string, string | null>()
/** In-flight requests, so twenty tiles mounting at once make one call each. */
const inflight = new Map<string, Promise<string | null>>()

const APPS_FOLDER = 'shell:appsfolder\\'

function fetchIcon(target: string): Promise<string | null> {
  const hit = inflight.get(target)
  if (hit) return hit

  const lower = target.toLowerCase()
  const job = (
    lower.startsWith(APPS_FOLDER)
      ? // A packaged (Store) app: no exe to read, so ask by its AppsFolder id.
        invoke<Record<string, string | null>>('shell_installed_app_icons', { ids: [target.slice(APPS_FOLDER.length)] }).then(
          (r) => r[target.slice(APPS_FOLDER.length)] ?? null,
        )
      : /\.(exe|lnk)$/i.test(target)
        ? shell.fileIcons([target]).then((r) => r[target] ?? null)
        : Promise.resolve(null)
  )
    .catch(() => null)
    .then((url) => {
      cache.set(target, url)
      inflight.delete(target)
      return url
    })

  inflight.set(target, job)
  return job
}

/**
 * Resolves `path` to the app's real icon as a data URL, or null.
 *
 * `path` may be an executable, a shortcut, or a `shell:AppsFolder\<id>`
 * target. Pass null to skip extraction entirely (for an app that already
 * has an icon, or one of Udaan's own).
 */
export function useAppIcon(path: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => (path ? (cache.get(path) ?? null) : null))

  useEffect(() => {
    if (!path) {
      setSrc(null)
      return
    }
    if (cache.has(path)) {
      setSrc(cache.get(path) ?? null)
      return
    }
    let off = false
    void fetchIcon(path).then((url) => {
      if (!off) setSrc(url)
    })
    return () => {
      off = true
    }
  }, [path])

  return src
}

/**
 * Warms the cache for several apps at once.
 *
 * A grid that calls `useAppIcon` per tile is correct but issues one IPC
 * round trip per app; calling this first with every path resolves them in a
 * single batch, and the hooks then read straight from the cache.
 */
export async function prefetchAppIcons(paths: (string | null | undefined)[]): Promise<void> {
  const exes = [...new Set(paths.filter((p): p is string => !!p && /\.(exe|lnk)$/i.test(p) && !cache.has(p)))]
  const packaged = [...new Set(paths.filter((p): p is string => !!p && p.toLowerCase().startsWith(APPS_FOLDER) && !cache.has(p)))]

  await Promise.all([
    exes.length
      ? shell
          .fileIcons(exes)
          .then((r) => exes.forEach((p) => cache.set(p, r[p] ?? null)))
          .catch(() => exes.forEach((p) => cache.set(p, null)))
      : Promise.resolve(),
    packaged.length
      ? invoke<Record<string, string | null>>('shell_installed_app_icons', { ids: packaged.map((p) => p.slice(APPS_FOLDER.length)) })
          .then((r) => packaged.forEach((p) => cache.set(p, r[p.slice(APPS_FOLDER.length)] ?? null)))
          .catch(() => packaged.forEach((p) => cache.set(p, null)))
      : Promise.resolve(),
  ])
}

/**
 * A stable monogram tile for an app with no readable icon.
 *
 * Hue comes from the name; saturation and lightness are fixed, so every
 * generated tile sits in the same tonal family instead of some being neon
 * and others muddy. Returns CSS, so callers can size it themselves.
 */
export function monogram(name: string): { initials: string; background: string } {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : (words[0]?.slice(0, 2) ?? '?').toUpperCase()
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return {
    initials,
    background: `linear-gradient(145deg, hsl(${h} 46% 55%), hsl(${(h + 22) % 360} 50% 38%))`,
  }
}
