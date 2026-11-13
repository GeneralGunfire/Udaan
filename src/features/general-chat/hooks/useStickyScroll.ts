import { useCallback, useEffect, useRef } from 'react'

const NEAR_BOTTOM_THRESHOLD_PX = 80

/**
 * Keeps a scroll container pinned to the bottom as new content arrives,
 * but only while the user hasn't scrolled away from the bottom themselves.
 * Once they scroll up to read history, new messages no longer yank them
 * back down — matches normal chat-app behavior (Slack, Discord, etc.).
 *
 * `resetKey` (e.g. the active session id) forces stickToBottom back to
 * true and jumps to bottom immediately — otherwise switching from a
 * session where the user had scrolled up leaves the newly-loaded session
 * showing whatever scroll position the previous session's ref left behind.
 */
export function useStickyScroll<T>(dependency: T, resetKey?: string | number | null) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottom.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
  }, [])

  useEffect(() => {
    stickToBottom.current = true
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (!stickToBottom.current) return
    // Deferred to the next frame rather than set synchronously. A message
    // arrives before its own layout has been performed — images, code
    // blocks and streamed text all change the element's height after this
    // effect runs — so assigning `scrollTop` here used to scroll to the
    // height the container had BEFORE the new content was measured,
    // leaving the newest message partly below the fold. Reading
    // `scrollHeight` a frame later reads the settled height.
    const raf = requestAnimationFrame(() => {
      const current = containerRef.current
      if (current) current.scrollTop = current.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency])

  return { containerRef, handleScroll }
}
