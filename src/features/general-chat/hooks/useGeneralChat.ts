import { useCallback, useEffect, useRef, useState } from 'react'
import {
  chat as omniRouteChat,
  type ChatMessage as OmniRouteMessage,
} from '@/integrations/omniroute'
import {
  isScheduleQuery,
  buildScheduleContextMessage,
  SCHEDULE_QUERY_TEMPERATURE,
  isScheduleActionRequest,
  SCHEDULE_TOOLS,
  executeScheduleToolCall,
  buildEventIdReference,
  SCHEDULE_EVENTS,
  type OllamaToolCall,
} from '@/integrations/schedule'
import {
  createSession,
  listSessions,
  listMessages,
  addMessage,
  updateMessage,
  deleteSession as deleteSessionApi,
  listMemoryFacts,
  type ChatSession,
} from '@/integrations/general-chat'
import { AGENT_WORKSPACE_TOOLS, executeAgentToolCall, getWorkspacePath } from '@/integrations/agent-workspace'
import type { ModeId } from '../components/modes'
import type { ChatMessageData, ChatMessageStep } from '../components/ChatMessage'
import { isAgentTaskRequest } from '../lib/agentIntent'
import { invoke } from '@tauri-apps/api/core'
import { search as webSearch, fetchPage } from '@/integrations/omni-find/client'

/** Questions that need today's information, not the model's memory. */
const CURRENT_EVENTS = /\b(latest|today|tonight|yesterday|this week|right now|currently|news|update|price of|prices?|weather|score|who won|election|stock|exchange rate|rand|release date|2025|2026)\b/i

/** Searches the web and reads the top pages; returns numbered sources for the prompt. */
async function gatherWeb(query: string, signal: AbortSignal): Promise<{ context: string; sources: { title: string; url: string }[] }> {
  const hits = await webSearch(query, 10).catch(() => [])
  const top = hits.slice(0, 8)
  // Read the best few pages in parallel; each gets 12s before it is skipped.
  const pages = await Promise.all(
    top.slice(0, 5).map((h) =>
      Promise.race([fetchPage(h.url).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 12_000))]),
    ),
  )
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const sources = top.map((h) => ({ title: h.title, url: h.url }))
  const blocks = top.map((h, i) => {
    const page = pages[i]
    const body = page?.text ? page.text.slice(0, 2200) : h.snippet
    return `[${i + 1}] ${h.title}\n${h.url}\n${body}`
  })
  return { context: blocks.join('\n\n---\n\n'), sources }
}

const IMAGE_MD = /!\[[^\]]*\]\([^)]*\)/g

/** "draw a fox", "generate an image of…", "/imagine …" → the thing to draw; otherwise null. */
function imageRequest(prompt: string): string | null {
  const p = prompt.trim()
  const slash = p.match(/^\/(?:imagine|image|draw)\s+(.+)/i)
  if (slash) return slash[1]
  const m = p.match(/^(?:please\s+)?(?:can you\s+)?(?:draw|paint|sketch|generate|create|make|design)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|illustration|drawing|painting|logo|wallpaper|art(?:work)?)?\s*(?:of|showing|with)?\s+(.+)/i)
  if (m && /(draw|paint|sketch|image|picture|photo|illustration|drawing|painting|logo|wallpaper|art)/i.test(p)) return m[1].replace(/[.?!]+$/, '')
  return null
}

/** Hard cap on tool-calling steps per user turn — forces a stop and an honest message rather than looping silently forever against a flaky backend. */
const MAX_AGENT_STEPS = 10

/**
 * Turns a raw OmniRoute client error into something a reader can act on.
 * The prior version always appended "Is OmniRoute running?" and dumped
 * the entire raw response body (a JSON blob with a `diagnostics` object
 * listing every provider combo it tried) straight into the chat bubble
 * — misleading when OmniRoute plainly *did* respond (it's not a
 * reachability problem), and unreadable either way. `client.ts`'s
 * "Cannot reach OmniRoute at …" message already covers true
 * unreachability distinctly (a network-level fetch failure, not an HTTP
 * error status), so this only needs to handle "OmniRoute answered, but
 * with an error" — which after `RETRYABLE_STATUSES` already retries
 * 401/429/499/502/503 a couple of times, means every retry attempt
 * genuinely failed.
 */
function describeOmniRouteError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).replace(/^Error: /, '')
  return `I could not get an answer: ${raw.slice(0, 220)}

Open Settings > AI to check the providers, then send again.`
}

/**
 * General Chat talks to OmniRoute (a local multi-provider cloud proxy) —
 * the local Ollama-backed mode was removed along with Ollama itself.
 * `mode` is kept as a parameter (always `'omniroute'` today) so session
 * storage/history stay scoped the same way if another provider mode is
 * ever added back.
 */
export function useGeneralChat(mode: ModeId) {
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [responding, setResponding] = useState(false)
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const abortRef = useRef<AbortController | null>(null)
  // Assistant-message DB row ids only exist once the row is first persisted
  // (after the reply resolves) — this maps in-memory message id -> db id so
  // a later updateMessage() call targets the right row.
  const dbMessageId = useRef<Map<string, string>>(new Map())
  // Cross-session key facts (e.g. name, timezone) — loaded once and
  // prepended to every turn's system prompt so the model has some memory
  // beyond the current conversation. Refreshed on mount only; a fact
  // written mid-session takes effect on the *next* new session.
  const memoryFactsRef = useRef<string>('')
  // The conversation so far, sent with every turn so replies have context.
  const messagesRef = useRef<ChatMessageData[]>([])
  messagesRef.current = messages

  const loadSessionList = useCallback(async () => {
    try {
      const list = await listSessions(mode)
      setSessions(list)
      return list
    } catch (err) {
      console.error('Failed to list chat sessions:', err)
      return []
    }
  }, [mode])

  const loadSession = useCallback(async (id: string) => {
    const stored = await listMessages(id)
    setSessionId(id)
    setMessages(
      stored.map((m) => ({
        id: m.id,
        role: m.role,
        mode: (m.mode as ModeId) ?? 'omniroute',
        text: m.content,
        createdAt: m.created_at,
      })),
    )
    dbMessageId.current.clear()
    for (const m of stored) {
      dbMessageId.current.set(m.id, m.id)
    }
  }, [])

  // On mount and whenever the active mode changes, load that provider's
  // session list and restore its most recently active session.
  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    ;(async () => {
      try {
        const list = await loadSessionList()
        const latest = list[0]
        if (latest && !cancelled) {
          await loadSession(latest.id)
        } else if (!cancelled) {
          setSessionId(null)
          setMessages([])
          dbMessageId.current.clear()
        }
      } catch (err) {
        console.error('Failed to restore chat history:', err)
      } finally {
        if (!cancelled) setLoadingHistory(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode, loadSessionList, loadSession])

  useEffect(() => {
    listMemoryFacts()
      .then((facts) => {
        memoryFactsRef.current =
          facts.length > 0 ? facts.map((f) => `- ${f.key}: ${f.value}`).join('\n') : ''
      })
      .catch((err) => console.error('Failed to load memory facts:', err))
  }, [])

  /** Writes an assistant message's final text to the DB row created for it (see `send`). */
  const persistAssistantContent = useCallback((messageId: string, content: string) => {
    const dbId = dbMessageId.current.get(messageId)
    if (dbId) {
      updateMessage(dbId, content).catch((err) => console.error('Failed to persist message:', err))
    }
  }, [])

  const updateAssistant = useCallback((assistantId: string, patch: Partial<ChatMessageData>) => {
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)))
  }, [])

  const appendStep = useCallback(
    (assistantId: string, step: ChatMessageStep) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, steps: [...(m.steps ?? []), step] } : m)),
      )
    },
    [],
  )

  /**
   * The agentic tool-calling loop for the sandboxed file workspace. Real
   * multi-turn tool-calling: each tool result is fed back to the model as
   * a `tool` message and the model is called again, up to MAX_AGENT_STEPS
   * times, rather than the schedule path's fixed two-call pattern. Given
   * OmniRoute's free-tier backends' known failure rate, a malformed or
   * failing tool call is surfaced as a failed step and the loop stops
   * there rather than retrying silently or pretending success.
   */
  const runAgentLoop = useCallback(
    async (prompt: string, assistantId: string, controller: AbortController, systemPreamble: string) => {
      const history: OmniRouteMessage[] = [
        { role: 'system', content: systemPreamble },
        { role: 'user', content: prompt },
      ]

      for (let step = 0; step < MAX_AGENT_STEPS; step++) {
        const result = await omniRouteChat(history, controller.signal, undefined, AGENT_WORKSPACE_TOOLS)

        if (!result.toolCalls || result.toolCalls.length === 0) {
          const text = result.content || '(empty response)'
          updateAssistant(assistantId, { text })
          persistAssistantContent(assistantId, text)
          return
        }

        // Record the assistant's own tool-call turn so the next request's
        // history is a valid OpenAI-style transcript (assistant tool_calls
        // -> tool results -> assistant continues), not just the results.
        history.push({
          role: 'assistant',
          content: result.content || '',
        })

        let anyFailed = false
        for (const call of result.toolCalls) {
          const outcome = await executeAgentToolCall(call)
          appendStep(assistantId, { label: outcome.label, ok: outcome.ok })
          history.push({
            role: 'tool',
            tool_call_id: call.id,
            content: outcome.result,
          })
          if (!outcome.ok) anyFailed = true
        }

        if (anyFailed) {
          const text =
            'One of the steps above failed, so I stopped here rather than continuing on bad information. You can ask me to try a different approach.'
          updateAssistant(assistantId, { text })
          persistAssistantContent(assistantId, text)
          return
        }
      }

      const text = `I've hit my step limit (${MAX_AGENT_STEPS}) for this task — here's where I got to. You can ask me to continue.`
      updateAssistant(assistantId, { text })
      persistAssistantContent(assistantId, text)
    },
    [persistAssistantContent, updateAssistant, appendStep],
  )

  const runOmniRoute = useCallback(
    async (prompt: string, assistantId: string, images: string[] = [], web = false) => {
      const started = performance.now()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const scheduleQuery = isScheduleQuery(prompt)
        const scheduleAction = isScheduleActionRequest(prompt)
        const agentTask = isAgentTaskRequest(prompt)

        const memoryPreamble = [
          `Today is ${new Date().toISOString().slice(0, 10)}.`,
          memoryFactsRef.current ? `Known facts about the user:\n${memoryFactsRef.current}` : null,
        ]
          .filter(Boolean)
          .join('\n\n')

        if (agentTask && !scheduleAction) {
          const workspacePath = await getWorkspacePath().catch(() => null)
          const systemPreamble = [
            memoryPreamble,
            'You can read, write, list, and delete files inside a sandboxed workspace directory using the provided tools.' +
              (workspacePath ? ` The workspace is at: ${workspacePath}` : '') +
              ' You cannot access any other location on disk, and there is no command-execution tool available yet. Use relative paths only.',
          ]
            .filter(Boolean)
            .join('\n\n')
          await runAgentLoop(prompt, assistantId, controller, systemPreamble)
          setLastLatencyMs(Math.round(performance.now() - started))
          return
        }

        const systemPrompt = [
          "You are Udaan's assistant: a knowledgeable, capable, friendly AI in the user's desktop, as helpful as ChatGPT. " +
            'Give complete, accurate answers; use Markdown (headings, lists, tables, code blocks) when it helps readability, and keep casual replies short. ' +
            "You remember this whole conversation. If the user wants a picture drawn, tell them to start the message with /imagine.",
          memoryPreamble,
          scheduleQuery ? buildScheduleContextMessage(prompt) : null,
          scheduleAction && SCHEDULE_EVENTS.length > 0
            ? `Here are the user's real schedule events/todos, with their exact ids:\n\n${buildEventIdReference(SCHEDULE_EVENTS)}\n\nUse the schedule tools with these exact ids to carry out any requested action(s) — including multiple events in one request. If a request is ambiguous or matches nothing, ask for clarification instead of calling a tool.`
            : null,
        ]
          .filter(Boolean)
          .join('\n\n')

        // Earlier turns (text only, most recent 24) so the model remembers the conversation.
        const history = messagesRef.current
          .filter((m) => m.id !== assistantId && m.text.trim() && !m.text.startsWith('('))
          .slice(-25, -1)
          .map((m) => ({ role: m.role, content: m.text.replace(IMAGE_MD, '[image]') }))
        const messages = [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          ...history,
          { role: 'user' as const, content: prompt },
        ]

        // Picture requests go to the free Pollinations generator.
        const imagePrompt = imageRequest(prompt)
        if (imagePrompt && !images.length) {
          updateAssistant(assistantId, { text: '' })
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`
          const saved = await invoke<string>('chat_download_image', { url })
          const text = `Here's **${imagePrompt}**:

![${imagePrompt.replace(/[[\]]/g, '')}](${saved})`
          updateAssistant(assistantId, { text })
          persistAssistantContent(assistantId, text)
          setLastLatencyMs(Math.round(performance.now() - started))
          return
        }

        // Web search: when asked for, or when the question is plainly about now.
        let webSources: { title: string; url: string }[] = []
        if ((web || CURRENT_EVENTS.test(prompt)) && !images.length && !scheduleAction) {
          updateAssistant(assistantId, { text: '', steps: [{ label: 'Searching the web', ok: true }] })
          const found = await gatherWeb(prompt, controller.signal)
          webSources = found.sources
          if (found.context) {
            messages.splice(messages.length - 1, 0, {
              role: 'system' as const,
              content:
                `Today is ${new Date().toDateString()}. Answer using these web results, which are more current than your training. ` +
                'Cite them inline as [1], [2] etc. matching their numbers. If they conflict or do not answer the question, say so.\n\n' +
                found.context,
            })
          }
          updateAssistant(assistantId, { steps: [] })
        }

        // Show the answer as it is written (throttled so a fast stream does not re-render every token).
        let streamed = ''
        let lastPaint = 0
        const result = await omniRouteChat(
          messages,
          controller.signal,
          {
            temperature: scheduleQuery ? SCHEDULE_QUERY_TEMPERATURE : undefined,
            images,
            onDelta: (d) => {
              streamed += d
              const t = performance.now()
              if (t - lastPaint > 70) {
                lastPaint = t
                updateAssistant(assistantId, { text: streamed })
              }
            },
          },
          scheduleAction && !images.length ? [...SCHEDULE_TOOLS] : undefined,
        )
        setProvider(result.provider ?? null)

        if (result.toolCalls && result.toolCalls.length > 0) {
          const toolResults: string[] = []
          for (const call of result.toolCalls) {
            toolResults.push(await executeScheduleToolCall(call as OllamaToolCall))
          }
          const phrasing = await omniRouteChat([
            {
              role: 'system' as const,
              content: `The following actions were already performed successfully. Report them back to the user in one short, natural sentence. Do not add anything not stated here.\n\n${toolResults.join('\n')}`,
            },
            { role: 'user' as const, content: prompt },
          ])
          const text = phrasing.content || toolResults.join(' ')
          updateAssistant(assistantId, { text })
          persistAssistantContent(assistantId, text)
          setLastLatencyMs(Math.round(performance.now() - started))
          return
        }

        const sourcesMd = webSources.length ? `\n\n**Sources**\n${webSources.map((src, i) => `${i + 1}. [${src.title.replace(/[[\]]/g, '')}](${src.url})`).join('\n')}` : ''
        const text = (result.content || '(empty response)') + sourcesMd
        updateAssistant(assistantId, { text })
        persistAssistantContent(assistantId, text)
        setLastLatencyMs(Math.round(performance.now() - started))
      } catch (err) {
        const message =
          err instanceof Error && err.name === 'AbortError' ? '(stopped)' : describeOmniRouteError(err)
        updateAssistant(assistantId, { text: message })
        persistAssistantContent(assistantId, message)
      } finally {
        abortRef.current = null
        setResponding(false)
      }
    },
    [persistAssistantContent, updateAssistant, runAgentLoop],
  )

  const send = useCallback(
    async (prompt: string, images: string[] = [], web = false) => {
      const typed = prompt.trim()
      if (!typed && !images.length) return
      // Attached pictures live in the message itself, so they show (and persist) in the thread.
      const trimmed = [typed || 'What do you see in this image?', ...images.map((p) => `![image](${p})`)].join('\n\n')

      let activeSessionId = sessionId
      if (!activeSessionId) {
        try {
          const session: ChatSession = await createSession(typed || 'Image', mode)
          activeSessionId = session.id
          setSessionId(session.id)
          setSessions((prev) => [session, ...prev])
        } catch (err) {
          console.error('Failed to create chat session:', err)
        }
      }

      const now = new Date().toISOString()
      const userMsg: ChatMessageData = {
        id: crypto.randomUUID(),
        role: 'user',
        mode,
        text: trimmed,
        createdAt: now,
      }
      const assistantId = crypto.randomUUID()
      const assistantMsg: ChatMessageData = {
        id: assistantId,
        role: 'assistant',
        mode,
        text: '',
        createdAt: now,
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setResponding(true)

      if (activeSessionId) {
        try {
          const storedUser = await addMessage(activeSessionId, 'user', trimmed, mode)
          dbMessageId.current.set(userMsg.id, storedUser.id)
          const storedAssistant = await addMessage(activeSessionId, 'assistant', '', mode)
          dbMessageId.current.set(assistantId, storedAssistant.id)
        } catch (err) {
          console.error('Failed to persist message:', err)
        }
      }

      runOmniRoute(typed || 'What do you see in this image?', assistantId, images, web)
    },
    [sessionId, mode, runOmniRoute],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** Starts a fresh, empty conversation in the current provider — the next `send()` creates its session. */
  const newChat = useCallback(() => {
    setSessionId(null)
    setMessages([])
    dbMessageId.current.clear()
  }, [])

  /** Switches to an existing session in the current provider's list. */
  const switchSession = useCallback(
    (id: string) => {
      loadSession(id).catch((err) => console.error('Failed to load session:', err))
    },
    [loadSession],
  )

  /** Deletes a session. If it was the active one, falls back to the next most recent, or a fresh empty chat. */
  const closeSession = useCallback(
    async (id: string) => {
      try {
        await deleteSessionApi(id)
      } catch (err) {
        console.error('Failed to delete session:', err)
        return
      }
      const remaining = await loadSessionList()
      if (id === sessionId) {
        const next = remaining[0]
        if (next) {
          await loadSession(next.id)
        } else {
          newChat()
        }
      }
    },
    [sessionId, loadSessionList, loadSession, newChat],
  )

  return {
    messages,
    responding,
    lastLatencyMs,
    provider,
    loadingHistory,
    sessions,
    sessionId,
    send,
    stop,
    newChat,
    switchSession,
    closeSession,
  }
}
