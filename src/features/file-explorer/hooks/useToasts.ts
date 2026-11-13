import { useCallback, useRef, useState } from 'react'

export interface Toast {
  id: string
  message: string
  tone: 'default' | 'danger'
}

const TOAST_DURATION_MS = 3200

/** Lightweight local toast queue — File Explorer has no app-wide toast system to reuse, so this stays scoped here rather than introducing one globally. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message: string, tone: Toast['tone'] = 'default') => {
      const id = crypto.randomUUID()
      setToasts((prev) => [...prev, { id, message, tone }])
      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  return { toasts, push, dismiss }
}
