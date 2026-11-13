import { invoke } from '@tauri-apps/api/core'

export interface StudyBook {
  id: string
  title: string
  filePath: string
  fileKind: string
  chunkCount: number
  uploadedAt: string
  indexWarning: string | null
}

interface RawBook {
  id: string
  title: string
  file_path: string
  file_kind: string
  chunk_count: number
  uploaded_at: string
  index_warning: string | null
}

function fromRawBook(raw: RawBook): StudyBook {
  return {
    id: raw.id,
    title: raw.title,
    filePath: raw.file_path,
    fileKind: raw.file_kind,
    chunkCount: raw.chunk_count,
    uploadedAt: raw.uploaded_at,
    indexWarning: raw.index_warning,
  }
}

export interface IndexResult {
  book: StudyBook
  warning: string | null
}

/**
 * Uploads and indexes a book: extracts text (server-side for .pdf; pass
 * `paragraphs` for .docx, extracted on the frontend via mammoth same as
 * Document Reader), chunks it, and embeds every chunk via the local
 * sentence-transformers subprocess. Can take a while on first call (the
 * embedding model's first-ever load is ~24s) — callers should show a real
 * "indexing…" state, not assume this resolves quickly.
 */
export async function addBook(
  filePath: string,
  title: string,
  fileKind: 'pdf' | 'docx',
  paragraphs?: string[],
): Promise<IndexResult> {
  const raw = await invoke<{ book: RawBook; warning: string | null }>('study_add_book', {
    filePath,
    title,
    fileKind,
    paragraphs,
  })
  return { book: fromRawBook(raw.book), warning: raw.warning }
}

export async function listBooks(): Promise<StudyBook[]> {
  const raw = await invoke<RawBook[]>('study_list_books')
  return raw.map(fromRawBook)
}

export function deleteBook(id: string): Promise<void> {
  return invoke('study_delete_book', { id })
}

export interface RetrievedChunk {
  bookId: string
  text: string
  score: number
}

interface RawRetrievedChunk {
  book_id: string
  text: string
  score: number
}

/** Finds the top-N most relevant chunks across the given books for a query. Returns an empty array (not an error) when nothing scores above the relevance floor — callers should treat that as "not covered by this book," not retry. */
export async function retrieve(bookIds: string[], query: string, topN = 5): Promise<RetrievedChunk[]> {
  const raw = await invoke<RawRetrievedChunk[]>('study_retrieve', { bookIds, query, topN })
  return raw.map((c) => ({ bookId: c.book_id, text: c.text, score: c.score }))
}

export interface StudySession {
  id: string
  title: string
  /** Comma-joined book ids open when this session was created. */
  bookIds: string
  createdAt: string
  updatedAt: string
}

interface RawSession {
  id: string
  title: string
  book_ids: string
  created_at: string
  updated_at: string
}

function fromRawSession(raw: RawSession): StudySession {
  return { id: raw.id, title: raw.title, bookIds: raw.book_ids, createdAt: raw.created_at, updatedAt: raw.updated_at }
}

function toRawSession(session: StudySession): RawSession {
  return {
    id: session.id,
    title: session.title,
    book_ids: session.bookIds,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}

export function createSession(session: StudySession): Promise<void> {
  return invoke('study_create_session', { session: toRawSession(session) })
}

export function touchSession(id: string, updatedAt: string): Promise<void> {
  return invoke('study_touch_session', { id, updatedAt })
}

export async function listSessions(): Promise<StudySession[]> {
  const raw = await invoke<RawSession[]>('study_list_sessions')
  return raw.map(fromRawSession)
}

export function deleteSession(id: string): Promise<void> {
  return invoke('study_delete_session', { id })
}

export type StudyRole = 'user' | 'assistant'

export interface StudyMessage {
  id: string
  sessionId: string
  role: StudyRole
  content: string
  createdAt: string
}

interface RawMessage {
  id: string
  session_id: string
  role: StudyRole
  content: string
  created_at: string
}

function fromRawMessage(raw: RawMessage): StudyMessage {
  return { id: raw.id, sessionId: raw.session_id, role: raw.role, content: raw.content, createdAt: raw.created_at }
}

function toRawMessage(message: StudyMessage): RawMessage {
  return {
    id: message.id,
    session_id: message.sessionId,
    role: message.role,
    content: message.content,
    created_at: message.createdAt,
  }
}

export function addMessage(message: StudyMessage): Promise<void> {
  return invoke('study_add_message', { message: toRawMessage(message) })
}

export async function listMessages(sessionId: string): Promise<StudyMessage[]> {
  const raw = await invoke<RawMessage[]>('study_list_messages', { sessionId })
  return raw.map(fromRawMessage)
}
