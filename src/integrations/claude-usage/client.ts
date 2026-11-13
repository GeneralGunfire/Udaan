import { invoke } from '@tauri-apps/api/core'

export interface TokenTotals {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

export interface ProjectUsage {
  name: string
  totals: TokenTotals
  sessionCount: number
}

export interface SessionUsage {
  sessionId: string
  projectName: string
  startedAt: string
  endedAt: string
  totals: TokenTotals
  primaryModel: string
}

export interface UsageReport {
  today: TokenTotals
  thisWeek: TokenTotals
  allTime: TokenTotals
  projects: ProjectUsage[]
  recentSessions: SessionUsage[]
  computedAtMs: number
}

interface RawTokenTotals {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
}

interface RawProjectUsage {
  name: string
  totals: RawTokenTotals
  session_count: number
}

interface RawSessionUsage {
  session_id: string
  project_name: string
  started_at: string
  ended_at: string
  totals: RawTokenTotals
  primary_model: string
}

interface RawUsageReport {
  today: RawTokenTotals
  this_week: RawTokenTotals
  all_time: RawTokenTotals
  projects: RawProjectUsage[]
  recent_sessions: RawSessionUsage[]
  computed_at_ms: number
}

function totalsFromRaw(raw: RawTokenTotals): TokenTotals {
  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheCreationTokens: raw.cache_creation_tokens,
    cacheReadTokens: raw.cache_read_tokens,
  }
}

/** Sum of every token category — the one number to show as "total usage." */
export function totalTokens(t: TokenTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens
}

/**
 * Reads Claude Code's own local session logs under `~/.claude/projects/`
 * (read-only — never writes there) and returns aggregated token usage.
 * Backed by a 60s server-side cache; pass `forceRefresh: true` (the
 * dashboard's manual refresh button) to bypass it.
 */
export async function getClaudeUsageReport(forceRefresh = false): Promise<UsageReport> {
  const raw = await invoke<RawUsageReport>('claude_usage_get_report', { forceRefresh })
  return {
    today: totalsFromRaw(raw.today),
    thisWeek: totalsFromRaw(raw.this_week),
    allTime: totalsFromRaw(raw.all_time),
    projects: raw.projects.map((p) => ({ name: p.name, totals: totalsFromRaw(p.totals), sessionCount: p.session_count })),
    recentSessions: raw.recent_sessions.map((s) => ({
      sessionId: s.session_id,
      projectName: s.project_name,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      totals: totalsFromRaw(s.totals),
      primaryModel: s.primary_model,
    })),
    computedAtMs: raw.computed_at_ms,
  }
}
