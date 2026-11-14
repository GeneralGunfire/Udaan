import { motion } from 'framer-motion'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { cn } from '@/shared/lib/cn'
import { CheckIcon, ImageIcon } from '@/shared/icons'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { SOLID_COLOURS } from '@/os/ui/WallpaperThumb'
import { WallpaperGallery } from '@/os/ui/WallpaperGallery'
import { Button } from '@/os/ui/controls'
import { openApp } from '@/os/kernel/shell'
import { curve, dolly, dur } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'

/**
 * The wallpaper sheet, rising over the desktop. Choices apply instantly (the
 * desktop crossfades behind it), so it doubles as a live preview.
 *
 * Built on the shared gallery so the live wallpapers are choosable here —
 * this sheet used to list only the still set.
 */
export function WallpaperPicker({ onClose }: { onClose: () => void }) {
  const { wallpaperId, setWallpaperId } = useWallpaper()
  const reduced = prefersReducedMotion()

  async function browse() {
    const picked = await openDialog({ multiple: false, filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] })
    if (typeof picked === 'string') setWallpaperId(`file:${picked}`)
  }

  return (
    <motion.div
      className="fixed inset-0"
      initial={{ opacity: 0, backgroundColor: 'rgba(0,0,0,0)' }}
      animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0.18)', transition: { duration: dur.normal, ease: curve.decelerate } }}
      exit={{ opacity: 0, backgroundColor: 'rgba(0,0,0,0)', transition: { duration: dur.fast, ease: curve.accelerate } }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-label="Wallpaper"
        {...(reduced ? {} : dolly)}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        tabIndex={-1}
        style={{ transformOrigin: '50% 100%' }}
        className="os-panel-material os-sheen absolute bottom-[110px] left-1/2 flex max-h-[min(640px,calc(100vh-150px))] w-[min(980px,calc(100vw-48px))] -translate-x-1/2 flex-col rounded-(--os-radius-overlay) text-(--os-text) outline-none"
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-4">
          <h2 className="text-[15px] font-semibold">Wallpaper</h2>
          <div className="flex gap-2">
            <Button variant="tinted" onClick={() => void browse()}>
              <ImageIcon width={14} height={14} /> Choose a photo…
            </Button>
            <Button
              onClick={() => {
                onClose()
                void openApp('settings', { section: 'personalization' })
              }}
            >
              More in Settings
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">
          <WallpaperGallery value={wallpaperId} onChange={setWallpaperId} columns={4} />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-(--os-separator) px-5 py-3">
          <span className="mr-1 text-[12px] text-(--os-text-dim)">Solid colour</span>
          {SOLID_COLOURS.map((c) => {
            const active = wallpaperId === `color:${c}`
            return (
              <motion.button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={active}
                onClick={() => setWallpaperId(`color:${c}`)}
                whileHover={reduced ? undefined : { scale: 1.12 }}
                whileTap={reduced ? undefined : { scale: 0.92 }}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full outline-none ring-1 ring-(--os-border) focus-visible:ring-2 focus-visible:ring-accent',
                  active && 'ring-[3px] ring-accent',
                )}
                style={{ background: c }}
              >
                {active && <CheckIcon className="h-3.5 w-3.5 text-white" />}
              </motion.button>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
