export type SearchResultKind = 'task' | 'notification' | 'document'

export interface SearchResult {
  id: string
  kind: SearchResultKind
  title: string
  subtitle: string
  createdAt: string
  /** Opaque payload the caller (GlobalSearchOverlay) uses to navigate on click. */
  navTarget: { kind: SearchResultKind; id: string }
}
