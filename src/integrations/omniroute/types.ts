export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
}

/** An OpenAI-format tool definition — same shape Ollama uses, reused as-is from `local-model`. */
export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatToolCall {
  id: string
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ChatResult {
  content: string
  toolCalls?: ChatToolCall[]
}
