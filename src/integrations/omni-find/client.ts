import { invoke } from '@tauri-apps/api/core'

/**
 * OmniFind's web layer — search and page extraction, both native.
 *
 * These cannot be browser `fetch()` calls: search engines send no CORS
 * headers, and many sites serve a stripped page to non-browser agents.
 * See src-tauri/src/omni_find/mod.rs.
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** Which backend found this — 'brave' | 'tavily' | 'duckduckgo' | 'wikipedia'. */
  provider: string
}

export interface PageContent {
  url: string
  title: string
  text: string
  /** True when the page was longer than the extractor's cap, so the UI
   * can say "read the first N characters" rather than implying it read
   * the whole thing. */
  truncated: boolean
  published: string | null
}

export interface SearchKeys {
  brave?: string | null
  tavily?: string | null
}

/** Searches the web. Free backends always run; a key adds a better one. */
export function search(
  query: string,
  limit = 8,
  keys: SearchKeys = {},
): Promise<SearchResult[]> {
  return invoke('omni_find_search', {
    query,
    limit,
    braveKey: keys.brave ?? null,
    tavilyKey: keys.tavily ?? null,
  })
}

/** Fetches one page and returns its readable text. Rejects for paywalls,
 * script-rendered pages, and non-text content — all of which the caller
 * should treat as "this source contributes nothing", not as a failure of
 * the whole research run. */
export function fetchPage(url: string): Promise<PageContent> {
  return invoke('omni_find_fetch_page', { url })
}
