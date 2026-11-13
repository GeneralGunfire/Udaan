/** "local" | "omniroute" — Local and OmniRoute conversations are separate threads, never merged. */
export type ChatProvider = 'local' | 'omniroute'

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
  /** "local" | "omniroute" — the provider active when the message was sent/answered. */
  mode: string
  created_at: string
}

/** One cross-session key fact (e.g. key: "name", value: "Tess"). */
export interface MemoryFact {
  key: string
  value: string
  updated_at: string
}
