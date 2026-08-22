import { useCallback, useEffect, useRef } from 'react'

const NEAR_BOTTOM_THRESHOLD_PX = 80

/**
 * Keeps a scroll container pinned to the bottom as new content arrives,
 * but only while the user hasn't scrolled away from the bottom themselves.
 * Once they scroll up to read history, new messages no longer yank them
 * back down — matches normal chat-app behavior (Slack, Discord, etc.).
 */
export function useStickyScroll<T>(dependency: T) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottom.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency])

  return { containerRef, handleScroll }
}
