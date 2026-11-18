import { useState, type ReactNode } from 'react'
import { Button, Segmented, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { audio, useAudio } from './audio'
import { discoverFeed, type Failure } from './feeds'
import { CATEGORIES, type Feed } from './types'

/* ── icons ───────────────────────────────────────────────────────── */

export function Ico({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', className)} aria-hidden>
      <path d={d} />
    </svg>
  )
}
export const I = {
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14 14',
  close: 'M4 4l8 8M12 4l-8 8',
  plus: 'M8 3v10M3 8h10',
  bookmark: 'M4.5 2.5h7v11L8 11l-3.5 2.5z',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3',
  headphones: 'M2.5 10V8a5.5 5.5 0 0 1 11 0v2M2.5 10h2v3.5h-2zM11.5 10h2v3.5h-2z',
  play: 'M5 3.5v9l7-4.5z',
  pause: 'M5 3.5v9M11 3.5v9',
  next: 'M4 3.5v9l6-4.5zM12 3.5v9',
  prev: 'M12 3.5v9L6 8zM4 3.5v9',
  ext: 'M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v4H2.5V4H6.5',
  link: 'M6.5 9.5l3-3M7 4.5l.8-.8a2.5 2.5 0 0 1 3.5 3.5l-.8.8M9 11.5l-.8.8a2.5 2.5 0 0 1-3.5-3.5l.8-.8',
  spark: 'M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  warn: 'M8 2.5 14 13H2zM8 6.5v3M8 11.2h.01',
  rss: 'M3 3.5a9.5 9.5 0 0 1 9.5 9.5M3 7.5A5.5 5.5 0 0 1 8.5 13M3.5 12.8h.01',
  down: 'M4 6l4 4 4-4',
  up: 'M4 10l4-4 4 4',
  back: 'M10 3.5 5.5 8l4.5 4.5',
  gear: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1',
}

/* ── formatting ──────────────────────────────────────────────────── */

export function ago(ms: number | null): string {
  if (!ms) return ''
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  if (m < 60 * 24) return `${Math.round(m / 60)}h`
  const d = Math.round(m / 1440)
  return d < 7 ? `${d}d` : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function Picture({ src, className }: { src: string | null; className?: string }) {
  const [bad, setBad] = useState(false)
  if (!src || bad) return null
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} className={cn('object-cover', className)} />
}

/* ── listening bar ───────────────────────────────────────────────── */

export function AudioBar() {
  const a = useAudio()
  if (!a.active) return null
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-t border-(--u-edge) bg-(--u-m-solid-hi) px-4">
      <Ico d={I.headphones} size={18} className="text-(--u-accent)" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{a.title}</p>
        <p className="truncate text-[11.5px] text-(--u-ink-3)">
          {a.label} · {a.index + 1} of {a.total}
        </p>
      </div>
      <Button icon size="sm" aria-label="Previous story" onClick={audio.prev}>
        <Ico d={I.prev} />
      </Button>
      <Button icon size="sm" variant="accent" aria-label={a.playing ? 'Pause' : 'Play'} onClick={audio.toggle}>
        <Ico d={a.playing ? I.pause : I.play} />
      </Button>
      <Button icon size="sm" aria-label="Next story" onClick={audio.next}>
        <Ico d={I.next} />
      </Button>
      <Segmented value={String(a.rate)} onChange={(v) => audio.setRate(Number(v))} options={[{ value: '1', label: '1×' }, { value: '1.25', label: '1.25×' }, { value: '1.5', label: '1.5×' }]} />
      <Button icon size="sm" aria-label="Stop listening" onClick={audio.stop}>
        <Ico d={I.close} />
      </Button>
    </div>
  )
}

/* ── managing sources ────────────────────────────────────────────── */

export function SourcesView({ feeds, failures, onToggle, onAdd, onCategory }: { feeds: (Feed & { enabled: boolean })[]; failures: Failure[]; onToggle: (f: Feed) => void; onAdd: (f: Feed) => void; onCategory: (url: string, cat: string) => void }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ url: string; name: string; count: number } | null>(null)
  const [cat, setCat] = useState('general')
  const [error, setError] = useState<string | null>(null)
  const failed = new Map(failures.map((f) => [f.url, f.reason]))

  const find = async () => {
    if (!input.trim() || busy) return
    setBusy(true)
    setError(null)
    setFound(null)
    try {
      const f = await discoverFeed(input)
      if (feeds.some((x) => x.url === f.url)) throw new Error('You already have that source.')
      setFound(f)
    } catch (e) {
      setError(e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not add that.')
    }
    setBusy(false)
  }

  const group = (id: string, label: string, list: (Feed & { enabled: boolean })[]): ReactNode =>
    list.length ? (
      <section key={id} className="mt-7">
        <h3 className="mb-2 px-1 text-[12px] font-semibold text-(--u-ink-3)">{label}</h3>
        <div className="flex flex-col">
          {list.map((f) => (
            <div key={f.url} className="flex items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-(--u-wash-hover)">
              {f.builtin ? <Switch checked={f.enabled} onChange={() => onToggle(f)} label={`${f.name} on or off`} /> : <Ico d={I.rss} size={16} className="mx-[11px] text-(--u-accent)" />}
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-[13px] font-medium', !f.enabled && 'text-(--u-ink-3)')}>{f.name}</p>
                <p className="truncate text-[11.5px] text-(--u-ink-3)" title={f.url}>
                  {f.url.replace(/^https?:\/\//, '')}
                </p>
              </div>
              {failed.has(f.url) && f.enabled && (
                <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-[#d9a13b]" title={failed.get(f.url)}>
                  <Ico d={I.warn} size={13} /> Didn’t load
                </span>
              )}
              {!f.builtin && (
                <>
                  <select value={f.category} onChange={(e) => onCategory(f.url, e.target.value)} className="h-7 rounded-[6px] bg-(--u-wash-hover) px-2 text-[12px] outline-none" aria-label="Category">
                    {CATEGORIES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => onToggle(f)} className="hover:text-(--u-danger)">
                    Remove
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    ) : null

  const custom = feeds.filter((f) => !f.builtin)
  return (
    <div className="u-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 pb-14 pt-8">
        <h1 className="text-[28px] font-bold tracking-tight">Sources</h1>
        <p className="mt-1 text-[13.5px] text-(--u-ink-3)">Choose where your news comes from. Add any site: paste its address and News finds the feed.</p>

        <form
          className="mt-6 rounded-[14px] bg-(--u-wash-hover) p-4 shadow-[inset_0_0_0_1px_var(--u-edge)]"
          onSubmit={(e) => {
            e.preventDefault()
            void find()
          }}
        >
          <p className="mb-2 text-[13px] font-semibold">Add a source</p>
          <div className="flex gap-2">
            <input value={input} onChange={(e) => (setInput(e.target.value), setFound(null), setError(null))} placeholder="Website or feed address, e.g. dailymaverick.co.za" spellCheck={false} className="u-field h-9 min-w-0 flex-1" />
            <Button type="submit" variant="tinted" disabled={!input.trim() || busy}>
              {busy ? 'Looking…' : 'Find feed'}
            </Button>
          </div>
          {error && <p className="mt-2 text-[12.5px] text-(--u-danger)">{error}</p>}
          {found && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] bg-(--u-m-solid) px-3.5 py-3">
              <Ico d={I.rss} size={16} className="text-(--u-accent)" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{found.name}</p>
                <p className="text-[11.5px] text-(--u-ink-3)">{found.count} recent stories</p>
              </div>
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-8 rounded-[8px] bg-(--u-wash-hover) px-2 text-[12.5px] outline-none" aria-label="Category">
                {CATEGORIES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <Button
                variant="accent"
                onClick={() => {
                  onAdd({ url: found.url, name: found.name, category: cat, builtin: false })
                  setFound(null)
                  setInput('')
                }}
              >
                Add
              </Button>
            </div>
          )}
        </form>

        {group('custom', 'Your sources', custom)}
        {CATEGORIES.map(([id, label]) => group(id, label, feeds.filter((f) => f.builtin && f.category === id)))}
      </div>
    </div>
  )
}
