import { invoke } from '@tauri-apps/api/core'

/** An image is only used if it really loads at least this big: cards are drawn ~270px wide, up to 2x on dense screens. */
const MIN_W = 640
const MIN_H = 360
const CACHE_KEY = 'udaan-news-img-v2'
const CACHE_MAX = 80

const inflight = new Map<string, Promise<string | null>>()

function readCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function remember(key: string, url: string) {
  try {
    const cache = readCache()
    cache[key] = url
    const keys = Object.keys(cache)
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[k]
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable: just skip caching */
  }
}

/**
 * Feeds usually link a thumbnail from the same CDN that serves the full-size
 * picture; bump the size where the URL says how big it is.
 */
export function upgradeImageUrl(url: string): string {
  let u = url
  // BBC: ichef.bbci.co.uk/news/240/... or /ace/standard/240/...
  u = u.replace(/(ichef\.bbci\.co\.uk\/[^?]*?\/)(\d{2,4})(\/)/, (m, a, w, b) => (Number(w) < 1024 ? `${a}1024${b}` : m))
  // The Guardian / Observer (i.guim.co.uk): width=140
  if (/i\.guim\.co\.uk/.test(u)) u = u.replace(/width=\d+/, 'width=1200').replace(/quality=\d+/, 'quality=85')
  // NPR: ...-s400-c85.jpg
  u = u.replace(/-s\d{2,4}-c/, '-s1100-c')
  // WordPress sizes (-150x150.jpg) and Jetpack (?w=300)
  u = u.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))/i, '$1')
  if (/(wp\.com|wordpress\.com)/.test(u)) u = u.replace(/([?&])w=\d+/, '$1w=1200')
  return u
}

/** Resolves true only when the picture loads and is big enough to look good. */
function loadsWell(url: string, timeoutMs = 9000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(ok)
    }
    img.onload = () => finish(img.naturalWidth >= MIN_W && img.naturalHeight >= MIN_H)
    img.onerror = () => finish(false)
    img.src = url
  })
}

export interface StoryImageInput {
  headline: string
  image: string | null
  link: string | null
}

/**
 * The best real picture for a story, or null if none is good enough. Tries the
 * feed image at full size, then as given, then the article page's own
 * social-share picture. Results are cached so reopening Start is instant.
 */
export function resolveStoryImage(story: StoryImageInput): Promise<string | null> {
  const key = story.link ?? story.headline
  const existing = inflight.get(key)
  if (existing) return existing
  const job = (async () => {
    const cached = readCache()[key]
    if (cached && (await loadsWell(cached))) return cached

    const tried = new Set<string>()
    const attempt = async (url: string | null | undefined) => {
      if (!url || tried.has(url)) return null
      tried.add(url)
      return (await loadsWell(url)) ? url : null
    }

    let found: string | null = null
    if (story.image) {
      found = await attempt(upgradeImageUrl(story.image))
      if (!found) found = await attempt(story.image)
    }
    if (!found && story.link) {
      const page = await invoke<string | null>('news_page_image', { url: story.link }).catch(() => null)
      if (page) {
        found = await attempt(upgradeImageUrl(page))
        if (!found) found = await attempt(page)
      }
    }
    if (found) remember(key, found)
    return found
  })()
  inflight.set(key, job)
  return job
}
