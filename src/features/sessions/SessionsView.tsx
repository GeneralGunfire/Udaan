import { useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { openInVSCode } from '@/integrations/claude-code'
import { useClaudeCodeTasks } from './hooks/useClaudeCodeTasks'
import { NewTaskForm } from './components/NewTaskForm'
import { TaskList } from './components/TaskList'
import { TaskOutputTab } from './components/TaskOutputTab'

/** Task queue + history for headless Claude Code CLI sessions. */
export function SessionsView() {
  const { tasks, loading, submit } = useClaudeCodeTasks()
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null

  function handleOpenInVSCode(cwd: string) {
    openInVSCode(cwd).catch((err) => {
      console.error('Failed to open in VS Code', err)
    })
  }

  return (
    <div className="flex h-full w-full self-stretch gap-4">
      <GlassPanel className="flex w-80 shrink-0 flex-col gap-4 overflow-hidden">
        <div>
          <h1 className="text-text-primary text-lg font-medium">Claude Code Sessions</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Queue headless Claude Code runs and watch their output live.
          </p>
        </div>

        <NewTaskForm onSubmit={submit} />

        <div className="border-glass-border border-t pt-3" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-text-tertiary px-1 py-6 text-center text-sm">Loading…</p>
          ) : (
            <TaskList
              tasks={tasks}
              activeTaskId={activeTaskId}
              onOpenTask={setActiveTaskId}
              onOpenInVSCode={handleOpenInVSCode}
            />
          )}
        </div>
      </GlassPanel>

      <div className="min-h-0 flex-1">
        {activeTask ? (
          <TaskOutputTab
            task={activeTask}
            onClose={() => setActiveTaskId(null)}
            onOpenInVSCode={handleOpenInVSCode}
          />
        ) : (
          <GlassPanel className="flex h-full items-center justify-center">
            <p className="text-text-tertiary text-sm">Select a task to view its output.</p>
          </GlassPanel>
        )}
      </div>
    </div>
  )
}
