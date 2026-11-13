/**
 * LLM escalation — the LAST resort, used only when the deterministic parser
 * genuinely can't resolve a command (unknown intent on schedule-shaped
 * text, or a target reference that fuzzy-matches nothing).
 *
 * Stubbed out: the local Ollama runtime this relied on was removed from the
 * app entirely. Both functions below always return `null` (their existing
 * "no match found" result), which every call site in `conversationEngine.ts`
 * already handles by bailing out cleanly to its next fallback — so callers
 * need no changes. If a local-model-backed fallback is reintroduced later,
 * restore the real implementation here (see git history for the last
 * working version, which called `@/integrations/local-model`).
 */
import type { CalendarEvent } from '../types'

/** Always returns null — see module doc comment. */
export async function disambiguateReference(
  _reference: string,
  _candidates: CalendarEvent[],
  _signal?: AbortSignal,
): Promise<CalendarEvent | null> {
  return null
}

/** Always returns null — see module doc comment. */
export async function interpretFreeformCreate(
  _prompt: string,
  _today: Date,
  _signal?: AbortSignal,
): Promise<{ title: string; date: string; time?: string; allDay?: boolean } | null> {
  return null
}
