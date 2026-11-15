import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { listNotes, readNoteBody, createNote, saveNoteBody, deleteNote, setNotesOrder, getActiveNote, setActiveNote, type NoteMeta } from '@/integrations/notes/client'
import { launchApp } from '@/integrations/installed-apps/client'
import { Button, Segmented } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { SearchIcon, TrashIcon, CopyIcon, PlusIcon } from '@/shared/icons'

interface NotesViewProps {
  onClose: () => void
}

type SaveState = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'dirty' } | { kind: 'error'; message: string }
type Mode = 'write' | 'split' | 'read'
type Sort = 'updated' | 'created' | 'title'

const SAVE_DELAY_MS = 500
const PASTE_SAVE_DELAY_MS = 100
const PINNED_KEY = 'udaan.notes.pinned'
const UPDATED_KEY = 'udaan.notes.updated'
const MODE_KEY = 'udaan.notes.mode'
const SORT_KEY = 'udaan.notes.sort'

/* ── small persistence helpers (all best-effort) ───────────────────── */

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* it just won't survive a restart */
  }
}

/* ── text helpers ───────────────────────────────────────────────────── */

function titleOf(body: string): string {
  const first = body.split('\n').find((l) => l.trim())?.trim().replace(/^#{1,6}\s+/, '') ?? ''
  return first ? first.slice(0, 80) : 'Untitled'
}

function snippetOf(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines[1] ?? '').replace(/^[-*>#\s]+(\[[ xX]\]\s*)?/, '').slice(0, 120)
}

/** `#word` anywhere that is not a heading (a heading has a space after the hashes). */
function tagsOf(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(/(^|\s)#([a-zA-Z][\w-]{1,28})(?=\s|$|[.,;:!?)])/g)) out.add(m[2].toLowerCase())
  return [...out]
}

function checklistOf(body: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const l of body.split('\n')) {
    const m = l.match(/^\s*[-*]\s+\[([ xX])\]/)
    if (m) {
      total++
      if (m[1] !== ' ') done++
    }
  }
  return { done, total }
}

const newId = () => `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function bucket(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days < 1 ? 'Today' : days < 2 ? 'Yesterday' : days < 8 ? 'Previous 7 days' : days < 31 ? 'This month' : 'Older'
}

/* ── the Markdown preview ──────────────────────────────────────────── */

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)]+\))|(~~[^~]+~~)|(#[a-zA-Z][\w-]{1,28})/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const t = m[0]
    const k = `${key}-${i++}`
    if (t.startsWith('`')) out.push(<code key={k} className="rounded-[5px] bg-(--u-wash-on) px-1.5 py-0.5 font-mono text-[0.9em]">{t.slice(1, -1)}</code>)
    else if (t.startsWith('**')) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>)
    else if (t.startsWith('~~')) out.push(<s key={k} className="opacity-70">{t.slice(2, -2)}</s>)
    else if (t.startsWith('[')) {
      const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (mm) {
        const href = mm[2]
        out.push(
          <a key={k} href={href} onClick={(e) => (e.preventDefault(), /^https?:/i.test(href) && void launchApp(href).catch(() => {}))} className="text-(--u-accent) underline decoration-[0.5px] underline-offset-2">
            {mm[1]}
          </a>,
        )
      }
    } else if (t.startsWith('#')) out.push(<span key={k} className="rounded-full bg-(--u-wash-on) px-1.5 text-[0.92em] text-(--u-accent)">{t}</span>)
    else out.push(<em key={k}>{t.slice(1, -1)}</em>)
    last = at + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Preview({ body, onToggle }: { body: string; onToggle: (line: number) => void }) {
  const lines = body.split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = `l${i}`
    if (line.trim().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++])
      i++
      nodes.push(
        <pre key={key} className="my-3 overflow-x-auto rounded-[10px] bg-(--u-wash-on) p-3.5 font-mono text-[13px] leading-relaxed">
          {code.join('\n')}
        </pre>,
      )
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      nodes.push(
        <p key={key} className={cn('font-semibold tracking-tight', lvl === 1 ? 'mb-2 mt-6 text-[28px]' : lvl === 2 ? 'mb-1.5 mt-5 text-[21px]' : 'mb-1 mt-4 text-[17px]')}>
          {inline(h[2], key)}
        </p>,
      )
    } else if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) {
      const done = /\[[xX]\]/.test(line)
      const label = line.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '')
      const indent = (line.match(/^\s*/)?.[0].length ?? 0) * 6
      const at = i
      nodes.push(
        <button key={key} type="button" onClick={() => onToggle(at)} className="my-0.5 flex w-full items-start gap-2.5 rounded-[8px] px-1 py-0.5 text-left hover:bg-(--u-wash-on)" style={{ paddingLeft: indent + 4 }}>
          <span className={cn('mt-[5px] flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] shadow-[inset_0_0_0_1.5px_var(--u-ink-3)]', done && 'bg-(--u-accent) shadow-none')}>
            {done && (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5 10 17 19 7" />
              </svg>
            )}
          </span>
          <span className={cn('text-[15.5px] leading-[1.6]', done && 'text-(--u-ink-3) line-through')}>{inline(label, key)}</span>
        </button>,
      )
    } else if (/^\s*[-*]\s+/.test(line)) {
      const indent = (line.match(/^\s*/)?.[0].length ?? 0) * 6
      nodes.push(
        <p key={key} className="my-0.5 flex gap-2.5 text-[15.5px] leading-[1.65]" style={{ paddingLeft: indent + 6 }}>
          <span className="text-(--u-ink-3)">•</span>
          <span>{inline(line.replace(/^\s*[-*]\s+/, ''), key)}</span>
        </p>,
      )
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const n = line.match(/^\s*(\d+)\./)?.[1]
      nodes.push(
        <p key={key} className="my-0.5 flex gap-2.5 pl-1.5 text-[15.5px] leading-[1.65]">
          <span className="w-5 shrink-0 text-right tabular-nums text-(--u-ink-3)">{n}.</span>
          <span>{inline(line.replace(/^\s*\d+\.\s+/, ''), key)}</span>
        </p>,
      )
    } else if (line.startsWith('>')) {
      nodes.push(
        <blockquote key={key} className="my-2 border-l-[3px] border-(--u-accent) pl-4 text-[15.5px] italic leading-[1.65] text-(--u-ink-2)">
          {inline(line.replace(/^>\s?/, ''), key)}
        </blockquote>,
      )
    } else if (/^---+$/.test(line.trim())) {
      nodes.push(<hr key={key} className="my-5 border-0 border-t border-(--u-edge)" />)
    } else if (!line.trim()) {
      nodes.push(<div key={key} className="h-3" />)
    } else {
      nodes.push(
        <p key={key} className="text-[15.5px] leading-[1.75]">
          {inline(line, key)}
        </p>,
      )
    }
    i++
  }
  return <div className="select-text">{nodes}</div>
}

/* ── the app ────────────────────────────────────────────────────────── */

/**
 * Notes: Markdown notes that save as you type. A formatting toolbar, interactive checklists,
 * #tags, pinned notes, search across every note's text and export to a .md file.
 */
export function NotesView(_props: NotesViewProps) {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [bodies, setBodies] = useState<Record<string, string>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: Date.now() })
  const [loaded, setLoaded] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [, tick] = useState(0)
  const [mode, setModeState] = useState<Mode>(() => readJson<Mode>(MODE_KEY, 'write'))
  const [sort, setSortState] = useState<Sort>(() => readJson<Sort>(SORT_KEY, 'updated'))
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(readJson<string[]>(PINNED_KEY, [])))
  const [updated, setUpdated] = useState<Record<string, string>>(() => readJson<Record<string, string>>(UPDATED_KEY, {}))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ id: string; body: string } | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const setMode = (m: Mode) => (setModeState(m), writeJson(MODE_KEY, m))
  const setSort = (s: Sort) => (setSortState(s), writeJson(SORT_KEY, s))
  const say = (text: string) => {
    setFlash(text)
    setTimeout(() => setFlash((f) => (f === text ? null : f)), 1600)
  }

  // Keep "Saved 5s ago" fresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const stamp = useCallback((id: string) => {
    setUpdated((u) => {
      const next = { ...u, [id]: new Date().toISOString() }
      writeJson(UPDATED_KEY, next)
      return next
    })
  }, [])

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const job = pending.current
    if (!job) return
    pending.current = null
    setSave({ kind: 'saving' })
    try {
      await saveNoteBody(job.id, titleOf(job.body), job.body)
      setNotes((prev) => prev.map((n) => (n.id === job.id ? { ...n, title: titleOf(job.body) } : n)))
      stamp(job.id)
      setSave(pending.current ? { kind: 'dirty' } : { kind: 'saved', at: Date.now() })
    } catch (err) {
      pending.current = pending.current ?? job
      setSave({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [stamp])

  const schedule = useCallback(
    (id: string, body: string, delay = SAVE_DELAY_MS) => {
      pending.current = { id, body }
      setSave({ kind: 'dirty' })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [flush],
  )

  useEffect(() => {
    void (async () => {
      try {
        const [list, active] = await Promise.all([listNotes(), getActiveNote()])
        const texts = await Promise.all(list.map((n) => readNoteBody(n.id).catch(() => '')))
        setBodies(Object.fromEntries(list.map((n, i) => [n.id, texts[i]])))
        setNotes(list)
        setActiveId(active && list.some((n) => n.id === active) ? active : (list[list.length - 1]?.id ?? null))
      } finally {
        setLoaded(true)
      }
    })()
    const onUnload = () => void flush()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      void flush()
    }
  }, [flush])

  const body = activeId ? (bodies[activeId] ?? '') : ''
  const active = notes.find((n) => n.id === activeId) ?? null
  const stampOf = (n: NoteMeta) => updated[n.id] ?? n.createdAt

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of notes) for (const t of tagsOf(bodies[n.id] ?? '')) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [notes, bodies])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = notes.filter((n) => (!q || n.title.toLowerCase().includes(q) || (bodies[n.id] ?? '').toLowerCase().includes(q)) && (!tag || tagsOf(bodies[n.id] ?? '').includes(tag)))
    list = [...list].sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : stampOf(b).localeCompare(stampOf(a))))
    const pins = list.filter((n) => pinned.has(n.id))
    const rest = list.filter((n) => !pinned.has(n.id))
    const out: { label: string; items: NoteMeta[] }[] = []
    if (pins.length) out.push({ label: 'Pinned', items: pins })
    if (sort === 'title') {
      if (rest.length) out.push({ label: 'All notes', items: rest })
    } else {
      for (const n of rest) {
        const label = bucket(sort === 'created' ? n.createdAt : stampOf(n))
        const g = out.find((x) => x.label === label)
        if (g) g.items.push(n)
        else out.push({ label, items: [n] })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, bodies, query, tag, sort, pinned, updated])

  const select = async (id: string) => {
    if (id === activeId) return
    await flush()
    setActiveId(id)
    void setActiveNote(id).catch(() => {})
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const create = async (initial = '') => {
    await flush()
    const meta: NoteMeta = { id: newId(), title: initial ? titleOf(initial) : 'Untitled', position: notes.length, createdAt: new Date().toISOString() }
    await createNote(meta)
    if (initial) await saveNoteBody(meta.id, meta.title, initial).catch(() => {})
    setNotes((p) => [...p, meta])
    setBodies((b) => ({ ...b, [meta.id]: initial }))
    setActiveId(meta.id)
    setQuery('')
    setTag(null)
    stamp(meta.id)
    if (mode === 'read') setMode('write')
    void setActiveNote(meta.id).catch(() => {})
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const remove = async (id: string) => {
    const n = notes.find((x) => x.id === id)
    if (!n || !window.confirm(`Delete "${n.title === 'Untitled' ? 'this note' : n.title}"? This can't be undone.`)) return
    if (pending.current?.id === id) pending.current = null
    const rest = notes.filter((x) => x.id !== id)
    setNotes(rest)
    await deleteNote(id).catch(() => {})
    void setNotesOrder(rest.map((x) => x.id)).catch(() => {})
    if (activeId === id) {
      const next = rest[rest.length - 1]?.id ?? null
      setActiveId(next)
      void setActiveNote(next).catch(() => {})
    }
  }

  const change = (next: string, delay?: number) => {
    if (!activeId) return
    setBodies((b) => ({ ...b, [activeId]: next }))
    schedule(activeId, next, delay)
  }

  const togglePin = (id: string) =>
    setPinned((cur) => {
      const next = new Set(cur)
      if (!next.delete(id)) next.add(id)
      writeJson(PINNED_KEY, [...next])
      return next
    })

  /* formatting: acts on the selection in the editor */
  const edit = (fn: (value: string, start: number, end: number) => { value: string; start: number; end: number }) => {
    const el = editorRef.current
    if (!el || !activeId) return
    const r = fn(el.value, el.selectionStart, el.selectionEnd)
    change(r.value)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(r.start, r.end)
    })
  }
  const wrap = (before: string, after = before, placeholder = 'text') =>
    edit((v, s, e) => {
      const sel = v.slice(s, e) || placeholder
      const already = v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after
      if (already) return { value: v.slice(0, s - before.length) + v.slice(s, e) + v.slice(e + after.length), start: s - before.length, end: e - before.length }
      return { value: v.slice(0, s) + before + sel + after + v.slice(e), start: s + before.length, end: s + before.length + sel.length }
    })
  const prefixLines = (prefix: string, numbered = false) =>
    edit((v, s, e) => {
      const a = v.lastIndexOf('\n', s - 1) + 1
      const bEnd = v.indexOf('\n', e)
      const b = bEnd === -1 ? v.length : bEnd
      const lines = v.slice(a, b).split('\n')
      const has = lines.every((l) => (numbered ? /^\d+\.\s/.test(l) : l.startsWith(prefix)))
      const out = lines.map((l, i) => (has ? (numbered ? l.replace(/^\d+\.\s/, '') : l.slice(prefix.length)) : (numbered ? `${i + 1}. ` : prefix) + l.replace(/^(#{1,3}\s|[-*]\s(\[[ xX]\]\s)?|>\s|\d+\.\s)/, numbered || prefix.startsWith('#') ? '' : '')))
      const text = out.join('\n')
      return { value: v.slice(0, a) + text + v.slice(b), start: a, end: a + text.length }
    })
  const toggleLine = (line: number) => {
    const lines = body.split('\n')
    lines[line] = /\[[xX]\]/.test(lines[line]) ? lines[line].replace(/\[[xX]\]/, '[ ]') : lines[line].replace('[ ]', '[x]')
    change(lines.join('\n'))
  }
  const addLink = () =>
    edit((v, s, e) => {
      const sel = v.slice(s, e) || 'link text'
      const text = `[${sel}](https://)`
      return { value: v.slice(0, s) + text + v.slice(e), start: s + sel.length + 3, end: s + sel.length + 11 }
    })

  const exportNote = async () => {
    if (!active) return
    try {
      const name = `${titleOf(body).replace(/[\\/:*?"<>|]/g, '').slice(0, 50) || 'note'}.md`
      const path = await saveDialog({ defaultPath: name, filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }] })
      if (!path) return
      await writeTextFile(path, body)
      say('Saved to file')
    } catch {
      await navigator.clipboard.writeText(body).catch(() => {})
      say('Could not save a file. Copied instead')
    }
  }

  // Ctrl+N new note, Ctrl+F search, Ctrl+B/I/K formatting, Ctrl+Shift+P cycles the view.
  const createRef = useRef(create)
  createRef.current = create
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (!e.shiftKey && k === 'n') (e.preventDefault(), void createRef.current())
      else if (!e.shiftKey && k === 'f') (e.preventDefault(), searchRef.current?.focus(), searchRef.current?.select())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  const list = checklistOf(body)

  const tool = (label: ReactNode, title: string, onClick: () => void, extra?: string) => (
    <Button size="sm" icon title={title} aria-label={title} onClick={onClick} className={cn('h-8 w-8 text-[13px]', extra)}>
      {label}
    </Button>
  )

  return (
    <div className="flex h-full bg-(--u-bg) text-(--u-ink)">
      <aside className="flex w-[292px] shrink-0 flex-col border-r border-(--u-edge)">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <div className="flex-1">
            <h2 className="text-[19px] font-semibold tracking-tight">Notes</h2>
            <p className="text-[11.5px] text-(--u-ink-3)">
              {notes.length} {notes.length === 1 ? 'note' : 'notes'}
              {pinned.size ? ` · ${pinned.size} pinned` : ''}
            </p>
          </div>
          <Button variant="primary" onClick={() => void create()} aria-label="New note" title="New note (Ctrl+N)">
            <PlusIcon width={14} height={14} /> New
          </Button>
        </div>
        <label className="u-search mx-4 mb-2 h-9">
          <SearchIcon width={14} height={14} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search every note" />
        </label>
        {allTags.length > 0 && (
          <div className="mx-4 mb-2 flex flex-wrap gap-1.5">
            {allTags.slice(0, 10).map(([t, n]) => (
              <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)} className={cn('rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors', tag === t ? 'bg-(--u-accent) text-white' : 'bg-(--u-wash-on) text-(--u-ink-2) hover:text-(--u-ink)')}>
                #{t} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mx-4 mb-2 flex items-center gap-2 text-[11.5px] text-(--u-ink-3)">
          <span>Sort</span>
          <Segmented<Sort> className="flex-1" value={sort} options={[{ value: 'updated', label: 'Edited' }, { value: 'created', label: 'Created' }, { value: 'title', label: 'A–Z' }]} onChange={setSort} />
        </div>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loaded && groups.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-(--u-ink-3)">{query || tag ? 'Nothing matches' : 'No notes yet. Press New to start one.'}</p>}
          {groups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="u-label px-3 pb-1 pt-2">{g.label}</p>
              {g.items.map((n) => {
                const isActive = n.id === activeId
                const snippet = snippetOf(bodies[n.id] ?? '')
                const nt = tagsOf(bodies[n.id] ?? '')
                const cl = checklistOf(bodies[n.id] ?? '')
                return (
                  <button key={n.id} type="button" data-selected={isActive || undefined} onClick={() => void select(n.id)} className="u-row mb-0.5 h-auto flex-col items-stretch gap-0.5 px-3 py-2 text-left">
                    <span className="flex items-baseline gap-2">
                      {pinned.has(n.id) && (
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" className="shrink-0 -rotate-45 self-center text-(--u-accent)" aria-label="Pinned">
                          <path d="M9 3h6l-1 6 3 3v2h-4.5V21h-1V14H7v-2l3-3Z" />
                        </svg>
                      )}
                      <span className={cn('min-w-0 flex-1 truncate text-[13.5px] font-semibold', n.title === 'Untitled' && 'text-(--u-ink-3)')}>{n.title === 'Untitled' ? 'New note' : n.title}</span>
                      <span className="shrink-0 text-[11px] text-(--u-ink-3)">{when(sort === 'created' ? n.createdAt : stampOf(n))}</span>
                    </span>
                    <span className="truncate text-[12.5px] text-(--u-ink-3)">{snippet || 'No additional text'}</span>
                    {(nt.length > 0 || cl.total > 0) && (
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-(--u-ink-3)">
                        {cl.total > 0 && (
                          <span className="tabular-nums">
                            ☑ {cl.done}/{cl.total}
                          </span>
                        )}
                        {nt.slice(0, 3).map((t) => (
                          <span key={t} className="text-(--u-accent)">
                            #{t}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-1 border-b border-(--u-edge) px-4">
              {tool(<b>B</b>, 'Bold', () => wrap('**'))}
              {tool(<i className="font-serif">I</i>, 'Italic', () => wrap('*'))}
              {tool(<span className="line-through">S</span>, 'Strikethrough', () => wrap('~~'))}
              <span className="mx-1 h-4 w-px bg-(--u-edge)" />
              {tool('H1', 'Heading', () => prefixLines('# '), 'text-[12px] font-bold')}
              {tool('H2', 'Subheading', () => prefixLines('## '), 'text-[12px] font-bold')}
              {tool('•', 'Bulleted list', () => prefixLines('- '), 'text-[16px]')}
              {tool('1.', 'Numbered list', () => prefixLines('', true), 'text-[12px]')}
              {tool('☑', 'Checklist', () => prefixLines('- [ ] '))}
              {tool('❝', 'Quote', () => prefixLines('> '), 'text-[15px]')}
              {tool('</>', 'Code', () => wrap('`', '`', 'code'), 'font-mono text-[11px]')}
              {tool('🔗', 'Link', addLink, 'text-[13px]')}
              <span className="flex-1" />
              <Segmented<Mode> value={mode} options={[{ value: 'write', label: 'Write' }, { value: 'split', label: 'Split' }, { value: 'read', label: 'Read' }]} onChange={setMode} />
            </header>

            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--u-edge) px-5 text-[12px] text-(--u-ink-3)">
              <SaveBadge state={save} onRetry={() => void flush()} />
              {flash && <span className="text-(--u-ink-2)">{flash}</span>}
              <span className="flex-1" />
              {list.total > 0 && (
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-(--u-wash-press)">
                    <span className="block h-full rounded-full bg-(--u-accent) transition-[width] duration-300" style={{ width: `${(list.done / list.total) * 100}%` }} />
                  </span>
                  {list.done}/{list.total} done
                </span>
              )}
              <span className="tabular-nums">
                {words} words · {Math.max(1, Math.round(words / 230))} min
              </span>
              <Button size="sm" aria-pressed={pinned.has(active.id)} title={pinned.has(active.id) ? 'Unpin note' : 'Pin note to the top'} onClick={() => togglePin(active.id)} className={pinned.has(active.id) ? 'text-(--u-accent)' : ''}>
                {pinned.has(active.id) ? 'Pinned' : 'Pin'}
              </Button>
              <Button
                size="sm"
                title="Copy the whole note"
                onClick={() => {
                  void navigator.clipboard.writeText(body)
                  say('Copied')
                }}
              >
                <CopyIcon width={13} height={13} /> Copy
              </Button>
              <Button size="sm" title="Save as a Markdown file" onClick={() => void exportNote()}>
                Export
              </Button>
              <Button size="sm" icon title="Delete note" onClick={() => void remove(active.id)} className="hover:text-(--u-danger)">
                <TrashIcon width={14} height={14} />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1">
              {mode !== 'read' && (
                <div className={cn('u-scroll min-h-0 overflow-y-auto', mode === 'split' ? 'w-1/2 border-r border-(--u-edge)' : 'w-full')}>
                  <div className={cn('mx-auto px-9 pb-24 pt-7', mode === 'split' ? 'max-w-none' : 'max-w-[800px]')}>
                    <p className="mb-3 text-[12px] text-(--u-ink-3)">{new Date(active.createdAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    <textarea
                      ref={editorRef}
                      value={body}
                      onChange={(e) => change(e.target.value)}
                      onPaste={(e) => {
                        const el = e.currentTarget
                        requestAnimationFrame(() => change(el.value, PASTE_SAVE_DELAY_MS))
                      }}
                      onBlur={() => void flush()}
                      onKeyDown={(e) => {
                        const mod = e.ctrlKey || e.metaKey
                        if (mod && e.key === 's') (e.preventDefault(), void flush())
                        else if (mod && e.key.toLowerCase() === 'b') (e.preventDefault(), wrap('**'))
                        else if (mod && e.key.toLowerCase() === 'i') (e.preventDefault(), wrap('*'))
                        else if (mod && e.key.toLowerCase() === 'k') (e.preventDefault(), addLink())
                        else if (e.key === 'Enter' && !e.shiftKey) {
                          // Continue a list: Enter on "- item" starts the next one; Enter on an empty item ends the list.
                          const el = e.currentTarget
                          const a = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1
                          const line = el.value.slice(a, el.selectionStart)
                          const m = line.match(/^(\s*)([-*]\s(\[[ xX]\]\s)?|\d+\.\s)/)
                          if (m && el.selectionStart === el.selectionEnd) {
                            e.preventDefault()
                            if (line.trim() === m[0].trim()) {
                              change(el.value.slice(0, a) + el.value.slice(el.selectionStart))
                              requestAnimationFrame(() => el.setSelectionRange(a, a))
                            } else {
                              const next = /^\d+\./.test(m[2]) ? `${m[1]}${parseInt(m[2], 10) + 1}. ` : m[3] ? `${m[1]}${m[2].replace(/\[[xX]\]/, '[ ]')}` : `${m[1]}${m[2]}`
                              const v = el.value.slice(0, el.selectionStart) + '\n' + next + el.value.slice(el.selectionEnd)
                              const pos = el.selectionStart + 1 + next.length
                              change(v)
                              requestAnimationFrame(() => el.setSelectionRange(pos, pos))
                            }
                          }
                        }
                      }}
                      placeholder="Start writing. The first line becomes the title. Markdown works: **bold**, - lists, - [ ] checklists, #tags"
                      spellCheck
                      className="select-text min-h-[60vh] w-full resize-none bg-transparent text-[16px] leading-[1.75] outline-none placeholder:text-(--u-ink-3) [field-sizing:content]"
                    />
                  </div>
                </div>
              )}
              {mode !== 'write' && (
                <div className={cn('u-scroll min-h-0 overflow-y-auto', mode === 'split' ? 'w-1/2' : 'w-full')}>
                  <div className={cn('mx-auto px-9 pb-24 pt-7', mode === 'split' ? 'max-w-none' : 'max-w-[760px]')}>
                    {body.trim() ? <Preview body={body} onToggle={toggleLine} /> : <p className="text-[14px] text-(--u-ink-3)">Nothing to show yet.</p>}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          loaded && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-[16px] font-semibold">No note selected</p>
              <p className="max-w-[300px] text-[13px] text-(--u-ink-3)">Notes save as you type. Use #tags to group them and - [ ] for checklists.</p>
              <Button variant="primary" onClick={() => void create()}>
                New note
              </Button>
            </div>
          )
        )}
      </main>
    </div>
  )
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const secs = state.kind === 'saved' ? Math.round((Date.now() - state.at) / 1000) : 0
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium', state.kind === 'error' ? 'bg-(--u-danger)/15 text-(--u-danger)' : 'bg-(--u-wash-on) text-(--u-ink-2)')}>
      {state.kind === 'saved' && (
        <>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-(--u-ok)">
            <path d="M5 12.5 10 17 19 7" />
          </svg>
          Saved {secs < 10 ? 'just now' : `at ${new Date(state.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
        </>
      )}
      {state.kind === 'saving' && 'Saving…'}
      {state.kind === 'dirty' && 'Editing…'}
      {state.kind === 'error' && (
        <>
          Couldn't save
          <button type="button" onClick={onRetry} className="underline">
            Retry
          </button>
        </>
      )}
    </span>
  )
}
