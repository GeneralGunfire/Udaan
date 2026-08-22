/** "local" | "claude" — Local and Claude conversations are separate threads, never merged. */
export type ChatProvider = 'local' | 'claude'

export interface ChatSession {
  id: string
  title: string
  provider: ChatProvider
  created_at: string
  updated_at: string
}

export type MessageRole = 'user' | 'assistant'

export interface StoredChatMessage {
  id: string
  session_id: string
  role: MessageRole
  content: string
  /** "local" | "claude" — the provider active when the message was sent/answered. */
  mode: string
  created_at: string
}
