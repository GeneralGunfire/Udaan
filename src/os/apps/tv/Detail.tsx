import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { useTv } from './ctx'
import { addReminder, clearReminder, fmtWhen, lookupTitle, reminderOptions } from './data'
import { STATUS_LABEL, tvLib, useLibrary } from './library'
import { serviceById } from './services'
import { keyOf, searchName, type Status, type Title } from './types'
import { Btn, focusRing, Icon, Logo } from './ui'

const STATUSES: Status[] = ['want', 'watching', 'watched']

/** Next episode label: "S2 E5" becomes "S2 E6"; anything else starts at "S1 E1". */
function nextEpisode(p?: string) {
  const m = /^S(\d+)\s*E(\d+)$/i.exec((p ?? '').trim())
  return m ? `S${m[1]} E${Number(m[2]) + 1}` : 'S1 E1'
}

export function Detail({ seed, onBack }: { seed: Title; onBack: () => void }) {
  const tv = useTv()
  const { lib, ready } = useLibrary()
  const [t, setT] = useState<Title>(seed)
  const [trailer, setTrailer] = useState(false)
  const [trailerFailed, setTrailerFailed] = useState(false)
  const [remindOpen, setRemindOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const item = lib.items[keyOf(t)]

  // The catalogue lists a title with little detail; one lookup adds runtime, rating and the trailer.
  useEffect(() => {
    setT(seed)
    setTrailer(false)
    setTrailerFailed(false)
    setRemindOpen(false)
    if (seed.previewUrl && seed.runtimeMin) return
    let live = true
    void lookupTitle(seed.id).then(
      (full) => live && full && setT((cur) => ({ ...cur, ...full, summary: full.summary || cur.summary, genre: full.genre || cur.genre })),
      () => {},
    )
    return () => {
      live = false
    }
  }, [seed])

  // Esc closes the trailer first; the shell's Esc (back) only sees it when no trailer is open.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (trailer || remindOpen)) {
        e.stopPropagation()
        e.preventDefault()
        setTrailer(false)
        setRemindOpen(false)
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [trailer, remindOpen])

  const options = useMemo(() => reminderOptions(), [remindOpen])
  const where = serviceById(item?.service)
  const meta = [t.year, t.genre, t.runtimeMin ? `${Math.floor(t.runtimeMin / 60) ? `${Math.floor(t.runtimeMin / 60)}h ` : ''}${t.runtimeMin % 60}m` : '', t.rating].filter(Boolean)

  const setStatus = (s: Status) => tvLib.put(t, { status: s, ...(s === 'watched' ? {} : { stars: undefined }) })
  const remind = async (at: Date) => {
    if (busy) return
    setBusy(true)
    try {
      if (item?.remind) await clearReminder(item.remind)
      const r = await addReminder(t, where?.name ?? tv.chosen.name, at)
      tvLib.put(t, { remind: r })
      tv.say(`Reminder added to Calendar for ${fmtWhen(at.getTime())}`)
      setRemindOpen(false)
    } catch (e) {
      tv.say(`Couldn’t add the reminder: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBusy(false)
  }
  const unremind = async () => {
    if (!item?.remind) return
    await clearReminder(item.remind)
    tvLib.put(t, { remind: null })
    tv.say('Reminder removed')
  }

  return (
    <div className="relative min-h-full">
      <div aria-hidden className="absolute inset-x-0 top-0 h-[560px] overflow-hidden">
        <img src={t.imageHi || t.image} alt="" className="h-full w-full scale-110 object-cover blur-2xl brightness-[0.32]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-[#0c0d10]/70 to-transparent" />
      </div>

      <div className="relative px-14 pb-16 pt-6">
        <button type="button" onClick={onBack} className={cn('flex h-8 items-center gap-1 rounded-full pl-1.5 pr-3 text-[13px] text-white/65 hover:bg-white/[0.1] hover:text-white', focusRing)}>
          <Icon name="back" size={15} /> Back
        </button>

        <div className="mt-6 flex flex-wrap gap-12">
          <img src={t.imageHi || t.image} alt="" draggable={false} className="aspect-[2/3] w-[260px] shrink-0 self-start rounded-[12px] bg-white/[0.06] object-cover" />

          <div className="min-w-[320px] max-w-[760px] flex-1">
            {trailer && t.previewUrl && (
              <div className="mb-6 overflow-hidden rounded-[12px] bg-black">
                {trailerFailed ? (
                  <div className="flex aspect-video items-center justify-center px-6 text-center text-[13px] text-white/55">The trailer couldn’t be played here.</div>
                ) : (
                  <video src={t.previewUrl} controls autoPlay playsInline onError={() => setTrailerFailed(true)} className="aspect-video w-full" />
                )}
              </div>
            )}

            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/50">{t.kind === 'show' ? 'Series' : 'Film'}</p>
            <h1 className="mt-1.5 text-[44px] font-bold leading-[1.05] tracking-tight">{t.kind === 'show' ? searchName(t) : t.title}</h1>
            {t.kind === 'show' && searchName(t) !== t.title && <p className="mt-1 text-[16px] text-white/60">{t.title.replace(searchName(t), '').replace(/^[,\s]+/, '')}</p>}
            <p className="mt-3 text-[13.5px] text-white/55">{meta.join(' · ')}</p>
            <p className="mt-5 max-w-[680px] text-[15.5px] leading-[1.7] text-white/80">{t.summary || 'No description available.'}</p>

            {/* where to watch */}
            <div className="mt-7">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">Watch on</p>
              {tv.searchable.length ? (
                <div className="flex flex-wrap gap-2">
                  {tv.searchable.map((s, i) => (
                    <button key={s.id} type="button" onClick={() => tv.watch(s, t)} className={cn('flex h-11 items-center gap-2.5 rounded-full pl-1.5 pr-5 text-[14px] font-semibold transition-colors duration-100', focusRing, i === 0 ? 'bg-white text-black hover:bg-white/90' : 'bg-white/[0.1] hover:bg-white/[0.18]', tv.loadingId === s.id && 'opacity-60')}>
                      <Logo s={s} size={32} />
                      {tv.loadingId === s.id ? 'Opening…' : s.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[13.5px] text-white/50">Add a streaming app from Apps to watch this.</p>
              )}
              <p className="mt-2 text-[12px] text-white/40">Opens the app on a search for “{searchName(t)}”. Streaming apps don’t share their catalogue, so the title may not be on every one.</p>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              {t.previewUrl && (
                <Btn onClick={() => (setTrailerFailed(false), setTrailer((o) => !o))}>
                  <Icon name={trailer ? 'close' : 'video'} size={16} /> {trailer ? 'Close trailer' : 'Trailer'}
                </Btn>
              )}
              <div className="relative">
                <Btn onClick={() => setRemindOpen((o) => !o)} disabled={!ready}>
                  <Icon name="bell" size={16} /> Remind me
                </Btn>
                {remindOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onPointerDown={() => setRemindOpen(false)} />
                    <div className="absolute left-0 top-[46px] z-40 w-[290px] rounded-[14px] bg-[#1a1b20] p-2 ring-1 ring-white/10">
                      <p className="px-3 pb-1 pt-2 text-[11.5px] text-white/45">Adds an event to your Calendar</p>
                      {options.map((o) => (
                        <button key={o.label} type="button" disabled={busy} onClick={() => void remind(o.at)} className="flex w-full items-center justify-between rounded-[8px] px-3 py-2.5 text-left text-[13.5px] hover:bg-white/[0.08] disabled:opacity-50">
                          {o.label}
                          <span className="text-[12px] text-white/45">{fmtWhen(o.at.getTime())}</span>
                        </button>
                      ))}
                      <form
                        className="mt-1 flex items-center gap-2 border-t border-white/10 px-2 pb-1 pt-2.5"
                        onSubmit={(e) => {
                          e.preventDefault()
                          const d = new Date(custom)
                          if (custom && !Number.isNaN(d.getTime())) void remind(d)
                        }}
                      >
                        <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 min-w-0 flex-1 rounded-[8px] bg-white/[0.08] px-2 text-[12.5px] [color-scheme:dark] outline-none focus:ring-1 focus:ring-[var(--u-accent)]" />
                        <button type="submit" disabled={!custom || busy} className="h-8 rounded-[8px] bg-[var(--u-accent)] px-3 text-[12.5px] font-semibold disabled:opacity-40">
                          Set
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>
              {item?.remind && (
                <span className="flex h-10 items-center gap-2 rounded-full bg-white/[0.06] pl-4 pr-2 text-[12.5px] text-white/70">
                  <Icon name="clock" size={14} /> {fmtWhen(item.remind.atMs)}
                  <button type="button" aria-label="Remove reminder" title="Remove reminder" onClick={() => void unremind()} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/[0.14]">
                    <Icon name="close" size={11} />
                  </button>
                </span>
              )}
            </div>

            {/* my list */}
            <div className="mt-8 border-t border-white/[0.08] pt-6">
              <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">My list</p>
              {item ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {STATUSES.map((s) => (
                      <button key={s} type="button" aria-pressed={item.status === s} onClick={() => setStatus(s)} className={cn('h-9 rounded-full px-4 text-[13px] font-medium transition-colors duration-100', focusRing, item.status === s ? (s === 'watching' ? 'bg-[var(--u-accent)] text-white' : 'bg-white text-black') : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.15]')}>
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                    <button type="button" onClick={() => (tvLib.remove(t), tv.say('Removed from your list'))} className="ml-2 h-9 rounded-full px-3 text-[12.5px] text-white/50 hover:bg-white/[0.08] hover:text-white">
                      Remove
                    </button>
                  </div>
                  {item.status === 'watching' && (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <label className="flex items-center gap-2 text-[13px] text-white/60">
                        Progress
                        <input value={item.progress ?? ''} onChange={(e) => tvLib.put(t, { progress: e.target.value })} placeholder={t.kind === 'show' ? 'e.g. S2 E5' : 'e.g. 1h 10m in'} className="h-9 w-[170px] rounded-[10px] bg-white/[0.08] px-3 text-[13px] text-white outline-none placeholder:text-white/30 focus:ring-1 focus:ring-[var(--u-accent)]" />
                      </label>
                      {t.kind === 'show' && (
                        <button type="button" onClick={() => tvLib.put(t, { progress: nextEpisode(item.progress) })} className="h-9 rounded-full bg-white/[0.08] px-4 text-[12.5px] font-medium hover:bg-white/[0.15]">
                          Next episode
                        </button>
                      )}
                      {where && <span className="text-[12.5px] text-white/45">on {where.name}</span>}
                    </div>
                  )}
                  {item.status === 'watched' && (
                    <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
                      <span className="mr-2 text-[13px] text-white/60">Your rating</span>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={item.stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => tvLib.put(t, { stars: item.stars === n ? undefined : n })} className={cn('rounded-[6px] p-1 transition-colors', (item.stars ?? 0) >= n ? 'text-[#f5c542]' : 'text-white/25 hover:text-white/60')}>
                          <Icon name="star" size={22} className={(item.stars ?? 0) >= n ? 'fill-current' : ''} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Btn primary disabled={!ready} onClick={() => (tvLib.put(t), tv.say('Added to your list'))}>
                  <Icon name="plus" size={16} /> Add to my list
                </Btn>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
