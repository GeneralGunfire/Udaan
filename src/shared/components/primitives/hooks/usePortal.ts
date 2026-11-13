import { useEffect, useState } from 'react'

const CONTAINER_ID = 'udaan-portal-root'

/**
 * Every overlay primitive (Dialog, Popover, Tooltip, DropdownMenu) mounts
 * into one shared container appended to <body>, rather than each creating
 * its own div. A single container means one predictable place in the DOM
 * to reason about stacking (paired with the zIndex scale in
 * shared/lib/motion.ts) and one place a future "close everything" action
 * could target, instead of N ad-hoc containers scattered through <body>.
 *
 * Lazily created on first use and never removed — these mount for the
 * lifetime of the app, so there's nothing to clean up on unmount.
 */
function getOrCreateContainer(): HTMLElement {
  let container = document.getElementById(CONTAINER_ID)
  if (!container) {
    container = document.createElement('div')
    container.id = CONTAINER_ID
    document.body.appendChild(container)
  }
  return container
}

/** Returns the shared portal container once mounted (SSR-safe — the
 *  document doesn't exist until an effect runs client-side; this app has
 *  no SSR path, but the null-first render is also just correct React). */
export function usePortalContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setContainer(getOrCreateContainer())
  }, [])

  return container
}
