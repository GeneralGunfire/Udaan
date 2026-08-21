import { useEffect, useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { GaugeIcon, PulseIcon, QueueIcon } from '@/shared/icons'
import {
  isReachable,
  listRunningModels,
  configuredChatModel,
  type RunningModel,
} from '@/integrations/local-model'
import { listTasks, type ClaudeCodeTask, type TaskStatus } from '@/integrations/claude-code'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

const STATUS_ORDER: TaskStatus[] = ['queued', 'running', 'done', 'failed']

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
}

function groupByStatus(tasks: ClaudeCodeTask[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { queued: 0, running: 0, done: 0, failed: 0 }
  for (const t of tasks) counts[t.status] += 1
  return counts
}

/**
 * Model Dashboard — real Ollama reachability/loaded-model status and real
 * Claude Code task counts by status. No mock data: sections that can't be
 * populated cheaply show an honest "not available" state instead.
 */
export function ModelDashboardView() {
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null)
  const [running, setRunning] = useState<RunningModel[]>([])
  const [tasks, setTasks] = useState<ClaudeCodeTask[] | null>(null)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [reachable, runningModels, taskResult] = await Promise.allSettled([
        isReachable(),
        listRunningModels(),
        listTasks(),
      ])

      if (cancelled) return

      setOllamaUp(reachable.status === 'fulfilled' ? reachable.value : false)
      setRunning(runningModels.status === 'fulfilled' ? runningModels.value : [])

      if (taskResult.status === 'fulfilled') {
        setTasks(taskResult.value)
        setTasksError(null)
      } else {
        setTasks(null)
        setTasksError(
          taskResult.reason instanceof Error
            ? taskResult.reason.message
            : String(taskResult.reason),
        )
      }

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const counts = tasks ? groupByStatus(tasks) : null

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center gap-2">
        <GaugeIcon width={16} height={16} className="text-brand-teal" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">
          Model Dashboard
        </h1>
      </div>

      {/* Ollama status */}
      <GlassPanel className="flex flex-col gap-3">
        <h2 className="text-text-primary text-[14px] font-medium">Local Model (Ollama)</h2>
        {loading ? (
          <p className="text-text-tertiary text-[12px]">Checking...</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${ollamaUp ? 'bg-success' : 'bg-text-tertiary'}`}
              />
              <span className="text-text-secondary text-[12.5px]">
                {ollamaUp ? 'Running' : 'Not reachable'}
              </span>
              <span className="text-text-tertiary text-[11px]">(localhost:11434)</span>
            </div>

            {ollamaUp && running.length > 0 ? (
              <div className="flex flex-col gap-1.5 pl-4">
                {running.map((m) => (
                  <div key={m.name} className="flex items-center gap-3 text-[12px]">
                    <span className="text-text-primary font-medium">{m.name}</span>
                    <span className="text-text-tertiary tabular-nums">
                      {formatBytes(m.sizeBytes)}
                      {m.sizeVramBytes > 0 ? ` (${formatBytes(m.sizeVramBytes)} VRAM)` : ' (CPU)'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pl-4 text-[12px]">
                <span className="text-text-tertiary">
                  {ollamaUp
                    ? 'No model currently loaded in memory. '
                    : 'Cannot query loaded models while Ollama is unreachable. '}
                  Configured chat model:{' '}
                </span>
                <span className="text-text-secondary font-medium">{configuredChatModel()}</span>
              </div>
            )}
          </div>
        )}
      </GlassPanel>

      {/* Claude Code task counts */}
      <GlassPanel className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <QueueIcon width={14} height={14} className="text-brand-teal" />
          <h2 className="text-text-primary text-[14px] font-medium">Claude Code Tasks</h2>
        </div>
        {loading ? (
          <p className="text-text-tertiary text-[12px]">Loading...</p>
        ) : tasksError ? (
          <p className="text-text-tertiary text-[12px]">
            Could not load tasks: {tasksError}
          </p>
        ) : counts ? (
          <div className="grid grid-cols-4 gap-3">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="glass-surface flex flex-col gap-1 rounded-[10px] p-3">
                <div className="text-text-primary text-[22px] leading-none font-semibold tabular-nums">
                  {counts[status]}
                </div>
                <div className="text-text-tertiary text-[11px]">{STATUS_LABEL[status]}</div>
              </div>
            ))}
          </div>
        ) : null}
      </GlassPanel>

      {/* Router stats — honest placeholder, visually distinct from real data above */}
      <div className="border-glass-border rounded-lg border border-dashed p-5">
        <div className="flex items-center gap-2">
          <PulseIcon width={14} height={14} className="text-text-tertiary" />
          <h2 className="text-text-tertiary text-[13px] font-medium">
            Router Stats — Not Yet Available
          </h2>
        </div>
        <p className="text-text-tertiary mt-1.5 text-[11.5px] leading-relaxed">
          Request-level routing (local vs. Claude Code) already works in General Chat, but
          per-request telemetry isn't aggregated anywhere yet. Once that exists, this section
          will show routing counts, average latency per mode, and fallback rates.
        </p>
      </div>
    </div>
  )
}
