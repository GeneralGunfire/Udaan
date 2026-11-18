import type { DailyBrief } from '@/integrations/daily-brief'
import { Button } from '@/os/ui/controls'
import { ArticleCard, HeroCard } from './cards'
import { I, Ico } from './parts'
import type { Article } from './types'

export interface BriefSection {
  title: string
  stories: Article[]
}

/**
 * TODAY: the written briefing as a front page. A lead story, then each section as a grid of cards, every one
 * with a picture or the Udaan News cover. The briefing is written once a day from the feeds (see
 * integrations/daily-brief); this only presents it. Click any story to read it.
 */
export function Briefing({
  brief,
  sections,
  written,
  label,
  isToday,
  working,
  readSet,
  savedSet,
  onRegenerate,
  onDates,
  onOpen,
  onSave,
  onListen,
}: {
  brief: DailyBrief | null | undefined
  sections: BriefSection[]
  written: boolean
  label: string
  isToday: boolean
  working: boolean
  readSet: Set<string>
  savedSet: Set<string>
  onRegenerate: () => void
  onDates: (e: React.MouseEvent) => void
  onOpen: (a: Article) => void
  onSave: (a: Article) => void
  onListen: () => void
}) {
  const all = sections.flatMap((s) => s.stories)
  const lead = all[0]
  const count = all.length

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-14 pt-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-(--u-ink-3)">{label}</p>
          <h1 className="mt-1 text-[30px] font-bold tracking-tight">{isToday ? 'Today’s briefing' : 'Briefing'}</h1>
          {count > 0 && <p className="mt-1 text-[13px] text-(--u-ink-3)">{count} stories{written ? ', written from this morning’s feeds' : ' from the feeds'}</p>}
        </div>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <Button variant="accent" onClick={onListen}>
              <Ico d={I.headphones} size={15} /> Listen
            </Button>
          )}
          <Button variant="tinted" onClick={onDates}>
            Other days <Ico d={I.down} size={12} />
          </Button>
          {isToday && (
            <Button variant="tinted" disabled={working} onClick={onRegenerate}>
              <Ico d={I.refresh} size={14} className={working ? 'news-spin' : ''} /> {working ? 'Writing…' : 'Rewrite'}
            </Button>
          )}
        </div>
      </header>

      {brief?.degraded && (
        <div className="mt-5 flex items-start gap-2.5 rounded-[10px] bg-[color-mix(in_srgb,#d9a13b_14%,transparent)] px-4 py-3 text-[12.5px] leading-relaxed text-(--u-ink-2)">
          <Ico d={I.warn} size={14} className="mt-0.5 text-[#d9a13b]" />
          <span>This briefing could not be written in full, so it shows the headlines. {brief.degraded_reason ?? ''} Press Rewrite to try again.</span>
        </div>
      )}

      {brief === undefined ? (
        <p className="pt-24 text-center text-[13.5px] text-(--u-ink-3)">Loading…</p>
      ) : count === 0 ? (
        <div className="mx-auto flex max-w-[420px] flex-col items-center gap-3 pt-24 text-center">
          <p className="text-[17px] font-semibold text-(--u-ink-2)">{working ? 'Writing the briefing…' : isToday ? 'Today’s briefing isn’t ready yet' : 'Nothing was saved for this day'}</p>
          <p className="text-[13.5px] leading-relaxed text-(--u-ink-3)">{working ? 'It reads this morning’s feeds and writes a short report. This takes a minute or two.' : isToday ? 'It is written automatically at 5am. You can write it now, or open Top for the latest stories.' : 'Pick another day.'}</p>
          {isToday && !working && (
            <Button variant="accent" onClick={onRegenerate}>
              Write it now
            </Button>
          )}
        </div>
      ) : (
        <>
          {lead && (
            <div className="mt-7">
              <HeroCard a={lead} read={readSet.has(lead.id)} saved={savedSet.has(lead.id)} onOpen={() => onOpen(lead)} onSave={() => onSave(lead)} />
            </div>
          )}
          {sections.map((sec) => {
            const list = sec.stories.filter((s) => s !== lead)
            return list.length ? (
              <section key={sec.title} className="mt-10">
                <h2 className="mb-3 text-[18px] font-semibold">{sec.title}</h2>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {list.map((a) => (
                    <ArticleCard key={a.id} a={a} read={readSet.has(a.id)} saved={savedSet.has(a.id)} onOpen={() => onOpen(a)} onSave={() => onSave(a)} />
                  ))}
                </div>
              </section>
            ) : null
          })}
        </>
      )}
    </div>
  )
}
