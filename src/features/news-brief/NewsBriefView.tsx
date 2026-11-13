import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { getTodayBrief, getBriefByDate, listBriefHistory, regenerateTodayBrief, type DailyBrief, type BriefHistoryEntry, type RawItem } from '@/integrations/daily-brief'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { cn } from '@/shared/lib/cn'
import { parseReportFull } from './components/ReportRenderer'
import { Select } from '@/shared/components/ui/select'
import { SearchIcon } from '@/shared/icons'

interface NewsBriefViewProps {
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  southafrica: 'South Africa',
  politics: 'Politics',
  conflict: 'World',
  technology: 'Technology',
  science: 'Science',
  business: 'Business',
  health: 'Health & Medicine',
}

interface Story {
  section: string
  headline: string
  body: string[]
  image: string | null
  link: string | null
  source: string | null
}

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseRawItems(json: string): RawItem[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const words = (t: string) => new Set(t.toLowerCase().split(/\W+/).filter((w) => w.length > 3))

/** The raw feed item a written story is most likely about, for its picture and link. */
function bestMatch(text: string, items: RawItem[], used: Set<RawItem>): RawItem | null {
  const w = words(text)
  let best: RawItem | null = null
  let bestScore = 0
  for (const item of items) {
    const iw = words(`${item.title} ${item.description}`)
    let overlap = 0
    for (const x of iw) if (w.has(x)) overlap++
    // Scored as a share of the headline's own distinctive words, not a raw
    // count: a long item description otherwise out-scored a genuinely
    // closer match just by having more words to hit, which is how stories
    // ended up captioned with another story's picture and source link.
    let score = overlap / Math.max(6, Math.min(w.size, 24))
    if (item.image) score += 0.05
    if (used.has(item)) score -= 0.5
    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }
  // Below this the "match" is effectively coincidence; showing no picture
  // and no source is better than attributing a story to the wrong outlet.
  return bestScore >= 0.3 ? best : null
}

/** Stories to show: the AI-written report when there is one, the feed itself when not. */
/** Reader priority, so the brief leads with South Africa and technology
 * rather than whatever order the feeds or the summarizer happened to emit. */
const SECTION_ORDER = ['South Africa', 'Technology', 'Health', 'World', 'Conflict', 'Business', 'Science', 'Politics']

function sectionRank(title: string): number {
  const i = SECTION_ORDER.findIndex((s) => title.toLowerCase().includes(s.toLowerCase()))
  return i === -1 ? SECTION_ORDER.length : i
}

export function buildStories(brief: DailyBrief | null, raw: RawItem[]): { written: boolean; sections: { title: string; stories: Story[] }[] } {
  if (brief?.report_markdown) {
    const used = new Set<RawItem>()
    const sections = parseReportFull(brief.report_markdown).map((s) => ({
      title: s.title,
      stories: s.stories
        .filter((st) => st.headline || st.body.length)
        .map((st) => {
          const m = bestMatch(`${st.headline} ${st.body.join(' ')}`, raw, used)
          if (m) used.add(m)
          return { section: s.title, headline: st.headline || st.body[0]?.slice(0, 90) || '', body: st.headline ? st.body : st.body.slice(1), image: m?.image ?? null, link: m?.link ?? null, source: m?.source ?? null }
        }),
    }))
    return {
      written: true,
      sections: sections.filter((s) => s.stories.length).sort((a, b) => sectionRank(a.title) - sectionRank(b.title)),
    }
  }
  const byCat = new Map<string, RawItem[]>()
  for (const item of raw) byCat.set(item.category, [...(byCat.get(item.category) ?? []), item])
  return {
    written: false,
    sections: [...byCat.entries()]
      .map(([cat, items]) => ({
        title: CATEGORY_LABELS[cat] ?? cat,
        stories: items
          .sort((a, b) => Number(!!b.image) - Number(!!a.image) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
          .slice(0, 12)
          .map((i) => ({ section: CATEGORY_LABELS[cat] ?? cat, headline: i.title, body: i.description ? [i.description] : [], image: i.image ?? null, link: i.link, source: i.source })),
      }))
      .sort((a, b) => sectionRank(a.title) - sectionRank(b.title)),
  }
}

const SAVED_KEY = 'udaan.news.saved'

function readSaved(): Story[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
    return Array.isArray(v) ? (v as Story[]) : []
  } catch {
    return []
  }
}

/** Stories the reader bookmarked, kept across days (the brief itself is rewritten daily). */
function useSavedStories() {
  const [saved, setSaved] = useState<Story[]>(readSaved)
  const toggle = useCallback((story: Story) => {
    setSaved((cur) => {
      const next = cur.some((x) => x.headline === story.headline) ? cur.filter((x) => x.headline !== story.headline) : [story, ...cur]
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable: the bookmark just won't persist */
      }
      return next
    })
  }, [])
  return { saved, toggle }
}

function BookmarkButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={on ? 'Remove from Saved' : 'Save story'}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        'absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white outline-none backdrop-blur transition-opacity hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <path d="M6 3.5h12v17L12 16l-6 4.5Z" />
      </svg>
    </button>
  )
}

function Picture({ src, className }: { src: string | null; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <div className={cn('bg-gradient-to-br from-(--os-hover) to-transparent', className)} />
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      onLoad={(e) => { if (e.currentTarget.naturalWidth < 400) setFailed(true) }}
      className={cn('object-cover', className)}
    />
  )
}

function Meta({ s }: { s: Story }) {
  if (!s.source) return null
  return (
    <p className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--color-text-tertiary,rgb(255_255_255/0.45))]">
      <span className="font-semibold uppercase tracking-wide">{s.source}</span>
      {s.link && (
        <button type="button" onClick={(e) => (e.stopPropagation(), void openWithSystem(s.link!))} className="rounded px-1 hover:bg-(--os-hover) hover:text-[var(--color-text-primary)]">
          Read source ↗
        </button>
      )}
    </p>
  )
}

function Hero({ s, saved, onSave }: { s: Story; saved: boolean; onSave: () => void }) {
  return (
    <article className="group relative grid overflow-hidden rounded-[14px] border border-[var(--border-hairline)] bg-[var(--surface-raised)] md:grid-cols-[1.25fr_1fr]">
      <BookmarkButton on={saved} onToggle={onSave} />
      <Picture src={s.image} className="h-full max-h-[380px] min-h-[220px] w-full" />
      <div className="flex min-w-0 flex-col justify-center p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent)]">{s.section}</p>
        <h2 className="mt-2 text-[24px] font-semibold leading-[1.2] tracking-tight text-balance break-words text-[var(--color-text-primary)]">{s.headline}</h2>
        {s.body.slice(0, 3).map((p, i) => (
          <p key={i} className="mt-3 text-[14px] leading-relaxed text-[var(--color-text-secondary)]">
            {p.replace(/\*/g, '')}
          </p>
        ))}
        <Meta s={s} />
      </div>
    </article>
  )
}

function Card({ s, showSection, saved, onSave }: { s: Story; showSection?: boolean; saved: boolean; onSave: () => void }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-raised)] transition-colors hover:bg-[var(--surface-hover)]">
      <BookmarkButton on={saved} onToggle={onSave} />
      <Picture src={s.image} className="aspect-[16/9] w-full" />
      <div className="flex flex-1 flex-col p-4">
        {showSection && <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent)]">{s.section}</p>}
        <h3 className="text-[15.5px] font-semibold leading-snug text-balance break-words text-[var(--color-text-primary)]">{s.headline}</h3>
        {s.body[0] && <p className="mt-2 line-clamp-4 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">{s.body.join(' ').replace(/\*/g, '')}</p>}
        <div className="mt-auto">
          <Meta s={s} />
        </div>
      </div>
    </article>
  )
}

/** Udaan News: today's brief as a magazine, with pictures from the source feeds. */
export function NewsBriefView(_props: NewsBriefViewProps) {
  const [date, setDate] = useState<string | null>(null)
  const [brief, setBrief] = useState<DailyBrief | null | undefined>(undefined)
  const [history, setHistory] = useState<BriefHistoryEntry[]>([])
  const [tab, setTab] = useState<string>('Top')
  const [working, setWorking] = useState(false)
  const [query, setQuery] = useState('')
  const { saved, toggle: toggleSaved } = useSavedStories()
  const today = todayIso()

  const load = useCallback(() => {
    void (date === null ? getTodayBrief() : getBriefByDate(date)).then(setBrief, () => setBrief(null))
    void listBriefHistory().then(setHistory, () => {})
  }, [date])
  useEffect(load, [load])

  const raw = useMemo(() => (brief ? parseRawItems(brief.raw_items_json) : []), [brief])
  const { written, sections } = useMemo(() => buildStories(brief ?? null, raw), [brief, raw])
  const tabs = ['Top', ...sections.map((s) => s.title), ...(saved.length ? ['Saved'] : [])]
  // A front page, not one story per section: the lead from every section
  // first, then each section's second story, so Top is substantial on a day
  // the brief covers only three or four categories.
  const top = useMemo(() => {
    const out: Story[] = []
    for (let round = 0; round < 2; round++) for (const s of sections) if (s.stories[round]) out.push(s.stories[round])
    return out
  }, [sections])
  const inTab = tab === 'Top' ? top : tab === 'Saved' ? saved : (sections.find((s) => s.title === tab)?.stories ?? [])
  // Search looks across everything in the brief, not just the open tab.
  const needle = query.trim().toLowerCase()
  const everything = useMemo(() => [...new Map([...sections.flatMap((x) => x.stories), ...saved].map((x) => [x.headline, x])).values()], [sections, saved])
  const shown = needle ? everything.filter((x) => `${x.headline} ${x.body.join(' ')} ${x.source ?? ''}`.toLowerCase().includes(needle)) : inTab
  const isSaved = (x: Story) => saved.some((y) => y.headline === x.headline)
  const withImage = shown.findIndex((s) => s.image)
  const hero = shown[withImage >= 0 ? withImage : 0]
  const rest = shown.filter((s) => s !== hero)

  const regenerate = async () => {
    setWorking(true)
    try {
      await regenerateTodayBrief()
    } finally {
      setWorking(false)
      setDate(null)
      load()
    }
  }

  const label = new Date(`${date ?? today}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="flex h-full flex-col bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <header className="flex shrink-0 items-end justify-between gap-4 px-8 pb-3 pt-6">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">{label}</p>
          <h1 className="text-[30px] font-bold tracking-tight">{date === null || date === today ? "Today's Brief" : 'Brief'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stories"
              aria-label="Search stories"
              className="h-9 w-[200px] rounded-[8px] border border-[var(--border-hairline)] bg-(--os-hover) pl-8 pr-3 text-[13px] outline-none placeholder:text-[var(--color-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <Select
            value={date ?? today}
            onChange={(v) => setDate(v === today ? null : v)}
            options={[{ date: today }, ...history.filter((h) => h.date !== today)].map((h) => ({
              value: h.date,
              label: h.date === today ? 'Today' : new Date(`${h.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
            }))}
          />
          {(date === null || date === today) && (
            <button type="button" disabled={working} onClick={() => void regenerate()} className="flex h-9 items-center gap-2 rounded-[8px] bg-[var(--color-accent)] text-white px-4 text-[13px] font-medium hover:brightness-110 disabled:opacity-60">
              {working && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {working ? 'Writing…' : 'Regenerate'}
            </button>
          )}
        </div>
      </header>

      <nav className="flex shrink-0 gap-1 border-b border-[var(--border-hairline)] px-7">
        {tabs.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn('relative px-3 py-2.5 text-[13.5px] font-medium transition-colors', tab === t ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}>
            {t}
            {tab === t && <motion.span layoutId="news-tab" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--color-accent)]" />}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {brief === undefined ? (
          <p className="text-[var(--color-text-secondary)]">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <p className="text-[18px] font-semibold">{needle ? 'No matching stories' : working ? 'Writing your brief…' : 'No brief yet'}</p>
            <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">{working ? 'Reading the feeds and summarising them. This takes a minute or two.' : 'Press Regenerate to write today’s brief now.'}</p>
          </div>
        ) : (
          <motion.div key={`${tab}-${date}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto flex max-w-[1180px] flex-col gap-5">
            {!written && (
              <div className="flex items-center justify-between rounded-[10px] border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-[13px] text-amber-100/90">
                <span>These are the latest stories straight from the feeds — the written summary isn't ready{brief?.degraded_reason ? ` (${brief.degraded_reason})` : ''}.</span>
                {(date === null || date === today) && !working && (
                  <button type="button" onClick={() => void regenerate()} className="ml-4 shrink-0 font-semibold text-[var(--color-text-primary)] hover:underline">
                    Write it now
                  </button>
                )}
              </div>
            )}
            {needle && <p className="text-[13px] text-[var(--color-text-secondary)]">{shown.length} {shown.length === 1 ? 'story' : 'stories'} matching “{query.trim()}”</p>}
            {hero && <Hero s={hero} saved={isSaved(hero)} onSave={() => toggleSaved(hero)} />}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {rest.map((s, i) => (
                <Card key={`${s.headline}-${i}`} s={s} showSection={tab === 'Top' || !!needle} saved={isSaved(s)} onSave={() => toggleSaved(s)} />
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
