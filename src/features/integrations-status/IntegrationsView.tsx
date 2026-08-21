import { useEffect, useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { PlugIcon } from '@/shared/icons'
import { listTasks } from '@/integrations/claude-code'
import { isReachable as ollamaReachable } from '@/integrations/local-model'

type LiveStatus = 'checking' | 'connected' | 'error' | 'local'

interface Row {
  id: string
  name: string
  description: string
  status: LiveStatus
  detail: string | null
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'

async function checkClaudeCode(): Promise<{ status: LiveStatus; detail: string | null }> {
  try {
    await listTasks()
    return { status: 'connected', detail: null }
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}

async function checkLocalModel(): Promise<{ status: LiveStatus; detail: string | null }> {
  const up = await ollamaReachable()
  return up
    ? { status: 'connected', detail: null }
    : { status: 'error', detail: 'Ollama not reachable at localhost:11434' }
}

async function checkWeather(): Promise<{ status: LiveStatus; detail: string | null }> {
  try {
    const res = await fetch(`${GEOCODE_URL}?name=London&count=1`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
      ? { status: 'connected', detail: null }
      : { status: 'error', detail: `HTTP ${res.status}` }
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Schedule isn't a network integration — it's an in-memory data module with
 * no daemon and no connection to hold open. Rather than force it into a
 * connected/error binary that doesn't fit, it's labeled as local data.
 */
async function checkSchedule(): Promise<{ status: LiveStatus; detail: string | null }> {
  return { status: 'local', detail: 'In-memory data module — nothing to connect to' }
}

/**
 * Live status for each real integration. Every row does an actual check on
 * mount (and on manual refresh) rather than rendering a static list —
 * status here means "checked just now", not "known to exist in the repo".
 */
export function IntegrationsView() {
  const [rows, setRows] = useState<Row[]>([
    {
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Headless task runner (spawns `claude`, streams output, persists to SQLite)',
      status: 'checking',
      detail: null,
    },
    {
      id: 'local-model',
      name: 'Local Model (Ollama)',
      description: 'Local chat completion + faster-whisper transcription',
      status: 'checking',
      detail: null,
    },
    {
      id: 'weather',
      name: 'Weather (Open-Meteo)',
      description: 'Stateless public API, no API key — reachability checked per request',
      status: 'checking',
      detail: null,
    },
    {
      id: 'schedule',
      name: 'Schedule',
      description: 'In-memory event/todo data module shared by Calendar and Schedule',
      status: 'checking',
      detail: null,
    },
  ])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setRows((prev) => prev.map((r) => ({ ...r, status: 'checking', detail: null })))

      const [cc, lm, wx, sched] = await Promise.all([
        checkClaudeCode(),
        checkLocalModel(),
        checkWeather(),
        checkSchedule(),
      ])

      if (cancelled) return

      const results: Record<string, { status: LiveStatus; detail: string | null }> = {
        'claude-code': cc,
        'local-model': lm,
        weather: wx,
        schedule: sched,
      }

      setRows((prev) =>
        prev.map((r) => ({ ...r, status: results[r.id].status, detail: results[r.id].detail })),
      )
    }

    run()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlugIcon width={16} height={16} className="text-brand-teal" />
          <h1 className="font-display text-text-primary text-[16px] font-semibold">
            Integrations
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="glass-surface text-text-secondary hover:text-text-primary rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors duration-150"
        >
          Recheck
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <GlassPanel key={row.id} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-text-primary text-[13.5px] font-medium">{row.name}</div>
              <div className="text-text-tertiary mt-0.5 text-[11.5px] leading-relaxed">
                {row.description}
              </div>
              {row.detail && (
                <div className="text-text-tertiary mt-1 text-[11px] italic">{row.detail}</div>
              )}
            </div>
            <StatusPill status={row.status} />
          </GlassPanel>
        ))}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: LiveStatus }) {
  const config: Record<LiveStatus, { label: string; dot: string; text: string }> = {
    checking: { label: 'Checking…', dot: 'bg-text-tertiary', text: 'text-text-tertiary' },
    connected: { label: 'Connected', dot: 'bg-success', text: 'text-text-secondary' },
    error: { label: 'Error', dot: 'bg-red-400', text: 'text-text-secondary' },
    local: { label: 'Local data', dot: 'bg-brand-teal', text: 'text-text-secondary' },
  }
  const c = config[status]
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
      <span className={`text-[11.5px] font-medium ${c.text}`}>{c.label}</span>
    </div>
  )
}
