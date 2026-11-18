import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { launchApp } from '@/integrations/installed-apps/client'
import { CiteContext, Markdown } from '@/features/chat/Markdown'
import { Button, Segmented, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { MODES, citedSources, domainOf, faviconOf, isStale, type Angle, type Claim, type Mode, type Session, type Settings, type Source, type Turn } from './model'

/* ── tiny icon set ───────────────────────────────────────────────── */

export function Ico({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', className)} aria-hidden>
      <path d={d} />
    </svg>
  )
}
export const I = {
  plus: 'M8 3v10M3 8h10',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14 14',
  send: 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
  stop: 'M4.5 4.5h7v7h-7z',
  close: 'M4 4l8 8M12 4l-8 8',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  down: 'M4 6l4 4 4-4',
  right: 'M6 4l4 4-4 4',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  x: 'M5 5l6 6M11 5l-6 6',
  warn: 'M8 2.5 14 13H2zM8 6.5v3M8 11.2h.01',
  link: 'M6.5 9.5l3-3M7 4.5l.8-.8a2.5 2.5 0 0 1 3.5 3.5l-.8.8M9 11.5l-.8.8a2.5 2.5 0 0 1-3.5-3.5l.8-.8',
  sidebar: 'M2.5 3h11v10h-11zM10 3v10',
  gear: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1',
  pin: 'M6 2.5h4l-.5 4 2 2v1.5h-7V8.5l2-2zM8 10v3.5',
  retry: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3',
  note: 'M3 2.5h10v11H3zM5.5 6h5M5.5 8.5h5M5.5 11h3',
  save: 'M3 2.5h8l2 2v9H3zM5.5 2.5v3.5h4V2.5M5.5 13.5v-4h5v4',
}

/* ── dialog ──────────────────────────────────────────────────────── */

export function Sheet({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-6" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full flex-col overflow-hidden rounded-[14px] bg-(--u-m-solid) shadow-[inset_0_0_0_1px_var(--u-edge)]" style={{ width, maxWidth: '100%' }}>
        <header className="flex items-center justify-between border-b border-(--u-edge) px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button icon size="sm" aria-label="Close" onClick={onClose}>
            <Ico d={I.close} />
          </Button>
        </header>
        <div className="u-scroll min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function SettingsDialog({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const field = (label: string, hint: string, key: 'braveKey' | 'tavilyKey') => (
    <label className="flex flex-col gap-1.5 text-[12.5px]">
      <span className="font-medium">{label}</span>
      <input type="password" value={settings[key]} onChange={(e) => onChange({ ...settings, [key]: e.target.value.trim() })} placeholder="Paste a key (optional)" className="u-field h-9" spellCheck={false} autoComplete="off" />
      <span className="text-[11.5px] text-(--u-ink-3)">{hint}</span>
    </label>
  )
  return (
    <Sheet title="Search settings" onClose={onClose}>
      <div className="flex flex-col gap-5 p-5">
        <p className="text-[12.5px] leading-relaxed text-(--u-ink-3)">OmniFind always searches DuckDuckGo and Wikipedia for free. A key adds a search engine built for research, which usually finds better sources. Keys stay on this PC and are never saved inside a research session.</p>
        {field('Brave Search key', 'Free tier at brave.com/search/api', 'braveKey')}
        {field('Tavily key', 'Free tier at tavily.com', 'tavilyKey')}
      </div>
    </Sheet>
  )
}

/* ── composer ────────────────────────────────────────────────────── */

export function Composer({ onSend, onStop, busy, placeholder, big, extras, autoFocus, seed }: { onSend: (text: string) => void; onStop?: () => void; busy: boolean; placeholder: string; big?: boolean; extras?: ReactNode; autoFocus?: boolean; seed?: { text: string; n: number } }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  // An example the user clicked: put it in the box to edit, not straight into a run.
  useEffect(() => {
    if (!seed?.n) return
    setText(seed.text)
    ref.current?.focus()
  }, [seed])
  const submit = () => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    onSend(t)
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-[18px] bg-(--u-wash-hover) p-2.5 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
      <textarea
        ref={ref}
        value={text}
        rows={big ? 3 : 1}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), submit())
        }}
        className={cn('w-full resize-none bg-transparent px-2 py-1 leading-relaxed outline-none placeholder:text-(--u-ink-3) [field-sizing:content]', big ? 'max-h-[240px] min-h-[72px] text-[16px]' : 'max-h-[160px] min-h-[24px] text-[14px]')}
      />
      <div className="flex items-center gap-2">
        {extras}
        <span className="flex-1" />
        {busy ? (
          <Button icon size="sm" variant="tinted" aria-label="Stop" title="Stop (Esc)" onClick={onStop}>
            <Ico d={I.stop} />
          </Button>
        ) : (
          <Button icon size="sm" variant="accent" aria-label="Start" disabled={!text.trim()} onClick={submit}>
            <Ico d={I.send} />
          </Button>
        )}
      </div>
    </div>
  )
}

export function ModeBar({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
      <Segmented<Mode>
        value={settings.mode}
        onChange={(m) => onChange({ ...settings, mode: m, factCheck: MODES[m].check })}
        options={(Object.keys(MODES) as Mode[]).map((m) => ({ value: m, label: MODES[m].label }))}
      />
      <label className="flex items-center gap-2 text-(--u-ink-2)" title="Pause after planning so you can change the angles">
        <Switch checked={settings.reviewPlan} onChange={(v) => onChange({ ...settings, reviewPlan: v })} label="Review plan first" /> Review plan first
      </label>
      <label className="flex items-center gap-2 text-(--u-ink-2)" title="Check every claim in the report against the sources, quoting the evidence">
        <Switch checked={settings.factCheck} onChange={(v) => onChange({ ...settings, factCheck: v })} label="Fact-check" /> Fact-check
      </label>
    </div>
  )
}

/* ── plan editor ─────────────────────────────────────────────────── */

export function PlanReview({ angles, onStart, onCancel }: { angles: Angle[]; onStart: (a: Angle[]) => void; onCancel: () => void }) {
  const [list, setList] = useState(angles)
  const set = (i: number, patch: Partial<Angle>) => setList((l) => l.map((a, k) => (k === i ? { ...a, ...patch } : a)))
  const valid = list.filter((a) => a.text.trim() && a.query.trim())
  return (
    <div className="rounded-[14px] bg-(--u-wash-hover) p-4 shadow-[inset_0_0_0_1px_var(--u-edge)]">
      <p className="text-[13.5px] font-semibold">Here is the plan</p>
      <p className="mb-3 mt-0.5 text-[12.5px] text-(--u-ink-3)">Each angle is searched on its own. Edit the wording, remove what you don’t need, or add your own.</p>
      <div className="flex flex-col gap-2.5">
        {list.map((a, i) => (
          <div key={a.id} className="flex items-start gap-2 rounded-[10px] bg-(--u-m-solid) p-3">
            <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--u-wash-on) text-[11px] tabular-nums text-(--u-ink-2)">{i + 1}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <input value={a.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="What to find out" className="u-field h-8 text-[13px]" />
              <input value={a.query} onChange={(e) => set(i, { query: e.target.value })} placeholder="Search words" className="u-field h-7 font-mono text-[12px] text-(--u-ink-2)" spellCheck={false} />
            </div>
            <button type="button" aria-label="Remove angle" disabled={list.length < 2} onClick={() => setList((l) => l.filter((_, k) => k !== i))} className="mt-1 rounded-[6px] p-1 text-(--u-ink-3) enabled:hover:bg-(--u-wash-hover) enabled:hover:text-(--u-danger) disabled:opacity-30">
              <Ico d={I.close} size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="tinted" disabled={list.length >= 8} onClick={() => setList((l) => [...l, { id: `a${l.length}-${Math.random().toString(36).slice(2, 6)}`, text: '', query: '', status: 'pending', read: 0 }])}>
          <Ico d={I.plus} size={13} /> Add angle
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="tinted" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="accent" disabled={!valid.length} onClick={() => onStart(valid)}>
          Start research
        </Button>
      </div>
    </div>
  )
}

/* ── one turn ────────────────────────────────────────────────────── */

export interface TurnActions {
  onCite: (turn: Turn, n: number) => void
  onFocusSource: (turn: Turn, sourceId: string) => void
  onFollow: (q: string) => void
  onRetry: (turn: Turn) => void
  onRedraft: (turn: Turn) => void
  onCopy: (turn: Turn) => void
  onExport: () => void
  onNotes: (turn: Turn) => void
  onReview: { angles: Angle[]; start: (a: Angle[]) => void; cancel: () => void } | null
}

const ago = (a: number, b: number) => {
  const s = Math.max(1, Math.round((b - a) / 1000))
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`
}

export function TurnView({ session, turn, live, busyAny, act }: { session: Session; turn: Turn; live: boolean; busyAny: boolean; act: TurnActions }) {
  const sources = useMemo(() => citedSources(session, turn), [session, turn])
  const [process, setProcess] = useState<boolean | null>(null)
  const [claimsOpen, setClaimsOpen] = useState(false)
  const processOpen = process ?? (live || turn.phase === 'failed')
  const stale = isStale(session, turn)
  const running = ['planning', 'searching', 'reading', 'drafting', 'verifying'].includes(turn.phase)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold leading-snug tracking-tight">{turn.question}</h2>

      {turn.angles.length > 0 || running ? (
        <div>
          <button type="button" onClick={() => setProcess(!processOpen)} className="flex items-center gap-2 rounded-[8px] py-1 pr-2 text-[12.5px] text-(--u-ink-2) hover:text-(--u-ink)">
            <Ico d={processOpen ? I.down : I.right} size={13} />
            {running ? (
              <span className="flex items-center gap-2">
                <span className="research-spin h-3 w-3 rounded-full border-[1.5px] border-(--u-wash-press) border-t-(--u-accent)" />
                {turn.status}
              </span>
            ) : (
              <span>{`Researched ${turn.angles.length} angle${turn.angles.length === 1 ? '' : 's'} · ${sources.length} source${sources.length === 1 ? '' : 's'}${turn.finishedMs ? ` · ${ago(turn.createdMs, turn.finishedMs)}` : ''}`}</span>
            )}
          </button>
          {processOpen && turn.phase !== 'review' && (
            <ol className="ml-1.5 mt-1 flex flex-col gap-1.5 border-l border-(--u-edge) pl-4">
              {turn.angles.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className="mt-[3px] shrink-0">
                    {a.status === 'done' ? <Ico d={I.check} size={12} className="text-(--u-ok)" /> : a.status === 'failed' ? <Ico d={I.x} size={12} className="text-(--u-danger)" /> : a.status === 'pending' ? <span className="mx-1 block h-1.5 w-1.5 rounded-full bg-(--u-wash-press)" /> : <span className="research-spin block h-3 w-3 rounded-full border-[1.5px] border-(--u-wash-press) border-t-(--u-accent)" />}
                  </span>
                  <span className="min-w-0">
                    <span className="text-(--u-ink)">{a.text}</span>
                    <span className="block font-mono text-[11.5px] text-(--u-ink-3)">{a.query}</span>
                    {a.note && <span className="block text-[11.5px] text-(--u-ink-3)">{a.note}</span>}
                  </span>
                  {a.read > 0 && <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-(--u-ink-3)">{a.read} read</span>}
                </li>
              ))}
              {turn.kind === 'followup' && !turn.searchedMore && <li className="text-[12.5px] text-(--u-ink-3)">Answered from sources already read. No new search.</li>}
            </ol>
          )}
        </div>
      ) : null}

      {turn.phase === 'review' && act.onReview && <PlanReview angles={act.onReview.angles} onStart={act.onReview.start} onCancel={act.onReview.cancel} />}

      {(turn.report || turn.phase === 'drafting') && (
        <div className="select-text">
          <CiteContext.Provider
            value={{
              info: (n) => {
                const s = sources[n - 1]
                return s ? { ok: true, title: s.title || domainOf(s.url), url: s.url } : { ok: false }
              },
              onCite: (n) => act.onCite(turn, n),
            }}
          >
            {turn.report ? <Markdown text={turn.report} /> : <p className="text-[13px] text-(--u-ink-3)">Writing…</p>}
          </CiteContext.Provider>
          {turn.phase === 'drafting' && <span className="research-caret mt-1 inline-block h-[1.05em] w-[7px] rounded-[1px] bg-(--u-accent)" />}
        </div>
      )}

      {turn.error && (
        <div className="flex items-center gap-3 rounded-[10px] bg-[color-mix(in_srgb,var(--u-danger)_12%,transparent)] px-3.5 py-2.5 text-[12.5px]">
          <span className="min-w-0 flex-1 text-(--u-ink-2)">
            <span className="font-medium text-(--u-danger)">Couldn’t finish. </span>
            {turn.error}
          </span>
          {!busyAny && (
            <Button size="sm" variant="tinted" onClick={() => act.onRetry(turn)}>
              <Ico d={I.retry} size={13} /> Try again
            </Button>
          )}
        </div>
      )}
      {turn.phase === 'cancelled' && <p className="text-[12.5px] text-(--u-ink-3)">Stopped.</p>}

      {turn.phase === 'done' && (
        <>
          {turn.brokenCites.length > 0 && (
            <div className="flex items-center gap-2 rounded-[10px] bg-[color-mix(in_srgb,#d9a13b_14%,transparent)] px-3.5 py-2 text-[12.5px] text-(--u-ink-2)">
              <Ico d={I.warn} size={14} className="text-[#d9a13b]" />
              {turn.brokenCites.length === 1 ? `Citation [${turn.brokenCites[0]}] points at no source.` : `Citations ${turn.brokenCites.map((n) => `[${n}]`).join(', ')} point at no source.`} They are marked in red. Don’t rely on those sentences.
            </div>
          )}
          {stale && (
            <div className="flex items-center gap-3 rounded-[10px] bg-(--u-wash-hover) px-3.5 py-2.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
              <span className="flex-1 text-(--u-ink-2)">The sources changed since this report was written.</span>
              <Button size="sm" variant="accent" disabled={busyAny} onClick={() => act.onRedraft(turn)}>
                Rewrite report
              </Button>
            </div>
          )}
          {turn.factChecked && turn.claims.length > 0 && <ClaimsBar turn={turn} sources={sources} open={claimsOpen} onToggle={() => setClaimsOpen((o) => !o)} onSource={(id) => act.onFocusSource(turn, id)} />}
          {turn.factChecked && turn.claims.length === 0 && <p className="text-[12.5px] text-(--u-ink-3)">{turn.status.includes('could not run') ? 'The fact-check could not run this time.' : 'No checkable claims were found.'}</p>}

          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="tinted" onClick={() => act.onCopy(turn)}>
              <Ico d={I.copy} size={13} /> Copy
            </Button>
            <Button size="sm" variant="tinted" onClick={() => act.onNotes(turn)}>
              <Ico d={I.note} size={13} /> Save to Notes
            </Button>
            <Button size="sm" variant="tinted" onClick={act.onExport}>
              <Ico d={I.save} size={13} /> Export
            </Button>
            <Button size="sm" variant="tinted" disabled={busyAny} onClick={() => act.onRetry(turn)} title="Research this question again from scratch">
              <Ico d={I.retry} size={13} /> Redo
            </Button>
          </div>

          {turn.suggestions && turn.suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1">
              <p className="text-[11.5px] font-semibold text-(--u-ink-3)">Keep going</p>
              <div className="flex flex-wrap gap-2">
                {turn.suggestions.map((q) => (
                  <button key={q} type="button" disabled={busyAny} onClick={() => act.onFollow(q)} className="rounded-full px-3.5 py-1.5 text-left text-[12.5px] text-(--u-ink-2) shadow-[inset_0_0_0_1px_var(--u-edge)] enabled:hover:bg-(--u-wash-hover) enabled:hover:text-(--u-ink) disabled:opacity-50">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/* ── claim check ─────────────────────────────────────────────────── */

const VERDICT = {
  supported: { label: 'Supported', color: 'var(--u-ok)' },
  unsupported: { label: 'Not supported', color: '#d9a13b' },
  contradicted: { label: 'Contradicted', color: 'var(--u-danger)' },
} as const

function ClaimsBar({ turn, sources, open, onToggle, onSource }: { turn: Turn; sources: Source[]; open: boolean; onToggle: () => void; onSource: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'flagged'>('flagged')
  const total = turn.claims.length
  const count = (v: Claim['verdict']) => turn.claims.filter((c) => c.verdict === v).length
  const flagged = total - count('supported')
  const list = filter === 'all' ? turn.claims : turn.claims.filter((c) => c.verdict !== 'supported')
  return (
    <div className="rounded-[12px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">
            {flagged === 0 ? `All ${total} claims are backed by the sources` : `${count('supported')} of ${total} claims are backed by the sources`}
          </span>
          <span className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-(--u-wash-press)">
            {(['supported', 'unsupported', 'contradicted'] as const).map((v) => count(v) > 0 && <span key={v} style={{ width: `${(count(v) / total) * 100}%`, background: VERDICT[v].color }} />)}
          </span>
        </span>
        <span className="flex shrink-0 gap-3 text-[12px] text-(--u-ink-3)">
          {(['supported', 'unsupported', 'contradicted'] as const).map((v) => count(v) > 0 && (
            <span key={v} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: VERDICT[v].color }} />
              {count(v)}
            </span>
          ))}
        </span>
        <Ico d={open ? I.down : I.right} size={13} className="text-(--u-ink-3)" />
      </button>
      {open && (
        <div className="border-t border-(--u-edge) px-4 pb-3 pt-2.5">
          <div className="mb-2 flex gap-1.5">
            {(['flagged', 'all'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cn('h-7 rounded-full px-3 text-[12px]', filter === f ? 'bg-(--u-wash-on) font-medium' : 'text-(--u-ink-3) hover:bg-(--u-wash-hover)')}>
                {f === 'flagged' ? `Needs a look (${flagged})` : `All (${total})`}
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="py-3 text-center text-[12.5px] text-(--u-ink-3)">Nothing flagged.</p>}
          <ul className="flex flex-col gap-2.5">
            {list.map((c) => {
              const v = VERDICT[c.verdict]
              return (
                <li key={c.id} className="flex gap-2.5 text-[12.5px] leading-relaxed">
                  <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: v.color }} title={v.label} />
                  <div className="min-w-0 flex-1">
                    <p className="text-(--u-ink)">{c.text}</p>
                    {c.quote && c.quoteFound && (
                      <p className="mt-1 border-l-2 pl-2.5 text-[12px] italic text-(--u-ink-2)" style={{ borderColor: v.color }}>
                        “{c.quote}”
                        <span className="ml-1.5 not-italic text-(--u-ok)" title="These exact words were found in the source text">✓ found in source</span>
                      </p>
                    )}
                    {c.reasoning && <p className="mt-0.5 text-[12px] text-(--u-ink-3)">{c.reasoning}</p>}
                    {c.sources.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {c.sources.map((id) => {
                          const i = sources.findIndex((s) => s.id === id)
                          return i < 0 ? null : (
                            <button key={id} type="button" onClick={() => onSource(id)} className="rounded-full px-2 py-0.5 text-[11px] text-(--u-ink-2) shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-hover)">
                              [{i + 1}] {domainOf(sources[i].url)}
                            </button>
                          )
                        })}
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── sources panel ───────────────────────────────────────────────── */

export function SourcesDrawer({
  session,
  turn,
  focus,
  onToggle,
  onAddUrl,
  onCiteMore,
  onClose,
  busy,
}: {
  session: Session
  turn: Turn | null
  focus: string | null
  onToggle: (id: string) => void
  onAddUrl: (url: string) => Promise<void>
  onCiteMore: (id: string) => void
  onClose: () => void
  busy: boolean
}) {
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cited = turn ? citedSources(session, turn) : []
  const others = session.sources.filter((s) => !cited.some((c) => c.id === s.id))
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (focus) refs.current[focus]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus])

  const card = (s: Source, n?: number) => (
    <div key={s.id} ref={(el) => void (refs.current[s.id] = el)} className={cn('rounded-[10px] p-3 transition-shadow', focus === s.id ? 'shadow-[inset_0_0_0_1.5px_var(--u-accent)]' : 'shadow-[inset_0_0_0_1px_var(--u-edge)]', s.excluded && 'opacity-55')}>
      <div className="flex items-start gap-2.5">
        {n !== undefined && <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-(--u-wash-on) px-1 text-[11px] font-semibold tabular-nums text-(--u-accent)">{n}</span>}
        <img src={faviconOf(s.url)} alt="" className="mt-0.5 h-4 w-4 shrink-0 rounded-[3px]" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => void launchApp(s.url).catch(() => {})} title={s.url} className="line-clamp-2 text-left text-[12.5px] font-medium leading-snug hover:text-(--u-accent)">
            {s.title || domainOf(s.url)}
          </button>
          <p className="mt-0.5 text-[11px] text-(--u-ink-3)">
            {domainOf(s.url)}
            {s.published ? ` · ${s.published}` : ''}
            {s.manual ? ' · added by you' : ''}
          </p>
        </div>
        {n !== undefined ? (
          <Switch checked={!s.excluded} onChange={() => onToggle(s.id)} label={s.excluded ? 'Include this source' : 'Leave this source out'} />
        ) : (
          <Button size="sm" variant="tinted" disabled={!turn || busy} onClick={() => onCiteMore(s.id)}>
            Use
          </Button>
        )}
      </div>
      <p className="mt-2 line-clamp-3 text-[11.5px] leading-relaxed text-(--u-ink-3)">{s.text.slice(0, 260)}</p>
    </div>
  )

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-(--u-edge)">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-(--u-edge) px-4">
        <h3 className="flex-1 text-[13.5px] font-semibold">Sources</h3>
        <span className="text-[12px] tabular-nums text-(--u-ink-3)">{cited.length} cited</span>
        <Button icon size="sm" aria-label="Close sources" onClick={onClose}>
          <Ico d={I.close} />
        </Button>
      </header>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {!turn ? (
          <p className="px-2 py-10 text-center text-[12.5px] text-(--u-ink-3)">Sources appear here once research starts.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <p className="px-1 text-[11.5px] leading-relaxed text-(--u-ink-3)">Switch a source off to leave it out, then rewrite the report. Click a number in the report to jump to its source.</p>
            {cited.map((s, i) => card(s, i + 1))}
            {others.length > 0 && (
              <>
                <p className="px-1 pt-3 text-[11px] font-semibold text-(--u-ink-3)">Also read in this research</p>
                {others.map((s) => card(s))}
              </>
            )}
          </div>
        )}
      </div>
      <form
        className="flex shrink-0 flex-col gap-1.5 border-t border-(--u-edge) p-3"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!url.trim() || adding) return
          setAdding(true)
          setError(null)
          try {
            await onAddUrl(url.trim())
            setUrl('')
          } catch (err) {
            setError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Could not read that page.')
          }
          setAdding(false)
        }}
      >
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Add a page by its address" spellCheck={false} disabled={!turn} className="u-field h-8 min-w-0 flex-1 text-[12.5px]" />
          <Button type="submit" size="sm" variant="tinted" disabled={!url.trim() || adding || !turn}>
            {adding ? 'Reading…' : 'Add'}
          </Button>
        </div>
        {error && <p className="text-[11.5px] text-(--u-danger)">{error}</p>}
      </form>
    </aside>
  )
}
