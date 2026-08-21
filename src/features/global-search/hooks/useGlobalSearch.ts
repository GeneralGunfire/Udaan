import { useEffect, useState } from 'react'
import { searchEverything } from '../lib/searchIndex'
import type { SearchResult } from '../lib/types'

const DEBOUNCE_MS = 150

export function useGlobalSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const handle = setTimeout(() => {
      searchEverything(query)
        .then((found) => {
          if (!cancelled) setResults(found)
        })
        .catch((err) => console.error('Global search failed', err))
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  return { results, loading }
}
