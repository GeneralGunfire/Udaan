import { useCallback, useEffect, useState } from 'react'
import { listDir } from '@/integrations/file-explorer/client'
import type { FileEntry } from '@/integrations/file-explorer/types'

interface UseDirectoryListingResult {
  entries: FileEntry[]
  loading: boolean
  error: string | null
  refresh: () => void
}

/** Loads (and lets callers refresh) the immediate children of `dirPath`. */
export function useDirectoryListing(dirPath: string): UseDirectoryListingResult {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listDir(dirPath)
      .then((result) => {
        if (!cancelled) setEntries(result)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dirPath, refreshToken])

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), [])

  return { entries, loading, error, refresh }
}
