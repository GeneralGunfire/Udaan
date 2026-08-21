export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  /** Tokens generated, for basic latency/perf visibility in callers. */
  evalCount: number
  evalDurationMs: number
}

export interface TranscriptionResult {
  text: string
  language: string
  languageProbability: number
}
