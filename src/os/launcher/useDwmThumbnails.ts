import { useEffect, useRef } from 'react'
import { registerThumbnail, unregisterAllThumbnails, unregisterThumbnail, updateThumbnail } from '@/integrations/taskbar/client'

export interface ThumbTarget {
  handle: number
  /** Logical px in this window's client area. */
  x: number
  y: number
  width: number
  height: number
  skip?: boolean
  /** 0–1; DWM blends the live preview itself. */
  opacity?: number
}

/**
 * Keeps live DWM thumbnails in sync with a set of rects in this window.
 * DWM draws them on top of the page, so they must be released promptly:
 * registrations that resolve after unmount are released immediately, and
 * windows that drop out of the set are unregistered.
 */
export function useDwmThumbnails(targets: ThumbTarget[]) {
  const registered = useRef(new Map<number, number>())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const map = registered.current
    return () => {
      alive.current = false
      map.clear()
      void unregisterAllThumbnails()
    }
  }, [])

  useEffect(() => {
    const scale = window.devicePixelRatio
    const wanted = new Set<number>()
    for (const t of targets) {
      if (t.skip || t.width < 4 || t.height < 4) continue
      wanted.add(t.handle)
      const rect = {
        left: Math.round(t.x * scale),
        top: Math.round(t.y * scale),
        right: Math.round((t.x + t.width) * scale),
        bottom: Math.round((t.y + t.height) * scale),
      }
      const id = registered.current.get(t.handle)
      if (id !== undefined) {
        if (id >= 0) void updateThumbnail(id, rect, (t.opacity ?? 1) * 255).catch(() => {})
        continue
      }
      registered.current.set(t.handle, -1)
      void registerThumbnail(t.handle, rect).then(
        (thumb) => {
          if (alive.current && registered.current.has(t.handle)) {
            registered.current.set(t.handle, thumb)
            if ((t.opacity ?? 1) < 1) void updateThumbnail(thumb, rect, (t.opacity ?? 1) * 255).catch(() => {})
          } else void unregisterThumbnail(t.handle)
        },
        () => registered.current.delete(t.handle),
      )
    }
    for (const handle of [...registered.current.keys()]) {
      if (!wanted.has(handle)) {
        registered.current.delete(handle)
        void unregisterThumbnail(handle)
      }
    }
  }, [targets])

  /** Drop every preview right now (before a fade-out, so none linger). */
  return () => {
    alive.current = false
    registered.current.clear()
    void unregisterAllThumbnails()
  }
}
