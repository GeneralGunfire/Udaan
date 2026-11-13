import { useEffect } from 'react'

let lockCount = 0
let originalOverflow = ''
let originalPaddingRight = ''

/**
 * Locks body scroll while `active`, reference-counted so two overlays that
 * both want the lock (e.g. a dialog opening a confirm dialog on top of it)
 * don't fight over restoring the wrong original value on close — only the
 * last one to unlock actually restores `document.body`'s styles.
 *
 * Compensates for the scrollbar's own width so locking scroll doesn't
 * shift layout by however many pixels the (now-hidden) scrollbar took up —
 * measured once per lock rather than assumed, since it varies by OS/zoom.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return

    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow
      originalPaddingRight = document.body.style.paddingRight
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      if (scrollbarWidth > 0) {
        const currentPadding = parseFloat(getComputedStyle(document.body).paddingRight) || 0
        document.body.style.paddingRight = `${currentPadding + scrollbarWidth}px`
      }
    }
    lockCount += 1

    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow
        document.body.style.paddingRight = originalPaddingRight
      }
    }
  }, [active])
}
