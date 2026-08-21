import { useEffect, useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { PulseIcon, TerminalIcon, DatabaseIcon } from '@/shared/icons'
import { getSystemStats } from '@/integrations/system-health'
import type { SystemStats } from '@/integrations/system-health'
import { isReachable as ollamaReachable } from '@/integrations/local-model'
import { checkCli } from '@/integrations/claude-code'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 GB'
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}

function usagePct(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

function UsageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-red-400' : pct >= 75 ? 'bg-amber-400' : 'bg-brand-teal'
  return (
    <div className="bg-glass-hover h-1.5 w-full overflow-hidden rounded-full">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

interface CliStatus {
  ok: boolean
  version?: string
  error?: string
}

/**
 * System Health — real disk/RAM usage (via a Rust sysinfo-backed command),
 * real Ollama reachability, and a real Claude Code CLI check (`claude
 * --version` run on the backend, not just "the spawner code exists").
 */
export function SystemHealthView() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null)
  const [cli, setCli] = useState<CliStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [statsResult, ollamaResult, cliResult] = await Promise.allSettled([
        getSystemStats(),
        ollamaReachable(),
        checkCli(),
      ])

      if (cancelled) return

      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value)
        setStatsError(null)
      } else {
        setStats(null)
        setStatsError(
          statsResult.reason instanceof Error
            ? statsResult.reason.message
            : String(statsResult.reason),
        )
      }

      setOllamaUp(ollamaResult.status === 'fulfilled' ? ollamaResult.value : false)
      setCli(cliResult.status === 'fulfilled' ? cliResult.value : { ok: false, error: 'Check failed' })

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center gap-2">
        <PulseIcon width={16} height={16} className="text-brand-teal" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">
          System Health
        </h1>
      </div>

      {/* RAM + Disk */}
      <GlassPanel className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <DatabaseIcon width={14} height={14} className="text-brand-teal" />
          <h2 className="text-text-primary text-[14px] font-medium">Memory &amp; Disk</h2>
        </div>

        {loading ? (
          <p className="text-text-tertiary text-[12px]">Checking...</p>
        ) : statsError || !stats ? (
          <p className="text-text-tertiary text-[12px]">
            Not available: {statsError ?? 'unknown error'}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-text-secondary font-medium">RAM</span>
                <span className="text-text-tertiary tabular-nums">
                  {formatBytes(stats.memory.usedBytes)} / {formatBytes(stats.memory.totalBytes)}
                </span>
              </div>
              <UsageBar pct={usagePct(stats.memory.usedBytes, stats.memory.totalBytes)} />
            </div>

            {stats.disks.length === 0 ? (
              <p className="text-text-tertiary text-[12px]">No disks reported.</p>
            ) : (
              stats.disks.map((disk) => (
                <div key={disk.mountPoint} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-text-secondary font-medium">
                      {disk.name || disk.mountPoint} ({disk.mountPoint})
                    </span>
                    <span className="text-text-tertiary tabular-nums">
                      {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}
                    </span>
                  </div>
                  <UsageBar pct={usagePct(disk.usedBytes, disk.totalBytes)} />
                </div>
              ))
            )}
          </div>
        )}
      </GlassPanel>

      {/* Ollama */}
      <GlassPanel className="flex items-center justify-between gap-4">
        <div>
          <div className="text-text-primary text-[13.5px] font-medium">Ollama</div>
          <div className="text-text-tertiary mt-0.5 text-[11.5px]">localhost:11434</div>
        </div>
        {loading ? (
          <span className="text-text-tertiary text-[11.5px]">Checking…</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${ollamaUp ? 'bg-success' : 'bg-red-400'}`} />
            <span className="text-text-secondary text-[11.5px] font-medium">
              {ollamaUp ? 'Reachable' : 'Not reachable'}
            </span>
          </div>
        )}
      </GlassPanel>

      {/* Claude Code CLI */}
      <GlassPanel className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <TerminalIcon width={13} height={13} className="text-text-tertiary" />
            <span className="text-text-primary text-[13.5px] font-medium">Claude Code CLI</span>
          </div>
          <div className="text-text-tertiary mt-0.5 text-[11.5px]">
            {loading
              ? 'Running "claude --version"…'
              : cli?.ok
                ? cli.version || 'Installed'
                : cli?.error || 'Not found on PATH'}
          </div>
        </div>
        {loading ? (
          <span className="text-text-tertiary text-[11.5px]">Checking…</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${cli?.ok ? 'bg-success' : 'bg-red-400'}`} />
            <span className="text-text-secondary text-[11.5px] font-medium">
              {cli?.ok ? 'Reachable' : 'Not reachable'}
            </span>
          </div>
        )}
      </GlassPanel>
    </div>
  )
}
