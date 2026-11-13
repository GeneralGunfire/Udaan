import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { listNotes, readNoteBody, createNote, saveNoteBody, deleteNote, setNotesOrder, getActiveNote, setActiveNote, type NoteMeta } from '@/integrations/notes/client'
import { SearchIcon, TrashIcon, CopyIcon, PlusIcon } from '@/shared/icons'

interface NotesViewProps {
  onClose: () => void
}

type SaveState = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'dirty' } | { kind: 'error'; message: string }

const SAVE_DELAY_MS = 600
const PASTE_SAVE_DELAY_MS = 120

function titleOf(body: string): string {
  const first = body.split('\n').find((l) => l.trim())?.trim() ?? ''
  return first ? first.slice(0, 80) : 'Untitled'
}

function snippetOf(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines[1] ?? '').slice(0, 120)
}

const PINNED_KEY = 'udaan.notes.pinned'

function readPinned(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? (v as string[]) : [])
  } catch {
    return new Set()
  }
}

const newId = () => `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * Notes: a list of notes with search across their text, and an editor that
 * saves as you type and shows exactly when it last saved.
 */
export function NotesView(_props: NotesViewProps) {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [bodies, setBodies] = useState<Record<string, string>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: Date.now() })
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, tick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ id: string; body: string } | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [pinned, setPinned] = useState<Set<string>>(readPinned)

  // Refresh "Saved 5s ago" labels.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(t)
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
      setSave(pending.current ? { kind: 'dirty' } : { kind: 'saved', at: Date.now() })
    } catch (err) {
      pending.current = pending.current ?? job
      setSave({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

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
    // Last keystrokes are never lost: save on close.
    const onUnload = () => void flush()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      void flush()
    }
  }, [flush])

  const body = activeId ? (bodies[activeId] ?? '') : ''
  const active = notes.find((n) => n.id === activeId) ?? null

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = [...notes].reverse().filter((n) => !q || n.title.toLowerCase().includes(q) || (bodies[n.id] ?? '').toLowerCase().includes(q))
    return [...matches.filter((n) => pinned.has(n.id)), ...matches.filter((n) => !pinned.has(n.id))]
  }, [notes, bodies, query, pinned])

  const select = async (id: string) => {
    if (id === activeId) return
    await flush()
    setActiveId(id)
    void setActiveNote(id).catch(() => {})
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const create = async () => {
    await flush()
    const meta: NoteMeta = { id: newId(), title: 'Untitled', position: notes.length, createdAt: new Date().toISOString() }
    await createNote(meta)
    setNotes((p) => [...p, meta])
    setBodies((b) => ({ ...b, [meta.id]: '' }))
    setActiveId(meta.id)
    setQuery('')
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
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify([...next]))
      } catch {
        /* the pin just won't survive a restart */
      }
      return next
    })

  // Ctrl+N starts a note and Ctrl+F jumps to search, from anywhere in the app.
  const createRef = useRef(create)
  createRef.current = create
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void createRef.current()
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const words = body.trim() ? body.trim().split(/\s+/).length : 0

  return (
    <div className="flex h-full bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border-hairline)] bg-[var(--surface-raised)]">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <div className="flex-1">
            <h2 className="text-[19px] font-bold tracking-tight">Notes</h2>
            <p className="text-[11.5px] text-[var(--color-text-tertiary)]">
              {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            </p>
          </div>
          <button type="button" onClick={() => void create()} aria-label="New note" className="flex h-9 items-center gap-1.5 rounded-[9px] bg-[var(--color-accent)] px-3 text-[13px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-95">
            <PlusIcon width={14} height={14} /> New
          </button>
        </div>
        <label className="mx-4 mb-3 flex h-9 items-center gap-2 rounded-[9px] bg-[var(--surface-overlay)] px-3 transition-colors focus-within:bg-[var(--surface-hover)]">
          <SearchIcon width={14} height={14} className="text-[var(--color-text-tertiary)]" />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loaded && shown.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-[var(--color-text-tertiary)]">{query ? 'Nothing matches your search' : 'No notes yet'}</p>}
          <AnimatePresence initial={false}>
            {shown.map((n) => {
              const isActive = n.id === activeId
              const snippet = snippetOf(bodies[n.id] ?? '')
              return (
                <motion.div
                  key={n.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  onClick={() => void select(n.id)}
                  className={`group relative mb-1 cursor-default rounded-[11px] px-3 py-2.5 transition-colors ${isActive ? 'bg-[var(--color-accent)]/[0.12]' : 'hover:bg-[var(--surface-hover)]'}`}
                >
                  {isActive && <motion.span layoutId="note-active" className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full bg-[var(--color-accent)]" />}
                  <div className="flex items-baseline gap-2">
                    {pinned.has(n.id) && (
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" className="shrink-0 -rotate-45 self-center text-[var(--color-accent)]" aria-label="Pinned">
                        <path d="M9 3h6l-1 6 3 3v2h-4.5V21h-1V14H7v-2l3-3Z" />
                      </svg>
                    )}
                    <p className={`min-w-0 flex-1 truncate text-[14px] font-semibold ${n.title === 'Untitled' ? 'text-[var(--color-text-tertiary)]' : ''}`}>{n.title === 'Untitled' ? 'New note' : n.title}</p>
                    <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{when(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-tertiary)]">{snippet || 'No additional text'}</p>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-5">
              <SaveBadge state={save} onRetry={() => void flush()} />
              <span className="flex-1" />
              <span className="text-[12px] tabular-nums text-[var(--color-text-tertiary)]">
                {words} words · {Math.max(1, Math.round(words / 230))} min read
              </span>
              <button
                type="button"
                title={pinned.has(active.id) ? 'Unpin note' : 'Pin note to the top'}
                aria-pressed={pinned.has(active.id)}
                onClick={() => togglePin(active.id)}
                className={`flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] hover:bg-[var(--surface-hover)] ${pinned.has(active.id) ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill={pinned.has(active.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="-rotate-45">
                  <path d="M9 3h6l-1 6 3 3v2h-4.5V21h-1V14H7v-2l3-3Z" />
                </svg>
                {pinned.has(active.id) ? 'Pinned' : 'Pin'}
              </button>
              <button
                type="button"
                title="Copy note"
                onClick={() => {
                  void navigator.clipboard.writeText(body)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1400)
                }}
                className="ml-2 flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                <CopyIcon width={14} height={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" title="Delete note" onClick={() => void remove(active.id)} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-danger)]">
                <TrashIcon width={14} height={14} />
              </button>
            </header>
            <motion.div key={active.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[780px] px-10 pb-24 pt-8">
                <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">{new Date(active.createdAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <textarea
                  ref={editorRef}
                  value={body}
                  onChange={(e) => change(e.target.value)}
                  onPaste={(e) => {
                    // Pasted text is saved almost immediately.
                    const el = e.currentTarget
                    requestAnimationFrame(() => change(el.value, PASTE_SAVE_DELAY_MS))
                  }}
                  onBlur={() => void flush()}
                  onKeyDown={(e) => {
                    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      void flush()
                    }
                  }}
                  placeholder="Start writing — the first line becomes the title"
                  spellCheck
                  className="select-text min-h-[60vh] w-full resize-none bg-transparent text-[17px] leading-[1.75] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] [field-sizing:content] first-line:text-[26px] first-line:font-bold"
                />
              </div>
            </motion.div>
          </>
        ) : (
          loaded && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-[16px] font-semibold">No note selected</p>
              <button type="button" onClick={() => void create()} className="h-9 rounded-[9px] bg-[var(--color-accent)] px-4 text-[13px] font-semibold text-white hover:brightness-110">
                New note
              </button>
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
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={state.kind}
        initial={{ opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 3 }}
        transition={{ duration: 0.15 }}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${state.kind === 'error' ? 'bg-[var(--color-danger-surface)] text-[var(--color-danger)]' : state.kind === 'saved' ? 'bg-[var(--color-success-surface)] text-[var(--color-success)]' : 'bg-[var(--surface-hover)] text-[var(--color-text-secondary)]'}`}
      >
        {state.kind === 'saved' && (
          <>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
            <button type="button" onClick={onRetry} className="ml-1 underline">
              Retry
            </button>
          </>
        )}
      </motion.span>
    </AnimatePresence>
  )
}
