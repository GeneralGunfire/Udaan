import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { createNote, listNotes, saveNoteBody } from '@/integrations/notes/client'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { addManualSource, newTurn, redraft, runTurn, titleFor, type Hooks, type Work } from './engine'
import {
  importOldHistory,
  isBusy,
  loadSettings,
  newSession,
  saveSettings,
  store,
  toMarkdown,
  type Angle,
  type Session,
  type SessionMeta,
  type Settings,
  type Turn,
} from './model'
import { Composer, I, Ico, ModeBar, SettingsDialog, SourcesDrawer, TurnView, type TurnActions } from './parts'
import './research.css'

/**
 * OMNIFIND: deep research you can watch, steer and check.
 *
 *   plan      the angles it will investigate (you can edit them first)
 *   search    each angle is searched, real pages are read
 *   write     a cited report, written live
 *   check     every claim is tested against the page text; the evidence must be quoted and is looked up
 *   follow up answer from what was already read, or search for more
 *
 * Sessions are saved to disk, searchable, and exportable. Ctrl+N new research, Ctrl+K search, Esc stops.
 */

const EXAMPLES = ['How does a heat pump compare with an air conditioner on running costs?', 'What are the strongest arguments for and against a four-day work week?', 'What does the evidence say about intermittent fasting?', 'How do mRNA vaccines work, and what are the known side effects?']

const dayLabel = (ms: number) => {
  const d = new Date(ms)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= start) return 'Today'
  if (ms >= start - 86_400_000) return 'Yesterday'
  if (ms >= start - 7 * 86_400_000) return 'Previous 7 days'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong.')

export function ResearchApp() {
  const [metas, setMetas] = useState<SessionMeta[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [settings, setSettingsState] = useState<Settings>(loadSettings)
  const [running, setRunning] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [focus, setFocus] = useState<{ turnId: string; sourceId: string } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [review, setReview] = useState<{ turnId: string; angles: Angle[]; resolve: (a: Angle[] | null) => void } | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ id: string; title: string; snippet: string }[] | null>(null)
  const [dialog, setDialog] = useState<null | 'settings' | { rename: string }>(null)
  const [searchMore, setSearchMore] = useState(false)
  const [toast, setToast] = useState<{ text: string; danger?: boolean } | null>(null)
  const [seed, setSeed] = useState<{ text: string; n: number }>({ text: '', n: 0 })
  const sessionRef = useRef<Session | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchRef = useRef<HTMLInputElement>(null)
  const openMenu = useShellMenu()

  const say = useCallback((text: string, danger?: boolean) => {
    setToast({ text, danger })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3400)
  }, [])
  const setSettings = (s: Settings) => (setSettingsState(s), saveSettings(s))
  const refreshList = useCallback(() => void store.list().then(setMetas, () => {}), [])

  useEffect(() => {
    void (async () => {
      const n = await importOldHistory()
      if (n) say(`Brought over ${n} earlier research report${n === 1 ? '' : 's'}`)
      refreshList()
    })()
  }, [refreshList, say])

  const persist = useCallback(
    (s: Session | null, now = false) => {
      if (!s || !s.turns.length) return
      clearTimeout(saveTimer.current)
      const go = () => void store.save(s).then(refreshList, (e) => say(`Couldn’t save: ${errText(e)}`, true))
      if (now) go()
      else saveTimer.current = setTimeout(go, 1500)
    },
    [refreshList, say],
  )
  const update = useCallback(
    (fn: (s: Session) => Session, now = false) => {
      const cur = sessionRef.current
      if (!cur) return null
      const next = fn(cur)
      sessionRef.current = next
      setSession(next)
      persist(next, now)
      return next
    },
    [persist],
  )

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setHits(null)
    const t = setTimeout(() => void store.search(q).then(setHits, () => setHits([])), 220)
    return () => clearTimeout(t)
  }, [query])

  /* ── running ───────────────────────────────────────────────────── */

  const stop = useCallback(() => {
    review?.resolve(null)
    setReview(null)
    abortRef.current?.abort()
  }, [review])

  const hooksFor = useCallback(
    (turnId: string, ctl: AbortController, withReview: boolean): Hooks => ({
      signal: ctl.signal,
      onUpdate: (turn, sources) => update((s) => ({ ...s, turns: s.turns.map((t) => (t.id === turnId ? turn : t)), sources, updatedMs: Date.now() })),
      reviewPlan: withReview ? (angles) => new Promise((resolve) => setReview({ turnId, angles, resolve })) : undefined,
    }),
    [update],
  )

  const finish = useCallback(
    async (question: string) => {
      setRunning(null)
      setReview(null)
      persist(sessionRef.current, true)
      const s = sessionRef.current
      if (s && s.title === 'New research') {
        const title = await titleFor(question)
        update((x) => (x.title === 'New research' ? { ...x, title } : x), true)
      }
    },
    [persist, update],
  )

  const execute = useCallback(
    async (turn: Turn) => {
      const ctl = new AbortController()
      abortRef.current?.abort()
      abortRef.current = ctl
      setRunning(turn.id)
      setActiveId(turn.id)
      const s = sessionRef.current!
      const work: Work = { turn: { ...turn }, sources: s.sources.map((x) => ({ ...x })) }
      await runTurn(work, s, settings, hooksFor(turn.id, ctl, settings.reviewPlan && turn.searchedMore))
      if (abortRef.current === ctl) abortRef.current = null
      await finish(turn.question)
    },
    [finish, hooksFor, settings],
  )

  const ask = useCallback(
    (question: string, follow = false) => {
      if (running) return
      const base = sessionRef.current ?? newSession()
      const isFollow = follow && base.turns.some((t) => t.phase === 'done')
      const turn = newTurn(question, isFollow ? 'followup' : 'research', settings.mode, isFollow ? searchMore : true, settings.factCheck)
      const next: Session = { ...base, turns: [...base.turns, turn], updatedMs: Date.now() }
      sessionRef.current = next
      setSession(next)
      void execute(turn)
    },
    [execute, running, searchMore, settings.factCheck, settings.mode],
  )

  const rewrite = useCallback(
    async (turn: Turn) => {
      if (running) return
      const ctl = new AbortController()
      abortRef.current = ctl
      setRunning(turn.id)
      const s = sessionRef.current!
      const work: Work = { turn: { ...turn }, sources: s.sources.map((x) => ({ ...x })) }
      await redraft(work, s, hooksFor(turn.id, ctl, false))
      await finish(turn.question)
    },
    [finish, hooksFor, running],
  )

  const retry = useCallback(
    (turn: Turn) => {
      if (running) return
      // A failure after the sources were read only needs the writing redone.
      if (turn.phase === 'failed' && turn.cites.length > 0 && turn.angles.some((a) => a.read > 0)) return void rewrite(turn)
      const fresh = newTurn(turn.question, turn.kind, turn.mode, turn.searchedMore, settings.factCheck)
      update((s) => ({ ...s, turns: s.turns.map((t) => (t.id === turn.id ? fresh : t)) }))
      void execute(fresh)
    },
    [execute, rewrite, running, settings.factCheck, update],
  )

  /* ── sessions ──────────────────────────────────────────────────── */

  const startNew = useCallback(() => {
    stop()
    sessionRef.current = null
    setSession(null)
    setActiveId(null)
    setDrawer(false)
    setFocus(null)
  }, [stop])

  const openSession = useCallback(
    async (id: string) => {
      if (sessionRef.current?.id === id) return
      stop()
      try {
        const s = await store.get(id)
        // A run that was interrupted by closing the app is marked as stopped.
        s.turns = s.turns.map((t) => (isBusy(t) ? { ...t, phase: 'cancelled', status: 'Stopped' } : t))
        sessionRef.current = s
        setSession(s)
        setActiveId(null)
        setFocus(null)
      } catch (e) {
        say(errText(e), true)
      }
    },
    [say, stop],
  )

  const patchSession = async (id: string, patch: Partial<Session>) => {
    if (sessionRef.current?.id === id) update((s) => ({ ...s, ...patch }), true)
    else {
      const s = await store.get(id)
      await store.save({ ...s, ...patch })
      refreshList()
    }
  }
  const removeSession = async (id: string) => {
    await store.remove(id).catch((e) => say(errText(e), true))
    if (sessionRef.current?.id === id) startNew()
    refreshList()
  }
  const exportSession = async (id: string) => {
    const s = sessionRef.current?.id === id ? sessionRef.current : await store.get(id)
    const path = await saveDialog({ defaultPath: `${s.title.replace(/[<>:"/\\|?*]/g, '').slice(0, 60) || 'Research'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (!path) return
    await store.writeText(path, toMarkdown(s)).then(() => say('Exported'), (e) => say(errText(e), true))
  }
  const sessionMenu = (e: { clientX: number; clientY: number }, m: { id: string; title: string; pinned?: boolean }) =>
    openMenu(e, [
      { label: 'Rename', onSelect: () => setDialog({ rename: m.id }) },
      { label: m.pinned ? 'Unpin' : 'Pin', onSelect: () => void patchSession(m.id, { pinned: !m.pinned }) },
      { label: 'Export as Markdown…', onSelect: () => void exportSession(m.id) },
      {},
      { label: 'Delete', danger: true, onSelect: () => void removeSession(m.id) },
    ])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') (e.preventDefault(), startNew())
      else if (e.ctrlKey && e.key.toLowerCase() === 'k') (e.preventDefault(), searchRef.current?.focus())
      else if (e.key === 'Escape' && abortRef.current && !dialog) (e.preventDefault(), stop())
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [startNew, stop, dialog])
  useEffect(() => () => abortRef.current?.abort(), [])

  /* ── turn actions ──────────────────────────────────────────────── */

  const active = useMemo(() => session?.turns.find((t) => t.id === activeId) ?? session?.turns[session.turns.length - 1] ?? null, [session, activeId])

  const act: TurnActions = {
    onCite: (turn, n) => {
      const id = turn.cites[n - 1]
      setActiveId(turn.id)
      setDrawer(true)
      if (id) setFocus({ turnId: turn.id, sourceId: id })
    },
    onFocusSource: (turn, sourceId) => {
      setActiveId(turn.id)
      setDrawer(true)
      setFocus({ turnId: turn.id, sourceId })
    },
    onFollow: (q) => ask(q, true),
    onRetry: retry,
    onRedraft: (t) => void rewrite(t),
    onCopy: (t) => void navigator.clipboard.writeText(toMarkdown({ ...session!, turns: [t] })).then(() => say('Copied as Markdown')),
    onExport: () => session && void exportSession(session.id),
    onNotes: async (t) => {
      try {
        const id = crypto.randomUUID()
        const title = t.question.slice(0, 60)
        await createNote({ id, title, position: (await listNotes()).length, createdAt: new Date().toISOString() })
        await saveNoteBody(id, title, toMarkdown({ ...session!, turns: [t] }))
        say('Saved to Notes')
      } catch (e) {
        say(`Couldn’t save to Notes: ${errText(e)}`, true)
      }
    },
    onReview: review ? { angles: review.angles, start: (a) => (review.resolve(a), setReview(null)), cancel: () => (review.resolve(null), setReview(null)) } : null,
  }

  const toggleExclude = (id: string) => update((s) => ({ ...s, sources: s.sources.map((x) => (x.id === id ? { ...x, excluded: !x.excluded } : x)) }), true)
  const addUrl = async (url: string) => {
    const src = await addManualSource(url)
    if (sessionRef.current?.sources.some((s) => s.url === src.url)) throw new Error('That page is already a source.')
    update((s) => ({ ...s, sources: [...s.sources, src], turns: s.turns.map((t) => (t.id === (active?.id ?? '') ? { ...t, cites: [...t.cites, src.id] } : t)) }), true)
    say('Added. Rewrite the report to use it.')
  }
  const citeMore = (id: string) => update((s) => ({ ...s, turns: s.turns.map((t) => (t.id === active?.id && !t.cites.includes(id) ? { ...t, cites: [...t.cites, id] } : t)) }), true)

  /* sticky scroll while the report is written */
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = session?.turns[session.turns.length - 1]
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [last?.report.length, last?.phase, last?.angles.length, session?.turns.length])
  useEffect(() => {
    stick.current = true
  }, [session?.id])

  /* sidebar groups */
  const groups = useMemo(() => {
    const out: { label: string; items: SessionMeta[] }[] = []
    const pinned = metas.filter((m) => m.pinned)
    if (pinned.length) out.push({ label: 'Pinned', items: pinned })
    for (const m of metas.filter((x) => !x.pinned)) {
      const g = dayLabel(m.updatedMs)
      const l = out[out.length - 1]
      if (l && l.label === g) l.items.push(m)
      else out.push({ label: g, items: [m] })
    }
    return out
  }, [metas])

  const busy = !!running
  const needsKeys = !settings.braveKey && !settings.tavilyKey

  return (
    <div className="relative flex h-full min-h-0 text-(--u-ink)">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-(--u-edge)">
        <div className="px-3 pb-2 pt-3">
          <Button variant="tinted" className="w-full justify-start" onClick={startNew} title="New research (Ctrl+N)">
            <Ico d={I.plus} /> New research
          </Button>
        </div>
        <label className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-[8px] bg-(--u-wash-hover) px-2.5 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
          <Ico d={I.search} size={14} className="text-(--u-ink-3)" />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} placeholder="Search all research" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--u-ink-3)" />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery('')} className="text-(--u-ink-3) hover:text-(--u-ink)">
              <Ico d={I.close} size={11} />
            </button>
          )}
        </label>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3 text-[12.5px]">
          {hits ? (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold text-(--u-ink-3)">{hits.length ? `${hits.length} found` : 'Nothing found'}</p>
              {hits.map((h) => (
                <button key={h.id} type="button" onClick={() => void openSession(h.id)} className={cn('mb-0.5 flex w-full flex-col gap-0.5 rounded-[8px] px-2.5 py-2 text-left', h.id === session?.id ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)')}>
                  <span className="truncate font-medium">{h.title}</span>
                  {h.snippet && <span className="line-clamp-2 text-[11.5px] text-(--u-ink-3)">{h.snippet}</span>}
                </button>
              ))}
            </>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="px-2 pb-1 pt-3 text-[11px] font-semibold text-(--u-ink-3)">{g.label}</p>
                  {g.items.map((m) => (
                    <button key={m.id} type="button" onClick={() => void openSession(m.id)} onContextMenu={(e) => (e.preventDefault(), sessionMenu(e, m))} className={cn('group mb-px flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2.5 text-left', m.id === session?.id ? 'bg-(--u-wash-on) font-medium' : 'hover:bg-(--u-wash-hover)')}>
                      {m.pinned && <Ico d={I.pin} size={12} className="text-(--u-ink-3)" />}
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      <span role="button" aria-label="More" onClick={(e) => (e.stopPropagation(), sessionMenu(e, m))} className="hidden rounded-[5px] p-0.5 text-(--u-ink-3) hover:bg-(--u-wash-press) hover:text-(--u-ink) group-hover:block">
                        <Ico d={I.more} size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {!metas.length && <p className="px-2.5 pt-4 text-[12px] leading-relaxed text-(--u-ink-3)">Your research is saved here, searchable, so you can come back to it.</p>}
            </>
          )}
        </div>
        <div className="border-t border-(--u-edge) p-2">
          <button type="button" onClick={() => setDialog('settings')} className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[12.5px] text-(--u-ink-2) hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
            <Ico d={I.gear} size={14} /> Search settings
            {needsKeys && <span className="ml-auto text-[11px] text-(--u-ink-3)">free engines</span>}
          </button>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!session ? (
          <div className="u-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 pb-10 pt-[11vh]">
            <div className="flex w-full max-w-[720px] flex-col items-center gap-7">
              <div className="text-center">
                <h1 className="text-[30px] font-light tracking-tight">What do you want to find out?</h1>
                <p className="mx-auto mt-2 max-w-[520px] text-[13.5px] leading-relaxed text-(--u-ink-3)">OmniFind plans the research, reads real pages, writes a cited report, then checks every claim against what it read.</p>
              </div>
              <Composer big autoFocus busy={busy} onStop={stop} onSend={(t) => ask(t)} placeholder="Ask a question worth looking into" seed={seed} extras={<ModeBar settings={settings} onChange={setSettings} />} />
              <p className="-mt-3 text-center text-[12px] text-(--u-ink-3)">{settings.mode === 'quick' ? 'Quick: 2 angles, 2 pages each.' : settings.mode === 'standard' ? 'Standard: 3 angles, 3 pages each.' : 'Deep: 5 angles, 4 pages each. Takes a few minutes.'}</p>
              <div className="grid w-full grid-cols-2 gap-2">
                {EXAMPLES.map((q) => (
                  <button key={q} type="button" onClick={() => setSeed((s) => ({ text: q, n: s.n + 1 }))} className="rounded-[12px] px-4 py-3 text-left text-[12.5px] leading-snug text-(--u-ink-2) shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-(--u-edge) px-4">
              <button type="button" onClick={() => setDialog({ rename: session.id })} className="min-w-0 truncate rounded-[6px] px-1.5 py-0.5 text-left text-[14px] font-semibold hover:bg-(--u-wash-hover)">
                {session.title}
              </button>
              <span className="flex-1" />
              <Button size="sm" variant={drawer ? 'tinted' : 'ghost'} onClick={() => setDrawer((d) => !d)} title="Sources">
                <Ico d={I.sidebar} size={14} /> Sources
                <span className="rounded-full bg-(--u-wash-on) px-1.5 text-[11px] tabular-nums">{session.sources.length}</span>
              </Button>
              <Button icon size="sm" aria-label="More" onClick={(e) => sessionMenu(e, session)}>
                <Ico d={I.more} />
              </Button>
            </header>
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <div
                  ref={scroller}
                  onScroll={(e) => {
                    const el = e.currentTarget
                    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
                  }}
                  className="u-scroll min-h-0 flex-1 overflow-y-auto"
                >
                  <div className="mx-auto flex w-full max-w-[820px] flex-col gap-10 px-8 pb-8 pt-7">
                    {session.turns.map((t) => (
                      <TurnView key={t.id} session={session} turn={t} live={running === t.id} busyAny={busy} act={act} />
                    ))}
                  </div>
                </div>
                <div className="shrink-0 px-8 pb-5 pt-2">
                  <div className="mx-auto w-full max-w-[820px]">
                    <Composer
                      busy={busy}
                      onStop={stop}
                      onSend={(t) => ask(t, true)}
                      placeholder={busy ? 'Researching…' : 'Ask a follow-up'}
                      extras={
                        <label className="flex items-center gap-2 text-[12.5px] text-(--u-ink-2)" title="Off: answer from the sources already read. On: search for new ones too.">
                          <Switch checked={searchMore} onChange={setSearchMore} label="Search for more sources" /> Search for more sources
                        </label>
                      }
                    />
                  </div>
                </div>
              </div>
              {drawer && <SourcesDrawer session={session} turn={active} focus={focus && focus.turnId === active?.id ? focus.sourceId : null} onToggle={toggleExclude} onAddUrl={addUrl} onCiteMore={citeMore} onClose={() => setDrawer(false)} busy={busy} />}
            </div>
          </>
        )}
      </main>

      {dialog === 'settings' && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && <RenameDialog title={(session?.id === dialog.rename ? session.title : metas.find((m) => m.id === dialog.rename)?.title) ?? ''} onClose={() => setDialog(null)} onSave={(t) => (void patchSession(dialog.rename, { title: t }), setDialog(null))} />}
      {toast && <div className={cn('pointer-events-none absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-(--u-m-solid-hi) px-4 py-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]', toast.danger && 'text-(--u-danger)')}>{toast.text}</div>}
    </div>
  )
}

function RenameDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (t: string) => void }) {
  const [v, setV] = useState(title)
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-6" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="flex w-[400px] max-w-full flex-col gap-4 rounded-[14px] bg-(--u-m-solid) p-5 shadow-[inset_0_0_0_1px_var(--u-edge)]" onSubmit={(e) => (e.preventDefault(), v.trim() && onSave(v.trim()))} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 className="text-[15px] font-semibold">Rename research</h2>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.currentTarget.select()} className="u-field h-9" />
        <div className="flex justify-end gap-2">
          <Button variant="tinted" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" disabled={!v.trim()}>
            Rename
          </Button>
        </div>
      </form>
    </div>
  )
}

