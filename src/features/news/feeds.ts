import { invoke } from '@tauri-apps/api/core'
import feedsConfig from '@/integrations/daily-brief/feeds.json'
import type { Article, Feed } from './types'

/**
 * Reading the feeds. RSS cannot be fetched from the webview (almost no feed sends CORS headers), so the
 * text comes through Rust; parsing stays here with DOMParser. One dead feed contributes nothing and is
 * reported, never fatal.
 */

export const BUILTIN: Feed[] = (() => {
  const seen = new Set<string>()
  const out: Feed[] = []
  for (const [category, list] of Object.entries(feedsConfig as Record<string, { name: string; url: string }[]>))
    for (const f of list) if (!seen.has(f.url)) (seen.add(f.url), out.push({ url: f.url, name: f.name, category, builtin: true }))
  return out
})()

const fetchText = (url: string) => invoke<string>('daily_brief_fetch_feed', { url })

/* ── parsing ─────────────────────────────────────────────────────── */

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
export const articleId = (link: string, title: string, source: string) => hash(link || `${source}|${title}`)

function text(html: string, max = 420): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  t = t.replace(/Get our breaking news email.*?(?=\.\s|$)/gi, '').replace(/Continue reading\.\.\.?/gi, '').replace(/Sign up (to|for) our.*?(?=\.\s|$)/gi, '').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return (end > max * 0.4 ? cut.slice(0, end + 1) : cut).trim() + (end > max * 0.4 ? '' : '…')
}

function imageOf(el: Element): string | null {
  const by = (n: string) => [...el.getElementsByTagName(n)]
  const media = [...by('media:thumbnail'), ...by('media:content')]
    .map((m) => ({ url: m.getAttribute('url'), w: Number(m.getAttribute('width') ?? 0), medium: m.getAttribute('medium'), type: m.getAttribute('type') }))
    .filter((m) => m.url && (!m.medium || m.medium === 'image') && (!m.type || m.type.startsWith('image')))
    .sort((a, b) => b.w - a.w)
  if (media[0]?.url) return media[0].url
  const enc = by('enclosure').find((e) => (e.getAttribute('type') ?? '').startsWith('image'))
  if (enc?.getAttribute('url')) return enc.getAttribute('url')
  const html = [...by('content:encoded'), ...by('description'), ...by('content'), ...by('summary')].map((e) => e.textContent ?? '').join(' ')
  return html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null
}

const when = (v: string | null | undefined) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

export function parseFeed(xml: string, feed: Pick<Feed, 'name' | 'category'> & { url?: string }): Article[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) return []
  const rss = [...doc.querySelectorAll('item')]
  const nodes = rss.length ? rss : [...doc.querySelectorAll('entry')]
  return nodes
    .map((n): Article | null => {
      const title = text(n.querySelector('title')?.textContent ?? '', 200)
      if (!title) return null
      const link = (rss.length ? n.querySelector('link')?.textContent : (n.querySelector('link[rel="alternate"]') ?? n.querySelector('link'))?.getAttribute('href'))?.trim() ?? ''
      return {
        id: articleId(link, title, feed.name),
        source: feed.name,
        category: feed.category,
        feed: feed.url,
        title,
        description: text((rss.length ? n.querySelector('description')?.textContent : n.querySelector('summary, content')?.textContent) ?? ''),
        link,
        publishedMs: when(n.querySelector('pubDate, updated, published')?.textContent),
        image: imageOf(n),
      }
    })
    .filter((a): a is Article => a !== null)
}

/* ── fetching everything ─────────────────────────────────────────── */

export interface Failure {
  url: string
  name: string
  reason: string
}

export async function fetchAll(feeds: Feed[]): Promise<{ items: Article[]; failures: Failure[] }> {
  const failures: Failure[] = []
  const out: Article[] = []
  let next = 0
  // A handful at a time: forty simultaneous requests would slow every one of them down on this machine.
  const worker = async () => {
    while (next < feeds.length) {
      const f = feeds[next++]
      try {
        const items = parseFeed(await fetchText(f.url), f)
        if (!items.length) failures.push({ url: f.url, name: f.name, reason: 'The feed had no stories.' })
        out.push(...items)
      } catch (e) {
        failures.push({ url: f.url, name: f.name, reason: typeof e === 'string' ? e : e instanceof Error ? e.message : 'Could not be read.' })
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  const cutoff = Date.now() - 5 * 86_400_000
  return { items: out.filter((a) => a.publishedMs === null || a.publishedMs >= cutoff), failures }
}

/* ── the same story from several outlets ─────────────────────────── */

const words = (t: string) => new Set(t.toLowerCase().split(/\W+/).filter((w) => w.length > 3))

/** Newest first, with near-identical headlines from different outlets folded into one story ("also reported by"). */
export function groupStories(items: Article[]): Article[] {
  const sorted = [...items].sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0))
  const seenLink = new Set<string>()
  const primaries: { a: Article; w: Set<string> }[] = []
  for (const a of sorted) {
    const key = a.link || a.id
    if (seenLink.has(key)) continue
    seenLink.add(key)
    const w = words(a.title)
    let home: { a: Article; w: Set<string> } | undefined
    if (w.size >= 3)
      for (const p of primaries) {
        if (a.publishedMs && p.a.publishedMs && Math.abs(a.publishedMs - p.a.publishedMs) > 48 * 3_600_000) continue
        let shared = 0
        for (const x of w) if (p.w.has(x)) shared++
        if (shared >= 3 && shared / (w.size + p.w.size - shared) >= 0.55) {
          home = p
          break
        }
      }
    if (home) {
      if (a.source !== home.a.source && !home.a.also?.some((x) => x.source === a.source)) home.a.also = [...(home.a.also ?? []), { source: a.source, link: a.link }]
      if (!home.a.image && a.image) home.a.image = a.image
    } else primaries.push({ a: { ...a }, w })
  }
  return primaries.map((p) => p.a)
}

/* ── adding a source from a website address ──────────────────────── */

const looksLikeFeed = (t: string) => /<(rss|feed|rdf:RDF)[\s>]/i.test(t.slice(0, 2000))

export async function discoverFeed(input: string): Promise<{ url: string; name: string; count: number }> {
  const base = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`
  const attempt = async (url: string) => {
    const body = await fetchText(url)
    return looksLikeFeed(body) ? { url, body } : { url, body: null as string | null, html: body }
  }
  const finish = (url: string, xml: string) => {
    const items = parseFeed(xml, { name: '', category: 'general' })
    if (!items.length) throw new Error('That feed has no stories.')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const name = doc.querySelector('channel > title, feed > title')?.textContent?.trim() || new URL(url).hostname.replace(/^www\./, '')
    return { url, name, count: items.length }
  }
  let first
  try {
    first = await attempt(base)
  } catch {
    throw new Error('Could not open that address.')
  }
  if (first.body) return finish(first.url, first.body)
  // A web page: look for the feed it advertises, then for the usual places.
  const doc = new DOMParser().parseFromString(first.html ?? '', 'text/html')
  const candidates = [...doc.querySelectorAll('link[rel="alternate"]')]
    .filter((l) => /rss|atom|xml/i.test(l.getAttribute('type') ?? ''))
    .map((l) => l.getAttribute('href'))
    .filter((h): h is string => !!h)
    .map((h) => new URL(h, base).toString())
  for (const p of ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml']) candidates.push(new URL(p, base).toString())
  for (const c of [...new Set(candidates)]) {
    try {
      const r = await attempt(c)
      if (r.body) return finish(r.url, r.body)
    } catch {
      /* next */
    }
  }
  throw new Error('No news feed was found there. Try the address of the feed itself.')
}

/* ── remembered between opens ────────────────────────────────────── */

const CACHE = 'news2.cache'
export function loadCache(): { at: number; items: Article[] } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) ?? 'null')
    return v && Array.isArray(v.items) ? v : null
  } catch {
    return null
  }
}
export function saveCache(items: Article[]) {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), items: [...items].sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0)).slice(0, 600) }))
  } catch {
    /* too big: just not remembered */
  }
}
