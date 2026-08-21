import { useCallback, useEffect, useRef, useState } from 'react'
import { homeDir } from '@tauri-apps/api/path'
import { chat as localChat, isReachable as isOllamaReachable } from '@/integrations/local-model'
import { submitTask, onTaskEvent, parseStreamLine } from '@/integrations/claude-code'
import type { ModeId } from '../components/modes'
import type { ChatMessageData } from '../components/ChatMessage'
import { routeMode } from '../lib/router'

/** Tracks the in-flight Claude Code task backing an assistant message, so stream events can be routed to the right bubble. */
interface PendingClaudeTask {
  taskId: string
  messageId: string
}

export function useGeneralChat() {
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [responding, setResponding] = useState(false)
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
  const pendingClaudeTask = useRef<PendingClaudeTask | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
        }
      } else if (event.kind === 'status' && event.status === 'done') {
        setResponding(false)
        pendingClaudeTask.current = null
      } else if (event.kind === 'status' && event.status === 'failed') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pending.messageId ? { ...m, text: 'Claude session failed.' } : m,
          ),
        )
        setResponding(false)
        pendingClaudeTask.current = null
      } else if (event.kind === 'stderr') {
        setMessages((prev) =>
          prev.map((m) => (m.id === pending.messageId ? { ...m, text: event.line } : m)),
        )
      }
    })
    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  const runLocal = useCallback(async (prompt: string, assistantId: string) => {
    const started = performance.now()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const reachable = await isOllamaReachable()
      if (!reachable) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: 'Ollama is not running at localhost:11434. Start it with "ollama serve" (or the Ollama background service) and try again.',
                }
              : m,
          ),
        )
        return
      }
      const result = await localChat([{ role: 'user', content: prompt }], controller.signal)
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, text: result.content || '(empty response)' } : m)),
      )
      setLastLatencyMs(Math.round(performance.now() - started))
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? '(stopped)'
          : `Local model error: ${err instanceof Error ? err.message : String(err)}. Is Ollama running?`
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: message } : m)))
    } finally {
      abortRef.current = null
      setResponding(false)
    }
  }, [])

  const runClaude = useCallback(async (prompt: string, assistantId: string) => {
    try {
      const cwd = await homeDir()
      const task = await submitTask(prompt, cwd)
      pendingClaudeTask.current = { taskId: task.id, messageId: assistantId }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: `Claude session error: ${err instanceof Error ? err.message : String(err)}` }
            : m,
        ),
      )
      setResponding(false)
    }
  }, [])

  const send = useCallback(
    (prompt: string, mode: ModeId) => {
      const trimmed = prompt.trim()
      if (!trimmed) return

      const resolvedMode = mode === 'router' ? routeMode(trimmed) : mode

      const userMsg: ChatMessageData = {
        id: crypto.randomUUID(),
        role: 'user',
        mode,
        text: trimmed,
      }
      const assistantId = crypto.randomUUID()
      const assistantMsg: ChatMessageData = {
        id: assistantId,
        role: 'assistant',
        mode: resolvedMode === 'claude' ? 'claude' : 'local',
        text: '',
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setResponding(true)

      if (resolvedMode === 'claude') {
        runClaude(trimmed, assistantId)
      } else {
        runLocal(trimmed, assistantId)
      }
    },
    [runClaude, runLocal],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    // Claude Code tasks run headless server-side; there's no cancel command
    // yet, so stop only interrupts the local-model request.
  }, [])

  return { messages, responding, lastLatencyMs, send, stop }
}
