export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  /**
   * Lower = more deterministic/grounded, higher = more creative. Ollama
   * defaults to 0.8 if unset, which is too improvisational for factual
   * lookups (e.g. reporting real schedule data back accurately) — pass a
   * low value like 0.1 for those.
   */
  temperature?: number
}

/** An Ollama-format tool definition — see https://ollama.com/blog/tool-support. */
export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ChatResult {
  content: string
  /** Present when the model chose to call one or more tools instead of (or alongside) replying with text. */
  toolCalls?: ChatToolCall[]
  /** Tokens generated, for basic latency/perf visibility in callers. */
  evalCount: number
  evalDurationMs: number
}

export interface TranscriptionResult {
  text: string
  language: string
  languageProbability: number
}
