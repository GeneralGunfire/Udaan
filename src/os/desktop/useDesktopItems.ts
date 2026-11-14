import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { FileEntry } from '@/integrations/file-explorer/types'
import { getTaskbarPref, setTaskbarPref } from '@/integrations/taskbar-prefs/client'
import { listen } from '@tauri-apps/api/event'
import { inTauri, shell } from '@/os/kernel/shell'
import { useQuickstarts, type Quickstart } from '@/os/kernel/quickstarts'
import type { Cell, IconSize, SortBy } from './layout'
import { usePoll } from '@/os/kernel/poll'

export interface DesktopItem extends FileEntry {
  id: string
  /** What the icon label shows: Explorer hides .lnk/.url extensions. */
  label: string
  iconUrl: string | null
  isShortcut: boolean
  /** A shell object rather than a file (the Recycle Bin), or a saved quickstart. */
  system?: 'recycle-bin' | 'quickstart'
  binFull?: boolean
  /** Set on `system: 'quickstart'` items — which quickstart to run. */
  quickstartId?: string
}

export interface DesktopPrefs {
  iconSize: IconSize
  autoArrange: boolean
  sortBy: SortBy
  showIcons: boolean
  positions: Record<string, Cell>
}

const PREFS_KEY = 'desktop-layout'
const DEFAULT_PREFS: DesktopPrefs = { iconSize: 'medium', autoArrange: false, sortBy: 'name', showIcons: true, positions: {} }

function toItem(e: FileEntry): DesktopItem {
  const ext = e.extension.toLowerCase()
  const isShortcut = !e.isDir && (ext === 'lnk' || ext === 'url')
  return {
    ...e,
    id: e.path.toLowerCase(),
    label: isShortcut ? e.name.replace(/\.(lnk|url)$/i, '') : e.name,
    iconUrl: null,
    isShortcut,
  }
}

function recycleBinItem(full: boolean): DesktopItem {
  return {
    id: '::recycle-bin',
    name: 'Recycle Bin',
    label: 'Recycle Bin',
    path: 'shell:RecycleBinFolder',
    isDir: false,
    extension: '',
    sizeBytes: 0,
    modifiedMs: 0,
    createdMs: 0,
    iconUrl: null,
    isShortcut: false,
    system: 'recycle-bin',
    binFull: full,
  }
}

/** A saved quickstart, shown on the desktop without writing a real .lnk. */
function quickstartItem(qs: Quickstart): DesktopItem {
  return {
    id: `::quickstart:${qs.id}`,
    name: qs.name,
    label: qs.name,
    path: `quickstart:${qs.id}`,
    isDir: false,
    extension: '',
    sizeBytes: 0,
    modifiedMs: 0,
    createdMs: 0,
    iconUrl: null,
    isShortcut: false,
    system: 'quickstart',
    quickstartId: qs.id,
  }
}

export function useDesktopItems() {
  const { quickstarts } = useQuickstarts()
  const [dirs, setDirs] = useState<string[]>([])
  const [items, setItems] = useState<DesktopItem[]>([])
  const [prefs, setPrefs] = useState<DesktopPrefs>(DEFAULT_PREFS)
  const [error, setError] = useState<string | null>(null)
  const icons = useRef(new Map<string, string | null>())
  const prefsLoaded = useRef(false)

  const [binFull, setBinFull] = useState(false)
  const refreshBin = useCallback(async () => {
    if (!inTauri) return
    // Asked of Windows in one call (count and size), not by enumerating the bin.
    const info = await invoke<{ itemCount: number }>('desktop_recycle_bin').catch(() => null)
    if (info) setBinFull(info.itemCount > 0)
  }, [])

  usePoll(() => void refreshBin(), 10_000)

  // The engine assembles the desktop: both real folders (asked of Windows), minus what Explorer
  // hides, each item once. This only decorates it with labels and icons.
  const reload = useCallback(async () => {
    const entries = await invoke<FileEntry[]>('desktop_items_list').catch(() => [] as FileEntry[])
    const next = entries.map(toItem)
    const missing = next.filter((i) => !icons.current.has(i.path)).map((i) => i.path)
    if (missing.length && inTauri) {
      const fetched = await shell.fileIcons(missing).catch(() => ({}) as Record<string, string | null>)
      for (const p of missing) icons.current.set(p, fetched[p] ?? null)
    }
    setItems(next.map((i) => ({ ...i, iconUrl: icons.current.get(i.path) ?? null })))
    void refreshBin()
    setError(null)
  }, [refreshBin])

  useEffect(() => {
    if (!inTauri) return
    let cancelled = false
    void (async () => {
      try {
        const [d, raw] = await Promise.all([invoke<string[]>('desktop_items_dirs'), getTaskbarPref(PREFS_KEY).catch(() => null)])
        if (cancelled) return
        if (raw) {
          try {
            setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<DesktopPrefs>) })
          } catch {
            /* corrupt prefs: keep defaults */
          }
        }
        prefsLoaded.current = true
        setDirs(d)
        await reload()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  // The engine watches both folders and announces a change once the burst settles.
  useEffect(() => {
    if (!inTauri) return
    const unlisten = listen('desktop://changed', () => void reload())
    return () => void unlisten.then((fn) => fn())
  }, [reload])

  const updatePrefs = useCallback((patch: Partial<DesktopPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      if (prefsLoaded.current) void setTaskbarPref(PREFS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const refreshIcon = useCallback(
    (path: string) => {
      icons.current.delete(path)
      void shell.invalidateIcon(path).then(() => reload())
    },
    [reload],
  )

  return useMemo(
    () => ({
      dirs,
      primaryDir: dirs[0] ?? null,
      items: [recycleBinItem(binFull), ...quickstarts.map(quickstartItem), ...items],
      prefs,
      updatePrefs,
      reload,
      refreshBin,
      refreshIcon,
      error,
    }),
    [dirs, items, binFull, quickstarts, prefs, updatePrefs, reload, refreshBin, refreshIcon, error],
  )
}
