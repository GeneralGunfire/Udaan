import { AnimatePresence, motion } from 'framer-motion'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { getWallpaper } from '@/app/wallpapers'

/**
 * Full-bleed ambient wallpaper rendered inside the app's own DOM.
 * The window is a normal opaque window — this layer, not OS-level
 * transparency, is what makes the glass surfaces above it feel frosted.
 * Image is user-selectable (see WallpaperPicker); persisted via
 * WallpaperProvider.
 */
export function AmbientBackground() {
  const { wallpaperId } = useWallpaper()
  const wallpaper = getWallpaper(wallpaperId)

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-(--ambient-base)">
      <AnimatePresence>
        <motion.img
          key={wallpaper.id}
          src={wallpaper.src}
          alt=""
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </AnimatePresence>
    </div>
  )
}
