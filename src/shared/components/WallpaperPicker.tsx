import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { WALLPAPERS } from '@/app/wallpapers'
import { ImageIcon } from '@/shared/icons'
import { Button } from './ui/button'

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
    // Registered on the next tick, not synchronously with the toggle click —
    // some embedded webviews (e.g. WebView2) can still be dispatching the
    // very click that opened the popover when this listener attaches in
    // the same event-loop turn, which would close it immediately.
    const id = window.setTimeout(() => {
      document.addEventListener('click', onClickOutside)
      document.addEventListener('keydown', onKeyDown)
    }, 0)
    return () => {
      window.clearTimeout(id)
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
      <Button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change wallpaper"
        aria-expanded={open}
        variant="ghost"
        className={`h-8 w-8 ${open ? 'bg-white/10 text-text-primary border-white/10' : ''}`}
      >
        <ImageIcon width={16} height={16} />
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="glass-surface absolute top-10 right-0 z-50 w-80 rounded-2xl p-4 backdrop-blur-2xl"
            style={{ boxShadow: 'var(--shadow-panel)' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-text-primary text-[13px] font-medium">
                Wallpaper
              </span>
              <span className="text-text-tertiary text-[12px]">
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
                      className={`text-[12px] transition-colors duration-150 ${
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
