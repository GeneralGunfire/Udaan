import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { launchApp } from '@/integrations/installed-apps/client'
import { useTv } from './ctx'
import { fmtWhen, searchTitles, useBrowse } from './data'
import { STATUS_LABEL, tvLib, useLibrary } from './library'
import { CATALOG, searchUrl, serviceById, type Service } from './services'
import { keyOf, searchName, type ListItem, type Status, type Title } from './types'
import { Btn, Empty, focusRing, Icon, Logo, Pill, PosterCard, Rail } from './ui'

/** Bookmark toggle shared by every poster: adds as "want to watch", or removes. */
function useBookmark() {
  const { lib, ready } = useLibrary()
  const tv = useTv()
  return {
    status: (t: Title) => lib.items[keyOf(t)]?.status,
    toggle: (t: Title) => {
      if (!ready) return
      if (lib.items[keyOf(t)]) (tvLib.remove(t), tv.say('Removed from your list'))
      else (tvLib.put(t), tv.say('Added to your list'))
    },
  }
}

/* ── home ────────────────────────────────────────────────────────── */

export function Home() {
  const tv = useTv()
  const { lib } = useLibrary()
  const movies = useBrowse('movie')
  const shows = useBrowse('show')
  const bm = useBookmark()
  const [hero, setHero] = useState(0)
  const featured = movies.items[hero]
  const count = Math.min(movies.items.length, 8)

  const items = Object.values(lib.items)
  const watching = items.filter((i) => i.status === 'watching').sort((a, b) => b.updatedMs - a.updatedMs)
  const want = items.filter((i) => i.status === 'want').sort((a, b) => b.updatedMs - a.updatedMs)
  const apps = lib.installed.map((id) => serviceById(id)).filter((s): s is Service => !!s)
  const offline = !movies.items.length && !shows.items.length && !!(movies.error || shows.error)

  const resume = (i: ListItem) => {
    const s = serviceById(i.service) ?? tv.chosen
    tv.watch(s, i)
  }

  return (
    <div className="pb-16">
      {/* hero: changes only when you ask, never on a timer */}
      <section className="relative h-[54vh] min-h-[400px] overflow-hidden">
        {featured && <img key={featured.id} src={featured.imageHi || featured.image} alt="" className="tv-fade absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-[0.4]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-[#0c0d10]/35 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0c0d10]/85 via-[#0c0d10]/25 to-transparent" />
        {featured ? (
          <div key={featured.id} className="tv-fade relative flex h-full items-end gap-12 px-14 pb-12">
            <div className="max-w-[640px] flex-1">
              <p className="text-[12.5px] font-semibold uppercase tracking-[0.2em] text-white/60">
                #{hero + 1} film this week · {featured.genre}
                {featured.year ? ` · ${featured.year}` : ''}
              </p>
              <h1 className="mt-3 text-[54px] font-bold leading-[1.03] tracking-tight">{featured.title}</h1>
              <p className="mt-4 line-clamp-3 text-[15.5px] leading-relaxed text-white/75">{featured.summary}</p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Btn primary onClick={() => tv.watch(tv.chosen, featured)}>
                  <Icon name="play" size={16} /> Watch on {tv.chosen.name}
                </Btn>
                <Btn onClick={() => tv.openTitle(featured)}>Details</Btn>
                <Btn onClick={() => bm.toggle(featured)} title={bm.status(featured) ? 'Remove from my list' : 'Add to my list'}>
                  <Icon name={bm.status(featured) ? 'check' : 'plus'} size={16} /> {bm.status(featured) ? 'In my list' : 'My list'}
                </Btn>
              </div>
            </div>
            <img src={featured.imageHi || featured.image} alt="" draggable={false} className="hidden h-[320px] rounded-[14px] lg:block" />
          </div>
        ) : (
          <div className="relative flex h-full flex-col items-start justify-end px-14 pb-12">
            <h1 className="text-[54px] font-bold tracking-tight">
              Udaan <span className="font-light text-white/55">TV</span>
            </h1>
            <p className="mt-2 text-[15px] text-white/50">{offline ? 'Can’t reach the film catalogue right now. Your apps still work.' : 'Loading this week’s films…'}</p>
            {offline && (
              <Btn className="mt-4" onClick={() => (movies.reload(), shows.reload())}>
                <Icon name="reload" size={15} /> Try again
              </Btn>
            )}
          </div>
        )}
        {count > 1 && (
          <div className="absolute bottom-5 right-14 flex items-center gap-1.5">
            <button type="button" aria-label="Previous film" onClick={() => setHero((h) => (h - 1 + count) % count)} className={cn('flex h-7 w-7 items-center justify-center rounded-full text-white/70 hover:bg-white/[0.12]', focusRing)}>
              <Icon name="back" size={14} />
            </button>
            {Array.from({ length: count }, (_, i) => (
              <button key={i} type="button" aria-label={`Film ${i + 1}`} onClick={() => setHero(i)} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-200', i === hero ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60')} />
            ))}
            <button type="button" aria-label="Next film" onClick={() => setHero((h) => (h + 1) % count)} className={cn('flex h-7 w-7 items-center justify-center rounded-full text-white/70 hover:bg-white/[0.12]', focusRing)}>
              <Icon name="fwd" size={14} />
            </button>
          </div>
        )}
      </section>

      {watching.length > 0 && (
        <Rail title="Continue watching" hint="Press play to pick up in the app">
          {watching.map((i) => (
            <PosterCard key={keyOf(i)} t={i} status="watching" sub={[i.progress, serviceById(i.service)?.name].filter(Boolean).join(' · ') || 'Watching'} onOpen={() => tv.openTitle(i)} onPlay={() => resume(i)} />
          ))}
        </Rail>
      )}

      <section className="px-14 pt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[19px] font-semibold">Your apps</h2>
          <button type="button" onClick={() => tv.go({ n: 'apps' })} className="text-[13px] font-medium text-white/55 hover:text-white">
            Add or remove ›
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {apps.map((s) => (
            <AppTile key={s.id} s={s} />
          ))}
          <button type="button" onClick={() => tv.go({ n: 'apps' })} className={cn('flex h-[84px] w-[110px] flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-white/20 text-white/55 hover:border-white/40 hover:text-white', focusRing)}>
            <Icon name="plus" size={20} />
            <span className="text-[12px]">Add apps</span>
          </button>
        </div>
      </section>

      {want.length > 0 && (
        <Rail title="My list" hint={`${want.length} to watch`}>
          {want.map((i) => (
            <PosterCard key={keyOf(i)} t={i} status="want" sub={i.remind ? `Reminder ${fmtWhen(i.remind.atMs)}` : undefined} onOpen={() => tv.openTitle(i)} onBookmark={() => bm.toggle(i)} />
          ))}
        </Rail>
      )}

      {movies.items.length > 0 && (
        <Rail title="Top films this week">
          {movies.items.slice(0, 24).map((t) => (
            <PosterCard key={t.id} t={t} status={bm.status(t)} onOpen={() => tv.openTitle(t)} onBookmark={() => bm.toggle(t)} />
          ))}
          <MoreCard label="All films" onClick={() => tv.go({ n: 'movies' })} />
        </Rail>
      )}
      {shows.items.length > 0 && (
        <Rail title="Top series right now">
          {shows.items.slice(0, 24).map((t) => (
            <PosterCard key={t.id} t={t} status={bm.status(t)} onOpen={() => tv.openTitle(t)} onBookmark={() => bm.toggle(t)} />
          ))}
          <MoreCard label="All series" onClick={() => tv.go({ n: 'series' })} />
        </Rail>
      )}
    </div>
  )
}

function MoreCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex aspect-[2/3] w-[168px] shrink-0 flex-col items-center justify-center gap-2 rounded-[10px] bg-white/[0.05] text-white/70 hover:bg-white/[0.1] hover:text-white', focusRing)}>
      <Icon name="fwd" size={22} />
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  )
}

function AppTile({ s }: { s: Service }) {
  const tv = useTv()
  const on = tv.running.includes(s.id)
  return (
    <button type="button" onClick={() => tv.openApp(s)} className={cn('relative flex h-[84px] w-[224px] items-center gap-3.5 rounded-[14px] bg-white/[0.06] px-4 text-left transition-colors duration-100 hover:bg-white/[0.11]', focusRing)}>
      <Logo s={s} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{s.name}</span>
        <span className="flex items-center gap-1.5 truncate text-[12px] text-white/50">
          {on && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4cd37b]" />}
          {tv.loadingId === s.id ? 'Opening…' : on ? 'Open, resumes where you left off' : s.blurb}
        </span>
      </span>
    </button>
  )
}

/* ── movies / series ─────────────────────────────────────────────── */

export function Browse({ kind }: { kind: 'movie' | 'show' }) {
  const tv = useTv()
  const { items, loading, error, reload } = useBrowse(kind)
  const bm = useBookmark()
  const [genre, setGenre] = useState('All')
  const [sort, setSort] = useState<'popular' | 'az' | 'newest'>('popular')
  const genres = useMemo(() => ['All', ...Array.from(new Set(items.map((p) => p.genre).filter(Boolean)))], [items])
  const shown = useMemo(() => {
    const l = genre === 'All' ? items : items.filter((p) => p.genre === genre)
    if (sort === 'az') return [...l].sort((a, b) => a.title.localeCompare(b.title))
    if (sort === 'newest') return [...l].sort((a, b) => (b.year || '').localeCompare(a.year || ''))
    return l
  }, [items, genre, sort])
  useEffect(() => setGenre('All'), [kind])

  return (
    <div className="px-14 pb-16 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight">{kind === 'movie' ? 'Films' : 'Series'}</h1>
          <p className="text-[13.5px] text-white/50">{kind === 'movie' ? 'The most bought and rented films this week' : 'The most popular series right now'}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(
            [
              ['popular', 'Popular'],
              ['newest', 'Newest'],
              ['az', 'A to Z'],
            ] as const
          ).map(([k, l]) => (
            <Pill key={k} on={sort === k} onClick={() => setSort(k)}>
              {l}
            </Pill>
          ))}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {genres.map((g) => (
          <Pill key={g} on={genre === g} onClick={() => setGenre(g)}>
            {g}
          </Pill>
        ))}
      </div>
      {error && !items.length ? (
        <Empty title="Can’t load the catalogue" body={error} action={<Btn onClick={reload}>Try again</Btn>} />
      ) : loading && !items.length ? (
        <p className="pt-24 text-center text-[13.5px] text-white/45">Loading…</p>
      ) : (
        <div className="mt-7 grid gap-x-5 gap-y-7" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
          {shown.map((t) => (
            <PosterCard key={t.id} t={t} width={0} status={bm.status(t)} onOpen={() => tv.openTitle(t)} onBookmark={() => bm.toggle(t)} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── search ──────────────────────────────────────────────────────── */

export function SearchPage({ q }: { q: string }) {
  const tv = useTv()
  const bm = useBookmark()
  const [res, setRes] = useState<{ q: string; items: Title[]; error?: string } | null>(null)
  useEffect(() => {
    let live = true
    searchTitles(q).then(
      (items) => live && setRes({ q, items }),
      (e) => live && setRes({ q, items: [], error: typeof e === 'string' ? e : String((e as Error)?.message ?? e) }),
    )
    return () => {
      live = false
    }
  }, [q])
  const current = res?.q === q ? res : null
  const films = current?.items.filter((t) => t.kind === 'movie') ?? []
  const series = current?.items.filter((t) => t.kind === 'show') ?? []
  const apps = tv.searchable

  return (
    <div className="pb-16">
      <div className="px-14 pt-6">
        <h1 className="text-[28px] font-bold tracking-tight">Results for “{q}”</h1>
        {apps.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12.5px] text-white/45">Or search inside</span>
            {apps.map((s) => (
              <button key={s.id} type="button" onClick={() => tv.openApp(s, searchUrl(s, q))} className={cn('flex h-9 items-center gap-2 rounded-full bg-white/[0.08] pl-1.5 pr-3.5 text-[12.5px] font-medium text-white/85 hover:bg-white/[0.16]', focusRing)}>
                <Logo s={s} size={24} />
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {!current ? (
        <p className="pt-20 text-center text-[13.5px] text-white/45">Searching…</p>
      ) : current.error ? (
        <Empty title="Search isn’t available" body={current.error} />
      ) : !current.items.length ? (
        <Empty title="No films or series found" body="Try another spelling. You can also search inside one of your apps above." />
      ) : (
        <>
          {films.length > 0 && (
            <Rail title="Films">
              {films.map((t) => (
                <PosterCard key={t.id} t={t} status={bm.status(t)} onOpen={() => tv.openTitle(t)} onBookmark={() => bm.toggle(t)} />
              ))}
            </Rail>
          )}
          {series.length > 0 && (
            <Rail title="Series">
              {series.map((t) => (
                <PosterCard key={t.id} t={t} status={bm.status(t)} sub={searchName(t) !== t.title ? t.title.replace(searchName(t), '').replace(/^[,\s]+/, '') : t.genre} onOpen={() => tv.openTitle(t)} onBookmark={() => bm.toggle(t)} />
              ))}
            </Rail>
          )}
        </>
      )}
    </div>
  )
}

/* ── my list ─────────────────────────────────────────────────────── */

export function ListPage() {
  const tv = useTv()
  const { lib, ready } = useLibrary()
  const [tab, setTab] = useState<Status>('watching')
  const all = Object.values(lib.items)
  const counts: Record<Status, number> = { watching: 0, want: 0, watched: 0 }
  all.forEach((i) => counts[i.status]++)
  const shown = all.filter((i) => i.status === tab).sort((a, b) => b.updatedMs - a.updatedMs)
  const reminders = all.filter((i) => i.remind && i.remind.atMs > Date.now()).sort((a, b) => a.remind!.atMs - b.remind!.atMs)
  const tabs: Status[] = ['watching', 'want', 'watched']

  // A fresh list opens on whatever has something in it.
  useEffect(() => {
    if (!ready) return
    setTab((cur) => (counts[cur] ? cur : (tabs.find((s) => counts[s]) ?? cur)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div className="px-14 pb-16 pt-6">
      <h1 className="text-[32px] font-bold tracking-tight">My list</h1>
      <p className="text-[13.5px] text-white/50">What you’re watching, what’s next, and what you’ve finished</p>

      {reminders.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {reminders.slice(0, 4).map((i) => (
            <button key={keyOf(i)} type="button" onClick={() => tv.openTitle(i)} className={cn('flex h-9 items-center gap-2 rounded-full bg-white/[0.07] pl-3 pr-4 text-[12.5px] text-white/80 hover:bg-white/[0.13]', focusRing)}>
              <Icon name="bell" size={13} className="text-[var(--u-accent)]" />
              <span className="font-medium">{searchName(i)}</span>
              <span className="text-white/45">{fmtWhen(i.remind!.atMs)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 flex gap-2">
        {tabs.map((s) => (
          <Pill key={s} on={tab === s} onClick={() => setTab(s)}>
            {STATUS_LABEL[s]} <span className={cn('ml-1 tabular-nums', tab === s ? 'text-black/50' : 'text-white/40')}>{counts[s]}</span>
          </Pill>
        ))}
      </div>

      {!shown.length ? (
        <Empty
          title={tab === 'watching' ? 'Nothing in progress' : tab === 'want' ? 'Your list is empty' : 'Nothing finished yet'}
          body={tab === 'watching' ? 'When you start a film or series from here it shows up, and Continue watching on Home brings you back to it.' : tab === 'want' ? 'Press + on any poster to save it for later.' : 'Mark titles as watched and rate them on their page.'}
          action={
            <div className="flex gap-2">
              <Btn onClick={() => tv.go({ n: 'movies' })}>Browse films</Btn>
              <Btn onClick={() => tv.go({ n: 'series' })}>Browse series</Btn>
            </div>
          }
        />
      ) : (
        <div className="mt-7 grid gap-x-5 gap-y-7" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
          {shown.map((i) => (
            <PosterCard
              key={keyOf(i)}
              t={i}
              width={0}
              status={i.status}
              sub={i.status === 'watching' ? [i.progress, serviceById(i.service)?.name].filter(Boolean).join(' · ') || 'Watching' : i.status === 'watched' && i.stars ? '★'.repeat(i.stars) : i.remind ? `Reminder ${fmtWhen(i.remind.atMs)}` : undefined}
              onOpen={() => tv.openTitle(i)}
              onBookmark={() => (tvLib.remove(i), tv.say('Removed from your list'))}
              onPlay={i.status !== 'watched' ? () => tv.watch(serviceById(i.service) ?? tv.chosen, i) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── apps ────────────────────────────────────────────────────────── */

export function AppsPage() {
  const { lib } = useLibrary()
  const tv = useTv()
  const groups = [
    ['Video', 'Video'],
    ['Live', 'Live TV and streams'],
    ['Music', 'Music'],
  ] as const
  return (
    <div className="px-14 pb-16 pt-6">
      <h1 className="text-[32px] font-bold tracking-tight">Apps</h1>
      <p className="text-[13.5px] text-white/50">Add streaming apps to your TV. They open and play right inside it.</p>
      {groups.map(([g, label]) => (
        <section key={g} className="mt-8">
          <h2 className="text-[17px] font-semibold">{label}</h2>
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {CATALOG.filter((s) => s.category === g).map((s) => {
              const has = lib.installed.includes(s.id)
              return (
                <div key={s.id} className="flex items-center gap-4 rounded-[14px] bg-white/[0.05] p-4">
                  <Logo s={s} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15.5px] font-semibold">{s.name}</p>
                    <p className="truncate text-[12.5px] text-white/50">{s.blurb}</p>
                  </div>
                  {s.store && (
                    <button type="button" title="Get the official Windows app from the Microsoft Store" onClick={() => void launchApp(`ms-windows-store://pdp/?ProductId=${s.store}`)} className="h-9 rounded-full px-3 text-[12.5px] font-medium text-white/55 hover:bg-white/[0.08] hover:text-white">
                      Official app
                    </button>
                  )}
                  <button type="button" onClick={() => tvLib.toggleInstalled(s.id)} className={cn('h-9 rounded-full px-4 text-[13px] font-bold', focusRing, has ? 'bg-white/[0.1] text-white/70 hover:bg-white/[0.16]' : 'bg-white text-black hover:bg-white/90')}>
                    {has ? 'Remove' : 'Add'}
                  </button>
                  {has && (
                    <button type="button" aria-label={`Open ${s.name}`} onClick={() => tv.openApp(s)} className="h-9 rounded-full bg-[var(--u-accent)] px-4 text-[13px] font-bold text-white hover:brightness-110">
                      Open
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
