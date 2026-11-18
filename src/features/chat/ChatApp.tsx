import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { lastProvider } from '@/integrations/omniroute/client'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { answer, makeTitle } from './engine'
import { Markdown } from './Markdown'
import './chat.css'
import {
  activePath,
  childrenOf,
  dayGroup,
  importOldChats,
  loadPrefs,
  newThread,
  patchNode,
  savePrefs,
  select,
  store,
  toMarkdown,
  uid,
  withNode,
  type Attachment,
  type ChatPrefs,
  type Node,
  type Project,
  type Thread,
  type ThreadMeta,
} from './model'

/**
 * CHAT. Conversations live in a sidebar, grouped by project and date, searchable by
 * anything said in them. Every answer can be regenerated and every question edited;
 * both keep the old version as a branch you can step back to. Tools (web, files,
 * calendar, memory) are switched on per your preference and show what they did.
 *
 *   Ctrl+N new chat   Ctrl+K search   Esc stop   ↑ in an empty box edits your last message
 */

/* ── small pieces ────────────────────────────────────────────────── */

function Ico({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', className)} aria-hidden>
      <path d={d} />
    </svg>
  )
}
const I = {
  plus: 'M8 3v10M3 8h10',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14 14',
  send: 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
  stop: 'M4.5 4.5h7v7h-7z',
  clip: 'M10.5 5 6 9.5a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5 5a4.2 4.2 0 0 0 6 6L13.5 10',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  edit: 'M10.5 2.5l3 3-8 8H2.5v-3z',
  retry: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3',
  speak: 'M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4',
  mic: 'M8 10.5a2.5 2.5 0 0 0 2.5-2.5V4a2.5 2.5 0 0 0-5 0v4A2.5 2.5 0 0 0 8 10.5ZM4 7.5a4 4 0 0 0 8 0M8 11.5V14',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  close: 'M4 4l8 8M12 4l-8 8',
  back: 'M10 3.5 5.5 8l4.5 4.5',
  fwd: 'M6 3.5 10.5 8 6 12.5',
  tools: 'M9.5 2.5a3 3 0 0 0-3.6 3.9L2.5 9.8 4.2 11.5 7.6 8.1a3 3 0 0 0 3.9-3.6L9.6 6.4 8.4 6.1 8.1 4.9z',
  sidebar: 'M2.5 3h11v10h-11zM6 3v10',
  folder: 'M1.8 4.2V12.8h12.4V5.6H7.6L6.2 3.4H1.8z',
  pin: 'M6 2.5h4l-.5 4 2 2v1.5h-7V8.5l2-2zM8 10v3.5',
  brain: 'M6 3a2 2 0 0 0-2 2 2 2 0 0 0-1 3.5A2 2 0 0 0 5 12a2 2 0 0 0 3 1V3.5A2 2 0 0 0 6 3ZM10 3a2 2 0 0 1 2 2 2 2 0 0 1 1 3.5A2 2 0 0 1 11 12a2 2 0 0 1-3 1',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  x: 'M5 5l6 6M11 5l-6 6',
  globe: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13ZM1.5 8h13M8 1.5c2 2 2.6 4 2.6 6.5S10 12.5 8 14.5C6 12.5 5.4 10.5 5.4 8S6 3.5 8 1.5',
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
function useToast() {
  const [msg, setMsg] = useState<{ text: string; danger?: boolean } | null>(null)
  const show = useCallback((text: string, danger?: boolean) => {
    setMsg({ text, danger })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setMsg(null), 3200)
  }, [])
  return [msg, show] as const
}

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong.')

/* ── the app ─────────────────────────────────────────────────────── */

export function ChatApp() {
  const [metas, setMetas] = useState<ThreadMeta[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [thread, setThread] = useState<Thread>(() => newThread())
  const [running, setRunning] = useState<string | null>(null) // node id being written
  const [prefs, setPrefsState] = useState<ChatPrefs>(loadPrefs)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ id: string; title: string; snippet: string }[] | null>(null)
  const [dialog, setDialog] = useState<null | { kind: 'project'; project: Project | null } | { kind: 'memory' } | { kind: 'rename'; id: string; title: string }>(null)
  const [toast, showToast] = useToast()
  const abort = useRef<AbortController | null>(null)
  const threadRef = useRef(thread)
  const searchRef = useRef<HTMLInputElement>(null)
  const openMenu = useShellMenu()

  const setPrefs = (p: ChatPrefs) => (setPrefsState(p), savePrefs(p))
  const refreshList = useCallback(() => void store.list().then(setMetas, () => {}), [])

  useEffect(() => {
    void (async () => {
      const n = await importOldChats().catch(() => 0)
      if (n) showToast(`Brought over ${n} conversation${n === 1 ? '' : 's'} from the old Chat`)
      refreshList()
      setProjects(await store.projects().catch(() => []))
    })()
  }, [refreshList, showToast])

  // Saving: debounced while an answer streams, immediately when asked.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const persist = useCallback(
    (t: Thread, now = false) => {
      if (!Object.keys(t.nodes).length) return
      clearTimeout(saveTimer.current)
      const go = () => void store.save(t).then(refreshList, (e) => showToast(`Couldn’t save: ${errText(e)}`, true))
      if (now) go()
      else saveTimer.current = setTimeout(go, 1200)
    },
    [refreshList, showToast],
  )
  const update = useCallback(
    (fn: (t: Thread) => Thread, now = false) => {
      const next = fn(threadRef.current)
      threadRef.current = next
      setThread(next)
      persist(next, now)
      return next
    },
    [persist],
  )

  /* full-text search, debounced */
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setHits(null)
    const t = setTimeout(() => void store.search(q).then(setHits, () => setHits([])), 220)
    return () => clearTimeout(t)
  }, [query])

  const openThread = useCallback(
    async (id: string) => {
      if (id === threadRef.current.id) return
      abort.current?.abort()
      try {
        const t = await store.get(id)
        threadRef.current = t
        setThread(t)
      } catch (e) {
        showToast(errText(e), true)
      }
    },
    [showToast],
  )
  const startNew = useCallback(() => {
    abort.current?.abort()
    const t = newThread(projectFilter)
    threadRef.current = t
    setThread(t)
  }, [projectFilter])

  const project = projects.find((p) => p.id === thread.projectId) ?? null

  /** Writes an answer as a child of `parent` (a user node). */
  const run = useCallback(
    async (parentId: string) => {
      const ctl = new AbortController()
      abort.current?.abort()
      abort.current = ctl
      const t0 = threadRef.current
      const reply: Node = { id: uid(), parent: parentId, role: 'assistant', content: '', createdMs: Date.now() }
      update((t) => withNode(t, reply))
      setRunning(reply.id)
      const history: Node[] = []
      for (let n: Node | undefined = t0.nodes[parentId]; n; n = n.parent ? t0.nodes[n.parent] : undefined) history.unshift(n)
      const isFirst = history.length === 1
      try {
        const res = await answer(history, project, prefs, ctl.signal, (u) => update((t) => patchNode(t, reply.id, { ...u })))
        const provider = res.provider || (await lastProvider().catch(() => ''))
        const t = update((x) => patchNode(x, reply.id, { ...res, provider, content: res.content || '' }), true)
        if (!res.content?.trim()) update((x) => patchNode(x, reply.id, { error: 'The model returned an empty answer.' }), true)
        if (isFirst && t.title === 'New chat') {
          const title = await makeTitle(history[0].content, res.content ?? '')
          if (threadRef.current.id === t.id) update((x) => ({ ...x, title }), true)
          else void store.get(t.id).then((x) => store.save({ ...x, title })).then(refreshList)
        }
      } catch (e) {
        const stopped = (e as Error)?.name === 'AbortError'
        update((t) => patchNode(t, reply.id, stopped ? { stopped: true } : { error: errText(e) }), true)
      } finally {
        if (abort.current === ctl) abort.current = null
        setRunning((r) => (r === reply.id ? null : r))
      }
    },
    [prefs, project, update, refreshList],
  )

  const send = useCallback(
    (text: string, attachments: Attachment[], parent?: string | null) => {
      const path = activePath(threadRef.current)
      const after = parent === undefined ? (path.at(-1)?.id ?? null) : parent
      const n: Node = { id: uid(), parent: after, role: 'user', content: text, createdMs: Date.now(), attachments: attachments.length ? attachments : undefined }
      update((t) => (t.title === 'New chat' && !Object.keys(t.nodes).length ? { ...withNode(t, n), title: text.slice(0, 60) || 'New chat' } : withNode(t, n)), true)
      void run(n.id)
    },
    [run, update],
  )

  const stop = () => abort.current?.abort()

  /* thread actions */
  const deleteThread = async (id: string) => {
    await store.remove(id).catch((e) => showToast(errText(e), true))
    if (id === threadRef.current.id) startNew()
    refreshList()
  }
  const patchMeta = async (id: string, patch: Partial<Thread>) => {
    if (id === threadRef.current.id) update((t) => ({ ...t, ...patch }), true)
    else {
      const t = await store.get(id)
      await store.save({ ...t, ...patch })
      refreshList()
    }
  }
  const exportThread = async (id: string) => {
    const t = id === threadRef.current.id ? threadRef.current : await store.get(id)
    const path = await saveDialog({ defaultPath: `${t.title.replace(/[<>:"/\\|?*]/g, '').slice(0, 60) || 'Chat'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (!path) return
    await store.writeText(path, toMarkdown(t)).then(() => showToast('Exported'), (e) => showToast(errText(e), true))
  }
  const threadMenu = (e: { clientX: number; clientY: number }, m: ThreadMeta | Thread) => {
    const pinned = !!m.pinned
    openMenu(e, [
      { label: 'Rename', onSelect: () => setDialog({ kind: 'rename', id: m.id, title: m.title }) },
      { label: pinned ? 'Unpin' : 'Pin', onSelect: () => void patchMeta(m.id, { pinned: !pinned }) },
      ...projects.map((p) => ({ label: `${m.projectId === p.id ? '✓ ' : ''}Move to ${p.name}`, onSelect: () => void patchMeta(m.id, { projectId: m.projectId === p.id ? null : p.id }) })),
      ...(m.projectId ? [{ label: 'Remove from project', onSelect: () => void patchMeta(m.id, { projectId: null }) }] : []),
      {},
      { label: 'Export as Markdown…', onSelect: () => void exportThread(m.id) },
      { label: 'Copy conversation', onSelect: () => void (m.id === threadRef.current.id ? Promise.resolve(threadRef.current) : store.get(m.id)).then((t) => navigator.clipboard.writeText(toMarkdown(t))).then(() => showToast('Copied')) },
      {},
      { label: 'Delete', danger: true, onSelect: () => void deleteThread(m.id) },
    ])
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') (e.preventDefault(), startNew())
      else if (e.ctrlKey && e.key.toLowerCase() === 'k') (e.preventDefault(), searchRef.current?.focus())
      else if (e.key === 'Escape' && abort.current && !dialog) (e.preventDefault(), stop())
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [startNew, dialog])

  const path = useMemo(() => activePath(thread), [thread])

  /* sidebar list */
  const groups = useMemo(() => {
    const list = metas.filter((m) => !projectFilter || m.projectId === projectFilter)
    const out: { label: string; items: ThreadMeta[] }[] = []
    const pinned = list.filter((m) => m.pinned)
    if (pinned.length) out.push({ label: 'Pinned', items: pinned })
    for (const m of list.filter((x) => !x.pinned)) {
      const g = dayGroup(m.updatedMs)
      const last = out.at(-1)
      if (last && last.label === g) last.items.push(m)
      else out.push({ label: g, items: [m] })
    }
    return out
  }, [metas, projectFilter])

  const saveProjects = (next: Project[]) => {
    setProjects(next)
    void store.setProjects(next).catch((e) => showToast(errText(e), true))
  }

  return (
    <div className="relative flex h-full min-h-0 text-(--u-ink)">
      {prefs.sidebar && (
        <aside className="flex w-[268px] shrink-0 flex-col border-r border-(--u-edge)">
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <Button variant="tinted" className="flex-1 justify-start" onClick={startNew} title="New chat (Ctrl+N)">
              <Ico d={I.plus} /> New chat
            </Button>
            <Button icon size="sm" aria-label="Memory" title="What Chat remembers about you" onClick={() => setDialog({ kind: 'memory' })}>
              <Ico d={I.brain} />
            </Button>
          </div>
          <label className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-[8px] bg-(--u-wash-hover) px-2.5 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
            <Ico d={I.search} size={14} className="text-(--u-ink-3)" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} placeholder="Search all chats" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--u-ink-3)" />
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
                  <button key={h.id} type="button" onClick={() => void openThread(h.id)} className={cn('mb-0.5 flex w-full flex-col gap-0.5 rounded-[8px] px-2.5 py-2 text-left', h.id === thread.id ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)')}>
                    <span className="truncate font-medium">{h.title}</span>
                    {h.snippet && <span className="line-clamp-2 text-[11.5px] text-(--u-ink-3)">{h.snippet}</span>}
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className="flex h-7 items-center justify-between px-2 pt-1">
                  <span className="text-[11px] font-semibold text-(--u-ink-3)">Projects</span>
                  <button type="button" title="New project" onClick={() => setDialog({ kind: 'project', project: null })} className="rounded-[5px] p-0.5 text-(--u-ink-3) hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
                    <Ico d={I.plus} size={13} />
                  </button>
                </div>
                {!projects.length && <p className="px-2.5 pb-1 text-[11.5px] leading-snug text-(--u-ink-3)">Group chats and give them shared instructions.</p>}
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProjectFilter((f) => (f === p.id ? null : p.id))}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      openMenu(e, [
                        { label: 'Edit project…', onSelect: () => setDialog({ kind: 'project', project: p }) },
                        { label: 'New chat in project', onSelect: () => (setProjectFilter(p.id), (threadRef.current = newThread(p.id)), setThread(threadRef.current)) },
                        {},
                        { label: 'Delete project', danger: true, onSelect: () => (saveProjects(projects.filter((x) => x.id !== p.id)), projectFilter === p.id && setProjectFilter(null)) },
                      ])
                    }}
                    className={cn('flex h-[30px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left', projectFilter === p.id ? 'bg-(--u-wash-on) font-medium' : 'hover:bg-(--u-wash-hover)')}
                  >
                    <Ico d={I.folder} size={14} className="text-(--u-accent)" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-[11px] tabular-nums text-(--u-ink-3)">{metas.filter((m) => m.projectId === p.id).length || ''}</span>
                  </button>
                ))}
                {groups.map((g) => (
                  <div key={g.label}>
                    <p className="px-2 pb-1 pt-3 text-[11px] font-semibold text-(--u-ink-3)">{g.label}</p>
                    {g.items.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => void openThread(m.id)}
                        onContextMenu={(e) => (e.preventDefault(), threadMenu(e, m))}
                        className={cn('group mb-px flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2.5 text-left', m.id === thread.id ? 'bg-(--u-wash-on) font-medium' : 'hover:bg-(--u-wash-hover)')}
                      >
                        {m.pinned && <Ico d={I.pin} size={12} className="text-(--u-ink-3)" />}
                        <span className="min-w-0 flex-1 truncate">{m.title}</span>
                        <span
                          role="button"
                          aria-label="More"
                          onClick={(e) => (e.stopPropagation(), threadMenu(e, m))}
                          className="hidden rounded-[5px] p-0.5 text-(--u-ink-3) hover:bg-(--u-wash-press) hover:text-(--u-ink) group-hover:block"
                        >
                          <Ico d={I.more} size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
                {!metas.length && <p className="px-2.5 pt-4 text-[12px] text-(--u-ink-3)">Your conversations will appear here.</p>}
              </>
            )}
          </div>
        </aside>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-(--u-edge) px-3">
          <Button icon size="sm" aria-label="Sidebar" onClick={() => setPrefs({ ...prefs, sidebar: !prefs.sidebar })}>
            <Ico d={I.sidebar} />
          </Button>
          <button type="button" onClick={() => Object.keys(thread.nodes).length && setDialog({ kind: 'rename', id: thread.id, title: thread.title })} className="min-w-0 truncate rounded-[6px] px-1.5 py-0.5 text-left text-[14px] font-semibold hover:bg-(--u-wash-hover)">
            {thread.title}
          </button>
          {project && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-(--u-wash-on) px-2.5 py-0.5 text-[11.5px] text-(--u-ink-2)">
              <Ico d={I.folder} size={12} className="text-(--u-accent)" />
              {project.name}
            </span>
          )}
          <span className="flex-1" />
          {path.length > 0 && (
            <Button icon size="sm" aria-label="Conversation menu" onClick={(e) => threadMenu(e, thread)}>
              <Ico d={I.more} />
            </Button>
          )}
        </header>

        <Conversation
          thread={thread}
          path={path}
          running={running}
          onSuggest={(s) => send(s, [])}
          onEdit={(n, text) => send(text, n.attachments ?? [], n.parent)}
          onRegenerate={(n) => n.parent && void run(n.parent)}
          onSelect={(n) => update((t) => select(t, n), true)}
          showToast={showToast}
          projectName={project?.name}
        />

        <Composer prefs={prefs} setPrefs={setPrefs} running={!!running} onSend={(text, att) => send(text, att)} onStop={stop} lastUser={[...path].reverse().find((n) => n.role === 'user') ?? null} onEditLast={(n, text) => send(text, n.attachments ?? [], n.parent)} showToast={showToast} />
      </main>

      {dialog?.kind === 'project' && (
        <ProjectDialog
          project={dialog.project}
          onClose={() => setDialog(null)}
          onSave={(p) => {
            saveProjects(dialog.project ? projects.map((x) => (x.id === p.id ? p : x)) : [...projects, p])
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'memory' && <MemoryDialog onClose={() => setDialog(null)} showToast={showToast} />}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          title={dialog.title}
          onClose={() => setDialog(null)}
          onSave={(title) => {
            void patchMeta(dialog.id, { title })
            setDialog(null)
          }}
        />
      )}
      {toast && (
        <div className={cn('pointer-events-none absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-(--u-m-solid-hi) px-4 py-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]', toast.danger && 'text-(--u-danger)')}>{toast.text}</div>
      )}
    </div>
  )
}

/* ── the conversation ────────────────────────────────────────────── */

const SUGGESTIONS = ['What’s on my calendar this week?', 'Summarise the latest news on AI', 'Explain a concept like I’m new to it', 'Help me write a professional email']

function Conversation({
  thread,
  path,
  running,
  onSuggest,
  onEdit,
  onRegenerate,
  onSelect,
  showToast,
  projectName,
}: {
  thread: Thread
  path: Node[]
  running: string | null
  onSuggest: (s: string) => void
  onEdit: (n: Node, text: string) => void
  onRegenerate: (n: Node) => void
  onSelect: (n: Node) => void
  showToast: (t: string, d?: boolean) => void
  projectName?: string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = path.at(-1)
  // Follow the answer while it streams, unless you scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [last?.content, last?.steps?.length, path.length])
  useEffect(() => {
    stick.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.id])

  if (!path.length)
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="text-center">
          <p className="text-[26px] font-light tracking-tight">{greeting()}</p>
          <p className="mt-1 text-[13px] text-(--u-ink-3)">{projectName ? `New chat in ${projectName}` : 'Ask anything. Chat can search the web, read your files and check your calendar.'}</p>
        </div>
        <div className="grid w-full max-w-[560px] grid-cols-2 gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => onSuggest(s)} className="rounded-[12px] px-4 py-3 text-left text-[12.5px] text-(--u-ink-2) shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
              {s}
            </button>
          ))}
        </div>
      </div>
    )

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      className="u-scroll min-h-0 flex-1 overflow-y-auto select-text"
    >
      <div className="mx-auto flex w-full max-w-[780px] flex-col gap-6 px-6 pb-10 pt-6">
        {path.map((n) => {
          const sibs = childrenOf(thread, n.parent)
          return n.role === 'user' ? (
            <UserMessage key={n.id} node={n} sibs={sibs} busy={!!running} onEdit={(t) => onEdit(n, t)} onSelect={onSelect} />
          ) : (
            <AssistantMessage key={n.id} node={n} sibs={sibs} live={running === n.id} busy={!!running} onRegenerate={() => onRegenerate(n)} onSelect={onSelect} showToast={showToast} />
          )
        })}
      </div>
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Branches({ sibs, node, onSelect, disabled }: { sibs: Node[]; node: Node; onSelect: (n: Node) => void; disabled: boolean }) {
  if (sibs.length < 2) return null
  const i = sibs.findIndex((s) => s.id === node.id)
  return (
    <span className="flex items-center text-[11.5px] tabular-nums text-(--u-ink-3)">
      <button type="button" disabled={disabled || i === 0} aria-label="Previous version" onClick={() => onSelect(sibs[i - 1])} className="rounded-[5px] p-1 enabled:hover:bg-(--u-wash-hover) enabled:hover:text-(--u-ink) disabled:opacity-40">
        <Ico d={I.back} size={12} />
      </button>
      {i + 1} / {sibs.length}
      <button type="button" disabled={disabled || i === sibs.length - 1} aria-label="Next version" onClick={() => onSelect(sibs[i + 1])} className="rounded-[5px] p-1 enabled:hover:bg-(--u-wash-hover) enabled:hover:text-(--u-ink) disabled:opacity-40">
        <Ico d={I.fwd} size={12} />
      </button>
    </span>
  )
}

function Act({ d, label, onClick, active }: { d: string; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={cn('rounded-[6px] p-1.5 text-(--u-ink-3) hover:bg-(--u-wash-hover) hover:text-(--u-ink)', active && 'text-(--u-accent)')}>
      <Ico d={d} size={14} />
    </button>
  )
}

const UserMessage = memo(function UserMessage({ node, sibs, busy, onEdit, onSelect }: { node: Node; sibs: Node[]; busy: boolean; onEdit: (text: string) => void; onSelect: (n: Node) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.content)
  if (editing)
    return (
      <div className="ml-auto flex w-full max-w-[640px] flex-col gap-2 rounded-[14px] bg-(--u-wash-hover) p-3 shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), draft.trim() && (setEditing(false), onEdit(draft.trim())))
            if (e.key === 'Escape') setEditing(false)
          }}
          className="min-h-[60px] w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none [field-sizing:content]"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="tinted" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="accent" disabled={!draft.trim() || busy} onClick={() => (setEditing(false), onEdit(draft.trim()))}>
            Send
          </Button>
        </div>
      </div>
    )
  return (
    <div className="group ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
      {node.attachments?.length ? <AttachmentChips list={node.attachments} /> : null}
      <div className="whitespace-pre-wrap break-words rounded-[16px] rounded-br-[5px] bg-(--u-wash-on) px-4 py-2.5 text-[14px] leading-relaxed">{node.content}</div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
        <Branches sibs={sibs} node={node} onSelect={onSelect} disabled={busy} />
        {!busy && <Act d={I.edit} label="Edit and resend" onClick={() => (setDraft(node.content), setEditing(true))} />}
        <Act d={I.copy} label="Copy" onClick={() => void navigator.clipboard.writeText(node.content)} />
      </div>
    </div>
  )
})

let speaking: string | null = null
function speak(id: string, text: string, onEnd: () => void) {
  speechSynthesis.cancel()
  if (speaking === id) return (speaking = null), onEnd()
  const plain = text.replace(/```[\s\S]*?```/g, ' (code) ').replace(/[#*_`>[\]()]/g, '').replace(/https?:\/\/\S+/g, '')
  const u = new SpeechSynthesisUtterance(plain)
  u.onend = u.onerror = () => ((speaking = null), onEnd())
  speaking = id
  speechSynthesis.speak(u)
}

const AssistantMessage = memo(function AssistantMessage({ node, sibs, live, busy, onRegenerate, onSelect, showToast }: { node: Node; sibs: Node[]; live: boolean; busy: boolean; onRegenerate: () => void; onSelect: (n: Node) => void; showToast: (t: string, d?: boolean) => void }) {
  const [stepsOpen, setStepsOpen] = useState(false)
  const [talking, setTalking] = useState(false)
  const thinking = live && !node.content
  return (
    <div className="group flex flex-col gap-2">
      {node.steps?.length ? (
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => setStepsOpen((o) => !o)} className="flex w-fit items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[12px] text-(--u-ink-3) hover:bg-(--u-wash-hover) hover:text-(--u-ink-2)">
            <Ico d={I.tools} size={12} />
            {live && !node.content ? node.steps.at(-1)!.label + '…' : `Used ${node.steps.length} tool${node.steps.length === 1 ? '' : 's'}`}
            <Ico d={stepsOpen ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} size={11} />
          </button>
          {stepsOpen && (
            <ul className="ml-2 flex flex-col gap-1 border-l border-(--u-edge) pl-3 text-[12px] text-(--u-ink-2)">
              {node.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Ico d={s.ok ? I.check : I.x} size={12} className={cn('mt-[3px]', s.ok ? 'text-(--u-ok)' : 'text-(--u-danger)')} />
                  <span>
                    {s.label}
                    {s.detail && <span className="block text-(--u-ink-3)">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {thinking ? (
        <div className="flex items-center gap-1.5 py-2" aria-label="Thinking">
          {[0, 1, 2].map((i) => (
            <span key={i} className="chat-dot h-1.5 w-1.5 rounded-full bg-(--u-ink-3)" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </div>
      ) : node.content ? (
        <div className="select-text">
          <Markdown text={node.content} />
          {live && <span className="chat-caret ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[3px] rounded-[1px] bg-(--u-accent)" />}
        </div>
      ) : null}

      {node.stopped && <p className="text-[12px] text-(--u-ink-3)">Stopped.</p>}
      {node.error && (
        <div className="flex items-center gap-3 rounded-[10px] bg-[color-mix(in_srgb,var(--u-danger)_12%,transparent)] px-3.5 py-2.5 text-[12.5px]">
          <span className="min-w-0 flex-1 text-(--u-ink-2)">
            <span className="font-medium text-(--u-danger)">No answer. </span>
            {node.error}
          </span>
          {!busy && (
            <Button size="sm" variant="tinted" onClick={onRegenerate}>
              Try again
            </Button>
          )}
        </div>
      )}

      {node.sources?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {node.sources.slice(0, 8).map((s, i) => {
            let host = s.url
            try {
              host = new URL(s.url).hostname.replace(/^www\./, '')
            } catch {
              /* keep */
            }
            return (
              <a key={s.url} href={s.url} title={s.title} onClick={(e) => (e.preventDefault(), void import('@/integrations/installed-apps/client').then((m) => m.launchApp(s.url)).catch(() => {}))} className="flex max-w-[220px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] text-(--u-ink-2) shadow-[inset_0_0_0_1px_var(--u-edge)] hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
                <span className="text-(--u-accent)">{i + 1}</span>
                <span className="truncate">{host}</span>
              </a>
            )
          })}
        </div>
      ) : null}

      {!live && (
        <div className="-ml-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
          {node.content && <Act d={I.copy} label="Copy" onClick={() => void navigator.clipboard.writeText(node.content).then(() => showToast('Copied'))} />}
          {!busy && <Act d={I.retry} label="Regenerate" onClick={onRegenerate} />}
          {node.content && <Act d={I.speak} label={talking ? 'Stop reading' : 'Read aloud'} active={talking} onClick={() => (setTalking(true), speak(node.id, node.content, () => setTalking(false)))} />}
          <Branches sibs={sibs} node={node} onSelect={onSelect} disabled={busy} />
          {node.provider && <span className="ml-2 text-[11px] text-(--u-ink-3)">{node.provider}</span>}
        </div>
      )}
    </div>
  )
})

function AttachmentChips({ list, onRemove }: { list: Attachment[]; onRemove?: (i: number) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {list.map((a, i) => (
        <span key={i} className="flex max-w-[240px] items-center gap-2 rounded-[10px] bg-(--u-wash-hover) py-1 pl-1 pr-2.5 text-[12px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
          {a.kind === 'image' && a.dataUrl ? <img src={a.dataUrl} alt="" className="h-8 w-8 rounded-[6px] object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-(--u-wash-on) text-[9px] font-semibold uppercase text-(--u-ink-2)">{a.name.split('.').pop()?.slice(0, 4)}</span>}
          <span className="min-w-0 truncate">{a.name}</span>
          {onRemove && (
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(i)} className="text-(--u-ink-3) hover:text-(--u-ink)">
              <Ico d={I.close} size={10} />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

/* ── composer ────────────────────────────────────────────────────── */

type SR = { start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string }
const SpeechRec: (new () => SR) | undefined = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition

function Composer({ prefs, setPrefs, running, onSend, onStop, lastUser, onEditLast, showToast }: { prefs: ChatPrefs; setPrefs: (p: ChatPrefs) => void; running: boolean; onSend: (text: string, att: Attachment[]) => void; onStop: () => void; lastUser: Node | null; onEditLast: (n: Node, text: string) => void; showToast: (t: string, d?: boolean) => void }) {
  const [text, setText] = useState('')
  const [att, setAtt] = useState<Attachment[]>([])
  const [toolsOpen, setToolsOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [editingLast, setEditingLast] = useState<Node | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const rec = useRef<SR | null>(null)

  useEffect(() => box.current?.focus(), [])

  const addPaths = useCallback(
    async (paths: string[]) => {
      for (const p of paths.slice(0, 10)) {
        try {
          const a = await store.attach(p)
          setAtt((l) => [...l, a])
        } catch (e) {
          showToast(errText(e), true)
        }
      }
    },
    [showToast],
  )

  // Files dragged in from Windows.
  useEffect(() => {
    let un: (() => void) | undefined
    let dead = false
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === 'enter' || e.payload.type === 'over') setDropping(true)
        else if (e.payload.type === 'drop') (setDropping(false), void addPaths(e.payload.paths))
        else setDropping(false)
      })
      .then((u) => (dead ? u() : (un = u)))
    return () => {
      dead = true
      un?.()
    }
  }, [addPaths])

  const submit = () => {
    const t = text.trim()
    if (running || (!t && !att.length)) return
    if (editingLast) onEditLast(editingLast, t)
    else onSend(t, att)
    setText('')
    setAtt([])
    setEditingLast(null)
  }

  const toggleMic = () => {
    if (!SpeechRec) return
    if (listening) return rec.current?.stop()
    const r = new SpeechRec()
    r.continuous = true
    r.interimResults = false
    r.lang = navigator.language || 'en-US'
    r.onresult = (e) => {
      let said = ''
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript
      setText((t) => (t ? t + ' ' : '') + said.trim())
    }
    r.onerror = (e) => showToast(e.error === 'not-allowed' ? 'Microphone access was refused.' : e.error === 'network' ? 'Dictation needs an internet connection.' : `Dictation stopped (${e.error}).`, true)
    r.onend = () => setListening(false)
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch (e) {
      showToast(errText(e), true)
    }
  }

  const toolCount = Object.values(prefs.tools).filter(Boolean).length
  const T = (key: keyof ChatPrefs['tools'], label: string, hint: string) => (
    <label className="flex items-center gap-3 rounded-[8px] px-2.5 py-2 hover:bg-(--u-wash-hover)">
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px]">{label}</span>
        <span className="block text-[11px] text-(--u-ink-3)">{hint}</span>
      </span>
      <Switch checked={prefs.tools[key]} onChange={(v) => setPrefs({ ...prefs, tools: { ...prefs.tools, [key]: v } })} label={label} />
    </label>
  )

  return (
    <div className="shrink-0 px-6 pb-5 pt-2">
      <div
        className={cn('relative mx-auto flex w-full max-w-[780px] flex-col gap-2 rounded-[18px] bg-(--u-wash-hover) p-2.5 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]', dropping && 'shadow-[inset_0_0_0_2px_var(--u-accent)]')}
      >
        {editingLast && (
          <div className="flex items-center justify-between px-2 text-[11.5px] text-(--u-ink-3)">
            Editing your last message. It will be kept as an earlier version.
            <button type="button" className="hover:text-(--u-ink)" onClick={() => (setEditingLast(null), setText(''))}>
              Cancel
            </button>
          </div>
        )}
        {att.length > 0 && (
          <div className="px-1">
            <div className="[&>div]:justify-start">
              <AttachmentChips list={att} onRemove={(i) => setAtt((l) => l.filter((_, k) => k !== i))} />
            </div>
          </div>
        )}
        <textarea
          ref={box}
          value={text}
          rows={1}
          placeholder={dropping ? 'Drop to attach' : 'Message Chat'}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (!files.length) return
            e.preventDefault()
            for (const f of files) {
              if (f.size > 6 * 1024 * 1024) {
                showToast('Pasted image is larger than 6 MB.', true)
                continue
              }
              const r = new FileReader()
              r.onload = () => setAtt((l) => [...l, { name: f.name || 'Pasted image.png', path: '', kind: 'image', dataUrl: String(r.result), size: f.size }])
              r.readAsDataURL(f)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && prefs.enterToSend && !e.nativeEvent.isComposing) (e.preventDefault(), submit())
            else if (e.key === 'Enter' && e.ctrlKey) (e.preventDefault(), submit())
            else if (e.key === 'ArrowUp' && !text && lastUser && !running) (e.preventDefault(), setEditingLast(lastUser), setText(lastUser.content))
            else if (e.key === 'Escape' && editingLast) (setEditingLast(null), setText(''))
          }}
          className="max-h-[220px] min-h-[24px] w-full resize-none bg-transparent px-2 py-1 text-[14px] leading-relaxed outline-none placeholder:text-(--u-ink-3) [field-sizing:content]"
        />
        <div className="flex items-center gap-1">
          <Button
            icon
            size="sm"
            aria-label="Attach files"
            title="Attach files (or drag them in, or paste an image)"
            onClick={async () => {
              const picked = await openDialog({ multiple: true })
              if (picked) void addPaths(Array.isArray(picked) ? picked : [picked])
            }}
          >
            <Ico d={I.clip} />
          </Button>
          <div className="relative">
            <Button size="sm" onClick={() => setToolsOpen((o) => !o)} className={cn(toolCount > 0 && 'text-(--u-accent)')} title="Tools Chat may use">
              <Ico d={I.globe} size={14} /> Tools {toolCount > 0 ? toolCount : 'off'}
            </Button>
            {toolsOpen && (
              <>
                <div className="fixed inset-0 z-40" onPointerDown={() => setToolsOpen(false)} />
                <div className="absolute bottom-[38px] left-0 z-50 w-[300px] rounded-[12px] bg-(--u-m-solid-hi) p-1.5 shadow-[inset_0_0_0_1px_var(--u-edge)]">
                  {T('web', 'Web', 'Search and read pages, with sources')}
                  {T('files', 'Files', 'List folders and read text files (read-only)')}
                  {T('calendar', 'Calendar', 'See your events and add new ones')}
                  {T('memory', 'Memory', 'Remember facts about you across chats')}
                  <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-(--u-ink-3)">With every tool off, answers stream word by word. Free providers sometimes skip tools.</p>
                </div>
              </>
            )}
          </div>
          {SpeechRec && (
            <Button icon size="sm" aria-label={listening ? 'Stop dictation' : 'Dictate'} title={listening ? 'Stop dictation' : 'Dictate'} onClick={toggleMic} className={cn(listening && 'text-(--u-danger)')}>
              <Ico d={I.mic} />
            </Button>
          )}
          <span className="flex-1" />
          <span className="mr-2 hidden text-[11px] text-(--u-ink-3) sm:block">{running ? 'Esc to stop' : 'Enter to send · Shift+Enter for a new line'}</span>
          {running ? (
            <Button icon size="sm" variant="tinted" aria-label="Stop" title="Stop (Esc)" onClick={onStop}>
              <Ico d={I.stop} />
            </Button>
          ) : (
            <Button icon size="sm" variant="accent" aria-label="Send" disabled={!text.trim() && !att.length} onClick={submit}>
              <Ico d={I.send} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── dialogs ─────────────────────────────────────────────────────── */

function Sheet({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
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
        {children}
      </div>
    </div>
  )
}

function RenameDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (t: string) => void }) {
  const [v, setV] = useState(title)
  return (
    <Sheet title="Rename chat" onClose={onClose} width={400}>
      <form className="flex flex-col gap-4 p-5" onSubmit={(e) => (e.preventDefault(), v.trim() && onSave(v.trim()))}>
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
    </Sheet>
  )
}

function ProjectDialog({ project, onClose, onSave }: { project: Project | null; onClose: () => void; onSave: (p: Project) => void }) {
  const [name, setName] = useState(project?.name ?? '')
  const [instructions, setInstructions] = useState(project?.instructions ?? '')
  return (
    <Sheet title={project ? 'Edit project' : 'New project'} onClose={onClose} width={520}>
      <form className="flex flex-col gap-4 p-5" onSubmit={(e) => (e.preventDefault(), name.trim() && onSave({ id: project?.id ?? uid(), name: name.trim(), instructions }))}>
        <label className="flex flex-col gap-1.5 text-[12.5px]">
          <span className="text-(--u-ink-3)">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thesis, Client work, Home renovation" className="u-field h-9" />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px]">
          <span className="text-(--u-ink-3)">Instructions for every chat in this project</span>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={7} placeholder="Background, tone, what to focus on, things to avoid…" className="u-field min-h-[140px] resize-y py-2 leading-relaxed" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="tinted" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" disabled={!name.trim()}>
            {project ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function MemoryDialog({ onClose, showToast }: { onClose: () => void; showToast: (t: string, d?: boolean) => void }) {
  const [facts, setFacts] = useState<{ key: string; value: string }[] | null>(null)
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const load = useCallback(() => void store.facts().then(setFacts, (e) => (showToast(errText(e), true), setFacts([]))), [showToast])
  useEffect(load, [load])
  return (
    <Sheet title="Memory" onClose={onClose} width={520}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-[12.5px] leading-relaxed text-(--u-ink-3)">Chat reads these before every conversation. It adds to them when you tell it something worth keeping (with the Memory tool on). Remove anything you don’t want it to know.</p>
        <div className="u-scroll flex max-h-[300px] flex-col gap-1 overflow-y-auto">
          {facts?.length === 0 && <p className="py-4 text-center text-[12.5px] text-(--u-ink-3)">Nothing remembered yet.</p>}
          {facts?.map((f) => (
            <div key={f.key} className="flex items-start gap-3 rounded-[8px] px-3 py-2 hover:bg-(--u-wash-hover)">
              <span className="w-[120px] shrink-0 truncate text-[12.5px] font-medium" title={f.key}>
                {f.key}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] text-(--u-ink-2)">{f.value}</span>
              <button type="button" aria-label={`Forget ${f.key}`} onClick={() => void store.deleteFact(f.key).then(load)} className="text-(--u-ink-3) hover:text-(--u-danger)">
                <Ico d={I.close} size={12} />
              </button>
            </div>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!k.trim() || !v.trim()) return
            void store.setFact(k.trim(), v.trim()).then(() => (setK(''), setV(''), load()))
          }}
        >
          <input value={k} onChange={(e) => setK(e.target.value)} placeholder="Label (e.g. name)" className="u-field h-8 w-[140px]" />
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder="What to remember" className="u-field h-8 min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="accent" disabled={!k.trim() || !v.trim()}>
            Add
          </Button>
        </form>
      </div>
    </Sheet>
  )
}

export default ChatApp
