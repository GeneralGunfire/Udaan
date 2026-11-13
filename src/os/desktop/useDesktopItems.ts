import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopDir } from '@tauri-apps/api/path'
import { listDir } from '@/integrations/file-explorer/client'
import type { FileEntry } from '@/integrations/file-explorer/types'
import { getTaskbarPref, setTaskbarPref } from '@/integrations/taskbar-prefs/client'
import { inTauri, onDirChanged, shell } from '@/os/kernel/shell'
import { useQuickstarts, type Quickstart } from '@/os/kernel/quickstarts'
import type { Cell, IconSize, SortBy } from './layout'

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
const HIDDEN_NAMES = new Set(['desktop.ini', 'thumbs.db'])

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

/** The user's Desktop plus the all-users Public Desktop, merged like Explorer shows them. */
async function resolveDesktopDirs(): Promise<string[]> {
  const mine = (await desktopDir()).replace(/[\\/]+$/, '')
  const usersRoot = mine.split(/[\\/]/).slice(0, -2).join('\\')
  return [mine, `${usersRoot}\\Public\\Desktop`]
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
    const info = await shell.recycleBinInfo().catch(() => null)
    if (info) setBinFull(info.itemCount > 0)
  }, [])

  useEffect(() => {
    const t = setInterval(() => void refreshBin(), 10_000)
    return () => clearInterval(t)
  }, [refreshBin])

  const reload = useCallback(async (dirList: string[]) => {
    const lists = await Promise.all(dirList.map((d) => listDir(d).catch(() => [] as FileEntry[])))
    const merged = new Map<string, DesktopItem>()
    for (const entry of lists.flat()) {
      const lower = entry.name.toLowerCase()
      if (HIDDEN_NAMES.has(lower) || lower.startsWith('~$')) continue
      const item = toItem(entry)
      merged.set(item.id, item)
    }
    const next = [...merged.values()]
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
        const [d, raw] = await Promise.all([resolveDesktopDirs(), getTaskbarPref(PREFS_KEY).catch(() => null)])
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
        await reload(d)
        await shell.watchDirs(d)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  useEffect(() => {
    if (!dirs.length) return
    const lowered = dirs.map((d) => d.toLowerCase())
    const unlisten = onDirChanged((dir) => {
      if (lowered.includes(dir.toLowerCase())) void reload(dirs)
    })
    return () => void unlisten.then((fn) => fn())
  }, [dirs, reload])

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
      void shell.invalidateIcon(path).then(() => reload(dirs))
    },
    [dirs, reload],
  )

  return useMemo(
    () => ({
      dirs,
      primaryDir: dirs[0] ?? null,
      items: [recycleBinItem(binFull), ...quickstarts.map(quickstartItem), ...items],
      prefs,
      updatePrefs,
      reload: () => reload(dirs),
      refreshBin,
      refreshIcon,
      error,
    }),
    [dirs, items, binFull, quickstarts, prefs, updatePrefs, reload, refreshBin, refreshIcon, error],
  )
}
