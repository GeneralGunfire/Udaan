import { motion } from 'framer-motion'
import { Button } from '@/os/ui/controls'
import { openApp } from '@/os/kernel/shell'
import { WallpaperBrowser } from '@/os/wallpaper/WallpaperBrowser'

/**
 * The wallpaper sheet, rising over the desktop. Choices apply instantly (the desktop crossfades
 * behind it), so it doubles as a live preview. The full controls (rotation, folders, per-picture
 * fitting) are in Settings.
 */
export function WallpaperPicker({ onClose }: { onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.16 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }} style={{ background: 'rgb(0 0 0 / 18%)' }} onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-label="Wallpaper"
        initial={{ y: -160, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 28 } }}
        exit={{ y: -120, opacity: 0, transition: { duration: 0.2 } }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        tabIndex={-1}
        className="u-surface u-start flex h-[min(720px,calc(100vh-150px))] w-[min(900px,calc(100vw-48px))] flex-col overflow-hidden outline-none"
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-semibold">Wallpaper</h2>
          <Button
            variant="tinted"
            onClick={() => {
              onClose()
              void openApp('settings', { section: 'personalization' })
            }}
          >
            All wallpaper settings
          </Button>
        </div>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <WallpaperBrowser compact />
        </div>
      </motion.div>
    </motion.div>
  )
}
