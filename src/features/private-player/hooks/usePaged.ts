import { useMemo, useState } from 'react'

/** "Show 20 more" pagination, matching the original app's use-paged.ts
 * pattern (there PAGE was 10; 20 per the explicit spec here) — renders a
 * fixed slice of a list rather than the whole thing at once, since
 * mounting every row/cover-art-placeholder for a 200-track library at once
 * was the direct cause of the library view's lag. */
export function usePaged<T>(items: T[], pageSize = 20) {
  const [visibleCount, setVisibleCount] = useState(pageSize)

  const visible = useMemo(() => items.slice(0, visibleCount), [items, visibleCount])
  const hasMore = visibleCount < items.length

  function showMore() {
    setVisibleCount((c) => Math.min(items.length, c + pageSize))
  }

  function reset() {
    setVisibleCount(pageSize)
  }

  return { visible, hasMore, showMore, reset, remaining: items.length - visibleCount }
}
