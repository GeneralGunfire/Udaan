import { chat } from '@/integrations/omniroute'
import type { ChatMessage } from '@/integrations/omniroute'
import { fetchRecentItems, type RawItem, type BriefCategory } from './rss'

/**
 * A background morning job has a completely different reliability profile
 * than interactive chat: nobody is staring at a spinner waiting on it, and
 * it has a genuinely large time budget (30 minutes) to spend, so it's
 * worth retrying far more patiently than `omniroute/client.ts`'s own
 * interactive-chat retry (2 quick retries, sub-3s backoff — correct for a
 * human waiting on a reply, but nowhere near enough to survive OmniRoute's
 * free-tier backends having a genuinely bad multi-minute stretch, which
 * live testing confirmed does happen). This wraps `chat()` with a much
 * longer, slower retry loop reserved for this feature alone — it never
 * touches `omniroute/client.ts` itself, so General Chat's interactive feel
 * is completely unaffected.
 */
const BRIEF_MAX_ATTEMPTS = 5
const BRIEF_RETRY_BASE_DELAY_MS = 15_000
const BRIEF_RETRY_MAX_DELAY_MS = 90_000
/** Per-attempt request timeout — `chat()`'s own underlying fetch has NO
 * timeout by default when called without a signal (confirmed directly: a
 * real morning run hung for 15+ minutes on a single request with three
 * TCP connections sitting established but silent, never erroring and
 * never completing). Without this, one hung request could burn the
 * entire 30-minute budget on a single attempt instead of actually
 * retrying across the 14 attempts this is designed for. */
const BRIEF_REQUEST_TIMEOUT_MS = 240_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retries with linearly growing backoff (15s, 30s, 45s, ... capped at 90s)
 * rather than a fixed delay — live testing against the real OmniRoute
 * daemon hit a stretch where every free-tier provider in the pool was
 * exhausted for several consecutive minutes, so a short fixed retry
 * window would have degraded to raw headlines on a morning that a longer
 * wait would have recovered from. Worst case (all 14 attempts fail) is
 * ~13.5 minutes of backoff plus request time — comfortably inside the
 * 30-minute overall budget enforced by scheduler.ts, leaving headroom for
 * the RSS fetch and the request round-trips themselves.
 */
async function chatWithPatientRetry(messages: ChatMessage[], temperature: number): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= BRIEF_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chat(messages, AbortSignal.timeout(BRIEF_REQUEST_TIMEOUT_MS), {
        temperature,
        // This loop does its own patient retrying, so it must not be sent to
        // the fallback for ten minutes after one OmniRoute miss.
        ignoreDeadCache: true,
        // The Claude fallback's own process timeout has to exceed this
        // attempt's request timeout, or every fallback attempt is killed
        // before it can answer a prompt this large.
        timeoutSecs: Math.floor(BRIEF_REQUEST_TIMEOUT_MS / 1000) + 60,
      })
      const content = response.content.trim()
      if (content) return content
      lastError = new Error('Empty response from summarizer')
    } catch (err) {
      lastError = err
    }
    const delay = Math.min(BRIEF_RETRY_BASE_DELAY_MS * attempt, BRIEF_RETRY_MAX_DELAY_MS)
    console.warn(
      `Daily brief: summarization attempt ${attempt}/${BRIEF_MAX_ATTEMPTS} failed, retrying in ${delay / 1000}s:`,
      lastError,
    )
    if (attempt < BRIEF_MAX_ATTEMPTS) await sleep(delay)
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Per-category cap on how many raw items get sent to the summarizer.
 * Raised from an earlier, tighter 8 after real morning runs came back too
 * shallow (2 of 4 categories with almost nothing to work with) — the
 * summarizer needs enough real material per category to actually exercise
 * its own "pick what's genuinely significant" judgment rather than being
 * handed only 1-2 items and forced to report on whatever exists. */
const MAX_ITEMS_PER_CATEGORY = 20

/** Title patterns that are almost never genuinely brief-worthy even when
 * multiple outlets happen to cover them (a viral/novelty story getting
 * picked up by several outlets is a POOR significance signal — cross-
 * outlet coverage alone was letting things like product reviews and
 * novelty stories through). Filtered out before scoring, not just
 * deprioritized, since these add no value even as filler. */
const LOW_VALUE_TITLE_PATTERNS: RegExp[] = [
  /\breview\b/i,
  /\bbest .* (of|for) 20\d\d\b/i,
  /\bhow to\b/i,
  /\bquiz\b/i,
  /\bhoroscope\b/i,
  /\brecipe\b/i,
  /\bcrossword\b/i,
]

function isLowValue(item: RawItem): boolean {
  return LOW_VALUE_TITLE_PATTERNS.some((pattern) => pattern.test(item.title))
}

/** A story multiple outlets are covering is a much stronger significance
 * signal than one outlet's single item — scored by near-duplicate title
 * overlap across sources within the same category. */
function scoreItems(items: RawItem[]): (RawItem & { score: number })[] {
  return items.map((item) => {
    const words = new Set(item.title.toLowerCase().split(/\W+/).filter((w) => w.length > 4))
    let crossOutletHits = 0
    for (const other of items) {
      if (other.source === item.source) continue
      const otherWords = other.title.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
      if (otherWords.some((w) => words.has(w))) crossOutletHits++
    }
    return { ...item, score: crossOutletHits }
  })
}

/** Trims each category to its top-N by (cross-outlet coverage, then
 * recency) — reduces prompt size without cutting stories that actually
 * matter, since low-signal filler items weren't adding report quality
 * anyway. Obviously low-value items (reviews, listicles, lifestyle
 * filler) are dropped outright before scoring, since they occasionally
 * outnumber real news within a single outlet's feed and would otherwise
 * crowd out genuine stories purely by volume. */
function selectTopItems(items: RawItem[]): RawItem[] {
  const byCategory = new Map<BriefCategory, RawItem[]>()
  for (const item of items) {
    if (isLowValue(item)) continue
    const list = byCategory.get(item.category) ?? []
    list.push(item)
    byCategory.set(item.category, list)
  }
  const selected: RawItem[] = []
  for (const [, categoryItems] of byCategory) {
    const scored = scoreItems(categoryItems).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
    })
    selected.push(...scored.slice(0, MAX_ITEMS_PER_CATEGORY))
  }
  return selected
}

const CATEGORY_LABELS: Record<BriefCategory, string> = {
  southafrica: 'South Africa',
  politics: 'Politics',
  conflict: 'Conflict & Geopolitics',
  technology: 'Technology',
  science: 'Science',
  business: 'Business & Economy',
  health: 'Health & Medicine',
}

function formatItemsForPrompt(items: RawItem[]): string {
  const byCategory = new Map<BriefCategory, RawItem[]>()
  for (const item of items) {
    const list = byCategory.get(item.category) ?? []
    list.push(item)
    byCategory.set(item.category, list)
  }
  const sections: string[] = []
  for (const [category, categoryItems] of byCategory) {
    const lines = categoryItems.map(
      (item) => `- [${item.source}] ${item.title} — ${item.description || '(no summary provided)'}`,
    )
    sections.push(`### ${CATEGORY_LABELS[category]}\n${lines.join('\n')}`)
  }
  return sections.join('\n\n')
}

const SYSTEM_PROMPT = `You are writing Udaan's daily morning news brief — a short, professionally written news digest, not a chat response.

Your source material is a list of raw RSS headlines and short descriptions from multiple real outlets, grouped by category (South Africa, Technology, Health & Medicine, Conflict & Geopolitics, Politics, Science, Business & Economy). You are given up to 20 items per category specifically so you have enough real material to be selective and thorough — use that material generously rather than writing a thin report.

Rules, all mandatory:
1. Aim for genuine depth. The reader cares most about South Africa, technology developments (especially AI, computing and science breakthroughs), medicine and health, and conflicts: write 5-8 story items for each of those four, and 3-5 for the other categories. Order the report: South Africa, Technology, Health & Medicine, Conflict & Geopolitics, then the rest. Each story should explain what happened, why it matters and what comes next, in 3-5 sentences. A category with fewer than 3 substantive items in the source list is the ONLY case where fewer stories is acceptable — never pad, but also never under-report when the source material actually supports more.
2. Prioritize genuinely important developments — real escalations, major political decisions, significant technology or science breakthroughs, substantive policy/business/research news — over minor, novelty, or human-interest filler. A story getting covered by multiple outlets is a hint it may matter, but is NOT sufficient on its own — a quirky or trivial story (renaming disputes, minor celebrity news, novelty product stories, listicles) covered by several outlets is still not brief-worthy. Judge each story on its own substance.
3. Write in an engaging, clear, professional reporter voice. This is real journalism-style writing, not an AI assistant summarizing bullet points. Vary sentence structure. Avoid generic phrases like "in other news" or "additionally."
4. Stay strictly neutral. For contested or political topics, present the different sides/positions factually rather than taking one. Never editorialize or insert opinion.
5. Paraphrase everything in your own original wording. NEVER copy a sentence or long phrase directly from a source description — a short quoted fragment (under 15 words) is only acceptable if it is directly attributed in quotation marks. Always name which outlet a claim came from (e.g. "according to the BBC" or "Reuters reported").
6. If the source material naturally supports it, separate "Developments" (what already happened) from "What to watch" (upcoming/ongoing situations worth tracking) — but don't force this structure if it doesn't fit naturally.
7. Structure the output as Markdown with a "## " heading per category actually covered (skip a category entirely only if there is truly nothing substantive in it — never pad, but don't skip a category just because its stories require more effort to write well). Under each heading, write your story items, each with a bold headline-style title line followed by 2-4 sentences of body text.
8. Do not include any preamble, sign-off, or meta-commentary about being an AI. Output only the report itself, starting directly with the first "## " heading.`

export interface GenerationResult {
  markdown: string | null
  /** True when generation succeeded but had to degrade in some way
   * (fewer backends available, more aggressive trimming than usual) —
   * surfaced in the UI as a visible notice rather than silently producing
   * a lower-quality report indistinguishable from a normal one. */
  degraded: boolean
  degradedReason?: string
}

/** How many of the four categories can come back with fewer than this many
 * raw items before the report is flagged as degraded (thin sourcing that
 * morning) rather than treated as a silently normal, complete report. */
const MIN_ITEMS_FOR_HEALTHY_CATEGORY = 3

/** Runs the fetch + trim + summarize pipeline once. Never throws — a total
 * failure returns `{ markdown: null, degraded: true }` so the caller can
 * fall back to showing raw headlines instead of an error or blank state. */
export async function generateDailyBrief(): Promise<{ result: GenerationResult; rawItems: RawItem[] }> {
  const { items: rawItems, failures } = await fetchRecentItems()
  if (rawItems.length === 0) {
    return { result: { markdown: null, degraded: true, degradedReason: 'No RSS items could be fetched' }, rawItems }
  }

  const itemsByCategory = new Map<BriefCategory, number>()
  for (const item of rawItems) {
    itemsByCategory.set(item.category, (itemsByCategory.get(item.category) ?? 0) + 1)
  }
  const thinCategories = (
    ['politics', 'conflict', 'technology', 'science', 'business', 'health'] as BriefCategory[]
  ).filter((c) => (itemsByCategory.get(c) ?? 0) < MIN_ITEMS_FOR_HEALTHY_CATEGORY)
  const sourcingDegradedReason =
    thinCategories.length > 0
      ? `Thin sourcing today for: ${thinCategories.map((c) => CATEGORY_LABELS[c]).join(', ')}${failures.length > 0 ? ` (${failures.length} feed fetch${failures.length === 1 ? '' : 'es'} failed)` : ''}`
      : undefined

  // Trimming down to the per-category cap is now the routine case (6
  // categories × up to 14 items each is a normal, expected volume with
  // this feed set) — it was previously flagged as "degraded," which
  // undersold an otherwise complete, well-sourced report as a warning-
  // worthy one on nearly every run. Only genuinely thin sourcing (a
  // category with real gaps, or feed fetch failures) still counts.
  const selected = selectTopItems(rawItems)
  const prompt = formatItemsForPrompt(selected)

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Here are today's raw source items, grouped by category:\n\n${prompt}` },
  ]

  try {
    const markdown = await chatWithPatientRetry(messages, 0.4)
    return {
      result: {
        markdown,
        degraded: sourcingDegradedReason !== undefined,
        degradedReason: sourcingDegradedReason,
      },
      rawItems,
    }
  } catch (err) {
    // Exhausted every retry within the patient window — genuinely no
    // summarization backend was available this morning, not just a single
    // transient blip. Falls through to the raw-headlines fallback.
    console.error('Daily brief: summarization failed after all retries:', err)
    return {
      result: { markdown: null, degraded: true, degradedReason: 'All summarization backends unavailable after repeated retries' },
      rawItems,
    }
  }
}
