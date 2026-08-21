import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Wordmark } from './Wordmark'
import {
  SearchIcon,
  WindowMinimizeIcon,
  WindowMaximizeIcon,
  WindowCloseIcon,
} from '@/shared/icons'
import { WallpaperPicker } from './WallpaperPicker'
import { useGlobalSearch } from '@/features/global-search/hooks/useGlobalSearch'
import { SearchResultsDropdown } from '@/features/global-search/components/SearchResultsDropdown'
import type { SearchResult } from '@/features/global-search/lib/types'

/**
 * Lazily resolves the Tauri window handle. Only ever called from click
 * handlers (never at module load), so running the frontend outside Tauri
 * (e.g. `pnpm dev` in a browser) doesn't crash on import — the buttons
 * just no-op with a console warning instead.
 */
async function withAppWindow(
  action: (win: import('@tauri-apps/api/window').Window) => void | Promise<void>,
) {
  if (!('__TAURI_INTERNALS__' in window)) {
    console.warn('Window controls are only available inside the Tauri app.')
    return
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  try {
    await action(getCurrentWindow())
  } catch (err) {
    console.error('Window control failed — check src-tauri capabilities:', err)
  }
}

/**
 * Floating title bar — a detached pill cluster above the main panel, not a
 * stretched strip welded to it. Native OS decorations are disabled (see
 * tauri.conf.json), so this row owns window drag, minimize, maximize, and
 * close via `data-tauri-drag-region` + the Tauri window API.
 */
interface TopBarProps {
  /** Called when the user picks a global search result — TopBar has no view/navigation state of its own. */
  onNavigateToSearchResult?: (result: SearchResult) => void
}

export function TopBar({ onNavigateToSearchResult }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const { results, loading } = useGlobalSearch(searchOpen ? searchValue : '')
  const containerRef = useRef<HTMLDivElement>(null)

  function closeSearch() {
    setSearchOpen(false)
    setSearchValue('')
  }

  useEffect(() => {
    if (!searchOpen) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeSearch()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [searchOpen])

  function handleSelect(result: SearchResult) {
    onNavigateToSearchResult?.(result)
    closeSearch()
  }

  return (
    <header className="relative z-20 flex shrink-0 items-center justify-between gap-3">
      {/* Brand pill — also the primary drag handle */}
      <div
        data-tauri-drag-region
        className="glass-surface flex h-11 items-center gap-2 rounded-full px-4 backdrop-blur-2xl"
        style={{ boxShadow: 'var(--shadow-composer)' }}
      >
        <Wordmark size="sm" />
      </div>

      {/* Spacer — also draggable so the whole bar isn't dead space */}
      <div data-tauri-drag-region className="h-11 flex-1" />

      {/* Search pill — expands inline when active */}
      <div ref={containerRef} className="relative shrink-0">
        <motion.div
          animate={{ width: searchOpen ? 220 : 44 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="glass-surface flex h-11 items-center overflow-hidden rounded-full backdrop-blur-2xl"
          style={{ boxShadow: 'var(--shadow-composer)' }}
        >
          <motion.button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen((o) => !o)}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="text-text-secondary hover:text-text-primary flex h-11 w-11 shrink-0 items-center justify-center transition-colors duration-150"
          >
            <SearchIcon width={14} height={14} />
          </motion.button>
          <AnimatePresence>
            {searchOpen && (
              <motion.input
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                autoFocus
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeSearch()
                }}
                placeholder="Search everything…"
                className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent pr-4 text-[12.5px] outline-none"
              />
            )}
          </AnimatePresence>
        </motion.div>

        <AnimatePresence>
          {searchOpen && searchValue.trim() && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <SearchResultsDropdown
                results={results}
                loading={loading}
                query={searchValue}
                onSelect={handleSelect}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Utility pill — wallpaper picker */}
      <div
        className="glass-surface flex h-11 shrink-0 items-center gap-0.5 rounded-full px-1 backdrop-blur-2xl"
        style={{ boxShadow: 'var(--shadow-composer)' }}
      >
        <WallpaperPicker />
      </div>

      {/* Window controls — circular, matching pill language, sized to
          match the other h-11 pills rather than a shrunken inline row */}
      <div
        className="glass-surface flex h-11 shrink-0 items-center gap-1 rounded-full p-1 backdrop-blur-2xl"
        style={{ boxShadow: 'var(--shadow-composer)' }}
      >
        <motion.button
          type="button"
          aria-label="Minimize"
          onClick={() => withAppWindow((win) => win.minimize())}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150"
        >
          <WindowMinimizeIcon width={12} height={12} />
        </motion.button>
        <motion.button
          type="button"
          aria-label="Maximize"
          onClick={() => withAppWindow((win) => win.toggleMaximize())}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150"
        >
          <WindowMaximizeIcon width={11} height={11} />
        </motion.button>
        <motion.button
          type="button"
          aria-label="Close"
          onClick={() => withAppWindow((win) => win.close())}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="text-text-secondary flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150 hover:bg-[#e5484d] hover:text-white"
        >
          <WindowCloseIcon width={13} height={13} />
        </motion.button>
      </div>
    </header>
  )
}
