import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Notification } from '@/integrations/notifications/client'
import { shell } from '@/os/kernel/shell'
import { APP_DEFS, isAppId } from '@/os/kernel/registry'
import { AppIcon } from '@/os/ui/icons/AppIcon'

export interface WindowsExtra {
  app: string
  launch: string | null
  image: string | null
  /** Set when the notification is a website's, delivered through this browser. */
  browser?: string | null
}

/** Mirrored Windows notifications (Phone Link, WhatsApp...) carry their picture and click target here. */
export function windowsExtra(n: Notification): WindowsExtra | null {
  if (n.kind !== 'windows' || !n.actionPayload) return null
  try {
    return JSON.parse(n.actionPayload) as WindowsExtra
  } catch {
    return null
  }
}

/** The name to show for who sent a notification. */
export function notificationSource(n: Notification): string {
  if (isAppId(n.sourceApp)) return APP_DEFS[n.sourceApp].name
  return windowsExtra(n)?.app || n.sourceApp
}

/**
 * Initials for a sender with no real icon.
 *
 * Two letters from two words ("Phone Link" → PL) reads as a brand; one
 * letter reads as a placeholder.
 */
function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0]?.slice(0, 2) ?? '?').toUpperCase()
}

/**
 * A stable colour per sender.
 *
 * Hue comes from the name, but saturation and lightness are fixed, so every
 * generated tile sits in the same tonal family. Deriving all three from the
 * hash is the usual mistake: it yields some neon tiles and some muddy ones,
 * and the set stops looking designed.
 */
function tileColours(name: string): [string, string] {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return [`hsl(${h} 46% 55%)`, `hsl(${(h + 22) % 360} 50% 38%)`]
}

const cache = new Map<string, string | null>()

/**
 * Who sent a notification.
 *
 * Only two sources of truth are allowed: Udaan's own app icon for its own
 * apps, and the *real* icon Windows holds for a third-party app, read off
 * the executable or its AppsFolder entry. When neither exists, a neutral
 * monogram tile.
 *
 * WHY THERE ARE NO BUNDLED BRAND LOGOS HERE
 * -----------------------------------------
 * This used to ship hand-drawn approximations of a dozen other companies'
 * marks — Claude, Word, Excel, Outlook, OneDrive and so on — matched by a
 * regex on the sender's name. Every one of them was wrong: a redrawn logo
 * is not that product's logo, it is a near-miss that misrepresents the
 * brand, and it looked especially wrong sitting beside the real icons
 * Windows supplies for everything else.
 *
 * The real icon is already available for any installed app. When it is not,
 * an honest monogram is better than a convincing forgery.
 */
export function NotificationIcon({ n, size = 22 }: { n: Notification; size?: number }) {
  const extra = windowsExtra(n)
  const name = extra?.app || n.sourceApp
  const target = isAppId(n.sourceApp) ? null : (extra?.launch ?? null)
  const [src, setSrc] = useState<string | null>(() => (target ? (cache.get(target) ?? null) : null))

  useEffect(() => {
    if (!target) return
    if (cache.has(target)) {
      setSrc(cache.get(target) ?? null)
      return
    }
    let off = false
    const prefix = 'shell:appsfolder\\'
    const load = target.toLowerCase().startsWith(prefix)
      ? invoke<Record<string, string | null>>('shell_installed_app_icons', { ids: [target.slice(prefix.length)] }).then((r) => r[target.slice(prefix.length)] ?? null)
      : /\.exe$/i.test(target)
        ? shell.fileIcons([target]).then((r) => r[target] ?? null)
        : Promise.resolve(null)
    void load.then(
      (url) => {
        cache.set(target, url)
        if (!off) setSrc(url)
      },
      () => cache.set(target, null),
    )
    return () => {
      off = true
    }
  }, [target])

  if (isAppId(n.sourceApp)) return <AppIcon appId={n.sourceApp} size={size} />

  // The app's real icon, extracted from the app itself.
  if (src) {
    // Same plate and icon ratio as in Start, so every app is the same size whatever margin its own artwork has.
    return (
      <span className="flex shrink-0 items-center justify-center rounded-[22%] bg-white/[0.13] shadow-[inset_0_0_0_1px_rgb(255_255_255/.1),0_1px_2px_rgb(0_0_0/.25)]" style={{ width: size, height: size }}>
        <img src={src} alt="" draggable={false} className="object-contain" style={{ width: size * 0.66, height: size * 0.66 }} />
      </span>
    )
  }

  const [from, to] = tileColours(name)
  return (
    <span
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{
        width: size,
        height: size,
        // Matches the app-icon silhouette, so a monogram sits correctly in a
        // row of real icons instead of reading as a different kind of object.
        borderRadius: size * 0.26,
        fontSize: size * 0.42,
        background: `linear-gradient(145deg, ${from}, ${to})`,
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.22), 0 1px 2px rgb(0 0 0 / 0.2)',
      }}
    >
      {initials(name)}
    </span>
  )
}
