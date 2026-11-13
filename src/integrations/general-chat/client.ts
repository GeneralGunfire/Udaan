import { invoke } from '@tauri-apps/api/core'
import type { ChatProvider, ChatSession, MemoryFact, MessageRole, StoredChatMessage } from './types'

/** Creates a new chat session for a provider, titled from a truncated copy of the first message. */
export function createSession(firstMessage: string, provider: ChatProvider): Promise<ChatSession> {
  return invoke('general_chat_create_session', { firstMessage, provider })
}

/** Lists sessions for one provider, most recently updated first. Local and OmniRoute never mix. */
export function listSessions(provider: ChatProvider): Promise<ChatSession[]> {
  return invoke('general_chat_list_sessions', { provider })
}

/** Lists all messages in a session, oldest first. */
export function listMessages(sessionId: string): Promise<StoredChatMessage[]> {
  return invoke('general_chat_list_messages', { sessionId })
}

/** Persists a new message and bumps the session's updated_at. */
export function addMessage(
  sessionId: string,
  role: MessageRole,
  content: string,
  mode: string,
): Promise<StoredChatMessage> {
  return invoke('general_chat_add_message', { sessionId, role, content, mode })
}

/** Updates a message's content in place — used once an assistant reply finishes streaming. */
export function updateMessage(id: string, content: string): Promise<void> {
  return invoke('general_chat_update_message', { id, content })
}

/** Deletes a session and all its messages. */
export function deleteSession(id: string): Promise<void> {
  return invoke('general_chat_delete_session', { id })
}

/** Sets/overwrites one cross-session key fact — a flat store, not a transcript. */
export function setMemoryFact(key: string, value: string): Promise<void> {
  return invoke('general_chat_set_memory_fact', { key, value })
}

export function deleteMemoryFact(key: string): Promise<void> {
  return invoke('general_chat_delete_memory_fact', { key })
}

/** All stored facts, most recently updated first. */
export function listMemoryFacts(): Promise<MemoryFact[]> {
  return invoke('general_chat_list_memory_facts')
}
