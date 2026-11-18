import { invoke } from '@tauri-apps/api/core'

/**
 * A conversation is a TREE of messages. Editing a question or regenerating an
 * answer adds a sibling instead of overwriting, so every version is kept and you
 * can step between them (‹ 2 / 3 ›). What you see is one path through the tree,
 * chosen by `selected` (parent id, or "root", -> the child shown).
 */

export interface Attachment {
  name: string
  path: string
  kind: 'text' | 'image' | 'binary'
  text?: string | null
  dataUrl?: string | null
  size: number
}

export interface ToolStep {
  name: string
  label: string
  ok: boolean
  detail?: string
}

export interface Source {
  title: string
  url: string
}

export interface Node {
  id: string
  parent: string | null
  role: 'user' | 'assistant'
  content: string
  createdMs: number
  attachments?: Attachment[]
  steps?: ToolStep[]
  sources?: Source[]
  provider?: string
  error?: string
  /** The answer was stopped part-way. */
  stopped?: boolean
}

export interface Thread {
  id: string
  title: string
  projectId?: string | null
  pinned?: boolean
  createdMs: number
  updatedMs: number
  nodes: Record<string, Node>
  selected: Record<string, string>
}

export interface ThreadMeta {
  id: string
  title: string
  projectId: string | null
  pinned: boolean
  createdMs: number
  updatedMs: number
  messages: number
}

export interface Project {
  id: string
  name: string
  instructions: string
}

export const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9-]/g, '')

export const newThread = (projectId?: string | null): Thread => ({ id: uid(), title: 'New chat', projectId: projectId ?? null, createdMs: Date.now(), updatedMs: Date.now(), nodes: {}, selected: {} })

export const childrenOf = (t: Thread, parent: string | null) =>
  Object.values(t.nodes)
    .filter((n) => n.parent === parent)
    .sort((a, b) => a.createdMs - b.createdMs)

/** The messages currently shown, top to bottom. */
export function activePath(t: Thread): Node[] {
  const out: Node[] = []
  let parent: string | null = null
  for (;;) {
    const kids = childrenOf(t, parent)
    if (!kids.length) break
    const pick = kids.find((k) => k.id === t.selected[parent ?? 'root']) ?? kids[kids.length - 1]
    out.push(pick)
    parent = pick.id
  }
  return out
}

export function withNode(t: Thread, n: Node): Thread {
  return { ...t, nodes: { ...t.nodes, [n.id]: n }, selected: { ...t.selected, [n.parent ?? 'root']: n.id }, updatedMs: Date.now() }
}
export function patchNode(t: Thread, id: string, patch: Partial<Node>): Thread {
  const n = t.nodes[id]
  return n ? { ...t, nodes: { ...t.nodes, [id]: { ...n, ...patch } }, updatedMs: Date.now() } : t
}
export function select(t: Thread, node: Node): Thread {
  return { ...t, selected: { ...t.selected, [node.parent ?? 'root']: node.id } }
}

/** A plain-text version of the whole visible conversation, for export and copying. */
export function toMarkdown(t: Thread): string {
  const lines = [`# ${t.title}`, '', `_${new Date(t.createdMs).toLocaleString()}_`, '']
  for (const n of activePath(t)) {
    lines.push(n.role === 'user' ? '## You' : '## Assistant', '')
    if (n.attachments?.length) lines.push(`Attached: ${n.attachments.map((a) => a.name).join(', ')}`, '')
    lines.push(n.content, '')
    if (n.sources?.length) lines.push('Sources:', ...n.sources.map((s) => `- [${s.title}](${s.url})`), '')
  }
  return lines.join('\n')
}

/* ── backend ─────────────────────────────────────────────────────── */

export const store = {
  list: () => invoke<ThreadMeta[]>('chat_list'),
  get: (id: string) => invoke<Thread>('chat_get', { id }),
  save: (thread: Thread) => invoke<void>('chat_save', { thread }),
  remove: (id: string) => invoke<void>('chat_delete', { id }),
  search: (query: string) => invoke<{ id: string; title: string; snippet: string; updatedMs: number }[]>('chat_search', { query }),
  projects: () => invoke<Project[]>('chat_projects_get'),
  setProjects: (projects: Project[]) => invoke<void>('chat_projects_set', { projects }),
  attach: (path: string) => invoke<Attachment>('chat_read_attachment', { path }),
  writeText: (path: string, text: string) => invoke<void>('chat_write_text', { path, text }),
  facts: () => invoke<{ key: string; value: string }[]>('general_chat_list_memory_facts'),
  setFact: (key: string, value: string) => invoke<void>('general_chat_set_memory_fact', { key, value }),
  deleteFact: (key: string) => invoke<void>('general_chat_delete_memory_fact', { key }),
}

/**
 * One-time import of conversations from the previous Chat (SQLite), so nothing is lost.
 * Each old session becomes a thread with a single linear path.
 */
export async function importOldChats(): Promise<number> {
  try {
    if (localStorage.getItem('chat2.imported') === '1') return 0
  } catch {
    return 0
  }
  let count = 0
  for (const provider of ['omniroute', 'local']) {
    const sessions = await invoke<{ id: string; title: string; created_at: string; updated_at: string }[]>('general_chat_list_sessions', { provider }).catch(() => [])
    for (const s of sessions) {
      const msgs = await invoke<{ id: string; role: 'user' | 'assistant'; content: string; created_at: string }[]>('general_chat_list_messages', { sessionId: s.id }).catch(() => [])
      if (!msgs.length) continue
      let t: Thread = { id: uid(), title: s.title || 'Imported chat', projectId: null, createdMs: Date.parse(s.created_at) || Date.now(), updatedMs: Date.parse(s.updated_at) || Date.now(), nodes: {}, selected: {} }
      let parent: string | null = null
      for (const m of msgs) {
        if (!m.content?.trim()) continue
        const n: Node = { id: uid(), parent, role: m.role === 'user' ? 'user' : 'assistant', content: m.content, createdMs: Date.parse(m.created_at) || Date.now() }
        t = withNode(t, n)
        parent = n.id
      }
      t.updatedMs = Date.parse(s.updated_at) || t.updatedMs
      await store.save(t)
      count++
    }
  }
  try {
    localStorage.setItem('chat2.imported', '1')
  } catch {
    /* ignore */
  }
  return count
}

/* ── tiny shared settings ────────────────────────────────────────── */

export interface ChatPrefs {
  tools: { web: boolean; files: boolean; calendar: boolean; memory: boolean }
  enterToSend: boolean
  sidebar: boolean
}
const KEY = 'chat2.prefs'
const DEFAULTS: ChatPrefs = { tools: { web: true, files: true, calendar: true, memory: true }, enterToSend: true, sidebar: true }
export function loadPrefs(): ChatPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { ...DEFAULTS, ...p, tools: { ...DEFAULTS.tools, ...(p.tools ?? {}) } }
  } catch {
    return DEFAULTS
  }
}
export function savePrefs(p: ChatPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export function dayGroup(ms: number): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  if (ms >= start) return 'Today'
  if (ms >= start - day) return 'Yesterday'
  if (ms >= start - 7 * day) return 'Previous 7 days'
  if (ms >= start - 30 * day) return 'Previous 30 days'
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
