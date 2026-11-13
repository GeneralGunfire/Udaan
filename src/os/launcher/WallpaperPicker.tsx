import { motion } from 'framer-motion'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { cn } from '@/shared/lib/cn'
import { CheckIcon, ImageIcon } from '@/shared/icons'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { GENERATED_WALLPAPERS } from '@/os/desktop/generatedWallpapers'
import { GeneratedThumb, SOLID_COLOURS } from '@/os/ui/WallpaperThumb'
import { openApp } from '@/os/kernel/shell'
import { curve, dur } from '@/os/motion/systemMotion'

/**
 * Wallpaper gallery sliding up over the desktop. Choices apply instantly
 * (the desktop crossfades behind it), so it doubles as a live preview.
 */
export function WallpaperPicker({ onClose }: { onClose: () => void }) {
  const { wallpaperId, setWallpaperId } = useWallpaper()

  async function browse() {
    const picked = await openDialog({ multiple: false, filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] })
    if (typeof picked === 'string') setWallpaperId(`file:${picked}`)
  }

  const tile = (active: boolean) =>
    cn('relative shrink-0 overflow-hidden rounded-[10px] outline-none transition', active ? 'ring-[3px] ring-[var(--color-accent)]' : 'ring-1 ring-[var(--border-hairline)] hover:ring-(--os-text-dim)')

  return (
    <motion.div className="fixed inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.fade } }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-label="Wallpaper"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { duration: dur.normal, ease: curve.decelerate } }}
        exit={{ y: 40, opacity: 0, transition: { duration: dur.fast, ease: curve.accelerate } }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        tabIndex={-1}
        className="os-acrylic absolute bottom-[110px] left-1/2 w-[min(1100px,calc(100vw-48px))] -translate-x-1/2 rounded-[16px] p-5 text-(--os-text) outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Wallpaper</h2>
          <div className="flex gap-2">
            <button type="button" onClick={() => void browse()} className="flex items-center gap-1.5 rounded-[8px] bg-[var(--surface-raised)] px-3 py-1.5 text-[12.5px] hover:bg-(--os-hover)">
              <ImageIcon width={14} height={14} /> Choose a photo…
            </button>
            <button
              type="button"
              onClick={() => {
                onClose()
                void openApp('settings', { section: 'personalization' })
              }}
              className="rounded-[8px] px-3 py-1.5 text-[12.5px] hover:bg-(--os-hover)"
            >
              More in Settings
            </button>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {GENERATED_WALLPAPERS.map((w) => (
            <button key={w.id} type="button" onClick={() => setWallpaperId(w.id)} className={tile(wallpaperId === w.id)} style={{ width: 200, height: 125 }}>
              <GeneratedThumb id={w.id} width={200} height={125} />
              <span className="absolute bottom-1.5 left-2.5 text-[12px] font-medium text-white drop-shadow">{w.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="mr-1 text-[12px] text-(--os-text-dim)">Solid colour</span>
          {SOLID_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setWallpaperId(`color:${c}`)}
              className={cn(tile(wallpaperId === `color:${c}`), 'flex h-7 w-7 items-center justify-center rounded-full')}
              style={{ background: c }}
            >
              {wallpaperId === `color:${c}` && <CheckIcon className="h-3.5 w-3.5 text-white" />}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
