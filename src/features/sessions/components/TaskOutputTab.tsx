import { useMemo } from 'react'
import { CodeEditorIcon, WindowCloseIcon } from '@/shared/icons'
import { parseStreamLine, type ClaudeCodeTask } from '@/integrations/claude-code'
import { TaskStatusBadge } from './TaskStatusBadge'

interface TaskOutputTabProps {
  task: ClaudeCodeTask
  onClose: () => void
  onOpenInVSCode: (cwd: string) => void
}

export function TaskOutputTab({ task, onClose, onOpenInVSCode }: TaskOutputTabProps) {
  const lines = useMemo(
    () =>
      task.output
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map(parseStreamLine),
    [task.output],
  )

  return (
    <div className="glass-surface flex h-full min-h-0 w-full max-w-3xl flex-col rounded-lg">
      <div className="border-glass-border flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-text-primary truncate text-sm font-medium">{task.prompt}</p>
          <p className="text-text-tertiary truncate text-[11px]">{task.cwd}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <button
            type="button"
            onClick={() => onOpenInVSCode(task.cwd)}
            title="Open in VS Code"
            className="text-text-tertiary hover:text-text-primary flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 hover:bg-glass"
          >
            <CodeEditorIcon width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="text-text-tertiary hover:text-text-primary flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 hover:bg-glass"
          >
            <WindowCloseIcon width={12} height={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {lines.length === 0 ? (
          <p className="text-text-tertiary text-sm">
            {task.status === 'queued' ? 'Waiting in queue…' : 'Starting…'}
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            {lines.map((l) => (
              <div
                key={l.key}
                className={
                  l.variant === 'raw' || l.variant === 'system'
                    ? 'text-text-tertiary font-mono text-[11px] break-all'
                    : l.variant === 'result'
                      ? 'text-emerald-400'
                      : 'text-text-primary whitespace-pre-wrap'
                }
              >
                {l.text}
              </div>
            ))}
          </div>
        )}
        {task.error && (
          <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
            {task.error}
          </div>
        )}
        {task.status === 'done' && (
          <div className="mt-4 flex items-center gap-2 border-t border-glass-border pt-3 text-[12px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Finished{task.finished_at ? ` at ${new Date(task.finished_at).toLocaleTimeString()}` : ''}
          </div>
        )}
        {task.status === 'failed' && !task.error && (
          <div className="mt-4 flex items-center gap-2 border-t border-glass-border pt-3 text-[12px] text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            Task failed with no error output
          </div>
        )}
      </div>
    </div>
  )
}
