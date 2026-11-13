import { getTodayBrief, saveTodayBrief } from './client'
import { generateDailyBrief } from './generate'
import { fetchRecentItems, type RawItem } from './rss'
import { isReachable, startOmniRoute } from '@/integrations/omniroute'

/** How long to wait for OmniRoute's daemon to actually start listening
 * after asking it to — cold start (spawning the process, it opening its
 * port) genuinely takes a few seconds; a single immediate reachability
 * check right after `startOmniRoute()` returns can still see "not
 * reachable yet" even on a successful start (same lesson already learned
 * in `useOmniRouteControl.ts`'s own start button). */
const OMNIROUTE_STARTUP_TIMEOUT_MS = 15_000
const OMNIROUTE_STARTUP_POLL_MS = 750

/**
 * OmniRoute is entirely manual-start elsewhere in this app (the composer's
 * daemon-status button) — nothing about Udaan's own boot sequence starts
 * it. A 5am automated job cannot assume a human clicked "Start" the night
 * before, so this is the one place that starts it itself if it isn't
 * already running, before attempting generation. Failing to start is not
 * treated as fatal here — the caller's own retry loop against `chat()`
 * will simply keep failing and correctly degrade to raw headlines, same
 * as any other backend-unavailable morning.
 */
async function ensureOmniRouteRunning(): Promise<void> {
  if (await isReachable()) return
  try {
    await startOmniRoute()
  } catch (err) {
    console.error('Daily brief: failed to auto-start OmniRoute:', err)
    return
  }
  const deadline = Date.now() + OMNIROUTE_STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isReachable()) return
    await new Promise((resolve) => setTimeout(resolve, OMNIROUTE_STARTUP_POLL_MS))
  }
  console.warn('Daily brief: OmniRoute did not become reachable within the startup timeout')
}

/** Target daily run time — the brief is generated for "today" once, either
 * right at 5am if Udaan is already running, or on the next app launch that
 * happens after 5am with no report yet for today (covers the "Udaan
 * wasn't running at exactly 5am" case identically, since both paths just
 * check "does today have a row yet"). */
const SCHEDULED_HOUR = 5

/** Hard wall-clock budget for the whole fetch+summarize pipeline. If a
 * generation run is still going past this, it's abandoned and the raw
 * items already fetched (if any) are saved as a degraded fallback rather
 * than leaving the morning report stuck "in progress" indefinitely. */
const MAX_GENERATION_MS = 30 * 60 * 1000

let generationInFlight: Promise<void> | null = null

function msUntilNext5am(): number {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), SCHEDULED_HOUR, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime() - now.getTime()
}

async function runWithBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Daily brief generation exceeded its time budget')), budgetMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

/** Runs the full generation pipeline once and persists the result,
 * whatever it is — a normal report, a degraded report, or (if everything
 * failed, including hitting the time budget) a raw-headlines-only
 * fallback. Never throws: this is meant to be fired from a timer/startup
 * check with nothing downstream awaiting it. */
async function runGenerationOnce(): Promise<void> {
  // Headlines are fetched first and kept here so that a later summarization
  // failure (or the budget timeout) still has real news to save, instead of
  // discarding everything and leaving the app with an empty report it will
  // not retry. Without this the brief was permanently blank on any morning
  // the summarizer could not be reached.
  let fetched: RawItem[] = []
  try {
    const { items } = await fetchRecentItems()
    fetched = items
    if (items.length > 0) {
      await saveTodayBrief(null, JSON.stringify(items), true, 'Headlines are in — writing the summary…')
    }
  } catch (err) {
    console.error('Daily brief: feed fetch failed:', err)
  }

  try {
    await ensureOmniRouteRunning()
    const { result, rawItems } = await runWithBudget(generateDailyBrief(), MAX_GENERATION_MS)
    await saveTodayBrief(
      result.markdown,
      JSON.stringify(rawItems.length > 0 ? rawItems : fetched),
      result.degraded,
      result.degradedReason ?? null,
    )
  } catch (err) {
    // Either the budget timeout fired, or something in the pipeline threw
    // in a way generateDailyBrief() itself didn't already catch (it's
    // designed not to throw, but this is the last line of defense so a
    // morning is never left with literally nothing saved). Best-effort: no
    // raw items are available here since generateDailyBrief() didn't
    // return, so this is the emptiest possible fallback state.
    console.error('Daily brief: generation run failed:', err)
    await saveTodayBrief(
      null,
      JSON.stringify(fetched),
      true,
      fetched.length > 0 ? 'The written summary could not be produced — showing headlines.' : 'Generation did not complete in time',
    ).catch((saveErr) => console.error('Daily brief: failed to save fallback state:', saveErr))
  }
}

/** Generates today's brief if (and only if) nothing has been attempted for
 * today yet — safe to call repeatedly (e.g. once on every app launch);
 * it's a no-op once today's row exists, successful or not. */
async function ensureTodayGenerated(): Promise<void> {
  if (generationInFlight) return generationInFlight
  const existing = await getTodayBrief().catch(() => null)
  // A brief that came out degraded (no AI summary) is retried, at most hourly.
  const degradedAndStale = existing?.degraded && Date.now() - new Date(existing.generated_at).getTime() > 60 * 60_000
  if (existing?.generation_attempted && !degradedAndStale) return
  generationInFlight = runGenerationOnce().finally(() => {
    generationInFlight = null
  })
  return generationInFlight
}

let scheduledTimer: ReturnType<typeof setTimeout> | null = null

function scheduleNext5am() {
  if (scheduledTimer) clearTimeout(scheduledTimer)
  // setTimeout's delay is a 32-bit signed int internally — a delay past
  // ~24.8 days overflows and fires almost immediately instead of never.
  // The longest real delay here is under 24h (worst case: just missed
  // 5am), so this is only a defensive cap, never expected to bite.
  const delay = Math.min(msUntilNext5am(), 2 ** 31 - 1)
  scheduledTimer = setTimeout(() => {
    void ensureTodayGenerated().finally(scheduleNext5am)
  }, delay)
}

/** Call once, at app startup: immediately checks whether today's brief
 * still needs generating (covers "Udaan started after 5am with nothing
 * generated yet"), then arms a timer for the next 5am so a long-running
 * session also gets tomorrow's brief without needing a restart. */
export function initDailyBriefScheduler(): void {
  void ensureTodayGenerated()
  scheduleNext5am()
  setInterval(() => void ensureTodayGenerated(), 60 * 60_000)
}

/** Writes today's brief again now, whatever state it is in (the News app's "Regenerate"). */
export function regenerateTodayBrief(): Promise<void> {
  if (generationInFlight) return generationInFlight
  generationInFlight = runGenerationOnce().finally(() => {
    generationInFlight = null
  })
  return generationInFlight
}
