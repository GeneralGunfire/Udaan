import { motion } from 'framer-motion'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { getWallpaper } from '@/app/wallpapers'

/**
 * Full-bleed ambient wallpaper rendered inside the app's own DOM.
 * The window is a normal opaque window — this layer, not OS-level
 * transparency, is what makes the glass surfaces above it feel frosted.
 * Image is user-selectable (see WallpaperPicker); persisted via
 * WallpaperProvider.
 *
 * No `-z-10`: a `position: fixed` element with a negative z-index and no
 * positioned ancestor can paint *behind* `body`'s own painted background
 * in Chromium/WebView2 when `body` also sets `overflow: hidden` (both true
 * here — see theme.css) — verified directly: the image element itself
 * reported `opacity: 1`/`display: block` via computed styles while the
 * screenshot showed nothing but the flat ambient-base color. DOM order
 * alone (this renders before everything else in App.tsx) is enough to
 * keep it behind all later siblings without needing a negative z-index.
 *
 * No AnimatePresence here: it isn't needed for the crossfade (the new
 * image's own `initial`/`animate` handles the fade-in on mount) and it
 * was observed leaving this layer's child unrendered in practice — not
 * worth the complexity for a background image that never needs an exit
 * animation of its own.
 *
 * `-inset-1` (overshoots the viewport by 1px on every edge) rather than
 * `inset-0`: a Tauri/WebView2-on-Windows sub-pixel rounding gap between
 * the DOM's reported viewport size and the window's actual client area
 * has shown up as a thin strip of the window's own background at an
 * edge (seen at the bottom once, then at the top after other changes) —
 * overshooting absorbs that rounding error instead of chasing which
 * edge it lands on next.
 */
export function AmbientBackground() {
  const { wallpaperId } = useWallpaper()
  const wallpaper = getWallpaper(wallpaperId)

  return (
    <div className="fixed -inset-1 z-0 overflow-hidden bg-(--ambient-base)">
      <motion.img
        key={wallpaper.id}
        src={wallpaper.src}
        alt=""
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  )
}
