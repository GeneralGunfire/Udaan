import { invoke } from '@tauri-apps/api/core'
import { chat } from '@/integrations/omniroute/client'
import type { ChatMessage, ChatTool, ChatToolCall } from '@/integrations/omniroute/types'
import { createEvent, listEvents } from '@/integrations/schedule/client'
import type { Attachment, ChatPrefs, Node, Project, Source, ToolStep } from './model'
import { store } from './model'

/**
 * One answer. Builds what the model sees (who you are, today's date, what it
 * remembers, the project's instructions, attachments, the conversation so far),
 * then either streams a plain answer or runs a short tool loop:
 *
 *   web_search, read_web_page   the same native search OmniFind uses
 *   list_folder, read_file      your files, read-only
 *   list_events, add_event      Calendar
 *   remember                    a fact kept for every future chat
 *
 * Tool rounds are capped, failures are reported in the steps, and Stop aborts at once.
 */

const MAX_ROUNDS = 5

type Exec = (args: Record<string, unknown>) => Promise<{ text: string; label: string; sources?: Source[] }>

interface ToolDef {
  group: keyof ChatPrefs['tools']
  def: ChatTool
  run: Exec
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

const TOOLS: ToolDef[] = [
  {
    group: 'web',
    def: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web. Use for anything recent, factual, or that you are unsure of. Returns titles, URLs and snippets.',
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search terms' } }, required: ['query'] },
      },
    },
    run: async (a) => {
      const q = str(a.query)
      const hits = await invoke<{ title: string; url: string; snippet: string }[]>('omni_find_search', { query: q, limit: 6, braveKey: null, tavilyKey: null })
      return {
        label: `Searched the web for “${q}”`,
        text: hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.url}\n${h.snippet}`).join('\n\n') || 'No results.',
        sources: hits.map((h) => ({ title: h.title, url: h.url })),
      }
    },
  },
  {
    group: 'web',
    def: {
      type: 'function',
      function: {
        name: 'read_web_page',
        description: 'Read the text of one web page, usually a URL from web_search.',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
    },
    run: async (a) => {
      const url = str(a.url)
      const p = await invoke<{ title: string; text: string; truncated: boolean }>('omni_find_fetch_page', { url })
      let host = url
      try {
        host = new URL(url).hostname
      } catch {
        /* keep url */
      }
      return { label: `Read ${host}`, text: `${p.title}\n\n${p.text.slice(0, 12_000)}${p.truncated || p.text.length > 12_000 ? '\n…[cut]' : ''}`, sources: [{ title: p.title || host, url }] }
    },
  },
  {
    group: 'files',
    def: {
      type: 'function',
      function: {
        name: 'list_folder',
        description: 'List the files and folders inside a folder on this PC (Windows paths like C:\\Users\\...). Read-only.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    },
    run: async (a) => {
      const path = str(a.path)
      const list = await invoke<{ name: string; isDir: boolean; size: number }[]>('files_list', { dir: path })
      return {
        label: `Looked in ${path}`,
        text:
          list
            .slice(0, 300)
            .map((e) => (e.isDir ? `[folder] ${e.name}` : `${e.name} (${e.size} bytes)`))
            .join('\n') || '(empty)',
      }
    },
  },
  {
    group: 'files',
    def: {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a text file on this PC. Read-only. Large files are cut.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    },
    run: async (a) => {
      const path = str(a.path)
      const f = await store.attach(path)
      if (f.kind !== 'text') return { label: `Opened ${f.name}`, text: `${f.name} is not a text file (${f.kind}).` }
      return { label: `Read ${f.name}`, text: f.text ?? '' }
    },
  },
  {
    group: 'calendar',
    def: {
      type: 'function',
      function: {
        name: 'list_events',
        description: 'List calendar events between two dates (inclusive, YYYY-MM-DD).',
        parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      },
    },
    run: async (a) => {
      const from = str(a.from)
      const to = str(a.to) || from
      const all = await listEvents()
      const hit = all.filter((e) => e.date && e.date >= from && e.date <= to).sort((x, y) => (x.date + (x.startTime ?? '')).localeCompare(y.date + (y.startTime ?? '')))
      return { label: `Checked the calendar ${from === to ? `for ${from}` : `${from} to ${to}`}`, text: hit.map((e) => `${e.date} ${e.allDay || !e.startTime ? 'all day' : `${e.startTime}${e.endTime ? `-${e.endTime}` : ''}`}: ${e.title}${e.status === 'done' ? ' (done)' : ''}`).join('\n') || 'Nothing scheduled.' }
    },
  },
  {
    group: 'calendar',
    def: {
      type: 'function',
      function: {
        name: 'add_event',
        description: 'Add an event to the calendar. Only when the user asked for it.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            start_time: { type: 'string', description: 'HH:mm, 24h. Omit for all day.' },
            duration_minutes: { type: 'number' },
          },
          required: ['title', 'date'],
        },
      },
    },
    run: async (a) => {
      const start = str(a.start_time) || undefined
      const dur = Number(a.duration_minutes) || (start ? 60 : undefined)
      let end: string | undefined
      if (start && dur) {
        const [h, m] = start.split(':').map(Number)
        const t = h * 60 + m + dur
        end = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
      }
      const e = await createEvent({ title: str(a.title), date: str(a.date), startTime: start, endTime: end, category: 'general', allDay: !start, durationMinutes: dur })
      return { label: `Added “${e.title}” to the calendar`, text: `Added: ${e.title} on ${e.date}${start ? ` at ${start}` : ''}.` }
    },
  },
  {
    group: 'memory',
    def: {
      type: 'function',
      function: {
        name: 'remember',
        description: 'Save a lasting fact about the user (name, preferences, ongoing projects) when they share one or ask you to remember it.',
        parameters: { type: 'object', properties: { key: { type: 'string', description: 'Short label, e.g. "name"' }, value: { type: 'string' } }, required: ['key', 'value'] },
      },
    },
    run: async (a) => {
      await store.setFact(str(a.key).slice(0, 60), str(a.value).slice(0, 400))
      return { label: `Remembered ${str(a.key)}`, text: 'Saved.' }
    },
  },
]

function systemPrompt(facts: { key: string; value: string }[], project: Project | null, toolsOn: boolean): string {
  const now = new Date()
  const parts = [
    'You are the assistant built into Udaan, a desktop environment on the user’s Windows PC.',
    `Today is ${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${now.toISOString().slice(0, 10)}), local time ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`,
    'Write clearly and directly. Use Markdown: short paragraphs, lists when they help, fenced code blocks with a language. Do not pad answers.',
  ]
  if (toolsOn) parts.push('You can call tools. Use web_search for current or uncertain facts and cite sources as [1], [2] matching the results. Never invent tool results. When you have what you need, answer.')
  if (facts.length) parts.push('What you know about the user:\n' + facts.map((f) => `- ${f.key}: ${f.value}`).join('\n'))
  if (project?.instructions.trim()) parts.push(`Instructions for this project (“${project.name}”):\n${project.instructions.trim()}`)
  return parts.join('\n\n')
}

function userContent(n: Node): { text: string; images: string[] } {
  let text = n.content
  const images: string[] = []
  for (const a of n.attachments ?? []) {
    if (a.kind === 'text' && a.text) text += `\n\n<attached file name="${a.name}">\n${a.text}\n</attached file>`
    else if (a.kind === 'image' && a.dataUrl) images.push(a.dataUrl)
    else text += `\n\n(Attached ${a.name}, which can’t be read as text.)`
  }
  return { text, images }
}

export interface RunUpdate {
  content?: string
  steps?: ToolStep[]
  sources?: Source[]
  provider?: string
}

/**
 * Answers the last user message in `history`. `onUpdate` receives the answer as it grows.
 * Resolves with the final state; throws on failure (AbortError when stopped).
 */
export async function answer(history: Node[], project: Project | null, prefs: ChatPrefs, signal: AbortSignal, onUpdate: (u: RunUpdate) => void): Promise<RunUpdate> {
  const facts = prefs.tools.memory ? await store.facts().catch(() => []) : []
  const tools = TOOLS.filter((t) => prefs.tools[t.group])
  const msgs: ChatMessage[] = [{ role: 'system', content: systemPrompt(facts, project, tools.length > 0) }]
  // Only the newest message's images are sent; older ones stay described by name.
  let images: string[] = []
  history.forEach((n, i) => {
    if (n.role === 'user') {
      const c = userContent(n)
      msgs.push({ role: 'user', content: c.text })
      if (i === history.length - 1) images = c.images
    } else if (n.content.trim()) msgs.push({ role: 'assistant', content: n.content })
  })

  const steps: ToolStep[] = []
  const sources: Source[] = []
  const addSources = (s?: Source[]) => s?.forEach((x) => !sources.some((y) => y.url === x.url) && sources.push(x))

  // Plain streamed answer when no tools are switched on.
  if (!tools.length) {
    let text = ''
    const r = await chat(msgs, signal, { images, onDelta: (d) => onUpdate({ content: (text += d) }) })
    return { content: r.content || text, provider: r.provider }
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1
    let streamed = ''
    const r = await chat(
      msgs,
      signal,
      { images: round === 0 ? images : undefined, onDelta: last ? (d) => onUpdate({ content: (streamed += d), steps: [...steps], sources: [...sources] }) : undefined },
      last ? undefined : tools.map((t) => t.def),
    )
    if (!r.toolCalls?.length) return { content: r.content || streamed, steps, sources, provider: r.provider }
    // The assistant's tool-call turn, so the transcript stays valid for the next request.
    msgs.push({
      role: 'assistant',
      content: r.content || '',
      tool_calls: r.toolCalls.map((c: ChatToolCall) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments) } })),
    } as ChatMessage)
    for (const call of r.toolCalls) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const tool = tools.find((t) => t.def.function.name === call.function.name)
      let out: string
      if (!tool) {
        out = `Unknown tool ${call.function.name}.`
        steps.push({ name: call.function.name, label: `Tried an unknown tool (${call.function.name})`, ok: false })
      } else if ((call.function.arguments as { __malformed?: boolean }).__malformed) {
        out = 'The arguments were not valid JSON. Try again with valid arguments.'
        steps.push({ name: call.function.name, label: `Sent bad arguments to ${call.function.name}`, ok: false })
      } else {
        try {
          const res = await tool.run(call.function.arguments)
          out = res.text
          addSources(res.sources)
          steps.push({ name: call.function.name, label: res.label, ok: true })
        } catch (e) {
          out = `Failed: ${e instanceof Error ? e.message : String(e)}`
          steps.push({ name: call.function.name, label: `${call.function.name} failed`, ok: false, detail: out })
        }
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content: out.slice(0, 16_000) })
      onUpdate({ steps: [...steps], sources: [...sources] })
    }
  }
  return { content: '', steps, sources }
}

/** A short title for a new conversation, from its first exchange. Falls back to the question itself. */
export async function makeTitle(question: string, reply: string): Promise<string> {
  const fallback = question.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat'
  try {
    const r = await chat(
      [
        { role: 'system', content: 'Write a 2 to 6 word title for this conversation. Reply with the title only, no quotes, no punctuation at the end.' },
        { role: 'user', content: `Q: ${question.slice(0, 600)}\nA: ${reply.slice(0, 600)}` },
      ],
      AbortSignal.timeout(20_000),
      { temperature: 0.2, maxTokens: 20, timeoutSecs: 20 },
    )
    const t = r.content.replace(/^["'#\s]+|["'.\s]+$/g, '').split('\n')[0].slice(0, 70)
    return t || fallback
  } catch {
    return fallback
  }
}

export type { Attachment }
