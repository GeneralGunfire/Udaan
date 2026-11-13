import { useEffect, useRef, useState } from 'react'
import { onTransferProgress } from '@/integrations/file-explorer/client'
import type { TransferProgress } from '@/integrations/file-explorer/types'

export interface ActiveTransfer {
  transferId: string
  label: string
  done: number
  total: number
  currentName: string
}

/**
 * Tracks in-flight copy/move progress for large transfers. `start`/`finish`
 * bracket a transfer by id so the progress bar only shows for transfers big
 * enough to matter (small ones finish before a first event even arrives)
 * and disappears the moment the backend command resolves, rather than
 * lingering on the last progress event.
 */
export function useTransferProgress() {
  const [active, setActive] = useState<ActiveTransfer | null>(null)
  const activeIdRef = useRef<string | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    onTransferProgress((progress: TransferProgress) => {
      if (progress.transferId !== activeIdRef.current) return
      setActive((prev) =>
        prev && prev.transferId === progress.transferId
          ? { ...prev, done: progress.done, total: progress.total, currentName: progress.currentName }
          : prev,
      )
    }).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  }, [])

  function start(transferId: string, label: string) {
    activeIdRef.current = transferId
    setActive({ transferId, label, done: 0, total: 0, currentName: '' })
  }

  function finish(transferId: string) {
    if (activeIdRef.current === transferId) {
      activeIdRef.current = null
      setActive(null)
    }
  }

  return { active, start, finish }
}
