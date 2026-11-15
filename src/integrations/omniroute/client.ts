/**
 * AI for the whole OS. Every request goes through the AI gateway in Rust (`src-tauri/src/ai_gateway`):
 * OmniRoute first (started for you if it is installed), then Pollinations (free, no key), then any
 * free-tier provider you added a key for in Settings > AI. A provider that fails is rested and the next
 * one answers. The Claude CLI is never used: it spends tokens.
 *
 * The functions here keep the names the apps already use (`chat`, `isReachable`...), so Chat, OmniFind,
 * the daily brief and the rest all got the gateway without being rewritten.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ChatMessage, ChatResult, ChatTool, ChatToolCall } from './types'

const OMNIROUTE_URL = 'http://localhost:20128'

/** Whether OmniRoute itself is answering (one of several providers; the gateway works without it). */
export async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OMNIROUTE_URL}/v1/models`, { signal: AbortSignal.timeout(2000) })
    return res.ok || res.status === 401
  } catch {
    return false
  }
}

/** A short label for the model that is answering, for display. */
export function configuredChatModel(): string {
  return 'auto'
}

export function startOmniRoute(): Promise<void> {
  return invoke('omniroute_start')
}
export function stopOmniRoute(): Promise<void> {
  return invoke('omniroute_stop')
}
export function hasStartedOmniRoute(): Promise<boolean> {
  return invoke('omniroute_started_by_app')
}

export interface ProviderInfo {
  id: string
  name: string
  model: string
  needsKey: boolean
  hasKey: boolean
  enabled: boolean
  state: 'ok' | 'resting' | 'failing' | 'idle'
  lastError: string
  signup: string
  lastOkMs: number
}

export const listProviders = () => invoke<ProviderInfo[]>('ai_providers')
export const setProvider = (id: string, patch: { key?: string; enabled?: boolean }) => invoke('ai_provider_set', { id, key: patch.key ?? null, enabled: patch.enabled ?? null })
export const testProvider = (id: string) => invoke<number>('ai_provider_test', { id })
export const lastProvider = () => invoke<string>('ai_last_provider')

interface RawToolCall {
  id: string
  function: { name: string; arguments: string }
}

export interface AiResult extends ChatResult {
  provider?: string
}

/**
 * One chat completion. `onDelta` receives the answer as it is written (not used when tools are given).
 * Aborting `signal` stops waiting at once.
 */
export async function chat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  options?: { temperature?: number; images?: string[]; timeoutSecs?: number; ignoreDeadCache?: boolean; onDelta?: (text: string) => void; maxTokens?: number },
  tools?: ChatTool[],
): Promise<AiResult> {
  const streamId = options?.onDelta && !(tools && tools.length) ? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : null
  let off: (() => void) | undefined
  if (streamId) {
    const un = await listen<{ id: string; text: string }>('ai://delta', (e) => e.payload.id === streamId && options?.onDelta?.(e.payload.text))
    off = un
  }
  try {
    const job = invoke<{ content: string; toolCalls?: RawToolCall[] | null; provider: string }>('ai_chat', {
      req: {
        messages,
        tools: tools && tools.length ? tools : null,
        temperature: options?.temperature ?? null,
        maxTokens: options?.maxTokens ?? null,
        streamId,
        timeoutSecs: options?.timeoutSecs ?? null,
        images: options?.images?.length ? options.images : null,
      },
    })
    const out = signal
      ? await Promise.race([job, new Promise<never>((_, reject) => (signal.aborted ? reject(new DOMException('Aborted', 'AbortError')) : signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })))])
      : await job
    const toolCalls: ChatToolCall[] | undefined =
      out.toolCalls && out.toolCalls.length
        ? out.toolCalls.map((tc) => {
            let args: Record<string, unknown>
            try {
              args = JSON.parse(tc.function.arguments || '{}')
            } catch {
              args = { __malformed: true, raw: tc.function.arguments }
            }
            return { id: tc.id, function: { name: tc.function.name, arguments: args } }
          })
        : undefined
    return { content: out.content, toolCalls, provider: out.provider }
  } finally {
    off?.()
  }
}
