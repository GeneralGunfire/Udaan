import { useEffect, useRef, useState } from 'react'
import { launchApp } from '@/integrations/installed-apps/client'
import { fetchPage } from '@/integrations/omni-find/client'
import { chat } from '@/integrations/omniroute/client'
import { Markdown } from '@/features/chat/Markdown'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { audio } from './audio'
import { StoryImage } from './images'
import { ago, I, Ico } from './parts'
import { categoryLabel, type Article } from './types'

/* ── bookmark ────────────────────────────────────────────────────── */

function Bookmark({ saved, onSave, className }: { saved: boolean; onSave: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={saved ? 'Remove from saved' : 'Save for later'}
      title={saved ? 'Saved' : 'Save for later'}
      onClick={(e) => (e.stopPropagation(), onSave())}
      className={cn('absolute flex h-8 w-8 items-center justify-center rounded-full bg-black/60 transition-opacity duration-100 hover:bg-black/80 focus-visible:opacity-100', saved ? 'text-(--u-accent) opacity-100' : 'text-white opacity-0 group-hover:opacity-100', className)}
    >
      <Ico d={I.bookmark} size={15} className={saved ? 'fill-current' : ''} />
    </button>
  )
}

const meta = (a: Article) => (
  <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-(--u-ink-3)">
    <span className="truncate font-medium text-(--u-ink-2)">{a.source}</span>
    {a.publishedMs && <span className="shrink-0">· {ago(a.publishedMs)}</span>}
    {a.also && a.also.length > 0 && (
      <span className="truncate" title={a.also.map((x) => x.source).join(', ')}>
        · also {a.also[0].source}
        {a.also.length > 1 ? ` +${a.also.length - 1}` : ''}
      </span>
    )}
  </span>
)

/* ── cards ───────────────────────────────────────────────────────── */

export function HeroCard({ a, read, saved, onOpen, onSave }: { a: Article; read: boolean; saved: boolean; onOpen: () => void; onSave: () => void }) {
  return (
    <article data-article={a.id} className="group relative overflow-hidden rounded-[18px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
      <button type="button" onClick={onOpen} className="grid w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-(--u-accent) md:grid-cols-[1.45fr_1fr]">
        <StoryImage a={a} className="h-[260px] w-full md:h-[340px]" />
        <span className="flex min-w-0 flex-col justify-center gap-3 bg-(--u-wash-hover) p-7">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-(--u-accent)">{categoryLabel(a.category)}</span>
          <span className={cn('text-balance text-[26px] leading-[1.18] tracking-tight', read ? 'font-semibold text-(--u-ink-2)' : 'font-bold')}>{a.title}</span>
          {a.description && <span className="line-clamp-4 text-[14px] leading-relaxed text-(--u-ink-2)">{a.description}</span>}
          {meta(a)}
        </span>
      </button>
      <Bookmark saved={saved} onSave={onSave} className="right-3 top-3" />
    </article>
  )
}

export function ArticleCard({ a, read, saved, onOpen, onSave }: { a: Article; read: boolean; saved: boolean; onOpen: () => void; onSave: () => void }) {
  return (
    <article data-article={a.id} className="group relative flex flex-col overflow-hidden rounded-[14px] bg-(--u-wash-hover) shadow-[inset_0_0_0_1px_var(--u-edge)] transition-colors duration-100 hover:bg-(--u-wash-on)">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-(--u-accent)">
        <StoryImage a={a} className="aspect-[16/9] w-full" />
        <span className="flex flex-1 flex-col gap-1.5 p-4">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-(--u-accent)">{categoryLabel(a.category)}</span>
          <span className={cn('line-clamp-3 text-[15.5px] leading-snug', read ? 'font-medium text-(--u-ink-2)' : 'font-semibold')}>{a.title}</span>
          {a.description && <span className="line-clamp-3 text-[12.5px] leading-relaxed text-(--u-ink-3)">{a.description}</span>}
          <span className="mt-auto pt-2">{meta(a)}</span>
        </span>
      </button>
      <Bookmark saved={saved} onSave={onSave} className="right-2.5 top-2.5" />
    </article>
  )
}

/* ── reading ─────────────────────────────────────────────────────── */

const textCache = new Map<string, string>()

/**
 * A story, full page. Back (Esc) returns to the list exactly where it was; the arrows (or j / k, left / right)
 * move to the previous and next story in that list, and the foot of the page offers the next one, so you can
 * read straight down a section. The full article is loaded here; the feed's summary shows meanwhile.
 */
export function ReaderPage({
  a,
  index,
  total,
  next,
  saved,
  savedText,
  read,
  onSave,
  onClose,
  onPrev,
  onNext,
  onToggleRead,
  onText,
}: {
  a: Article
  index: number
  total: number
  next: Article | null
  saved: boolean
  savedText?: string
  read: boolean
  onSave: () => void
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onToggleRead: () => void
  onText: (t: string) => void
}) {
  const [text, setText] = useState<string | null>(savedText ?? textCache.get(a.id) ?? null)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [summary, setSummary] = useState('')
  const [summarising, setSummarising] = useState(false)
  const [sumError, setSumError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  useEffect(() => {
    abort.current?.abort()
    setSummary('')
    setSumError(null)
    setSummarising(false)
    const cached = savedText ?? textCache.get(a.id) ?? null
    setText(cached)
    setState('idle')
    scroller.current?.scrollTo({ top: 0 })
    if (cached || !a.link) return
    let live = true
    setState('loading')
    fetchPage(a.link).then(
      (p) => {
        if (!live) return
        const body = p.text.trim()
        // A page that gave back almost nothing (a paywall, a script-rendered site) is no better than the feed's summary.
        if (body.length < Math.max(300, a.description.length * 1.5)) return setState('failed')
        textCache.set(a.id, body)
        setText(body)
        setState('idle')
        onTextRef.current(body)
      },
      () => live && setState('failed'),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id])
  useEffect(() => () => abort.current?.abort(), [])

  const summarise = async () => {
    const source = text ?? a.description
    if (!source) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setSummarising(true)
    setSummary('')
    setSumError(null)
    let seen = ''
    try {
      const r = await chat(
        [
          { role: 'system', content: 'Summarise the news article in 3 to 4 short bullet points (start each with "- "). State facts only, in plain words, no opinion and no preamble.' },
          { role: 'user', content: `${a.title}\n\n${source.slice(0, 12_000)}` },
        ],
        ctl.signal,
        { temperature: 0.2, onDelta: (d) => setSummary((seen += d)) },
      )
      setSummary(r.content || seen)
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setSumError(e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not summarise.')
    }
    setSummarising(false)
  }

  const paras = (text ?? '').split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const openOriginal = () => a.link && void launchApp(a.link).catch(() => {})

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-(--u-m-solid)">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-(--u-edge) px-3">
        <Button size="sm" variant="ghost" onClick={onClose} title="Back to the list (Esc)">
          <Ico d={I.back} size={14} /> Back
        </Button>
        <span className="mx-1 h-4 w-px bg-(--u-edge)" />
        <Button icon size="sm" aria-label="Previous story" title="Previous story (k)" disabled={index <= 0} onClick={onPrev}>
          <Ico d={I.up} />
        </Button>
        <Button icon size="sm" aria-label="Next story" title="Next story (j)" disabled={index >= total - 1} onClick={onNext}>
          <Ico d={I.down} />
        </Button>
        <span className="ml-1 text-[12px] tabular-nums text-(--u-ink-3)">
          {index + 1} of {total}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onSave} className={cn(saved && 'text-(--u-accent)')} title="Save (s)">
          <Ico d={I.bookmark} size={14} className={saved ? 'fill-current' : ''} /> {saved ? 'Saved' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => audio.play([{ title: a.title, text: text ?? a.description }], a.source)} title="Read aloud">
          <Ico d={I.headphones} size={14} /> Listen
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void summarise()} disabled={summarising} title="A short AI summary">
          <Ico d={I.spark} size={14} /> {summarising ? 'Summarising…' : 'Summarise'}
        </Button>
        {a.link && (
          <Button icon size="sm" aria-label="Open the original" title="Open the original (o)" onClick={openOriginal}>
            <Ico d={I.ext} />
          </Button>
        )}
        <Button icon size="sm" aria-label={read ? 'Mark as unread' : 'Mark as read'} title={read ? 'Mark as unread (m)' : 'Mark as read (m)'} onClick={onToggleRead} className={cn(!read && 'text-(--u-accent)')}>
          <Ico d={I.check} />
        </Button>
      </header>

      <div ref={scroller} className="u-scroll min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-[720px] select-text px-6 pb-16 pt-8">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-(--u-accent)">{categoryLabel(a.category)}</p>
          <h1 className="mt-2 text-balance text-[34px] font-bold leading-[1.14] tracking-tight">{a.title}</h1>
          <p className="mt-3 text-[13px] text-(--u-ink-3)">
            <span className="font-medium text-(--u-ink-2)">{a.source}</span>
            {a.publishedMs ? ` · ${new Date(a.publishedMs).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}` : ''}
          </p>
          <StoryImage a={a} className="mt-6 aspect-[16/9] w-full rounded-[14px]" />

          {(summary || sumError) && (
            <div className="mt-6 rounded-[12px] bg-(--u-wash-hover) px-5 py-4 shadow-[inset_0_0_0_1px_var(--u-edge)]">
              <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-(--u-ink-3)">
                <Ico d={I.spark} size={12} /> Summary
              </p>
              {sumError ? <p className="text-[12.5px] text-(--u-danger)">{sumError}</p> : <Markdown text={summary} />}
            </div>
          )}

          <div className="mt-7 text-[17px] leading-[1.8] text-(--u-ink)">
            {paras.length > 0 ? paras.map((p, i) => <p key={i} className="mb-5">{p}</p>) : <p className="mb-5 text-(--u-ink-2)">{a.description || 'No preview was provided for this story.'}</p>}
            {state === 'loading' && <p className="text-[13px] text-(--u-ink-3)">Loading the full article…</p>}
            {state === 'failed' && <p className="rounded-[10px] bg-(--u-wash-hover) px-4 py-3 text-[13px] leading-relaxed text-(--u-ink-3)">The full article can’t be shown here (a paywall, or a page that needs scripts). Open the original to read all of it.</p>}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {a.link && (
              <Button variant="tinted" onClick={openOriginal}>
                <Ico d={I.ext} size={14} /> Open the original
              </Button>
            )}
            {a.also && a.also.length > 0 && <span className="ml-2 text-[12px] text-(--u-ink-3)">Also reported by</span>}
            {a.also?.map((x) => (
              <button key={x.source} type="button" onClick={() => x.link && void launchApp(x.link).catch(() => {})} className="rounded-full px-3 py-1 text-[12px] text-(--u-ink-2) shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
                {x.source}
              </button>
            ))}
          </div>

          {next && (
            <button type="button" onClick={onNext} className="group mt-12 flex w-full items-center gap-4 rounded-[14px] bg-(--u-wash-hover) p-3 text-left shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-on)">
              <StoryImage a={next} className="h-[72px] w-[128px] shrink-0 rounded-[8px]" />
              <span className="min-w-0 flex-1">
                <span className="text-[11px] font-semibold text-(--u-ink-3)">Next story</span>
                <span className="mt-0.5 line-clamp-2 block text-[15px] font-semibold leading-snug">{next.title}</span>
              </span>
              <Ico d={I.down} size={18} className="mr-2 -rotate-90 text-(--u-ink-3)" />
            </button>
          )}
        </article>
      </div>
    </div>
  )
}
