import { useEffect, useMemo, useState } from 'react'
import { APP_DEFS, type AppId } from '@/os/kernel/registry'
import { groupKeyOf, shell, subscribeShell, useShell, type ShellWindow } from '@/os/kernel/shell'
import claudeLogo from '@/assets/app-icons/claude.svg'
import vscodeLogo from '@/assets/app-icons/vscode.png'
import nortonBrowserLogo from '@/assets/app-icons/norton-private-browser.svg'
import { baseName, exeKey, loadPins, onPinsChanged, type Pin } from './pins'

/** Official logos for programs whose icon we can't read while they're closed (packaged apps). */
const BRAND_LOGOS: Record<string, string> = {
  [exeKey('claude.exe')]: claudeLogo,
  [exeKey('code.exe')]: vscodeLogo,
  [exeKey('nortonbrowser.exe')]: nortonBrowserLogo,
}

/** Names for programs whose version resource says something less useful. */
const BRAND_NAMES: Record<string, string> = { [exeKey('explorer.exe')]: 'File Explorer' }

export interface DockItem {
  key: string
  name: string
  appId: AppId | null
  /** How to start it: an exe name for the installed-apps resolver, or a full path/URI. */
  launch: string | null
  exePath: string | null
  /** Real program icon for exe items; null for Udaan apps (drawn as tiles). */
  iconUrl: string | null
  pinned: boolean
  windows: ShellWindow[]
  focused: boolean
  allMinimized: boolean
}

export function toPin(item: DockItem): Pin | null {
  if (item.appId) return { key: item.key, kind: 'app', appId: item.appId, name: item.name }
  const match = item.key.slice('exe:'.length)
  const launch = item.launch ?? item.exePath
  return launch ? { key: item.key, kind: 'exe', match, launch, name: item.name } : null
}

const isPath = (s: string) => /[\\/:]/.test(s)

export function useDockItems() {
  const [pins, setPins] = useState<Pin[]>([])
  const windows = useShell((s) => s.windows)
  const foreground = useShell((s) => s.foreground)
  const [names, setNames] = useState<Record<string, string>>({})
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const [resolved, setResolved] = useState<Record<string, string | null>>({})
  const [winIcons, setWinIcons] = useState<Record<number, string | null>>({})

  // Last resort for programs whose executable can't be read (elevated
  // apps): the window's own icon, fetched once per window.
  useEffect(() => {
    const need = windows.filter((w) => !w.appId && !(w.handle in winIcons) && (!w.exePath || icons[w.exePath] === null))
    if (!need.length) return
    void shell.windowIcons(need.map((w) => w.handle)).then(
      (r) => setWinIcons((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), v])) })),
      () => {},
    )
  }, [windows, icons, winIcons])

  // Unpinned running apps keep the slot they first appeared in rather than
  // reshuffling with z-order (React's adjust-state-during-render pattern).
  const groupKeys = useMemo(() => [...new Set(windows.map(groupKeyOf))], [windows])
  const [order, setOrder] = useState<string[]>([])
  const [seenKeys, setSeenKeys] = useState<string[]>([])
  if (groupKeys !== seenKeys) {
    setSeenKeys(groupKeys)
    setOrder((prev) => [...prev.filter((k) => groupKeys.includes(k)), ...groupKeys.filter((k) => !prev.includes(k))])
  }

  useEffect(() => {
    subscribeShell()
    const load = () => void loadPins().then(setPins, (err) => console.error('[dock] pins', err))
    load()
    const un = onPinsChanged(load)
    return () => void un.then((fn) => fn())
  }, [])

  // Pinned programs that aren't running: find where they're installed.
  useEffect(() => {
    const todo = pins.flatMap((p) => (p.kind === 'exe' && !isPath(p.launch) && !(p.launch in resolved) ? [p.launch] : []))
    if (!todo.length) return
    void shell.resolveLaunch(todo).then((r) => setResolved((prev) => ({ ...prev, ...r })), () => {})
  }, [pins, resolved])

  const exePaths = useMemo(() => {
    const set = new Set<string>()
    for (const p of pins) {
      if (p.kind !== 'exe') continue
      const target = isPath(p.launch) ? p.launch : resolved[p.launch]
      if (target && /\.exe$/i.test(target)) set.add(target)
    }
    for (const w of windows) if (!w.appId && w.exePath) set.add(w.exePath)
    return [...set]
  }, [pins, windows, resolved])

  useEffect(() => {
    const missing = exePaths.filter((p) => !(p in icons))
    if (!missing.length) return
    void Promise.all([shell.fileIcons(missing), shell.appNames(missing)]).then(([i, n]) => {
      setIcons((prev) => ({ ...prev, ...i }))
      setNames((prev) => ({ ...prev, ...n }))
    })
  }, [exePaths, icons])

  return useMemo(() => {
    const groups = new Map<string, ShellWindow[]>()
    for (const w of windows) {
      const key = groupKeyOf(w)
      const list = groups.get(key) ?? []
      list.push(w)
      groups.set(key, list)
    }

    const make = (key: string, pinned: boolean, pin?: Pin): DockItem => {
      const ws = groups.get(key) ?? []
      const rawId = pin?.kind === 'app' ? pin.appId : (ws[0]?.appId ?? null)
      const appId = rawId && APP_DEFS[rawId] ? rawId : null
      const launch = pin?.kind === 'exe' ? pin.launch : (ws[0]?.exePath ?? null)
      const resolvedPath = launch && !isPath(launch) ? resolved[launch] : launch
      const exePath = ws[0]?.exePath ?? (resolvedPath && /\.exe$/i.test(resolvedPath) ? resolvedPath : null)
      const name = appId ? APP_DEFS[appId].name : (BRAND_NAMES[key] ?? pin?.name ?? (exePath && names[exePath]) ?? baseName(ws[0]?.processName ?? 'App').replace(/\.exe$/i, ''))
      const iconUrl = appId ? null : ((exePath && icons[exePath]) || BRAND_LOGOS[key] || (ws[0] && winIcons[ws[0].handle]) || null)
      return {
        key,
        name,
        appId,
        launch,
        exePath,
        iconUrl,
        pinned,
        windows: ws,
        focused: ws.some((w) => w.handle === foreground && !w.isMinimized),
        allMinimized: ws.length > 0 && ws.every((w) => w.isMinimized),
      }
    }

    const pinnedKeys = new Set(pins.map((p) => p.key))
    const pinned = pins.map((p) => make(p.key, true, p))
    const running = order.filter((k) => groups.has(k) && !pinnedKeys.has(k)).map((k) => make(k, false))
    return { pins, items: [...pinned, ...running], pinnedCount: pinned.length }
  }, [pins, windows, foreground, names, icons, order, resolved, winIcons])
}
