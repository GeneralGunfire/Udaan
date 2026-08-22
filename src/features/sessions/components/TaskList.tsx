import { CodeEditorIcon, FolderIcon } from '@/shared/icons'
import type { ClaudeCodeTask } from '@/integrations/claude-code'
import { TaskStatusBadge } from './TaskStatusBadge'
import { Button } from '@/shared/components/ui/button'
import { Tooltip, TooltipProvider } from '@/shared/components/ui/tooltip'

interface TaskListProps {
  tasks: ClaudeCodeTask[]
  activeTaskId: string | null
  onOpenTask: (id: string) => void
  onOpenInVSCode: (cwd: string) => void
}

export function TaskList({ tasks, activeTaskId, onOpenTask, onOpenInVSCode }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className="text-text-tertiary px-1 py-6 text-center text-[12.5px]">
        No tasks yet — queue one above.
      </p>
    )
  }

  return (
    <TooltipProvider delayDuration={400}>
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
              className="focus-visible:ring-brand-cyan/60 flex items-start justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-2"
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
                <Tooltip content="Open in VS Code">
                  <Button
                    type="button"
                    aria-label="Open in VS Code"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenInVSCode(task.cwd)
                    }}
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-md opacity-0 group-hover:opacity-100"
                  >
                    <CodeEditorIcon width={13} height={13} />
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}
