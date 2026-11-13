/**
 * Local TTS integration — Piper neural speech synthesis, used by Document
 * Reader. Ollama-backed chat/transcription (formerly also in this module,
 * for General Chat's Local mode and voice input) was removed along with
 * Ollama itself.
 *
 * Hardware target: 4-core CPU, no AVX-512, no discrete GPU, ~8GB RAM.
 */
import { invoke } from '@tauri-apps/api/core'

export interface TtsVoice {
  id: string
  label: string
  locale: string
  gender: string
}

/** Lists the local neural TTS voices bundled with Udaan (Piper). No lifecycle here — Piper has no persistent daemon, so there's nothing to start/stop/check. */
export function listTtsVoices(): Promise<TtsVoice[]> {
  return invoke('tts_list_voices')
}

/** Synthesizes one chunk of text (a sentence or paragraph) to WAV bytes via the local Piper process. `speed` maps to Piper's native `--length_scale` (synthesis-time rate control, not post-hoc playback resampling) — 1.0 is normal. Each call spawns a fresh Piper process (~1.5-2.5s incl. model load); callers should keep a lookahead queue rather than call this strictly on-demand. */
export async function synthesizeSpeech(text: string, voiceId: string, speed: number): Promise<ArrayBuffer> {
  const bytes = await invoke<number[]>('tts_synthesize', { text, voice: voiceId, speed })
  return new Uint8Array(bytes).buffer
}
