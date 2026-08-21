import { useCallback, useEffect, useRef, useState } from 'react'
import { homeDir } from '@tauri-apps/api/path'
import { chat as localChat, isReachable as isOllamaReachable } from '@/integrations/local-model'
import { submitTask, onTaskEvent, parseStreamLine } from '@/integrations/claude-code'
import { buildStudyGeneratorPrompt, type StudyGeneratorRequest } from '../lib/promptBuilder'

export type GeneratorBackend = 'claude' | 'local'

interface PendingTask {
  taskId: string
}

/**
 * Runs a Study Generator request through `buildStudyGeneratorPrompt` (which
 * pulls in the School knowledge base) and either backend — Claude Code
 * (better prose, used by default) or the local Ollama model (faster,
 * lower quality, useful for quick drafts). Every call goes through the
 * same prompt builder regardless of backend, so the knowledge base is
 * always in effect.
 */
export function useStudyGenerator() {
  const [output, setOutput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingTask = useRef<PendingTask | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const unlistenPromise = onTaskEvent((event) => {
      const pending = pendingTask.current
      if (!pending || event.task_id !== pending.taskId) return

      if (event.kind === 'line') {
        const rendered = parseStreamLine(event.line)
        if (rendered.variant === 'result') setOutput(rendered.text)
      } else if (event.kind === 'status' && event.status === 'done') {
        setGenerating(false)
        pendingTask.current = null
      } else if (event.kind === 'status' && event.status === 'failed') {
        setError('Claude Code generation failed.')
        setGenerating(false)
        pendingTask.current = null
      }
    })
    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  const generate = useCallback(async (request: StudyGeneratorRequest, backend: GeneratorBackend) => {
    setError(null)
    setOutput('')
    setGenerating(true)
    const prompt = buildStudyGeneratorPrompt(request)

    if (backend === 'local') {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const reachable = await isOllamaReachable()
        if (!reachable) {
          setError('Ollama is not running at localhost:11434. Start it and try again, or switch to Claude.')
          setGenerating(false)
          return
        }
        const result = await localChat([{ role: 'user', content: prompt }], controller.signal)
        setOutput(result.content || '(empty response)')
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        abortRef.current = null
        setGenerating(false)
      }
      return
    }

    try {
      const cwd = await homeDir()
      const task = await submitTask(prompt, cwd)
      pendingTask.current = { taskId: task.id }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGenerating(false)
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { output, generating, error, generate, stop }
}
