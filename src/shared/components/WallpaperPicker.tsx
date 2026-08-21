import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { WALLPAPERS } from '@/app/wallpapers'
import { ImageIcon } from '@/shared/icons'

export function WallpaperPicker() {
  const { wallpaperId, setWallpaperId } = useWallpaper()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    // 'click' (not 'pointerdown') so a thumbnail's own onClick always
    // commits before this can close the popover out from under it.
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function selectWallpaper(id: string) {
    setWallpaperId(id)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change wallpaper"
        aria-expanded={open}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150 ${
          open
            ? 'bg-glass-hover text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-glass-hover'
        }`}
      >
        <ImageIcon width={17} height={17} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="glass-surface absolute top-11 right-0 z-50 w-80 rounded-2xl p-4 backdrop-blur-2xl"
            style={{ boxShadow: 'var(--shadow-panel)' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-text-primary text-[13px] font-medium">
                Wallpaper
              </span>
              <span className="text-text-tertiary text-[11px]">
                {WALLPAPERS.find((w) => w.id === wallpaperId)?.label}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {WALLPAPERS.map((wallpaper) => {
                const isActive = wallpaper.id === wallpaperId
                return (
                  <button
                    key={wallpaper.id}
                    type="button"
                    onClick={() => selectWallpaper(wallpaper.id)}
                    className="group flex flex-col items-center gap-1.5"
                  >
                    <span
                      className="relative block aspect-square w-full overflow-hidden rounded-[10px] transition-transform duration-150 group-hover:scale-[1.03] group-active:scale-95"
                      style={{
                        outline: isActive
                          ? '2px solid var(--color-brand-cyan)'
                          : '2px solid transparent',
                        outlineOffset: '2px',
                      }}
                    >
                      <img
                        src={wallpaper.src}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      {isActive && (
                        <span
                          className="absolute right-1 bottom-1 flex h-4 w-4 items-center justify-center rounded-full text-white"
                          style={{ background: 'var(--gradient-brand)' }}
                        >
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M4 10l4 4 8-8" />
                          </svg>
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-[11px] transition-colors duration-150 ${
                        isActive
                          ? 'text-text-primary font-medium'
                          : 'text-text-tertiary group-hover:text-text-secondary'
                      }`}
                    >
                      {wallpaper.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
