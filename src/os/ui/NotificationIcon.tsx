import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Notification } from '@/integrations/notifications/client'
import { shell } from '@/os/kernel/shell'
import { APP_DEFS, isAppId } from '@/os/kernel/registry'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { installedApps } from '@/os/launcher/start/model'

export interface WindowsExtra {
  app: string
  launch: string | null
  image: string | null
  /** Set when the notification is a website's, delivered through this browser. */
  browser?: string | null
  /** The sending app's own id (AppUserModelID), when it has one. */
  aumid?: string | null
  /** Relayed from the phone through Phone Link. */
  phone?: boolean
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
const NAME_PREFIX = 'name:'

const PHONE_LINK = 'Microsoft.YourPhone_8wekyb3d8bbwe!App'
const APPS = 'shell:AppsFolder\\'

/**
 * Where to read a sender's real icon from, best first. Each is tried in turn until one gives a picture: the app's own id
 * (a relayed phone notification maps to Phone Link itself), a launch target that is an app or exe, then the installed app
 * of that name. A toast's `launch` is only its click arguments, which is why it alone never found Phone Link's icon.
 */
function iconTargets(extra: WindowsExtra | null, name: string): string[] {
  const out: string[] = []
  if (extra?.phone || /YourPhone/i.test(extra?.aumid ?? '')) out.push(APPS + PHONE_LINK)
  if (extra?.aumid) out.push(APPS + extra.aumid)
  const l = extra?.launch
  if (l && (/^shell:appsfolder\\/i.test(l) || /\.exe$/i.test(l))) out.push(l)
  out.push(NAME_PREFIX + name)
  if (extra?.phone) out.push(NAME_PREFIX + 'Phone Link')
  return out
}

async function loadIcon(target: string): Promise<string | null> {
  if (target.startsWith(NAME_PREFIX)) {
    const want = target.slice(NAME_PREFIX.length).toLowerCase()
    const apps = await installedApps()
    const hit = apps.find((a) => a.name.toLowerCase() === want) ?? apps.find((a) => a.name.toLowerCase().includes(want))
    if (!hit) return null
    return invoke<Record<string, string | null>>('shell_installed_app_icons', { ids: [hit.id] }).then((r) => r[hit.id] ?? null)
  }
  if (target.toLowerCase().startsWith(APPS.toLowerCase())) {
    const id = target.slice(APPS.length)
    return invoke<Record<string, string | null>>('shell_installed_app_icons', { ids: [id] }).then((r) => r[id] ?? null)
  }
  if (/\.exe$/i.test(target)) return shell.fileIcons([target]).then((r) => r[target] ?? null)
  return null
}

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
  const targets = isAppId(n.sourceApp) ? [] : iconTargets(extra, name)
  const key = targets.join('|')
  const [src, setSrc] = useState<string | null>(() => (key ? (cache.get(key) ?? null) : null))

  useEffect(() => {
    if (!key) return
    if (cache.has(key)) return void setSrc(cache.get(key) ?? null)
    let off = false
    void (async () => {
      let found: string | null = null
      for (const t of key.split('|')) {
        found = await loadIcon(t).catch(() => null)
        if (found) break
      }
      cache.set(key, found)
      if (!off) setSrc(found)
    })()
    return () => {
      off = true
    }
  }, [key])

  if (isAppId(n.sourceApp)) return <AppIcon appId={n.sourceApp} size={size} />

  // The app's real icon, extracted from the app itself.
  if (src) {
    // The real logo, bare, with nothing behind it (as in Start).
    return <img src={src} alt="" draggable={false} className="shrink-0 object-contain" style={{ width: size, height: size }} />
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
