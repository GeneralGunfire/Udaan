/**
 * Local model integration — Ollama (chat) + faster-whisper (transcription).
 *
 * Hardware target: 4-core CPU, no AVX-512, no discrete GPU, ~8GB RAM.
 * Model choice (qwen2.5:1.5b, ~1GB resident) and whisper size (tiny, ~230MB
 * resident) were picked to leave headroom for the OS and the rest of the app
 * on that budget — do not swap in a larger model without re-checking free RAM.
 */
import { invoke } from '@tauri-apps/api/core'
import type { ChatMessage, ChatResult, TranscriptionResult } from './types'

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

/** Sends a chat completion request to the local Ollama daemon. Ollama must be running (`ollama serve`, or the installed background service). */
export async function chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResult> {
  let res: Response
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false }),
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

  return {
    content: data.message?.content ?? '',
    evalCount: data.eval_count ?? 0,
    evalDurationMs: (data.eval_duration ?? 0) / 1_000_000,
  }
}

/** Transcribes an audio file at `path` with the local whisper (tiny) model via the Rust backend. */
export function transcribe(path: string): Promise<TranscriptionResult> {
  return invoke('local_model_transcribe', { path })
}

/** Transcribes in-memory WAV bytes (e.g. from a `MediaRecorder` mic capture) without touching the frontend filesystem. */
export function transcribeBytes(audio: Uint8Array): Promise<TranscriptionResult> {
  return invoke('local_model_transcribe_bytes', { audio: Array.from(audio) })
}
