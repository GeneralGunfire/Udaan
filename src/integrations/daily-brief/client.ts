import { invoke } from '@tauri-apps/api/core'

export interface DailyBrief {
  date: string
  report_markdown: string | null
  raw_items_json: string
  generation_attempted: boolean
  degraded: boolean
  degraded_reason: string | null
  generated_at: string
}

export interface BriefHistoryEntry {
  date: string
  has_report: boolean
  degraded: boolean
}

/** Today's brief, if generation has already been attempted today — `null` means nothing has run yet today and the pipeline should be triggered. */
export function getTodayBrief(): Promise<DailyBrief | null> {
  return invoke('daily_brief_get_today')
}

/** A specific past date's brief, for history browsing. */
export function getBriefByDate(date: string): Promise<DailyBrief | null> {
  return invoke('daily_brief_get_by_date', { date })
}

/** Most-recent-first list of every date a brief exists for. */
export function listBriefHistory(): Promise<BriefHistoryEntry[]> {
  return invoke('daily_brief_list_history')
}

/** Persists today's result — called whether generation fully succeeded, degraded, or failed outright, so the app never re-runs the pipeline twice in one day. */
export function saveTodayBrief(
  reportMarkdown: string | null,
  rawItemsJson: string,
  degraded: boolean,
  degradedReason: string | null,
): Promise<void> {
  return invoke('daily_brief_save', { reportMarkdown, rawItemsJson, degraded, degradedReason })
}

/** Wipes every stored brief — used to clear history and regenerate from scratch. */
export function deleteAllBriefs(): Promise<void> {
  return invoke('daily_brief_delete_all')
}
