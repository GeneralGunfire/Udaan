import { useEffect, useState } from 'react'
import { readThumbnailBytes } from '@/integrations/file-explorer/client'
import { thumbnailLimiter } from '../lib/concurrencyLimiter'

/**
 * Loads a downsized thumbnail (not the full file) as an object URL for
 * grid-view tiles. Queued through a shared concurrency limiter so
 * switching to Grid view in a folder with many images doesn't fire one
 * IPC call per visible file simultaneously — that fan-out (uncapped,
 * every tile mounting and requesting at once) is what previously froze
 * the app switching view modes. Cancels its own pending/queued request on
 * unmount or path change, so scrolling/re-filtering doesn't pile up dead
 * work behind slower ones still queued.
 */
export function useImageThumbnail(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    thumbnailLimiter(() => readThumbnailBytes(path))
      .then((bytes) => {
        if (cancelled) return
        const blob = new Blob([bytes], { type: 'image/jpeg' })
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  return url
}
