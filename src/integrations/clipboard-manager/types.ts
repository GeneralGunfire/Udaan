export type ClipboardEntryKind = 'text' | 'image'

export interface ClipboardEntry {
  id: string
  kind: ClipboardEntryKind
  /** Full text content, or for images a `data:image/png;base64,...` URL. */
  content: string
  preview: string
  createdAt: string
}
