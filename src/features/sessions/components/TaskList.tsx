import { CodeEditorIcon, FolderIcon } from '@/shared/icons'
import type { ClaudeCodeTask } from '@/integrations/claude-code'
import { TaskStatusBadge } from './TaskStatusBadge'

interface TaskListProps {
  tasks: ClaudeCodeTask[]
  activeTaskId: string | null
  onOpenTask: (id: string) => void
  onOpenInVSCode: (cwd: string) => void
}

export function TaskList({ tasks, activeTaskId, onOpenTask, onOpenInVSCode }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className="text-text-tertiary px-1 py-6 text-center text-sm">
        No tasks yet — queue one above.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`group flex flex-col gap-1 rounded-lg px-3 py-2.5 transition-colors duration-150 ${
            activeTaskId === task.id ? 'bg-glass-hover' : 'hover:bg-glass'
          }`}
        >
          <button
            type="button"
            onClick={() => onOpenTask(task.id)}
            className="flex items-start justify-between gap-3 text-left"
          >
            <span className="text-text-primary line-clamp-2 flex-1 text-[13px] leading-snug">
              {task.prompt}
            </span>
            <TaskStatusBadge status={task.status} />
          </button>
          <div className="text-text-tertiary flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-1">
              <FolderIcon width={11} height={11} className="shrink-0" />
              <span className="truncate">{task.cwd}</span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <span>{new Date(task.created_at).toLocaleTimeString()}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenInVSCode(task.cwd)
                }}
                title="Open in VS Code"
                className="text-text-tertiary hover:text-text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              >
                <CodeEditorIcon width={13} height={13} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
