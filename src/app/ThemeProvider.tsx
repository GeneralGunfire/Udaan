import { getPref, onPrefChanged } from '@/os/kernel/prefs'
import { useCallback, useEffect, useState, type PropsWithChildren } from 'react'
import { ThemeContext, type Theme } from '@/shared/hooks/useTheme'
import { applyMaterial, type MaterialKind } from '@/os/kernel/material'
import { applyPalette } from '@/os/kernel/palette'

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
 *
 * THE RULE: a window material may only go on a window whose content FILLS
 * it. DWM blurs the entire window rectangle, not the rounded shape the CSS
 * draws inside it, so any window that is bigger than its visible content
 * shows the leftover area as a flat blurred slab.
 *
 *   dock      NOT here. Its window is a full-width strip so the bar has
 *             headroom for the hover lift and labels; with acrylic it
 *             rendered as a hard-edged band across the screen with the
 *             dock floating inside it.
 *   toast     NOT here. The window wraps a stack of separate cards, so the
 *             gaps between them blurred as rectangles.
 *   launcher  NOT here. Its window is the whole screen, so acrylic would
 *             blur everything behind Start rather than the Start card, on
 *             a code path (legacy Windows 10 acrylic) that is slow at that
 *             size.
 *
 * Those three use the surface's own tint, which is designed to carry it
 * alone (see `data-material='none'` in os.css).
 */
const SURFACE_MATERIAL: Record<string, MaterialKind> = {
  menubar: 'mica',
  // NOT 'taskbar-popup': the compositor blurs the whole window rectangle the instant it is shown, while the
  // card inside is still fading and scaling in, so every popup flashed a blurred white plate before its card
  // arrived (and sometimes not, depending on timing). The popup card is a near-opaque matte surface of its
  // own, so it needs no OS blur at all.
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

  // Accent colour and solid surfaces are preferences; every window follows them.
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const apply = (key: string, value: unknown) => {
      const root = document.documentElement
      if (key === 'ui.accent' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) root.style.setProperty('--u-accent', value)
      if (key === 'ui.palette' && typeof value === 'string') applyPalette(value)
      if (key === 'ui.opaque') root.toggleAttribute('data-opaque', value === true)
      if (key === 'ui.materialStyle') root.setAttribute('data-mat', value === 'win11' ? 'win11' : 'matte')
      if (key === 'power.profile' && typeof value === 'string') root.setAttribute('data-profile', value)
    }
    void getPref('ui.accent').then((v) => apply('ui.accent', v))
    void getPref('ui.palette').then((v) => apply('ui.palette', v))
    void getPref('ui.opaque').then((v) => apply('ui.opaque', v))
    void getPref('ui.materialStyle').then((v) => apply('ui.materialStyle', v))
    void getPref('power.profile').then((v) => apply('power.profile', v))
    const un = onPrefChanged(apply)
    return () => void un.then((fn) => fn())
  }, [])

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
