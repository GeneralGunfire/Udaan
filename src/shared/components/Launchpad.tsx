import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { springs } from '@/os/motion/systemMotion'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { isAppId } from '@/os/kernel/registry'
import { duration, zIndex, prefersReducedMotion, pressable, ease } from '@/shared/lib/motion'
import { SearchIcon, WindowCloseIcon, FolderIcon, ChevronRightIcon } from '@/shared/icons'
import { AppTileContextMenu } from '@/os/ui/AppTileContextMenu'
import {
  PINNED_APPS,
  APP_FOLDERS,
  loadOtherApps,
  type AppDefinition,
  type AppFolderDefinition,
} from '@/app/apps'

export interface LaunchpadProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Columns in the tile grid — the single source of truth arrow-key
 *  navigation and the CSS grid both read from, so they can't drift apart
 *  the way a hand-duplicated `grid-cols-6` string and a separate constant
 *  previously could. */
const GRID_COLUMNS = 6

/** Module-level cache for standalone-app detection — persists across Launchpad open/close (unmount doesn't clear it) since installed apps don't change mid-session. See the effect below for why. */
let cachedOtherApps: AppDefinition[] | null = null

/** Same caching idea, per folder id — a folder's contents (e.g. Microsoft's detected Office apps) don't change between opens either. */
const cachedFolderApps = new Map<string, AppDefinition[]>()

/**
 * Ground-up rebuild of the app launcher: search bar + "Pinned" grid,
 * floating as a glass panel over the wallpaper. Folder tiles (e.g.
 * "Microsoft") expand inline into that folder's own tile grid — same
 * panel, no nested modal — mirroring how the Windows Start Menu opens an
 * app-group folder in place.
 *
 * No more per-app colour tints (the old `ICON_TINTS` hash function had
 * only 4 shades for 12+ apps, so visible hash collisions were guaranteed
 * — several apps ended up an identical colour, defeating the whole point
 * while also fighting the app's closed monochrome palette). Every Udaan
 * app tile now shares one flat surface fill with the monoline icon set;
 * position and label carry identity instead of colour.
 */
export function Launchpad({ open, onOpenChange }: LaunchpadProps) {
  const [query, setQuery] = useState('')
  const [openFolder, setOpenFolder] = useState<AppFolderDefinition | null>(null)
  const [folderApps, setFolderApps] = useState<AppDefinition[] | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)
  // Standalone apps (Claude, VS Code, Snipping Tool, Norton Private
  // Browser) detected against what's actually installed on this machine
  // — loaded once when Launchpad first opens rather than baked into the
  // static PINNED_APPS array, since unlike Studio/File Explorer these are
  // real external apps that may or may not be present.
  const [otherApps, setOtherApps] = useState<AppDefinition[]>(() => cachedOtherApps ?? [])
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const reduced = prefersReducedMotion()

  // Installed-app detection is a real Tauri IPC round-trip (registry reads
  // in Rust) — cheap in isolation, but re-running it on every single open
  // was the actual source of Launchpad feeling like it "loads" each time,
  // since `otherApps` started empty and repopulated a beat after the panel
  // animation finished. What's installed doesn't change within a running
  // session, so this now detects once per app launch (module-level cache
  // below) and every subsequent open renders with the result already in
  // hand — instant, same as the always-static PINNED_APPS tiles.
  useEffect(() => {
    if (!open || cachedOtherApps) return
    let cancelled = false
    loadOtherApps()
      .then((apps) => {
        cachedOtherApps = apps
        if (!cancelled) setOtherApps(apps)
      })
      .catch((err) => console.error('Failed to detect standalone apps for Launchpad:', err))
    return () => {
      cancelled = true
    }
  }, [open])

  const allPinnedApps = useMemo(() => [...PINNED_APPS, ...otherApps], [otherApps])

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allPinnedApps
    return allPinnedApps.filter((app) => app.name.toLowerCase().includes(q))
  }, [query, allPinnedApps])

  /** The tiles actually laid out in the grid right now, in render order — folder tiles are shown first (same order the grid renders them in), so keyboard navigation and rendering always agree on index. */
  const activeGridItems = useMemo<(AppDefinition | AppFolderDefinition)[]>(() => {
    if (openFolder) return folderApps ?? []
    return query ? filteredApps : [...APP_FOLDERS, ...filteredApps]
  }, [openFolder, folderApps, query, filteredApps])

  // Keep the keyboard-highlighted tile in range whenever the visible grid
  // changes shape (search narrows it, a folder opens/closes) — otherwise a
  // stale index could point past the end of a shorter list, or arrow keys
  // could silently do nothing after e.g. typing a search query.
  useEffect(() => {
    setHighlightedIndex((prev) => (activeGridItems.length === 0 ? 0 : Math.min(prev, activeGridItems.length - 1)))
  }, [activeGridItems])

  function activateItem(item: AppDefinition | AppFolderDefinition) {
    if ('launch' in item) void launch(item)
    else void openAppFolder(item)
  }

  function close() {
    setQuery('')
    setOpenFolder(null)
    setFolderApps(null)
    setFolderError(null)
    setLaunchError(null)
    onOpenChange(false)
  }

  async function launch(app: AppDefinition) {
    setLaunchError(null)
    try {
      await app.launch()
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : `Couldn't open ${app.name}.`)
      return
    }
    close()
  }

  async function openAppFolder(folder: AppFolderDefinition) {
    setOpenFolder(folder)

    // Folders with no real detection to do (Udaan's own bundled apps) skip
    // the loading state entirely — going through `loadApps`'s Promise
    // still means at least one render with folderApps===null first, which
    // is exactly the "Looking for installed apps…" flash that's pointless
    // for a fixed, always-known list.
    if (folder.staticApps) {
      setFolderApps(folder.staticApps)
      setFolderError(null)
      return
    }

    const cached = cachedFolderApps.get(folder.id)
    if (cached) {
      // Already known from an earlier open this session — render
      // immediately instead of showing "Looking for installed apps…" again
      // for something that was already resolved a moment ago.
      setFolderApps(cached)
      setFolderError(null)
      return
    }
    setFolderApps(null)
    setFolderError(null)
    try {
      const apps = await folder.loadApps()
      cachedFolderApps.set(folder.id, apps)
      setFolderApps(apps)
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : `Couldn't load ${folder.name} apps.`)
    }
  }

  function backToPinned() {
    setOpenFolder(null)
    setFolderApps(null)
    setFolderError(null)
    setHighlightedIndex(0)
  }

  // Latest activeGridItems/highlightedIndex/openFolder, read inside the
  // stable listener below instead of being dependencies of the effect —
  // both change on nearly every keystroke/hover while Launchpad is open,
  // which previously meant tearing down and re-adding a real `document`
  // event listener that often. Refs let the effect mount the listener
  // exactly once per `open` toggle while still always seeing current
  // values.
  const activeGridItemsRef = useRef(activeGridItems)
  activeGridItemsRef.current = activeGridItems
  const highlightedIndexRef = useRef(highlightedIndex)
  highlightedIndexRef.current = highlightedIndex
  const openFolderRef = useRef(openFolder)
  openFolderRef.current = openFolder

  // Typeahead buffer — typing a letter while the grid has focus jumps to
  // the next tile whose label starts with the buffered string, same
  // convention as the primitives' DropdownMenu typeahead
  // (src/shared/components/primitives/hooks/useTypeahead.ts) but kept
  // local here rather than sharing that hook directly: this grid is 2D
  // (Arrow Up/Down move by GRID_COLUMNS, not to the adjacent DOM sibling),
  // which the menu-shaped roving-focus hook doesn't model.
  const typeaheadBufferRef = useRef('')
  const typeaheadTimeRef = useRef(0)

  // Arrow-key grid navigation + typeahead + Enter-to-launch, matching how
  // the real Windows Start Menu lets you drive the whole tile grid from
  // the keyboard without ever leaving the search box. Escape still backs
  // out of a folder (or closes Launchpad entirely).
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (openFolderRef.current) backToPinned()
        else close()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = activeGridItemsRef.current
        if (items.length === 0) return
        e.preventDefault()
        setHighlightedIndex((prev) => {
          const delta =
            e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? GRID_COLUMNS : -GRID_COLUMNS
          const next = prev + delta
          return next >= 0 && next < items.length ? next : prev
        })
        return
      }
      if (e.key === 'Enter') {
        const item = activeGridItemsRef.current[highlightedIndexRef.current]
        if (item) {
          e.preventDefault()
          activateItem(item)
        }
        return
      }
      if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now()
        if (now - typeaheadTimeRef.current > 700) typeaheadBufferRef.current = ''
        typeaheadTimeRef.current = now
        typeaheadBufferRef.current += e.key.toLowerCase()
        const items = activeGridItemsRef.current
        const search = typeaheadBufferRef.current
        const match = items.findIndex((item) => item.name.toLowerCase().startsWith(search))
        if (match !== -1) setHighlightedIndex(match)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : duration.backdrop }}
            onClick={close}
            className="fixed inset-0"
            style={{
              zIndex: zIndex.overlay,
              background:
                'radial-gradient(120% 90% at 50% 45%, rgb(0 0 0 / 48%) 0%, rgb(0 0 0 / 66%) 55%, rgb(0 0 0 / 82%) 100%)',
            }}
          />
          <div
            className="fixed inset-0 flex items-center justify-center px-4"
            style={{ zIndex: zIndex.overlayPanel }}
            onClick={close}
          >
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
              transition={springs.flyout}
              onClick={(e) => e.stopPropagation()}
              className="app-panel relative flex h-130 w-full max-w-3xl flex-col overflow-hidden rounded-2xl p-8"
            >
              <div className="flex shrink-0 items-center gap-3">
                <div className="border-hairline bg-surface-raised flex flex-1 items-center gap-2.5 rounded-xl border px-4 py-3.5">
                  <SearchIcon width={16} height={16} className="text-text-tertiary shrink-0" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setHighlightedIndex(0)
                    }}
                    placeholder="Type here to search"
                    className="text-text-primary placeholder:text-text-tertiary w-full bg-transparent text-base outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={close}
                  aria-label="Close Launchpad"
                  className="text-text-tertiary hover:bg-surface-hover hover:text-text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-100"
                >
                  <WindowCloseIcon width={16} height={16} />
                </button>
              </div>

              <div className="mt-8 min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <AnimatePresence mode="wait" initial={false}>
                  {!openFolder ? (
                    <motion.div
                      key="pinned"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
                      transition={{ duration: 0.15, ease: ease.out }}
                    >
                      <h2 className="text-text-tertiary mb-5 text-xs font-semibold tracking-[0.06em] uppercase">
                        Pinned
                      </h2>

                      <div className="grid grid-cols-6 gap-x-3 gap-y-7">
                        {!query &&
                          APP_FOLDERS.map((folder, i) => (
                            <FolderTile
                              key={folder.id}
                              folder={folder}
                              highlighted={i === highlightedIndex}
                              onHover={() => setHighlightedIndex(i)}
                              onOpen={() => openAppFolder(folder)}
                            />
                          ))}

                        {filteredApps.map((app, i) => {
                          const index = (query ? 0 : APP_FOLDERS.length) + i
                          return (
                            <AppTile
                              key={app.id}
                              app={app}
                              highlighted={index === highlightedIndex}
                              onHover={() => setHighlightedIndex(index)}
                              onLaunch={() => launch(app)}
                            />
                          )
                        })}

                        {query && filteredApps.length === 0 && (
                          <p className="text-text-tertiary col-span-6 py-10 text-center text-sm">
                            No matching apps.
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="folder"
                      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
                      transition={{ duration: 0.15, ease: ease.out }}
                    >
                      <button
                        type="button"
                        onClick={backToPinned}
                        className="text-text-tertiary hover:text-text-primary mb-5 flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] uppercase transition-colors duration-100"
                      >
                        <ChevronRightIcon width={12} height={12} className="rotate-180" />
                        {openFolder.name}
                      </button>

                      <div className="grid grid-cols-6 gap-x-3 gap-y-7">
                        {folderApps?.map((app, i) => (
                          <AppTile
                            key={app.id}
                            app={app}
                            highlighted={i === highlightedIndex}
                            onHover={() => setHighlightedIndex(i)}
                            onLaunch={() => launch(app)}
                          />
                        ))}

                        {!folderApps && !folderError && (
                          <p className="text-text-tertiary col-span-6 py-10 text-center text-sm">
                            Looking for installed apps…
                          </p>
                        )}

                        {folderError && (
                          <p className="text-danger col-span-6 py-10 text-center text-sm">{folderError}</p>
                        )}

                        {folderApps && folderApps.length === 0 && (
                          <p className="text-text-tertiary col-span-6 py-10 text-center text-sm">
                            No {openFolder.name} apps found on this machine.
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {launchError && (
                  <p className="text-danger mt-5 text-center text-xs">{launchError}</p>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

interface AppTileProps {
  app: AppDefinition
  onLaunch: () => void
  /** True when this tile is the keyboard-navigation cursor's current target — mirrors :hover visually so keyboard and mouse users see the same feedback. */
  highlighted?: boolean
  onHover?: () => void
}

function AppTile({ app, onLaunch, highlighted, onHover }: AppTileProps) {
  const Icon = app.icon
  return (
    <AppTileContextMenu action={{ path: app.path, onOpen: onLaunch }}>
      <motion.button
        type="button"
        onClick={onLaunch}
        onMouseEnter={onHover}
        {...pressable}
        className={`flex flex-col items-center gap-2 rounded-xl px-2 py-3.5 text-center transition-colors duration-100 ${
          highlighted ? 'bg-[var(--os-menu-item-hover)]' : 'hover:bg-[var(--os-menu-item-hover)]'
        }`}
      >
        {isAppId(app.id) ? (
          <AppIcon appId={app.id} size={56} />
        ) : app.iconSrc ? (
          <img src={app.iconSrc} alt="" className="h-14 w-14 object-contain drop-shadow-[0_2px_4px_rgb(0_0_0/30%)]" draggable={false} />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-[var(--os-menu-item-hover)] text-[var(--os-menu-text)]">
            <Icon width={24} height={24} />
          </div>
        )}
        <span className="w-full truncate text-[12px] text-[var(--os-menu-text)]">{app.name}</span>
      </motion.button>
    </AppTileContextMenu>
  )
}

interface FolderTileProps {
  folder: AppFolderDefinition
  onOpen: () => void
  highlighted?: boolean
  onHover?: () => void
}

/**
 * Represents a group of apps rather than a single launchable one — visually
 * distinguished with a stacked-icon motif (a 2x2 cluster of small squares
 * behind the folder glyph) instead of a single icon block, so it reads as
 * "opens more" rather than "launches something" at a glance.
 */
function FolderTile({ folder, onOpen, highlighted, onHover }: FolderTileProps) {
  const previews = folder.previewIconSrcs?.slice(0, 4)
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      onMouseEnter={onHover}
      {...pressable}
      className={`flex flex-col items-center gap-2.5 rounded-xl px-2 py-4 text-center transition-colors duration-100 ${
        highlighted ? 'bg-surface-hover' : 'hover:bg-surface-hover'
      }`}
    >
      <div className="border-hairline bg-surface-raised relative flex h-16 w-16 items-center justify-center rounded-2xl border">
        {previews && previews.length > 0 ? (
          <div className="grid grid-cols-2 gap-1 p-2">
            {previews.map((src, i) => (
              <div
                key={i}
                className="bg-surface-overlay flex h-5.5 w-5.5 items-center justify-center rounded-[5px] p-0.5 shadow-[0_1px_2px_rgb(0_0_0/30%)]"
              >
                <img src={src} alt="" className="h-full w-full object-contain" draggable={false} />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            <span className="bg-text-tertiary/40 h-3 w-3 rounded-[3px]" />
            <span className="bg-text-tertiary/25 h-3 w-3 rounded-[3px]" />
            <span className="bg-text-tertiary/25 h-3 w-3 rounded-[3px]" />
            <span className="bg-text-tertiary/40 h-3 w-3 rounded-[3px]" />
          </div>
        )}
        <FolderIcon
          width={16}
          height={16}
          className="text-text-tertiary bg-surface-raised absolute -right-1 -bottom-1 rounded-full p-0.5"
        />
      </div>
      <span className="text-text-secondary w-full truncate text-sm">{folder.name}</span>
    </motion.button>
  )
}
