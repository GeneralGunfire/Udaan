import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Wordmark } from './Wordmark'
import {
  SearchIcon,
  WindowMinimizeIcon,
  WindowMaximizeIcon,
  WindowCloseIcon,
} from '@/shared/icons'
import { Button } from './ui/button'
import { WallpaperPicker } from './WallpaperPicker'
import { useGlobalSearch } from '@/features/global-search/hooks/useGlobalSearch'
import { SearchResultsDropdown } from '@/features/global-search/components/SearchResultsDropdown'
import type { SearchResult } from '@/features/global-search/lib/types'
import { MiniPlayer } from '@/features/creativity/dj-board/components/MiniPlayer'

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
 * Floating title bar — Arc/Raycast-style: one continuous rounded-rect
 * toolbar surface, not a row of separate glass pill islands with dead
 * space between them. Logical groups (brand / search / media / wallpaper
 * / window controls) are separated by hairline dividers *inside* the one
 * surface, not by gaps between floating containers. Native OS decorations
 * are disabled (see tauri.conf.json), so this row owns window drag,
 * minimize, maximize, and close via `data-tauri-drag-region` + the Tauri
 * window API.
 */
interface TopBarProps {
  /** Called when the user picks a global search result — TopBar has no view/navigation state of its own. */
  onNavigateToSearchResult?: (result: SearchResult) => void
  /** Opens the DJ Board view — used by the MiniPlayer so tapping it jumps back to the full board. */
  onOpenDjBoard?: () => void
}

export function TopBar({ onNavigateToSearchResult, onOpenDjBoard }: TopBarProps) {
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
    <header
      data-tauri-drag-region
      className="glass-surface relative z-20 flex h-12 shrink-0 items-center rounded-2xl px-2 backdrop-blur-2xl"
      style={{ boxShadow: 'var(--shadow-composer)' }}
    >
      {/* Brand — also the primary drag handle */}
      <div data-tauri-drag-region className="flex items-center gap-2 px-2.5">
        <Wordmark size="sm" />
      </div>

      {/* Spacer — also draggable so the whole bar isn't dead space */}
      <div data-tauri-drag-region className="h-full flex-1" />

      {/* Search — expands inline when active */}
      <div ref={containerRef} className="relative flex shrink-0 items-center">
        <div className="bg-glass-border mx-1 h-5 w-px" />
        <motion.div
          animate={{ width: searchOpen ? 220 : 32 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="flex h-8 items-center overflow-hidden rounded-lg"
        >
          <Button
            type="button"
            aria-label="Search"
            variant="ghost"
            onClick={() => setSearchOpen((o) => !o)}
            className="h-8 w-8 shrink-0"
          >
            <SearchIcon width={14} height={14} />
          </Button>
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
                className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent pr-3 text-[12.5px] outline-none"
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
              className="absolute top-10 right-0 z-30"
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

      {onOpenDjBoard && (
        <>
          <div className="bg-glass-border mx-1 h-5 w-px" />
          <MiniPlayer onOpenDjBoard={onOpenDjBoard} />
        </>
      )}

      <div className="bg-glass-border mx-1 h-5 w-px" />

      {/* Wallpaper picker */}
      <WallpaperPicker />

      <div className="bg-glass-border mx-1 h-5 w-px" />

      {/* Window controls */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          aria-label="Minimize"
          variant="ghost"
          onClick={() => withAppWindow((win) => win.minimize())}
          className="h-8 w-8"
        >
          <WindowMinimizeIcon width={12} height={12} />
        </Button>
        <Button
          type="button"
          aria-label="Maximize"
          variant="ghost"
          onClick={() => withAppWindow((win) => win.toggleMaximize())}
          className="h-8 w-8"
        >
          <WindowMaximizeIcon width={11} height={11} />
        </Button>
        <Button
          type="button"
          aria-label="Close"
          variant="ghost"
          onClick={() => withAppWindow((win) => win.close())}
          className="h-8 w-8 hover:border-[#e5484d]/40 hover:bg-[#e5484d] hover:text-white"
        >
          <WindowCloseIcon width={13} height={13} />
        </Button>
      </div>
    </header>
  )
}
