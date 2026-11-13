import { useEffect, useState } from 'react'
import { getHandlersForExtension } from '@/integrations/installed-apps/client'
import type { FileHandler } from '@/integrations/installed-apps/types'

/** Loads the "Open with" list (OS-registered handlers, default first) for a file's extension. */
export function useOpenWithHandlers(extension: string | null): FileHandler[] {
  const [handlers, setHandlers] = useState<FileHandler[]>([])

  useEffect(() => {
    if (!extension) {
      setHandlers([])
      return
    }
    let cancelled = false
    getHandlersForExtension(extension)
      .then((result) => {
        if (!cancelled) setHandlers(result)
      })
      .catch(() => {
        if (!cancelled) setHandlers([])
      })
    return () => {
      cancelled = true
    }
  }, [extension])

  return handlers
}
