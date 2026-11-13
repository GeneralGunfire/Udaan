import { useCallback, useEffect, useState } from 'react'
import { SyncIcon } from '@/shared/icons'
import { getClaudeUsageReport, totalTokens, type UsageReport } from '@/integrations/claude-usage/client'
import { ViewShell, ViewHeader, ViewBody } from '@/shared/components/ui/view'
import { Button } from '@/shared/components/ui/button'

interface ClaudeUsageViewProps {
  onClose: () => void
}

/** Matches the server's own cache TTL (see claude_usage::CACHE_TTL_SECS) — polling more often than the cache actually refreshes would just repaint with identical numbers. */
const POLL_MS = 60_000

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d ago`
}

/**
 * Claude Code token usage dashboard — a read-only report over the CLI's own
 * local session logs (see src-tauri/src/claude_usage/mod.rs). Visual
 * language matches Notes/Document Reader exactly: flat --color-bg-base
 * fill, border-hairline header, text-text-primary/-secondary/-tertiary
 * tokens, no frosted glass/blur.
 */
// `onClose` is part of BaseAppProps (AppHost always passes it) but this
// view no longer needs its own close button — AppTitleBar is now the one
// shared close affordance every app view uses.
export function ClaudeUsageView(_props: ClaudeUsageViewProps) {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (forceRefresh: boolean) => {
    if (forceRefresh) setRefreshing(true)
    try {
      const result = await getClaudeUsageReport(forceRefresh)
      setReport(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read Claude Code usage data.")
    } finally {
      if (forceRefresh) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    const interval = setInterval(() => void load(false), POLL_MS)
    return () => clearInterval(interval)
  }, [load])

  const breakdownMax = report
    ? Math.max(1, ...report.projects.map((p) => totalTokens(p.totals)))
    : 1

  return (
    <ViewShell>
      <ViewHeader
        title="Claude Code Usage"
        subtitle={report ? `Updated ${formatRelativeTime(new Date(report.computedAtMs).toISOString())}` : undefined}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void load(true)}
              disabled={refreshing}
              aria-label="Refresh"
            >
              <SyncIcon width={15} height={15} className={refreshing ? 'animate-spin' : undefined} />
            </Button>
          </>
        }
      />

      <ViewBody>
        {error && (
          <div className="border-hairline text-danger mb-5 rounded-xl border p-4 text-sm">{error}</div>
        )}

        {!report && !error && (
          <div className="flex h-full items-center justify-center">
            <span className="text-text-tertiary text-sm">Reading Claude Code usage history…</span>
          </div>
        )}

        {report && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Today" totals={report.today} />
              <StatCard label="This week" totals={report.thisWeek} />
              <StatCard label="All time" totals={report.allTime} />
            </div>

            <h2 className="text-text-tertiary mt-7 mb-3 text-xs font-semibold tracking-[0.06em] uppercase">
              By project
            </h2>
            {report.projects.length === 0 ? (
              <p className="text-text-tertiary text-sm">No Claude Code project history found.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {report.projects.map((project) => {
                  const total = totalTokens(project.totals)
                  const widthPct = Math.max(2, (total / breakdownMax) * 100)
                  return (
                    <div key={project.name} className="flex items-center gap-3">
                      <span className="text-text-secondary w-48 shrink-0 truncate text-sm" title={project.name}>
                        {project.name}
                      </span>
                      <div className="border-hairline relative h-6 flex-1 overflow-hidden rounded-md border">
                        <div className="h-full rounded-md bg-gradient-to-r from-[#c15f3c] to-[#e8956f]" style={{ width: `${widthPct}%` }} />
                      </div>
                      <span className="text-text-tertiary w-24 shrink-0 text-right text-xs tabular-nums">
                        {formatTokens(total)}
                      </span>
                      <span className="text-text-tertiary w-20 shrink-0 text-right text-xs tabular-nums">
                        {project.sessionCount} session{project.sessionCount === 1 ? '' : 's'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <h2 className="text-text-tertiary mt-7 mb-3 text-xs font-semibold tracking-[0.06em] uppercase">
              Recent sessions
            </h2>
            {report.recentSessions.length === 0 ? (
              <p className="text-text-tertiary text-sm">No sessions found.</p>
            ) : (
              <div className="border-hairline overflow-hidden rounded-xl border">
                {report.recentSessions.map((session, i) => (
                  <div
                    key={session.sessionId}
                    className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                      i > 0 ? 'border-hairline border-t' : ''
                    }`}
                  >
                    <span className="text-text-secondary min-w-0 flex-1 truncate" title={session.projectName}>
                      {session.projectName}
                    </span>
                    <span className="text-text-tertiary shrink-0 text-xs">{session.primaryModel}</span>
                    <span className="text-text-primary w-20 shrink-0 text-right tabular-nums">
                      {formatTokens(totalTokens(session.totals))}
                    </span>
                    <span className="text-text-tertiary w-16 shrink-0 text-right text-xs tabular-nums">
                      {formatRelativeTime(session.endedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </ViewBody>
    </ViewShell>
  )
}

function StatCard({ label, totals }: { label: string; totals: UsageReport['today'] }) {
  const total = totalTokens(totals)
  return (
    <div className="rounded-xl bg-[var(--surface-raised)] p-4">
      <div className="text-text-tertiary text-xs font-medium tracking-[0.04em] uppercase">{label}</div>
      <div className="text-text-primary mt-1 text-lg font-semibold tabular-nums">{formatTokens(total)}</div>
      <div className="text-text-tertiary mt-2 flex flex-col gap-0.5 text-2xs tabular-nums">
        <span>In: {formatTokens(totals.inputTokens)}</span>
        <span>Out: {formatTokens(totals.outputTokens)}</span>
        <span>Cache read: {formatTokens(totals.cacheReadTokens)}</span>
        <span>Cache write: {formatTokens(totals.cacheCreationTokens)}</span>
      </div>
    </div>
  )
}
