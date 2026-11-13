import { useRef } from 'react'

const BUFFER_RESET_MS = 700

/**
 * Buffers printable keypresses (typing "s", then "a" within the window
 * extends the search to "sa" rather than restarting at "a") and resolves
 * to the next menu item whose visible text starts with that buffer —
 * standard native <select>/menu typeahead behavior. Composed into
 * useRovingFocus's keydown handler, not wired separately by each menu.
 */
export function useTypeahead() {
  const buffer = useRef('')
  const lastKeyTime = useRef(0)

  function handleTypeaheadKey(
    key: string,
    items: HTMLElement[],
    currentIndex: number,
  ): number | null {
    if (key.length !== 1 || !/[a-z0-9]/i.test(key)) return null
    const now = Date.now()
    if (now - lastKeyTime.current > BUFFER_RESET_MS) buffer.current = ''
    lastKeyTime.current = now
    buffer.current += key.toLowerCase()

    const search = buffer.current
    // Start searching just after the current item so repeated presses of
    // the same letter cycle through all matches rather than always
    // landing on the first one.
    const ordered = [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex + 1)]
    const match = ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(search))
    if (!match) return null
    return items.indexOf(match)
  }

  return { handleTypeaheadKey }
}
