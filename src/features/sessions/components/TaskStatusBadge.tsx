import type { TaskStatus } from '@/integrations/claude-code'

const STYLES: Record<TaskStatus, string> = {
  queued: 'bg-text-tertiary/15 text-text-tertiary',
  running: 'bg-brand-cyan/20 text-brand-cyan',
  done: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase ${STYLES[status]}`}
    >
      {status}
    </span>
  )
}
