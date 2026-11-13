/**
 * OmniRoute integration — a local multi-provider LLM proxy
 * (https://github.com/diegosouzapw/OmniRoute) exposing an OpenAI-compatible
 * API. Backs General Chat: no on-device compute limit, so it's given the
 * full schedule tool-calling surface in one turn.
 */
import { invoke } from '@tauri-apps/api/core'
import type { ChatMessage, ChatResult, ChatTool, ChatToolCall } from './types'

const OMNIROUTE_URL = 'http://localhost:20128'
// Client-facing API key for this OmniRoute instance, created via
// `POST /api/keys` once `REQUIRE_API_KEY=true` was turned on (see
// `~/.omniroute/.env`) to close off the dashboard/API to other local
// processes. Scoped to this single local daemon — not a third-party secret —
// so it's kept here rather than added to a secrets-manager dependency this
// project doesn't otherwise have. If OmniRoute's password or this key is
// ever regenerated, a fresh key must be issued here too (see
// `omniroute-overnight/final-report.md` for how it was created).
const OMNIROUTE_API_KEY = 'sk-14107f74a8640555-65d45e-aab45f13'
// `auto/smart` is one of OmniRoute's own router models — it picks the
// best underlying provider/model per request itself, rather than always
// pinning to one fixed model. A prior version let the user override this
// via a picker UI, but the persisted choice wasn't reliably honored (a
// real bug — selecting "Claude Sonnet" was still routing to a different
// model underneath), so the picker was removed rather than debugged
// further; auto-routing is what was actually wanted here anyway.
const CHAT_MODEL = 'auto/smart'

/** Checks whether the OmniRoute daemon is reachable at all. Start it with `omniroute serve --daemon --no-open`. */
export async function isReachable(): Promise<boolean> {
  try {
    // `REQUIRE_API_KEY=true` on the daemon means this now needs the same
    // Bearer key as chat requests — without it every reachability check
    // came back 401 and was indistinguishable from "daemon isn't running".
    const res = await fetch(`${OMNIROUTE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${OMNIROUTE_API_KEY}` },
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** The model OmniRoute is configured to route chat requests to, for display purposes. */
export function configuredChatModel(): string {
  return CHAT_MODEL
}

/** Starts `omniroute serve --daemon --no-open` as a background process managed by Udaan itself, so it survives after this call returns and can later be stopped with `stopOmniRoute()`. No-op if Udaan already has one running. */
export function startOmniRoute(): Promise<void> {
  return invoke('omniroute_start')
}

/** Stops the `omniroute serve` process Udaan itself started. Never touches an OmniRoute instance the user launched some other way. */
export function stopOmniRoute(): Promise<void> {
  return invoke('omniroute_stop')
}

/** True only if Udaan itself currently has an `omniroute serve` process running — not a general reachability check (use `isReachable()` for that, which also covers an externally-started instance). */
export function hasStartedOmniRoute(): Promise<boolean> {
  return invoke('omniroute_started_by_app')
}

interface RawToolCall {
  id: string
  function: { name: string; arguments: string }
}

// OmniRoute's own no-auth free-tier backends (opencode/felo-web — see
// integrations/omniroute) fail a large fraction of requests (measured
// 55-80%+ across two overnight sessions), almost always with one of these
// transient/upstream-exhaustion statuses rather than a real client error —
// so a single retry attempt frequently succeeds on a different candidate
// from the pool. 499 is the client-abandoned/timeout status OmniRoute itself
// returns (not a real cancellation from us — `signal` isn't touched here).
// 401 belongs here too: OmniRoute's own `auto/smart` router can cycle
// through several backend combos internally before giving up, and a
// single dead-combo auth failure (e.g. a free-tier model whose key has
// expired on OmniRoute's side) comes back as a plain 401 with a
// `recovery_hint.action: "retry"` in the response body — OmniRoute is
// telling the caller this specific failure is transient, not that the
// whole request is unauthorized. Without 401 in this set, that one dead
// combo failed the entire chat turn on the first try even though
// OmniRoute's own diagnostics say retrying (which tries a fresh combo
// from its pool) is the right response.
// 400 belongs here for the same reason, confirmed against a real error:
// "OpenCode's free tier can only be used in OpenCode" — one of the named
// free backends above (opencode) actively gate-checks the caller and
// rejects requests from anything that isn't their own client. That's a
// property of the specific combo `auto/smart` happened to pick, not of
// this request being malformed, so retrying (which tries a different
// combo) is the correct response, same as the 401 case.
const RETRYABLE_STATUSES = new Set([400, 401, 429, 499, 502, 503])
const MAX_RETRIES = 1
const RETRY_BASE_DELAY_MS = 500

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

async function chatOnce(
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  options: { temperature?: number } | undefined,
  tools: ChatTool[] | undefined,
): Promise<{ res: Response } | { retryableStatus: number }> {
  let res: Response
  try {
    res = await fetch(`${OMNIROUTE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OMNIROUTE_API_KEY}` },
      body: JSON.stringify({
        model: configuredChatModel(),
        messages,
        // Explicit `stream: false` — without it, OmniRoute was returning a
        // Server-Sent-Events body (`data: {...}\n\n` chunks) instead of a
        // single JSON object, which `res.json()` below then failed to
        // parse with exactly "Unexpected token 'd', "data: {"id"...". This
        // client is a plain request/response caller (no streaming UI), so
        // it needs the non-streaming response shape explicitly rather
        // than relying on whatever OmniRoute happens to default to.
        stream: false,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
      }),
      signal,
    })
  } catch (err) {
    // `AbortSignal.timeout()` rejects with a `TimeoutError`, not
    // `AbortError` — a caller-supplied signal that's manually aborted
    // produces `AbortError`, but the built-in timeout helper does not, so
    // both need checking here. Without this, a genuine request timeout
    // was misreported as "Cannot reach OmniRoute," which reads as "the
    // daemon isn't running" even when it demonstrably is (a simple
    // request to the same daemon succeeds moments later) — confirmed
    // directly while debugging the daily brief's own summarization calls.
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err
    throw new Error(
      `Cannot reach OmniRoute at ${OMNIROUTE_URL}. Start it with "omniroute serve --daemon --no-open" and try again.`,
    )
  }
  if (!res.ok && RETRYABLE_STATUSES.has(res.status)) {
    return { retryableStatus: res.status }
  }
  return { res }
}

let omniDeadUntil = 0
const OMNI_DEAD_MS = 10 * 60_000
let autoStart: Promise<boolean> | null = null

/** Starts the daemon if nobody has; resolves to whether it is reachable. */
async function ensureOmniRoute(): Promise<boolean> {
  if (await isReachable()) return true
  autoStart ??= (async () => {
    try {
      await startOmniRoute()
      for (let i = 0; i < 16; i++) {
        if (await isReachable()) return true
        await delay(500)
      }
    } catch {
      /* not installed or failed to start */
    }
    return false
  })().finally(() => {
    autoStart = null
  })
  return autoStart
}

/** The signed-in Claude CLI, headless. Slower, but independent of OmniRoute's providers. */
async function claudeFallback(messages: ChatMessage[], signal?: AbortSignal, images: string[] = [], timeoutSecs?: number): Promise<ChatResult> {
  const gap = '\n\n'
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join(gap)
  const convo = messages.filter((m) => m.role !== 'system')
  const prompt =
    convo.length === 1
      ? convo[0].content
      : convo.map((m) => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool result'}: ${m.content}`).join(gap) + `${gap}Assistant:`
  const job = invoke<string>('ai_claude_complete', { system: system || null, prompt, model: null, images: images.length ? images : null, timeoutSecs: timeoutSecs ?? null })
  const content = signal
    ? await Promise.race([job, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))])
    : await job
  return { content }
}

/**
 * One chat completion. Tries OmniRoute (starting it if needed); when none
 * of its providers answer, falls back to Claude so the caller still gets a
 * reply. A dead OmniRoute is remembered for a while so later calls go
 * straight to the fallback instead of waiting on it again.
 */
export async function chat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  options?: { temperature?: number; images?: string[]; timeoutSecs?: number; ignoreDeadCache?: boolean },
  tools?: ChatTool[],
): Promise<ChatResult> {
  // Pictures need a vision model; Claude reads the files directly.
  if (options?.images?.length) return claudeFallback(messages, signal, options.images, options.timeoutSecs)
  // A background job with its own patient retry loop (the news brief) opts
  // out of the shared dead-cache, which otherwise sends every attempt after
  // the first straight to the fallback for ten minutes.
  if (options?.ignoreDeadCache || Date.now() >= omniDeadUntil) {
    try {
      if (!(await ensureOmniRoute())) throw new Error('OmniRoute is not running')
      return await chatViaOmniRoute(messages, signal, options, tools)
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError') && signal?.aborted) throw err
      console.warn('[ai] OmniRoute unavailable, using Claude:', err)
      if (!options?.ignoreDeadCache) omniDeadUntil = Date.now() + OMNI_DEAD_MS
    }
  }
  return claudeFallback(messages, signal, [], options?.timeoutSecs)
}

/** Sends a chat completion request to the local OmniRoute daemon (OpenAI-compatible `/v1/chat/completions`). */
async function chatViaOmniRoute(
  messages: ChatMessage[],
  signal?: AbortSignal,
  options?: { temperature?: number },
  tools?: ChatTool[],
): Promise<ChatResult> {  let res: Response | undefined
  let lastRetryableStatus: number | undefined
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const outcome = await chatOnce(messages, signal, options, tools)
    if ('res' in outcome) {
      res = outcome.res
      break
    }
    lastRetryableStatus = outcome.retryableStatus
    if (attempt < MAX_RETRIES) {
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt, signal)
    }
  }

  if (!res) {
    throw new Error(
      `OmniRoute chat request failed after ${MAX_RETRIES + 1} attempts: ${lastRetryableStatus} (upstream provider likely exhausted)`,
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OmniRoute chat request failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
  }
  const data = await res.json()
  const choice = data.choices?.[0]?.message

  const rawToolCalls: RawToolCall[] = Array.isArray(choice?.tool_calls) ? choice.tool_calls : []

  const toolCalls: ChatToolCall[] | undefined =
    rawToolCalls.length > 0
      ? rawToolCalls.map((tc) => {
          let args: Record<string, unknown>
          try {
            args = JSON.parse(tc.function.arguments || '{}')
          } catch {
            // Free-tier backends occasionally emit malformed JSON in
            // tool_call arguments — don't let one bad call discard the
            // whole response; surface it so the caller can report a
            // clear failure instead of retrying silently forever.
            args = { __malformed: true, raw: tc.function.arguments }
          }
          return {
            id: tc.id,
            function: { name: tc.function.name, arguments: args },
          }
        })
      : undefined

  return {
    content: choice?.content ?? '',
    toolCalls,
  }
}
