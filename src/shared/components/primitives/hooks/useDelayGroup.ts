let lastClosedAt = 0
const GROUP_WINDOW_MS = 300

/** Call when a tooltip closes. */
export function recordTooltipClosed() {
  lastClosedAt = Date.now()
}

/** True if another tooltip closed recently enough that a newly-hovered
 *  tooltip should skip its own open-delay and appear immediately — this
 *  is what makes hovering across a row of icon buttons feel like one
 *  continuous tooltip rather than each one pausing to "reconsider." */
export function shouldSkipDelay(): boolean {
  return Date.now() - lastClosedAt < GROUP_WINDOW_MS
}
