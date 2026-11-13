import { useCallback, useEffect, useState } from 'react'
import type { QuickAccessLocation } from '@/integrations/file-explorer/types'

const STORAGE_KEY = 'udaan.file-explorer.pinned-folders'

function readStored(): QuickAccessLocation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as QuickAccessLocation[]) : []
  } catch {
    return []
  }
}

function folderNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

/** Persists user-pinned folders (sidebar "Pinned" section) in localStorage — per-device, no backend needed. */
export function usePinnedFolders() {
  const [pinned, setPinned] = useState<QuickAccessLocation[]>(readStored)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pinned))
    } catch {
      // best-effort persistence only
    }
  }, [pinned])

  const pin = useCallback((path: string) => {
    setPinned((prev) => {
      if (prev.some((p) => p.path === path)) return prev
      return [...prev, { name: folderNameFromPath(path), path }]
    })
  }, [])

  const unpin = useCallback((path: string) => {
    setPinned((prev) => prev.filter((p) => p.path !== path))
  }, [])

  /** Moves the pin at `fromIndex` to `toIndex` — used by sidebar drag-reordering. */
  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setPinned((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  return { pinned, pin, unpin, reorder }
}
