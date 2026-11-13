import { useCallback, useEffect, useState, type PropsWithChildren } from 'react'
import { ThemeContext, type Theme } from '@/shared/hooks/useTheme'
import { applyMaterial, type MaterialKind } from '@/os/kernel/material'

const STORAGE_KEY = 'udaan-theme'

function readStored(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/**
 * Which real window material each shell surface asks the compositor for.
 *
 * Mica for surfaces that are always on screen: the compositor samples the
 * wallpaper once rather than the live backdrop every frame, so it costs
 * almost nothing to keep up permanently.
 *
 * Acrylic for surfaces that appear over arbitrary content and must stay
 * legible against it — a flyout over a white document needs a real blur, not
 * a wallpaper tint.
 *
 * `none` for the desktop (it *is* the backdrop; blurring it would blur the
 * wallpaper against itself) and for app windows, which paint opaque content.
 */
const SURFACE_MATERIAL: Record<string, MaterialKind> = {
  menubar: 'mica',
  taskbar: 'acrylic',
  'taskbar-popup': 'acrylic',
  launcher: 'acrylic',
  toast: 'acrylic',
}

/** Shell windows with square corners: full-width bars must not round. */
const SQUARE = new Set(['menubar', 'edgelight'])

/** Theme is shared by every Udaan window through localStorage's `storage` event. */
export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<Theme>(readStored)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Ask the compositor for a real blurred backdrop behind this window.
  // Re-applied on every theme change because the material carries its own
  // tint, which has to follow light/dark. See os/kernel/material.ts.
  useEffect(() => {
    const kind = new URLSearchParams(window.location.search).get('window') ?? 'desktop'
    const material = SURFACE_MATERIAL[kind]
    if (!material) {
      document.documentElement.setAttribute('data-material', 'none')
      return
    }
    void applyMaterial(material, theme === 'dark', !SQUARE.has(kind))
  }, [theme])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTheme(readStored())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Best-effort persistence.
      }
      return next
    })
  }, [])

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}
