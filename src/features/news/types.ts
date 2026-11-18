/** One story from a feed. */
export interface Article {
  id: string
  source: string
  category: string
  title: string
  /** Plain text from the feed, cut short. */
  description: string
  link: string
  publishedMs: number | null
  image: string | null
  /** The feed it came from (its address), so switching a feed off hides its stories. */
  feed?: string
  /** The same story as reported by other outlets. */
  also?: { source: string; link: string }[]
}

export interface SavedArticle extends Article {
  savedMs: number
  /** The full text, once it was read. Kept so a saved story still reads when the page is gone. */
  text?: string
}

export interface Feed {
  url: string
  name: string
  category: string
  builtin: boolean
}

export interface NewsState {
  v: number
  /** Feeds the user added. */
  custom: Feed[]
  /** Built-in feeds switched off (by url). */
  off: string[]
  topics: string[]
  saved: SavedArticle[]
  /** Ids of stories that were opened. */
  read: string[]
}

export type View = { n: 'today' } | { n: 'latest'; cat?: string } | { n: 'saved' } | { n: 'topic'; q: string } | { n: 'sources' }

export const CATEGORIES: [string, string][] = [
  ['southafrica', 'South Africa'],
  ['technology', 'Technology'],
  ['health', 'Health'],
  ['conflict', 'World'],
  ['politics', 'Politics'],
  ['science', 'Science'],
  ['business', 'Business'],
  ['general', 'General'],
]
export const categoryLabel = (id: string) => CATEGORIES.find(([k]) => k === id)?.[1] ?? id

export const viewKey = (v: View) => (v.n === 'latest' ? `latest:${v.cat ?? ''}` : v.n === 'topic' ? `topic:${v.q}` : v.n)
