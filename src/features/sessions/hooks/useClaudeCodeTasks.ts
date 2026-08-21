import { useCallback, useEffect, useState } from 'react'
import {
  listTasks,
  onTaskEvent,
  submitTask,
  type ClaudeCodeTask,
} from '@/integrations/claude-code'

/** Loads task history and keeps it live-updated via task events. */
export function useClaudeCodeTasks() {
  const [tasks, setTasks] = useState<ClaudeCodeTask[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const list = await listTasks()
    setTasks(list)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refresh()
      if (!cancelled) setLoading(false)
    })()

    const unlistenPromise = onTaskEvent((event) => {
      if (event.kind === 'status') {
        setTasks((prev) =>
          prev.map((t) => (t.id === event.task_id ? { ...t, status: event.status } : t)),
        )
        // A finished task's timestamps/output are best re-fetched once rather
        // than reconstructed client-side from partial event data.
        if (event.status === 'done' || event.status === 'failed') {
          refresh()
        }
      } else if (event.kind === 'line') {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === event.task_id ? { ...t, output: t.output + event.line + '\n' } : t,
          ),
        )
      } else if (event.kind === 'stderr') {
        setTasks((prev) =>
          prev.map((t) => (t.id === event.task_id ? { ...t, error: event.line } : t)),
        )
      }
    })

    return () => {
      cancelled = true
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [refresh])

  const submit = useCallback(
    async (prompt: string, cwd: string) => {
      const task = await submitTask(prompt, cwd)
      setTasks((prev) => [task, ...prev])
      return task
    },
    [],
  )

  return { tasks, loading, submit, refresh }
}
