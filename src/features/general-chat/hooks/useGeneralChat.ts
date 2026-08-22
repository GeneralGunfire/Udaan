import { useCallback, useEffect, useRef, useState } from 'react'
import { homeDir } from '@tauri-apps/api/path'
import { chat as localChat, isReachable as isOllamaReachable } from '@/integrations/local-model'
import { submitTask, onTaskEvent, parseStreamLine } from '@/integrations/claude-code'
import {
  isScheduleQuery,
  buildScheduleContextMessage,
  SCHEDULE_QUERY_TEMPERATURE,
  tryExecuteBulkScheduleAction,
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
  type ChatSession,
} from '@/integrations/general-chat'
import type { ModeId } from '../components/modes'
import type { ChatMessageData } from '../components/ChatMessage'

/** Tracks the in-flight Claude Code task backing an assistant message, so stream events can be routed to the right bubble. */
interface PendingClaudeTask {
  taskId: string
  messageId: string
}

/**
 * Local and Claude are separate conversation spaces — each has its own list
 * of sessions and its own active session id, never sharing messages. Switch
 * `mode` and the hook loads that provider's own session list/history.
 */
export function useGeneralChat(mode: ModeId) {
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [responding, setResponding] = useState(false)
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const pendingClaudeTask = useRef<PendingClaudeTask | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Assistant-message DB row ids only exist once the row is first persisted
  // (after the reply resolves) — this maps in-memory message id -> db id so
  // a later updateMessage() call targets the right row.
  const dbMessageId = useRef<Map<string, string>>(new Map())

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
        mode: (m.mode as ModeId) ?? 'local',
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
    const unlistenPromise = onTaskEvent((event) => {
      const pending = pendingClaudeTask.current
      if (!pending || event.task_id !== pending.taskId) return

      if (event.kind === 'line') {
        const rendered = parseStreamLine(event.line)
        if (rendered.variant === 'result') {
          setMessages((prev) =>
            prev.map((m) => (m.id === pending.messageId ? { ...m, text: rendered.text } : m)),
          )
          persistAssistantContent(pending.messageId, rendered.text)
        }
      } else if (event.kind === 'status' && event.status === 'done') {
        setResponding(false)
        pendingClaudeTask.current = null
      } else if (event.kind === 'status' && event.status === 'failed') {
        const text = 'Claude session failed.'
        setMessages((prev) =>
          prev.map((m) => (m.id === pending.messageId ? { ...m, text } : m)),
        )
        persistAssistantContent(pending.messageId, text)
        setResponding(false)
        pendingClaudeTask.current = null
      } else if (event.kind === 'stderr') {
        setMessages((prev) =>
          prev.map((m) => (m.id === pending.messageId ? { ...m, text: event.line } : m)),
        )
        persistAssistantContent(pending.messageId, event.line)
      }
    })
    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Writes an assistant message's final text to the DB row created for it (see `send`). */
  const persistAssistantContent = useCallback((messageId: string, content: string) => {
    const dbId = dbMessageId.current.get(messageId)
    if (dbId) {
      updateMessage(dbId, content).catch((err) => console.error('Failed to persist message:', err))
    }
  }, [])

  const runLocal = useCallback(
    async (prompt: string, assistantId: string) => {
      const started = performance.now()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const reachable = await isOllamaReachable()
        if (!reachable) {
          const text =
            'Ollama is not running at localhost:11434. Start it with "ollama serve" (or the Ollama background service) and try again.'
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text } : m)))
          persistAssistantContent(assistantId, text)
          return
        }

        // Tier 1 — bulk schedule actions ("move all today's events to
        // tomorrow"): resolved and executed deterministically in code, a
        // 1.5B model can't reliably batch multi-target tool calls in one
        // turn (verified directly). The model only phrases the result.
        const bulkResult = await tryExecuteBulkScheduleAction(prompt)
        if (bulkResult.handled) {
          const phrasing = await localChat(
            [
              {
                role: 'system' as const,
                content: `The following schedule action was already performed successfully. Report it back to the user in one short, natural sentence. Do not add anything not stated here.\n\n${bulkResult.summary}`,
              },
              { role: 'user' as const, content: prompt },
            ],
            controller.signal,
            { temperature: SCHEDULE_QUERY_TEMPERATURE },
          )
          const text = phrasing.content || bulkResult.summary
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text } : m)))
          persistAssistantContent(assistantId, text)
          setLastLatencyMs(Math.round(performance.now() - started))
          return
        }

        const scheduleQuery = isScheduleQuery(prompt)

        if (scheduleQuery) {
          // Tier 2 — read-only schedule question: grounded plain-text
          // context, low temperature, no tools needed.
          const result = await localChat(
            [
              { role: 'system' as const, content: buildScheduleContextMessage(prompt) },
              { role: 'user' as const, content: prompt },
            ],
            controller.signal,
            { temperature: SCHEDULE_QUERY_TEMPERATURE },
          )
          const text = result.content || '(empty response)'
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text } : m)))
          persistAssistantContent(assistantId, text)
          setLastLatencyMs(Math.round(performance.now() - started))
          return
        }

        if (isScheduleActionRequest(prompt) && SCHEDULE_EVENTS.length > 0) {
          // Tier 3 — single-target schedule action ("move event X to
          // Friday"): real Ollama tool-calling. Reliable for one clear
          // target per turn (verified directly against the real endpoint).
          const result = await localChat(
            [
              {
                role: 'system' as const,
                content: `Today is ${new Date().toISOString().slice(0, 10)}. Here are the user's real schedule events/todos, with their exact ids:\n\n${buildEventIdReference(SCHEDULE_EVENTS)}\n\nIf the user's request maps to exactly one of these events, call the matching tool with its exact id. If it's ambiguous or doesn't match any event, reply with text asking for clarification instead of calling a tool.`,
              },
              { role: 'user' as const, content: prompt },
            ],
            controller.signal,
            { temperature: SCHEDULE_QUERY_TEMPERATURE },
            [...SCHEDULE_TOOLS],
          )

          if (result.toolCalls && result.toolCalls.length > 0) {
            const toolResults: string[] = []
            for (const call of result.toolCalls as OllamaToolCall[]) {
              toolResults.push(await executeScheduleToolCall(call))
            }
            const phrasing = await localChat(
              [
                {
                  role: 'system' as const,
                  content: `The following actions were already performed successfully. Report them back to the user in one short, natural sentence. Do not add anything not stated here.\n\n${toolResults.join('\n')}`,
                },
                { role: 'user' as const, content: prompt },
              ],
              controller.signal,
              { temperature: SCHEDULE_QUERY_TEMPERATURE },
            )
            const text = phrasing.content || toolResults.join(' ')
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text } : m)))
            persistAssistantContent(assistantId, text)
            setLastLatencyMs(Math.round(performance.now() - started))
            return
          }

          const text = result.content || '(empty response)'
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text } : m)))
          persistAssistantContent(assistantId, text)
          setLastLatencyMs(Math.round(performance.now() - started))
          return
        }

        // Tier 4 — plain conversation, no schedule involvement.
        const result = await localChat([{ role: 'user' as const, content: prompt }], controller.signal)
        const text = result.content || '(empty response)'
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text } : m)))
        persistAssistantContent(assistantId, text)
        setLastLatencyMs(Math.round(performance.now() - started))
      } catch (err) {
        const message =
          err instanceof Error && err.name === 'AbortError'
            ? '(stopped)'
            : `Local model error: ${err instanceof Error ? err.message : String(err)}. Is Ollama running?`
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: message } : m)))
        persistAssistantContent(assistantId, message)
      } finally {
        abortRef.current = null
        setResponding(false)
      }
    },
    [persistAssistantContent],
  )

  const runClaude = useCallback(
    async (prompt: string, assistantId: string) => {
      try {
        const cwd = await homeDir()
        const task = await submitTask(prompt, cwd)
        pendingClaudeTask.current = { taskId: task.id, messageId: assistantId }
      } catch (err) {
        const text = `Claude session error: ${err instanceof Error ? err.message : String(err)}`
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text } : m)))
        persistAssistantContent(assistantId, text)
        setResponding(false)
      }
    },
    [persistAssistantContent],
  )

  const send = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim()
      if (!trimmed) return

      let activeSessionId = sessionId
      if (!activeSessionId) {
        try {
          const session: ChatSession = await createSession(trimmed, mode)
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

      if (mode === 'claude') {
        runClaude(trimmed, assistantId)
      } else {
        runLocal(trimmed, assistantId)
      }
    },
    [sessionId, mode, runClaude, runLocal],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    // Claude Code tasks run headless server-side; there's no cancel command
    // yet, so stop only interrupts the local-model request.
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
