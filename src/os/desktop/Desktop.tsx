import { useCallback, useEffect, useMemo, useState } from 'react'
import { emit } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  copyEntries,
  createFile,
  createFolder,
  deleteEntries,
  moveEntries,
  openWithSystem,
  renameEntry,
} from '@/integrations/file-explorer/client'
import { launchApp, launchAppByExeName } from '@/integrations/installed-apps/client'
import { WidgetLayer } from '@/os/widgets/WidgetLayer'
import { hydrateScheduleCache } from '@/integrations/schedule'
import { initDailyBriefScheduler } from '@/integrations/daily-brief'
import { loadQuickstarts, runQuickstart } from '@/os/kernel/quickstarts'
import {
  ClipboardIcon,
  CopyIcon,
  FileTextIcon,
  FolderIcon,
  GridIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  ScissorsIcon,
  SettingsIcon,
  SyncIcon,
  TrashIcon,
  ExplorerIcon,
  TerminalIcon,
} from '@/shared/icons'
import { inTauri, onHotkey, openApp, shell, useShell } from '@/os/kernel/shell'
import { applyStartupPrefs } from '@/os/kernel/session'
import { usePref } from '@/os/kernel/prefs'
import { dockZone } from '@/os/dock/geometry'
import {
  ContextMenu,
  ContextMenuCheckItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuTrigger,
} from '@/os/ui/ContextMenu'
import { ToastHost } from '@/os/ui/ToastHost'
import { toastError } from '@/os/ui/toasts'
import { DesktopIcons } from './DesktopIcons'
import { useDesktopItems, type DesktopItem } from './useDesktopItems'
import { Wallpaper } from './Wallpaper'
import type { IconSize, SortBy } from './layout'

const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply'])

function uniqueName(existing: DesktopItem[], base: string, ext = ''): string {
  const names = new Set(existing.map((i) => i.name.toLowerCase()))
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export function Desktop() {
  const desk = useDesktopItems()
  const { items, prefs, updatePrefs, primaryDir } = desk
  const viewport = useViewport()
  const [dockAutoHide] = usePref('dock.autoHide')
  const dockZonePx = dockAutoHide ? 12 : dockZone()
  // A live wallpaper only earns its GPU time while it can be seen. Stop it
  // when a full-screen window is up, or any visible window is maximized
  // (which covers the desktop below the menu bar). Selecting a primitive
  // from the store, not the window list, so this does not re-render on every
  // title change.
  const wallpaperCovered = useShell((s) => s.fullscreen || s.windows.some((w) => w.isMaximized && !w.isMinimized))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [pendingRenamePath, setPendingRenamePath] = useState<string | null>(null)
  const [clipboardHasFiles, setClipboardHasFiles] = useState(false)
  const [dropHover, setDropHover] = useState(false)

  const selectedAll = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected])
  // File operations never apply to shell objects like the Recycle Bin.
  const selectedItems = useMemo(() => selectedAll.filter((i) => !i.system), [selectedAll])
  const binSelected = selectedAll.some((i) => i.system === 'recycle-bin')

  // Once-per-session services that used to live in the old App shell.
  useEffect(() => {
    initDailyBriefScheduler()
    applyStartupPrefs().catch((err) => console.error('[shell] startup prefs failed', err))
    hydrateScheduleCache().catch((err) => console.error('[schedule] hydrate failed', err))
    // Warm the two most commonly opened app windows (each a full WebView2
    // instance) once the desktop itself has settled, so their first open
    // is instant without competing with the desktop's own startup work or
    // permanently costing memory for apps that go unused this session —
    // deliberately NOT the whole pinned list, since this machine is low
    // on RAM (see memory: udaan-runs-release-build).
    // Render every wallpaper for this exact screen in the background so changing it is instant.
    const pre = setTimeout(() => {
      const dpr = window.devicePixelRatio || 1
      void invoke('wallpaper_prerender', { width: Math.round(window.screen.width * dpr), height: Math.round(window.screen.height * dpr) }).catch(() => {})
    }, 6000)
    const t = setTimeout(() => {
      void invoke('shell_prewarm_apps', { appIds: ['settings', 'file-explorer'] }).catch((err) => console.error('[shell] prewarm failed', err))
    }, 4000)
    return () => {
      clearTimeout(t)
      clearTimeout(pre)
    }
  }, [])

  // A freshly created folder/document enters rename mode once it shows up
  // in the listing (adjusting state during render, not in an effect).
  if (pendingRenamePath) {
    const hit = items.find((i) => i.path.toLowerCase() === pendingRenamePath.toLowerCase())
    if (hit) {
      setPendingRenamePath(null)
      setSelected(new Set([hit.id]))
      setRenamingId(hit.id)
    }
  }

  const open = useCallback(async (targets: DesktopItem[]) => {
    for (const item of targets) {
      try {
        if (item.system === 'quickstart') {
          const qs = (await loadQuickstarts()).find((q) => q.id === item.quickstartId)
          if (qs) await runQuickstart(qs)
        } else if (item.system) await launchApp(item.path)
        else if (item.isDir) await openApp('file-explorer', { initialPath: item.path })
        else if (MODEL_EXTENSIONS.has(item.extension.toLowerCase())) await openApp('viewer-3d', { initialPath: item.path })
        else await openWithSystem(item.path)
      } catch (err) {
        toastError(`Couldn't open ${item.label}`, err)
      }
    }
  }, [])

  const recycle = useCallback(async (targets: DesktopItem[]) => {
    if (!targets.length) return
    try {
      await shell.recycle(targets.map((i) => i.path))
      setSelected(new Set())
    } catch (err) {
      toastError('Couldn’t move to the Recycle Bin', err)
    }
  }, [])

  const deletePermanently = useCallback(async (targets: DesktopItem[]) => {
    if (!targets.length) return
    const what = targets.length === 1 ? `"${targets[0].label}"` : `these ${targets.length} items`
    if (!window.confirm(`Permanently delete ${what}? This can't be undone.`)) return
    try {
      await deleteEntries(targets.map((i) => i.path))
      setSelected(new Set())
    } catch (err) {
      toastError('Couldn’t delete', err)
    }
  }, [])

  const toClipboard = useCallback(async (targets: DesktopItem[], cut: boolean) => {
    if (!targets.length) return
    try {
      await shell.clipboardSetFiles(targets.map((i) => i.path), cut)
    } catch (err) {
      toastError('Clipboard unavailable', err)
    }
  }, [])

  const paste = useCallback(async () => {
    if (!primaryDir) return
    try {
      const clip = await shell.clipboardGetFiles()
      if (!clip.paths.length) return
      if (clip.cut) await moveEntries(clip.paths, primaryDir)
      else await copyEntries(clip.paths, primaryDir)
    } catch (err) {
      toastError('Couldn’t paste', err)
    }
  }, [primaryDir])

  const newFolder = useCallback(async () => {
    if (!primaryDir) return
    try {
      const created = await createFolder(primaryDir, uniqueName(items, 'New folder'))
      setPendingRenamePath(created.path)
    } catch (err) {
      toastError('Couldn’t create a folder', err)
    }
  }, [primaryDir, items])

  const newTextDocument = useCallback(async () => {
    if (!primaryDir) return
    try {
      const created = await createFile(primaryDir, 'text')
      setPendingRenamePath(created.path)
    } catch (err) {
      toastError('Couldn’t create a document', err)
    }
  }, [primaryDir])

  const commitRename = useCallback(
    async (item: DesktopItem, label: string) => {
      setRenamingId(null)
      if (/[\\/:*?"<>|]/.test(label)) {
        toastError('Invalid name', 'A file name can’t contain \\ / : * ? " < > |')
        return
      }
      const newName = item.isShortcut ? `${label}.${item.extension}` : label
      try {
        await renameEntry(item.path, newName)
      } catch (err) {
        toastError(`Couldn’t rename ${item.label}`, err)
      }
    },
    [],
  )

  const moveInto = useCallback(async (targets: DesktopItem[], folder: DesktopItem) => {
    const files = targets.filter((t) => !t.system)
    if (folder.system === 'recycle-bin') {
      await recycle(files)
      void desk.refreshBin()
      return
    }
    try {
      await moveEntries(files.map((i) => i.path), folder.path)
      setSelected(new Set())
    } catch (err) {
      toastError(`Couldn’t move into ${folder.label}`, err)
    }
  }, [recycle, desk])

  // Desktop-owned global shortcuts (Win+D, Win+E). Every window receives
  // hotkeys; the dock and launcher handle their own.
  useEffect(() => {
    if (!inTauri) return
    const un = onHotkey((id) => {
      if (id === 'show-desktop') void shell.toggleDesktop()
      else if (id === 'file-explorer') void launchApp('explorer.exe')
    })
    return () => void un.then((fn) => fn())
  }, [])

  // Files dragged in from Explorer or another app are copied onto the desktop.
  useEffect(() => {
    if (!inTauri || !primaryDir) return
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload
      if (p.type === 'enter' || p.type === 'over') setDropHover(true)
      else if (p.type === 'leave') setDropHover(false)
      else if (p.type === 'drop') {
        setDropHover(false)
        const outside = p.paths.filter((path) => !path.toLowerCase().startsWith(primaryDir.toLowerCase() + '\\'))
        if (outside.length) copyEntries(outside, primaryDir).catch((err) => toastError('Couldn’t copy onto the desktop', err))
      }
    })
    return () => void un.then((fn) => fn())
  }, [primaryDir])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renamingId) return
    const key = e.key.toLowerCase()
    if (e.ctrlKey && key === 'c') void toClipboard(selectedItems, false)
    else if (e.ctrlKey && key === 'x') void toClipboard(selectedItems, true)
    else if (e.ctrlKey && key === 'v') void paste()
    else if (e.ctrlKey && e.shiftKey && key === 'n') void newFolder()
    else if (e.key === 'Delete' && e.shiftKey) void deletePermanently(selectedItems)
    else if (e.key === 'Delete') void recycle(selectedItems)
    else if (e.key === 'F5') void desk.reload()
    else if (e.key === 'Enter' && e.altKey && selectedItems.length === 1) void shell.invokeVerb(selectedItems[0].path, 'properties')
    else if (e.key === 'Escape') setSelected(new Set())
    else return
    e.preventDefault()
  }

  const single = selectedItems.length === 1 ? selectedItems[0] : null

  return (
    <div className="fixed inset-0 select-none overflow-hidden" onKeyDown={onKeyDown}>
      <Wallpaper animated covered={wallpaperCovered} />
      <ContextMenu
        onOpenChange={(open) => {
          if (open) shell.clipboardGetFiles().then((c) => setClipboardHasFiles(c.paths.length > 0), () => setClipboardHasFiles(false))
        }}
      >
        <ContextMenuTrigger asChild>
          <div className="absolute inset-x-0 top-0" style={{ bottom: dockZonePx }}>
            <DesktopIcons
              items={items}
              prefs={prefs}
              width={viewport.w}
              height={viewport.h - dockZonePx}
              selected={selected}
              onSelectedChange={setSelected}
              renamingId={renamingId}
              onRenameStart={setRenamingId}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRenamingId(null)}
              onPositionsChange={(positions) => updatePrefs({ positions })}
              onOpen={open}
              onMoveInto={moveInto}
            />
            <WidgetLayer width={viewport.w} height={viewport.h - dockZonePx} />
          </div>
        </ContextMenuTrigger>

        {binSelected && selectedItems.length === 0 ? (
          <ContextMenuContent>
            <ContextMenuItem icon={TrashIcon} onSelect={() => void launchApp('shell:RecycleBinFolder')} shortcut="Enter">
              <span className="font-semibold">Open</span>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                if (window.confirm('Permanently delete everything in the Recycle Bin?')) void shell.emptyRecycleBin().then(() => desk.refreshBin(), (e) => toastError('Couldn’t empty the Recycle Bin', e))
              }}
            >
              Empty Recycle Bin
            </ContextMenuItem>
          </ContextMenuContent>
        ) : selectedItems.length > 0 ? (
          <ContextMenuContent>
            <ContextMenuItem icon={single?.isDir ? FolderIcon : undefined} onSelect={() => void open(selectedItems)} shortcut="Enter">
              <span className="font-semibold">Open</span>
            </ContextMenuItem>
            {single && !single.isDir && (
              <ContextMenuItem onSelect={() => shell.invokeVerb(single.path, 'openas').catch((e) => toastError('Open with failed', e))}>
                Open with…
              </ContextMenuItem>
            )}
            {single && (
              <ContextMenuItem
                icon={ExplorerIcon}
                onSelect={() => void openApp('file-explorer', { initialPath: single.isDir ? single.path : single.path.replace(/[\\/][^\\/]+$/, '') })}
              >
                Show in Files
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem icon={ScissorsIcon} shortcut="Ctrl+X" onSelect={() => void toClipboard(selectedItems, true)}>
              Cut
            </ContextMenuItem>
            <ContextMenuItem icon={CopyIcon} shortcut="Ctrl+C" onSelect={() => void toClipboard(selectedItems, false)}>
              Copy
            </ContextMenuItem>
            {single && (
              <ContextMenuItem icon={PencilIcon} shortcut="F2" onSelect={() => setRenamingId(single.id)}>
                Rename
              </ContextMenuItem>
            )}
            <ContextMenuItem icon={TrashIcon} shortcut="Del" onSelect={() => void recycle(selectedItems)}>
              Move to Recycle Bin
            </ContextMenuItem>
            <ContextMenuSeparator />
            {single && (
              <ContextMenuItem onSelect={() => shell.invokeVerb(single.path, 'properties').catch((e) => toastError('Properties unavailable', e))} shortcut="Alt+Enter">
                Properties
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        ) : (
          <ContextMenuContent>
            <ContextMenuSub icon={GridIcon} label="View">
              <ContextMenuRadioGroup<IconSize>
                value={prefs.iconSize}
                onValueChange={(iconSize) => updatePrefs({ iconSize })}
                options={[
                  { value: 'large', label: 'Large icons' },
                  { value: 'medium', label: 'Medium icons' },
                  { value: 'small', label: 'Small icons' },
                ]}
              />
              <ContextMenuSeparator />
              <ContextMenuCheckItem checked={prefs.autoArrange} onCheckedChange={(autoArrange) => updatePrefs({ autoArrange })}>
                Auto arrange icons
              </ContextMenuCheckItem>
              <ContextMenuCheckItem checked={prefs.showIcons} onCheckedChange={(showIcons) => updatePrefs({ showIcons })}>
                Show desktop icons
              </ContextMenuCheckItem>
            </ContextMenuSub>
            <ContextMenuSub label="Sort by">
              <ContextMenuRadioGroup<SortBy>
                value={prefs.sortBy}
                onValueChange={(sortBy) => updatePrefs({ sortBy, positions: {} })}
                options={[
                  { value: 'name', label: 'Name' },
                  { value: 'size', label: 'Size' },
                  { value: 'type', label: 'Item type' },
                  { value: 'modified', label: 'Date modified' },
                ]}
              />
            </ContextMenuSub>
            <ContextMenuItem icon={SyncIcon} shortcut="F5" onSelect={() => void desk.reload()}>
              Refresh
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={ClipboardIcon} shortcut="Ctrl+V" disabled={!clipboardHasFiles} onSelect={() => void paste()}>
              Paste
            </ContextMenuItem>
            <ContextMenuSub icon={PlusIcon} label="New">
              <ContextMenuItem icon={FolderIcon} shortcut="Ctrl+Shift+N" onSelect={() => void newFolder()}>
                Folder
              </ContextMenuItem>
              <ContextMenuItem icon={FileTextIcon} onSelect={() => void newTextDocument()}>
                Text Document
              </ContextMenuItem>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              icon={TerminalIcon}
              onSelect={() => launchAppByExeName('wt.exe').catch((e) => toastError('Windows Terminal unavailable', e))}
            >
              Open in Windows Terminal
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={ImageIcon} onSelect={() => void emit('launcher:wallpaper')}>
              Change wallpaper
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => launchApp('ms-settings:display').catch((e) => toastError('Display settings unavailable', e))}>
              Display settings
            </ContextMenuItem>
            <ContextMenuItem icon={SettingsIcon} onSelect={() => void openApp('settings')}>
              Personalize
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {dropHover && <div className="pointer-events-none fixed inset-0 border-2 border-[var(--os-selection-border)] bg-white/[0.04]" />}
      <ToastHost bottomOffset={dockZonePx + 12} />
    </div>
  )
}
