/**
 * Local model integration — Ollama (chat) + faster-whisper (transcription).
 *
 * Hardware target: 4-core CPU, no AVX-512, no discrete GPU, ~8GB RAM.
 * Model choice (qwen2.5:1.5b, ~1GB resident) and whisper size (tiny, ~230MB
 * resident) were picked to leave headroom for the OS and the rest of the app
 * on that budget — do not swap in a larger model without re-checking free RAM.
 */
import { invoke } from '@tauri-apps/api/core'
import type { ChatMessage, ChatOptions, ChatResult, ChatTool, TranscriptionResult } from './types'

const OLLAMA_URL = 'http://localhost:11434'
const CHAT_MODEL = 'qwen2.5:1.5b'

/** Checks whether the Ollama daemon is reachable at all, without invoking the model. */
export async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/** The model this app is configured to talk to, for display purposes (dashboards, status views). */
export function configuredChatModel(): string {
  return CHAT_MODEL
}

export interface RunningModel {
  name: string
  /** Total resident size in bytes, as reported by Ollama. */
  sizeBytes: number
  /** VRAM-resident portion in bytes, as reported by Ollama (0 if running on CPU only). */
  sizeVramBytes: number
  /** ISO timestamp; Ollama will unload the model at this time if idle. */
  expiresAt: string
}

/** Lists models Ollama currently has loaded in memory, via `/api/ps`. Empty array if none loaded or Ollama unreachable. */
export async function listRunningModels(): Promise<RunningModel[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return []
    const data = await res.json()
    const models = Array.isArray(data.models) ? data.models : []
    return models.map((m: Record<string, unknown>) => ({
      name: String(m.name ?? m.model ?? 'unknown'),
      sizeBytes: Number(m.size ?? 0),
      sizeVramBytes: Number(m.size_vram ?? 0),
      expiresAt: String(m.expires_at ?? ''),
    }))
  } catch {
    return []
  }
}

/**
 * Sends a chat completion request to the local Ollama daemon. Ollama must
 * be running (`ollama serve`, or the installed background service). Pass
 * `tools` to enable real function-calling (qwen2.5:1.5b supports it) —
 * the model will either reply with text or emit `toolCalls` on the result,
 * never both meaningfully at once in practice.
 */
export async function chat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  options?: ChatOptions,
  tools?: ChatTool[],
): Promise<ChatResult> {
  let res: Response
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        stream: false,
        ...(options?.temperature !== undefined
          ? { options: { temperature: options.temperature } }
          : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
      }),
      signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new Error(
      `Cannot reach Ollama at ${OLLAMA_URL}. Start it with "ollama serve" or the Ollama background service, then try again.`,
    )
  }
  if (!res.ok) throw new Error(`Ollama chat request failed: ${res.status} ${res.statusText}`)
  const data = await res.json()

  const rawToolCalls = Array.isArray(data.message?.tool_calls) ? data.message.tool_calls : []

  return {
    content: data.message?.content ?? '',
    toolCalls:
      rawToolCalls.length > 0
        ? rawToolCalls.map((tc: { function: { name: string; arguments: Record<string, unknown> } }) => ({
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }))
        : undefined,
    evalCount: data.eval_count ?? 0,
    evalDurationMs: (data.eval_duration ?? 0) / 1_000_000,
  }
}

/** Starts `ollama serve` as a background process managed by Udaan itself, so it survives after this call returns and can later be stopped with `stopOllama()`. No-op if Udaan already has one running. */
export function startOllama(): Promise<void> {
  return invoke('local_model_start_ollama')
}

/** Stops the `ollama serve` process Udaan itself started. Never touches an Ollama instance the user launched some other way. */
export function stopOllama(): Promise<void> {
  return invoke('local_model_stop_ollama')
}

/** True only if Udaan itself currently has an `ollama serve` process running — not a general reachability check (use `isReachable()` for that, which also covers an externally-started instance). */
export function hasStartedOllama(): Promise<boolean> {
  return invoke('local_model_started_ollama')
}

/** Stops an Ollama instance Udaan did not start itself (e.g. the Windows background service/tray app) by killing any process matching Ollama's known executable names. Callers should confirm with the user first — this reaches outside processes the app doesn't own. */
export function stopExternalOllama(): Promise<void> {
  return invoke('local_model_stop_external_ollama')
}

/** Transcribes an audio file at `path` with the local whisper (tiny) model via the Rust backend. */
export function transcribe(path: string): Promise<TranscriptionResult> {
  return invoke('local_model_transcribe', { path })
}

/** Transcribes in-memory WAV bytes (e.g. from a `MediaRecorder` mic capture) without touching the frontend filesystem. */
export function transcribeBytes(audio: Uint8Array): Promise<TranscriptionResult> {
  return invoke('local_model_transcribe_bytes', { audio: Array.from(audio) })
}

export interface TtsVoice {
  id: string
  label: string
  locale: string
  gender: string
}

/** Lists the local neural TTS voices bundled with Udaan (Piper). No lifecycle here — unlike Ollama, Piper has no persistent daemon, so there's nothing to start/stop/check. */
export function listTtsVoices(): Promise<TtsVoice[]> {
  return invoke('tts_list_voices')
}

/** Synthesizes one chunk of text (a sentence or paragraph) to WAV bytes via the local Piper process. `speed` maps to Piper's native `--length_scale` (synthesis-time rate control, not post-hoc playback resampling) — 1.0 is normal. Each call spawns a fresh Piper process (~1.5-2.5s incl. model load); callers should keep a lookahead queue rather than call this strictly on-demand. */
export async function synthesizeSpeech(text: string, voiceId: string, speed: number): Promise<ArrayBuffer> {
  const bytes = await invoke<number[]>('tts_synthesize', { text, voice: voiceId, speed })
  return new Uint8Array(bytes).buffer
}
