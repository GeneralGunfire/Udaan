import { useCallback, useState } from 'react'

/** Back/forward stack over visited folder paths, browser-tab style. */
export function useNavigationHistory(initialPath: string) {
  const [history, setHistory] = useState<string[]>([initialPath])
  const [index, setIndex] = useState(0)

  const currentPath = history[index]

  const navigateTo = useCallback((path: string) => {
    setHistory((prev) => [...prev.slice(0, index + 1), path])
    setIndex((prev) => prev + 1)
  }, [index])

  const goBack = useCallback(() => {
    setIndex((prev) => Math.max(0, prev - 1))
  }, [])

  const goForward = useCallback(() => {
    setIndex((prev) => Math.min(history.length - 1, prev + 1))
  }, [history.length])

  return {
    currentPath,
    canGoBack: index > 0,
    canGoForward: index < history.length - 1,
    navigateTo,
    goBack,
    goForward,
  }
}
