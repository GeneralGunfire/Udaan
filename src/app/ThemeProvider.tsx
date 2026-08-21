import { useEffect, type PropsWithChildren } from 'react'
import { ThemeContext } from '@/shared/hooks/useTheme'

export function ThemeProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  }, [])

  return (
    <ThemeContext.Provider value={{ theme: 'dark', toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  )
}
