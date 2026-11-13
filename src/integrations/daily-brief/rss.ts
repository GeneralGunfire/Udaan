import { invoke } from '@tauri-apps/api/core'
import feedsConfig from './feeds.json'

export type BriefCategory = 'southafrica' | 'politics' | 'conflict' | 'technology' | 'science' | 'business' | 'health'

export interface FeedSource {
  name: string
  url: string
}

export interface RawItem {
  category: BriefCategory
  source: string
  title: string
  /** Plain-text description/summary, HTML stripped — kept short since this
   * is only ever fed to the summarizer as source material, never shown or
   * reproduced verbatim in the final report. */
  description: string
  link: string
  /** ISO 8601, when the feed provided a parseable date. */
  publishedAt: string | null
  /** A picture for the story, when the feed carries one. */
  image?: string | null
}

/** The feed's picture for an item: media:thumbnail/content, an image enclosure, or the first <img> in its HTML. */
function imageOf(el: Element): string | null {
  const byTag = (name: string) => [...el.getElementsByTagName(name)]
  const media = [...byTag('media:thumbnail'), ...byTag('media:content')]
    .map((m) => ({ url: m.getAttribute('url'), w: Number(m.getAttribute('width') ?? 0), medium: m.getAttribute('medium'), type: m.getAttribute('type') }))
    .filter((m) => m.url && (!m.medium || m.medium === 'image') && (!m.type || m.type.startsWith('image')))
    .sort((a, b) => b.w - a.w)
  if (media[0]?.url) return media[0].url
  const enclosure = byTag('enclosure').find((e) => (e.getAttribute('type') ?? '').startsWith('image'))
  if (enclosure?.getAttribute('url')) return enclosure.getAttribute('url')
  const html = [...byTag('content:encoded'), ...byTag('description'), ...byTag('content'), ...byTag('summary')].map((e) => e.textContent ?? '').join(' ')
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return m ? m[1] : null
}

const FEEDS = feedsConfig as Record<BriefCategory, FeedSource[]>
const CATEGORIES: BriefCategory[] = ['southafrica', 'technology', 'health', 'conflict', 'politics', 'science', 'business']
const LOOKBACK_HOURS = 36
/** Falls back to this much wider window only for a category that came up
 * with too little content in the normal window — a whole category should
 * never go silent in the final report just because nothing happened to
 * post in the last 36h, when there's still genuinely recent (if slightly
 * older) real news available. */
const FALLBACK_LOOKBACK_HOURS = 72
/** Below this many items, a category is considered too thin and gets the
 * wider fallback window applied. */
const MIN_ITEMS_PER_CATEGORY_BEFORE_WIDENING = 4

/** Boilerplate fragments some outlets (The Guardian especially) append to
 * every single description — newsletter/app promos, "Continue reading…"
 * links — that add nothing as source material and only dilute the actual
 * prompt signal (or worse, risk the model echoing a stray promotional
 * line). Stripped after HTML parsing since it's plain text at that point,
 * not markup. */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /Get our breaking news email.*?(?=\.\s|$)/gi,
  /Continue reading\.\.\.?/gi,
  /Sign up (to|for) our.*?(?=\.\s|$)/gi,
]

/** Hard cap on a single item's description length once fed into the
 * summarization prompt — some outlets (The Guardian's live-blog feeds
 * especially) put several full paragraphs in `<description>`, which adds
 * prompt-size cost for content the summarizer only ever needs a
 * one-sentence gist of. Cut at a sentence boundary where possible rather
 * than a hard character cutoff mid-word. */
const MAX_DESCRIPTION_CHARS = 320

function trimDescription(text: string): string {
  if (text.length <= MAX_DESCRIPTION_CHARS) return text
  const truncated = text.slice(0, MAX_DESCRIPTION_CHARS)
  const lastSentenceEnd = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('? '), truncated.lastIndexOf('! '))
  return (lastSentenceEnd > MAX_DESCRIPTION_CHARS * 0.4 ? truncated.slice(0, lastSentenceEnd + 1) : truncated).trim() + '…'
}

function stripHtml(input: string): string {
  const doc = new DOMParser().parseFromString(input, 'text/html')
  let text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  for (const pattern of BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, '').replace(/\s+/g, ' ').trim()
  }
  return text
}

function parsePubDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Reads RSS 2.0 `<item>` or Atom `<entry>` elements — the feed set here is
 * all RSS 2.0, but Atom support costs nothing extra and protects against a
 * feed silently switching formats later. */
function parseFeedXml(xml: string, source: string, category: BriefCategory): RawItem[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) return []

  const items = [...doc.querySelectorAll('item')]
  if (items.length > 0) {
    return items.map((item) => ({
      category,
      source,
      title: stripHtml(item.querySelector('title')?.textContent ?? ''),
      description: trimDescription(stripHtml(item.querySelector('description')?.textContent ?? '')),
      link: item.querySelector('link')?.textContent?.trim() ?? '',
      publishedAt: parsePubDate(item.querySelector('pubDate')?.textContent ?? null),
      image: imageOf(item),
    }))
  }

  const entries = [...doc.querySelectorAll('entry')]
  return entries.map((entry) => ({
    category,
    source,
    title: stripHtml(entry.querySelector('title')?.textContent ?? ''),
    description: trimDescription(stripHtml(entry.querySelector('summary, content')?.textContent ?? '')),
    link: entry.querySelector('link')?.getAttribute('href')?.trim() ?? '',
    publishedAt: parsePubDate(entry.querySelector('updated, published')?.textContent ?? null),
    image: imageOf(entry),
  }))
}

export interface FeedFetchFailure {
  category: BriefCategory
  source: string
  url: string
  reason: string
}

async function fetchOneFeed(
  source: FeedSource,
  category: BriefCategory,
  failures: FeedFetchFailure[],
): Promise<RawItem[]> {
  try {
    // Fetched via a Rust command, not the browser `fetch()` — RSS feeds
    // are meant for servers/readers, not browsers, so almost none send
    // `Access-Control-Allow-Origin`, and a plain in-webview `fetch()` is
    // silently blocked by CORS regardless of Tauri's CSP config (confirmed
    // directly: identical URLs succeeded via curl outside the webview and
    // failed with "TypeError: Failed to fetch" from inside it). Rust's
    // HTTP client isn't a browser and has no CORS restriction at all.
    const xml = await invoke<string>('daily_brief_fetch_feed', { url: source.url })
    const items = parseFeedXml(xml, source.name, category)
    if (items.length === 0) {
      failures.push({ category, source: source.name, url: source.url, reason: 'parsed but yielded no items' })
    }
    return items
  } catch (err) {
    // One dead/slow feed must never take down the whole morning brief —
    // record it (surfaced in the final report's "sourcing note" rather
    // than being completely invisible) and return nothing from just this
    // source.
    const reason = err instanceof Error ? err.message : String(err)
    failures.push({ category, source: source.name, url: source.url, reason })
    console.error(`Daily brief: failed to fetch ${source.name} (${source.url}):`, err)
    return []
  }
}

function withinWindow(item: RawItem, cutoff: number): boolean {
  return item.title.length > 0 && (item.publishedAt === null || new Date(item.publishedAt).getTime() >= cutoff)
}

/** Fetches every configured feed in parallel. Categories that come up too
 * thin within the normal 36h window (a real gap this feature hit in
 * practice — some mornings a category's feeds simply hadn't posted much)
 * get re-checked against a wider 72h window rather than being left
 * artificially empty; a whole missing category read as "shallow"/
 * incomplete in the final report even though older-but-still-current news
 * genuinely existed. Returns both the items and any feed-level failures,
 * so the caller can surface real gaps instead of a silent thin report. */
export async function fetchRecentItems(): Promise<{ items: RawItem[]; failures: FeedFetchFailure[] }> {
  const failures: FeedFetchFailure[] = []
  const results = await Promise.all(
    CATEGORIES.flatMap((category) => FEEDS[category].map((source) => fetchOneFeed(source, category, failures))),
  )
  const allItems = results.flat()

  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000
  const wideCutoff = Date.now() - FALLBACK_LOOKBACK_HOURS * 60 * 60 * 1000

  const byCategory = new Map<BriefCategory, RawItem[]>()
  for (const item of allItems) {
    if (!item.title) continue
    const list = byCategory.get(item.category) ?? []
    list.push(item)
    byCategory.set(item.category, list)
  }

  const finalItems: RawItem[] = []
  for (const category of CATEGORIES) {
    const categoryItems = byCategory.get(category) ?? []
    const withinNormalWindow = categoryItems.filter((i) => withinWindow(i, cutoff))
    if (withinNormalWindow.length >= MIN_ITEMS_PER_CATEGORY_BEFORE_WIDENING) {
      finalItems.push(...withinNormalWindow)
    } else {
      // Thin category — widen the window rather than leave it near-empty.
      finalItems.push(...categoryItems.filter((i) => withinWindow(i, wideCutoff)))
    }
  }

  finalItems.sort((a, b) => (a.publishedAt ?? '9999').localeCompare(b.publishedAt ?? '9999'))
  return { items: finalItems, failures }
}
