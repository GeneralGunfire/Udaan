import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'
import type { Article, Feed, NewsState } from './types'

/** The user's sources, topics, saved stories and read marks. One JSON file written by Rust; saves are debounced. */

const DEFAULT: NewsState = { v: 1, custom: [], off: [], topics: [], saved: [], read: [] }
let state: NewsState = DEFAULT
let loaded = false
let snap = { s: state, ready: false }
const subs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

const emit = () => {
  snap = { s: state, ready: loaded }
  subs.forEach((x) => x())
}
const save = () => {
  clearTimeout(timer)
  timer = setTimeout(() => void invoke('news_state_set', { json: JSON.stringify(state) }).catch(() => {}), 500)
}
const change = (fn: (s: NewsState) => NewsState) => {
  if (!loaded) return
  state = fn(state)
  emit()
  save()
}

/** The old News app kept saved stories in localStorage; bring them over once. */
function fromOld(): NewsState {
  const out = { ...DEFAULT }
  try {
    const old = JSON.parse(localStorage.getItem('udaan.news.saved') ?? '[]') as { headline: string; body: string[]; image: string | null; link: string | null; source: string | null; section: string }[]
    out.saved = old.map((o) => ({
      id: `old-${o.headline.length}-${o.headline.slice(0, 12)}`,
      source: o.source ?? 'News',
      category: 'general',
      title: o.headline,
      description: o.body.join(' '),
      link: o.link ?? '',
      publishedMs: null,
      image: o.image,
      savedMs: Date.now(),
    }))
  } catch {
    /* none */
  }
  return out
}

export async function loadNewsState() {
  if (loaded) return
  try {
    const raw = await invoke<string>('news_state_get')
    state = raw ? { ...DEFAULT, ...JSON.parse(raw) } : fromOld()
  } catch {
    state = fromOld()
  }
  loaded = true
  emit()
  save()
}

export const useNewsState = () =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => snap,
  )

export const news = {
  toggleFeed: (f: Feed) => change((s) => (f.builtin ? { ...s, off: s.off.includes(f.url) ? s.off.filter((u) => u !== f.url) : [...s.off, f.url] } : { ...s, custom: s.custom.filter((c) => c.url !== f.url) })),
  addFeed: (f: Feed) => change((s) => (s.custom.some((c) => c.url === f.url) ? s : { ...s, custom: [...s.custom, f] })),
  setFeedCategory: (url: string, category: string) => change((s) => ({ ...s, custom: s.custom.map((c) => (c.url === url ? { ...c, category } : c)) })),
  addTopic: (t: string) => change((s) => (s.topics.some((x) => x.toLowerCase() === t.toLowerCase()) ? s : { ...s, topics: [...s.topics, t] })),
  removeTopic: (t: string) => change((s) => ({ ...s, topics: s.topics.filter((x) => x !== t) })),
  toggleSaved: (a: Article, text?: string) =>
    change((s) => (s.saved.some((x) => x.id === a.id) ? { ...s, saved: s.saved.filter((x) => x.id !== a.id) } : { ...s, saved: [{ ...a, savedMs: Date.now(), text }, ...s.saved].slice(0, 400) })),
  keepText: (id: string, text: string) => change((s) => ({ ...s, saved: s.saved.map((x) => (x.id === id && !x.text ? { ...x, text } : x)) })),
  markRead: (ids: string[], on = true) =>
    change((s) => {
      const set = new Set(s.read)
      for (const id of ids) on ? set.add(id) : set.delete(id)
      // Old marks fall off the end, so the file doesn't grow forever.
      return { ...s, read: [...set].slice(-4000) }
    }),
}
