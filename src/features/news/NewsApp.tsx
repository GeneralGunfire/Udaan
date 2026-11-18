import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { launchApp } from '@/integrations/installed-apps/client'
import { getBriefByDate, getTodayBrief, listBriefHistory, regenerateTodayBrief, type BriefHistoryEntry, type DailyBrief } from '@/integrations/daily-brief'
import { buildStories, parseRawItems } from '@/features/news-brief/NewsBriefView'
import { UdaanMark } from '@/os/ui/icons/UdaanMark'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { audio } from './audio'
import { Briefing, type BriefSection } from './Briefing'
import { ArticleCard, HeroCard, ReaderPage } from './cards'
import { articleId, BUILTIN, fetchAll, groupStories, loadCache, saveCache, type Failure } from './feeds'
import { AudioBar, I, Ico, SourcesView } from './parts'
import { loadNewsState, news, useNewsState } from './state'
import { CATEGORIES, categoryLabel, viewKey, type Article, type View } from './types'
import './news.css'

/**
 * UDAAN NEWS. A magazine you can read straight through.
 *
 *   tabs      Briefing (written each morning) · Top · each section · your topics · Saved
 *   a story   opens full page; Esc goes back to exactly where you were
 *   reading   j / k or the arrows move to the next and previous story; the foot of the page offers the next
 *   every story has a picture, or an Udaan News cover when none good enough exists
 *
 *   s save   m read or unread   o open original   r refresh   u unread only   / search
 */

const REFRESH_MS = 15 * 60_000
const PAGE = 36
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const words = (t: string) => t.toLowerCase().split(/\W+/).filter(Boolean)
const matchesTopic = (a: Article, q: string) => {
  const hay = `${a.title} ${a.description}`.toLowerCase()
  return words(q).every((w) => hay.includes(w))
}
const categoryOf = (title: string) => CATEGORIES.find(([, label]) => title.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(title.toLowerCase()))?.[0] ?? 'general'

export function NewsApp() {
  const { s, ready } = useNewsState()
  const [view, setView] = useState<View>({ n: 'today' })
  const [items, setItems] = useState<Article[]>(() => loadCache()?.items ?? [])
  const [updatedMs, setUpdatedMs] = useState<number | null>(() => loadCache()?.at ?? null)
  const [loading, setLoading] = useState(false)
  const [failures, setFailures] = useState<Failure[]>([])
  const [reading, setReading] = useState<{ a: Article; list: Article[] } | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [addingTopic, setAddingTopic] = useState(false)
  const [, tick] = useState(0)
  const [date, setDate] = useState<string | null>(null)
  const [brief, setBrief] = useState<DailyBrief | null | undefined>(undefined)
  const [history, setHistory] = useState<BriefHistoryEntry[]>([])
  const [working, setWorking] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const openMenu = useShellMenu()

  useEffect(() => void loadNewsState(), [])

  /* ── sources ───────────────────────────────────────────────────── */

  const feeds = useMemo(() => [...BUILTIN, ...s.custom].map((f) => ({ ...f, enabled: f.builtin ? !s.off.includes(f.url) : true })), [s.custom, s.off])
  const enabledUrls = useMemo(() => new Set(feeds.filter((f) => f.enabled).map((f) => f.url)), [feeds])
  const feedsRef = useRef(feeds)
  useEffect(() => {
    feedsRef.current = feeds
  }, [feeds])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { items: got, failures: bad } = await fetchAll(feedsRef.current.filter((f) => f.enabled))
      // If every feed failed (offline), keep what was already shown.
      if (got.length) {
        setItems(got)
        saveCache(got)
        setUpdatedMs(Date.now())
      }
      setFailures(bad)
    } finally {
      setLoading(false)
    }
  }, [])

  const startedRef = useRef(false)
  useEffect(() => {
    if (!ready || startedRef.current) return
    startedRef.current = true
    if (!updatedMs || Date.now() - updatedMs > 8 * 60_000) void refresh()
    const t = setInterval(() => void refresh(), REFRESH_MS)
    const clock = setInterval(() => tick((n) => n + 1), 60_000)
    return () => (clearInterval(t), clearInterval(clock))
  }, [ready, updatedMs, refresh])

  const grouped = useMemo(() => groupStories(items.filter((a) => !a.feed || enabledUrls.has(a.feed))), [items, enabledUrls])
  const readSet = useMemo(() => new Set(s.read), [s.read])
  const savedSet = useMemo(() => new Set(s.saved.map((x) => x.id)), [s.saved])

  /* ── the briefing ──────────────────────────────────────────────── */

  const loadBrief = useCallback(() => {
    void (date === null ? getTodayBrief() : getBriefByDate(date)).then(setBrief, () => setBrief(null))
    void listBriefHistory().then(setHistory, () => {})
  }, [date])
  useEffect(loadBrief, [loadBrief])
  const { written, sections } = useMemo(() => buildStories(brief ?? null, brief ? parseRawItems(brief.raw_items_json) : []), [brief])
  const briefSections: BriefSection[] = useMemo(
    () =>
      sections.map((sec) => ({
        title: sec.title,
        stories: sec.stories.map((st) => ({
          id: articleId(st.link ?? '', st.headline, st.source ?? 'Briefing'),
          source: st.source ?? 'Briefing',
          category: categoryOf(sec.title),
          title: st.headline,
          description: st.body.join(' ').replace(/\*/g, ''),
          link: st.link ?? '',
          publishedMs: null,
          image: st.image,
        })),
      })),
    [sections],
  )
  const isToday = date === null || date === todayIso()
  const dayLabel = new Date(`${date ?? todayIso()}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  const rewrite = async () => {
    setWorking(true)
    try {
      await regenerateTodayBrief()
    } finally {
      setWorking(false)
      setDate(null)
      loadBrief()
    }
  }
  const dateMenu = (e: React.MouseEvent) =>
    openMenu(e, [{ label: 'Today', onSelect: () => setDate(null) }, ...history.filter((h) => h.date !== todayIso()).slice(0, 14).map((h) => ({ label: new Date(`${h.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), onSelect: () => setDate(h.date) }))])

  // If there is no written briefing, open on Top instead of an empty page.
  const decided = useRef(false)
  useEffect(() => {
    if (decided.current || brief === undefined) return
    decided.current = true
    if (!brief || !sections.length) setView({ n: 'latest' })
  }, [brief, sections.length])

  /* ── lists ─────────────────────────────────────────────────────── */

  const unread = useMemo(() => grouped.filter((a) => !readSet.has(a.id)).length, [grouped, readSet])

  const list = useMemo(() => {
    let l: Article[] = view.n === 'latest' ? (view.cat ? grouped.filter((a) => a.category === view.cat) : grouped) : view.n === 'topic' ? grouped.filter((a) => matchesTopic(a, view.q)) : view.n === 'saved' ? s.saved : view.n === 'today' ? briefSections.flatMap((x) => x.stories) : []
    if (unreadOnly && view.n !== 'saved') l = l.filter((a) => !readSet.has(a.id))
    const q = search.trim().toLowerCase()
    if (q) l = l.filter((a) => `${a.title} ${a.description} ${a.source}`.toLowerCase().includes(q))
    return l
  }, [view, grouped, s.saved, unreadOnly, search, readSet, briefSections])

  const go = (v: View) => {
    setView(v)
    setReading(null)
    setSearch('')
    setShown(PAGE)
    scroller.current?.scrollTo({ top: 0 })
  }

  /* ── reading ───────────────────────────────────────────────────── */

  const openStory = useCallback((a: Article, within: Article[]) => {
    setReading({ a, list: within })
    news.markRead([a.id])
  }, [])
  const move = useCallback(
    (d: number) => {
      if (!reading) return
      const i = reading.list.findIndex((x) => x.id === reading.a.id)
      const n = reading.list[i + d]
      if (n) openStory(n, reading.list)
    },
    [reading, openStory],
  )

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || e.ctrlKey || e.altKey || e.metaKey) return
      const a = reading?.a
      if (e.key === 'Escape') reading && setReading(null)
      else if ((e.key === 'j' || e.key === 'ArrowRight' || e.key === 'ArrowDown') && reading) move(1)
      else if ((e.key === 'k' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') && reading) move(-1)
      else if (e.key === 's' && a) news.toggleSaved(a)
      else if (e.key === 'm' && a) news.markRead([a.id], !readSet.has(a.id))
      else if (e.key === 'o' && a?.link) void launchApp(a.link).catch(() => {})
      else if (e.key === 'r') void refresh()
      else if (e.key === 'u') setUnreadOnly((v) => !v)
      else if (e.key === '/') searchRef.current?.focus()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [reading, move, readSet, refresh])

  /* ── tabs ──────────────────────────────────────────────────────── */

  const tabs: { v: View; label: string; badge?: number; menu?: (e: React.MouseEvent) => void }[] = [
    { v: { n: 'today' }, label: 'Briefing' },
    { v: { n: 'latest' }, label: 'Top', badge: unread },
    ...CATEGORIES.filter(([id]) => grouped.some((a) => a.category === id)).map(([id, label]) => ({ v: { n: 'latest', cat: id } as View, label })),
    ...s.topics.map((t) => ({ v: { n: 'topic', q: t } as View, label: t, menu: (e: React.MouseEvent) => openMenu(e, [{ label: `Stop following “${t}”`, danger: true, onSelect: () => (news.removeTopic(t), view.n === 'topic' && view.q === t && go({ n: 'latest' })) }]) })),
    { v: { n: 'saved' }, label: 'Saved', badge: s.saved.length },
  ]
  const isOn = (v: View) => viewKey(v) === viewKey(view)

  const agoText = updatedMs ? (Date.now() - updatedMs < 60_000 ? 'just now' : `${Math.round((Date.now() - updatedMs) / 60_000)} min ago`) : 'never'
  const heading = view.n === 'latest' ? (view.cat ? categoryLabel(view.cat) : 'Top stories') : view.n === 'topic' ? view.q : view.n === 'saved' ? 'Saved' : ''
  const visible = list.slice(0, shown)
  const lead = !search && !unreadOnly && visible.length > 3 ? visible[0] : null
  const rest = lead ? visible.slice(1) : visible

  const listen = () => {
    const pick = (unreadOnly ? list : list.filter((a) => !readSet.has(a.id))).slice(0, 15)
    audio.play(pick.map((a) => ({ title: a.title, text: a.description })), heading || 'News')
  }
  const listenBriefing = () =>
    audio.play(
      briefSections.flatMap((x) => x.stories).map((a) => ({ title: a.title, text: a.description })),
      isToday ? 'Today’s briefing' : 'Briefing',
    )

  const showSources = view.n === 'sources'

  return (
    <div className="flex h-full min-h-0 flex-col text-(--u-ink)">
      {/* header */}
      <header className="flex h-14 shrink-0 items-center gap-3 px-6">
        <UdaanMark size={20} className="text-(--u-ink)" />
        <h1 className="text-[16px] font-semibold tracking-tight">
          Udaan <span className="font-light text-(--u-ink-2)">News</span>
        </h1>
        <span className="flex-1" />
        {!showSources && view.n !== 'today' && (
          <label className="flex h-8 w-[230px] items-center gap-2 rounded-full bg-(--u-wash-hover) px-3 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
            <Ico d={I.search} size={13} className="text-(--u-ink-3)" />
            <input ref={searchRef} value={search} onChange={(e) => (setSearch(e.target.value), setShown(PAGE))} onKeyDown={(e) => e.key === 'Escape' && (setSearch(''), e.currentTarget.blur())} placeholder="Search stories  ( / )" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--u-ink-3)" />
          </label>
        )}
        {!showSources && view.n !== 'today' && view.n !== 'saved' && (
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} title="Show only stories you haven't opened (u)" className={cn('h-8 rounded-full px-3.5 text-[12.5px] font-medium', unreadOnly ? 'bg-(--u-ink) text-(--u-m-solid)' : 'bg-(--u-wash-hover) text-(--u-ink-2) hover:bg-(--u-wash-on)')}>
            Unread
          </button>
        )}
        <Button icon size="sm" aria-label="Refresh" title={`Refresh (r). Updated ${agoText}`} disabled={loading} onClick={() => void refresh()}>
          <Ico d={I.refresh} size={14} className={loading ? 'news-spin' : ''} />
        </Button>
        <Button icon size="sm" aria-label="Listen" title={view.n === 'today' ? 'Listen to the briefing' : 'Listen to the unread headlines'} onClick={view.n === 'today' ? listenBriefing : listen} disabled={view.n !== 'today' && !list.length}>
          <Ico d={I.headphones} size={14} />
        </Button>
        <Button icon size="sm" aria-label="Sources" title="Choose your sources" onClick={() => go({ n: 'sources' })} className={cn(showSources && 'bg-(--u-wash-on) text-(--u-accent)')}>
          <Ico d={I.gear} size={14} />
        </Button>
      </header>

      {/* tabs */}
      <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-(--u-edge) px-5 [scrollbar-width:none]" aria-label="Sections">
        {tabs.map((t) => (
          <button key={viewKey(t.v)} type="button" onClick={() => go(t.v)} onContextMenu={t.menu ? (e) => (e.preventDefault(), t.menu!(e)) : undefined} aria-current={isOn(t.v) ? 'page' : undefined} className={cn('relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-[13.5px] font-medium transition-colors duration-100', isOn(t.v) ? 'text-(--u-ink)' : 'text-(--u-ink-3) hover:text-(--u-ink-2)')}>
            {t.label}
            {!!t.badge && <span className="rounded-full bg-(--u-wash-on) px-1.5 text-[10.5px] tabular-nums text-(--u-ink-2)">{t.badge > 99 ? '99+' : t.badge}</span>}
            {isOn(t.v) && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-(--u-accent)" />}
          </button>
        ))}
        {addingTopic ? (
          <form
            className="ml-1 shrink-0"
            onSubmit={(e) => {
              e.preventDefault()
              const v = (new FormData(e.currentTarget).get('t') as string).trim()
              if (v) (news.addTopic(v), go({ n: 'topic', q: v }))
              setAddingTopic(false)
            }}
          >
            <input name="t" autoFocus placeholder="A word or name" onBlur={() => setAddingTopic(false)} onKeyDown={(e) => e.key === 'Escape' && setAddingTopic(false)} className="u-field h-7 w-[150px] text-[12.5px]" />
          </form>
        ) : (
          <button type="button" onClick={() => setAddingTopic(true)} title="Follow a topic" className="ml-1 flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] text-(--u-ink-3) hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
            <Ico d={I.plus} size={12} /> Topic
          </button>
        )}
        <span className="flex-1" />
        <span className="shrink-0 pr-1 text-[11.5px] text-(--u-ink-3)">
          {loading ? 'Updating…' : `Updated ${agoText}`}
          {failures.length > 0 && !loading && (
            <button type="button" onClick={() => go({ n: 'sources' })} className="ml-1.5 text-[#d9a13b] hover:underline">
              {failures.length} didn’t load
            </button>
          )}
        </span>
      </nav>

      {/* page */}
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="u-scroll h-full overflow-y-auto">
          {showSources ? (
            <SourcesView feeds={feeds} failures={failures} onToggle={news.toggleFeed} onAdd={(f) => (news.addFeed(f), setTimeout(() => void refresh(), 50))} onCategory={news.setFeedCategory} />
          ) : view.n === 'today' ? (
            <Briefing
              brief={brief}
              sections={briefSections}
              written={written}
              label={dayLabel}
              isToday={isToday}
              working={working}
              readSet={readSet}
              savedSet={savedSet}
              onRegenerate={() => void rewrite()}
              onDates={dateMenu}
              onOpen={(a) => openStory(a, list)}
              onSave={(a) => news.toggleSaved(a)}
              onListen={listenBriefing}
            />
          ) : (
            <div className="mx-auto max-w-[1180px] px-8 pb-14 pt-6">
              <div className="mb-5 flex items-baseline justify-between gap-4">
                <h2 className="text-[24px] font-bold tracking-tight">{heading}</h2>
                <span className="text-[12.5px] text-(--u-ink-3)">
                  {list.length} {list.length === 1 ? 'story' : 'stories'}
                  {view.n !== 'saved' && unread > 0 && !unreadOnly ? ` · ${unread} unread` : ''}
                  {view.n !== 'saved' && list.length > 0 && (
                    <button type="button" onClick={() => news.markRead(list.map((a) => a.id))} className="ml-3 hover:text-(--u-ink)">
                      Mark all read
                    </button>
                  )}
                </span>
              </div>

              {list.length === 0 ? (
                <div className="mx-auto max-w-[360px] pt-20 text-center">
                  <p className="text-[16px] font-medium text-(--u-ink-2)">{view.n === 'saved' ? 'Nothing saved yet' : loading && !items.length ? 'Loading your sources…' : unreadOnly ? 'You’re all caught up' : view.n === 'topic' ? `No stories mention “${view.q}” right now` : 'No stories here'}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-(--u-ink-3)">{view.n === 'saved' ? 'Press the bookmark on a story, or S while reading, to keep it.' : unreadOnly ? 'Turn off Unread to see everything.' : search ? 'Nothing matches your search.' : 'Check your connection, or add sources with the gear.'}</p>
                </div>
              ) : (
                <>
                  {lead && (
                    <div className="mb-5">
                      <HeroCard a={lead} read={readSet.has(lead.id)} saved={savedSet.has(lead.id)} onOpen={() => openStory(lead, list)} onSave={() => news.toggleSaved(lead)} />
                    </div>
                  )}
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                    {rest.map((a) => (
                      <ArticleCard key={a.id} a={a} read={readSet.has(a.id)} saved={savedSet.has(a.id)} onOpen={() => openStory(a, list)} onSave={() => news.toggleSaved(a)} />
                    ))}
                  </div>
                  {list.length > shown && (
                    <div className="mt-8 flex justify-center">
                      <Button variant="tinted" onClick={() => setShown((n) => n + PAGE)}>
                        Show more ({list.length - shown} left)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {reading && (
          <ReaderPage
            key={reading.a.id}
            a={reading.a}
            index={reading.list.findIndex((x) => x.id === reading.a.id)}
            total={reading.list.length}
            next={reading.list[reading.list.findIndex((x) => x.id === reading.a.id) + 1] ?? null}
            saved={savedSet.has(reading.a.id)}
            savedText={s.saved.find((x) => x.id === reading.a.id)?.text}
            read={readSet.has(reading.a.id)}
            onSave={() => news.toggleSaved(reading.a)}
            onClose={() => setReading(null)}
            onPrev={() => move(-1)}
            onNext={() => move(1)}
            onToggleRead={() => news.markRead([reading.a.id], !readSet.has(reading.a.id))}
            onText={(t) => savedSet.has(reading.a.id) && news.keepText(reading.a.id, t)}
          />
        )}
      </div>
      <AudioBar />
    </div>
  )
}
