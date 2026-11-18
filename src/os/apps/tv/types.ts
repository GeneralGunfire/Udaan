/** A film, or one season of a series, from the catalogue. */
export interface Title {
  id: string
  kind: 'movie' | 'show'
  title: string
  image: string
  imageHi: string
  genre: string
  summary: string
  year: string
  runtimeMin?: number | null
  rating: string
  previewUrl: string
  /** The show's name for a season, the director for a film. */
  artist: string
}

export type Status = 'want' | 'watching' | 'watched'

export interface Reminder {
  /** The Calendar event this created, so it can be removed again. */
  eventId: string
  atMs: number
  label: string
}

/** A title the user keeps: what they plan to watch, are watching, or finished. */
export interface ListItem extends Title {
  status: Status
  /** The streaming app they last used for it. */
  service?: string
  /** Where they are, e.g. "S2 E5". */
  progress?: string
  /** 1 to 5, once watched. */
  stars?: number
  addedMs: number
  updatedMs: number
  remind?: Reminder | null
}

export interface Library {
  v: number
  installed: string[]
  recent: string[]
  provider: string
  items: Record<string, ListItem>
}

export type View =
  | { n: 'home' }
  | { n: 'movies' }
  | { n: 'series' }
  | { n: 'list' }
  | { n: 'apps' }
  | { n: 'search'; q: string }
  | { n: 'title'; t: Title }

export const keyOf = (t: Pick<Title, 'kind' | 'id'>) => `${t.kind}:${t.id}`

/** "Breaking Bad, Season 5" becomes "Breaking Bad": what to type into a streaming app's search box. */
export const searchName = (t: Title) => (t.kind === 'show' ? (t.artist || t.title).replace(/,?\s*(season|series)\s*\d+.*$/i, '').trim() : t.title.replace(/\s*\(\d{4}\)\s*$/, '').trim())
