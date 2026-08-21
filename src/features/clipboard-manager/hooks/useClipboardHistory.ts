import { useCallback, useEffect, useState } from 'react'
import {
  listClipboardHistory,
  deleteClipboardEntry,
  clearClipboardHistory,
  restoreClipboardEntry,
  onClipboardChanged,
  type ClipboardEntry,
} from '@/integrations/clipboard-manager'

/** Live clipboard history — loads once, then prepends new entries as the background watcher records them. */
export function useClipboardHistory() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listClipboardHistory()
      .then((found) => {
        if (!cancelled) setEntries(found)
      })
      .catch((err) => console.error('Failed to load clipboard history', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const unlistenPromise = onClipboardChanged((entry) => {
      setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)])
    })

    return () => {
      cancelled = true
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
    try {
      await deleteClipboardEntry(id)
    } catch (err) {
      console.error('Failed to delete clipboard entry', err)
    }
  }, [])

  const clear = useCallback(async () => {
    setEntries([])
    try {
      await clearClipboardHistory()
    } catch (err) {
      console.error('Failed to clear clipboard history', err)
    }
  }, [])

  const restore = useCallback(async (entry: ClipboardEntry) => {
    try {
      await restoreClipboardEntry(entry.kind, entry.content)
    } catch (err) {
      console.error('Failed to restore clipboard entry', err)
    }
  }, [])

  return { entries, loading, remove, clear, restore }
}
