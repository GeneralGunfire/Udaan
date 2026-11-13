import { FocusPill } from './FocusPill'
import { usePref } from '@/os/kernel/prefs'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion'
import { onLayoutChange, pxScale } from '@/os/kernel/uiScale'
import { useImmersive } from '@/os/kernel/useImmersive'
import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { desktopDir, documentDir, downloadDir, homeDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from '@/shared/lib/cn'
import { useSystemStatus } from '@/shared/hooks/useSystemStatus'
import { getUnreadCount, onNotificationsChanged } from '@/integrations/notifications/client'
import { APP_DEFS } from '@/os/kernel/registry'
import { groupKeyOf, onHotkey, openApp, shell, subscribeShell, useShell, type ShellWindow } from '@/os/kernel/shell'
import { BatteryGlyph, StartGlyph } from '@/os/ui/icons/SystemGlyphs'
import { useShellMenu, type ShellMenuItemDef } from '@/os/ui/useShellMenu'
import { useLatest } from '@/os/ui/useLatest'
import { Artwork, mediaCommand, openLiveDj } from '@/os/dock/panels/MediaPanel'
import { useNowPlaying } from '@/os/dock/panels/useNowPlaying'
import { loadEdgeConfig, onEdgeConfig } from '@/features/edge-light/config'
import type { PanelKind, ShowFlyoutPayload } from '@/os/dock/taskbarPopupTypes'
import { playSound } from '@/os/sound/sounds'
import { badgePop, springs, valueChange } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'

export const MENU_BAR_HEIGHT = 34
const TOPMOST_REASSERT_MS = 2000

type Zone = { x: number; y: number; w: number; h: number }
const snap = (handle: number, zone: Zone) => invoke('shell_snap_window', { handle, zone })
/** The same zone as the Centred layout in Snap Layouts. */
const CENTRED: Zone = { x: 0.14, y: 0.05, w: 0.72, h: 0.9 }
const power = (action: string) => () => void invoke('shell_power', { action })

interface NetworkStatus {
  connected: boolean
  kind: 'ethernet' | 'wifi' | 'other' | 'none'
  signal: number | null
}

function useClock(seconds: boolean) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Re-render exactly on the minute (or second) boundary.
    const period = seconds ? 1_000 : 60_000
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      t = setTimeout(tick, period - (Date.now() % period) + 30)
    }
    tick()
    return () => clearTimeout(t)
  }, [seconds])
  return now
}

function useAppName(w: ShellWindow | undefined) {
  const [names, setNames] = useState<Record<string, string>>({})
  const exe = w && !w.appId ? w.exePath : null
  useEffect(() => {
    if (!exe || exe in names) return
    void shell.appNames([exe]).then((r) => setNames((n) => ({ ...n, ...r })), () => {})
  }, [exe, names])
  if (!w) return 'Udaan'
  if (w.appId && APP_DEFS[w.appId]) return APP_DEFS[w.appId].name
  return (exe && names[exe]) || w.processName.replace(/\.exe$/i, '')
}

function usePolled<T>(command: string, ms: number): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let stopped = false
    let t: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const v = await invoke<T>(command)
        if (!stopped) setValue(v)
      } catch {
        if (!stopped) setValue(null)
      }
      if (!stopped) t = setTimeout(poll, ms)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(t)
    }
  }, [command, ms])
  return value
}

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/**
 * Wi-Fi strength drawn as filled arcs rather than a static glyph: the
 * number of lit arcs is the signal, so the bar reports state at a glance
 * instead of only saying "wifi".
 */
function NetworkIcon({ s }: { s: NetworkStatus | null }) {
  if (s?.kind === 'wifi') {
    const bars = s.signal == null ? 3 : Math.max(1, Math.ceil((s.signal / 100) * 3))
    return (
      <svg viewBox="0 0 24 24" width="17" height="17" {...ICON} aria-hidden>
        <path d="M2.5 9a14 14 0 0 1 19 0" opacity={bars >= 3 ? 1 : 0.3} />
        <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" opacity={bars >= 2 ? 1 : 0.3} />
        <path d="M8.8 16a5 5 0 0 1 6.4 0" opacity={bars >= 1 ? 1 : 0.3} />
        <circle cx="12" cy="19.2" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" {...ICON} opacity={s?.connected === false ? 0.45 : 1} aria-hidden>
      <rect x="3" y="4.5" width="18" height="11" rx="2.5" />
      <path d="M8 19.5h8M12 15.5v4" />
      {s?.connected === false && <path d="M4 3.5l16 16" />}
    </svg>
  )
}

function SoundIcon({ level, muted }: { level: number; muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" {...ICON} aria-hidden>
      <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <>
          {level > 0 && <path d="M15 9.2a4 4 0 0 1 0 5.6" />}
          {level > 0.5 && <path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />}
        </>
      )}
    </svg>
  )
}

/**
 * A menu-bar status button.
 *
 * Pulled out as a component because there are nine of them and they must
 * behave identically: the same hover wash, the same press compression, the
 * same lit state when their panel is open. Inline classNames drifted before.
 */
const StatusButton = forwardRef<HTMLButtonElement, HTMLMotionProps<'button'> & { active?: boolean }>(
  function StatusButton({ active, className, children, ...rest }, ref) {
    return (
      <motion.button
        ref={ref}
        type="button"
        className={cn(
          'flex h-[26px] items-center rounded-[7px] px-2 text-[13px] leading-none text-[var(--os-text)]',
          'transition-colors duration-150 hover:bg-[var(--os-hover)]',
          active && 'bg-[var(--os-active)]',
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    )
  },
)

export function MenuBarWindow() {
  const windows = useShell((s) => s.windows)
  const foreground = useShell((s) => s.foreground)
  const immersive = useImmersive()
  const fullscreen = useShell((s) => s.fullscreen) || immersive
  const front = useMemo(() => windows.find((w) => w.handle === foreground), [windows, foreground])
  const [lastFront, setLastFront] = useState<ShellWindow | undefined>(undefined)
  if (front && front !== lastFront) setLastFront(front)
  // Menus act on the last real app window, even after the menu bar's own
  // click briefly took focus.
  const target = front ?? lastFront
  const appName = useAppName(target)
  const [clock24] = usePref('menubar.clock24')
  const [showSeconds] = usePref('menubar.seconds')
  const [focusEnabled] = usePref('focus.enabled')
  const now = useClock(showSeconds)
  const { battery } = useSystemStatus()
  const network = usePolled<NetworkStatus>('shell_network_status', 10000)
  const volume = usePolled<{ level: number; muted: boolean }>('shell_volume', 3000)
  const { media, positionMs } = useNowPlaying(2000, 500)
  const [edgeOn, setEdgeOn] = useState(() => loadEdgeConfig().enabled)
  useEffect(() => onEdgeConfig((c) => setEdgeOn(c.enabled)), [])
  const [unread, setUnread] = useState(0)
  const reduced = prefersReducedMotion()
  const openShellMenu = useShellMenu()
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, items: ShellMenuItemDef[]) => {
    const r = e.currentTarget.getBoundingClientRect()
    openShellMenu({ x: r.left, y: r.bottom + 4 }, items)
  }
  const [panel, setPanel] = useState<PanelKind | null>(null)
  const panelRef = useLatest(panel)
  const refs = {
    'notifications-panel': useRef<HTMLButtonElement>(null),
    calendar: useRef<HTMLButtonElement>(null),
    layouts: useRef<HTMLButtonElement>(null),
    network: useRef<HTMLButtonElement>(null),
    sound: useRef<HTMLButtonElement>(null),
    media: useRef<HTMLButtonElement>(null),
    edgelight: useRef<HTMLButtonElement>(null),
  }

  useEffect(() => subscribeShell(), [])

  // Pin to the very top: reserve the strip (maximized windows stop below
  // it), stay topmost, and step aside for full-screen apps like macOS.
  useEffect(() => {
    let cancelled = false
    const win = getCurrentWindow()
    const place = async () => {
      const h = Math.round(MENU_BAR_HEIGHT * pxScale())
      try {
        const m = await shell.reserveTopEdge(fullscreen ? 0 : h)
        if (cancelled) return
        if (fullscreen) return void (await win.hide())
        // Rust has already placed the window flush with the top edge.
        void m
        await win.show()
        // Showing can nudge it; put it back once it's visible.
        await invoke('shell_keep_at_top', { heightPx: h })
      } catch (err) {
        console.error('[menubar] placement failed', err)
      }
    }
    void place()
    const offLayout = onLayoutChange(() => void place())
    // Re-placing (not just re-raising) undoes anything that nudged the bar off the edge.
    const t = setInterval(() => {
      if (fullscreen) return
      void invoke('shell_keep_at_top', { heightPx: Math.round(MENU_BAR_HEIGHT * pxScale()) }).catch(() => {})
    }, TOPMOST_REASSERT_MS)
    return () => {
      cancelled = true
      offLayout()
      clearInterval(t)
    }
  }, [fullscreen])

  useEffect(() => {
    const refresh = () => void getUnreadCount().then(setUnread, () => {})
    refresh()
    const un = onNotificationsChanged(refresh)
    return () => void un.then((fn) => fn())
  }, [])

  useEffect(() => {
    const un = listen('taskbar-popup:hidden', () => setPanel(null))
    return () => void un.then((fn) => fn())
  }, [])

  const toggle = useCallback(
    (which: PanelKind) => {
      if (panelRef.current === which) {
        setPanel(null)
        void emit('taskbar-popup:hide')
        return
      }
      const r = refs[which].current?.getBoundingClientRect()
      const payload: ShowFlyoutPayload = {
        kind: which,
        x: window.screenX + (r ? r.left + r.width / 2 : window.innerWidth - 60),
        y: window.screenY + (r ? r.bottom : MENU_BAR_HEIGHT),
        placement: 'below',
      }
      setPanel(which)
      playSound('tap')
      void emit('taskbar-popup:show', payload)
    },
    // refs are stable objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelRef],
  )

  useEffect(() => {
    const subs = [
      listen('dock:open-notifications', () => panelRef.current !== 'notifications-panel' && toggle('notifications-panel')),
      onHotkey((id) => {
        if (id === 'notifications') toggle('notifications-panel')
        else if (id === 'quick-settings') toggle('sound')
      }),
    ]
    return () => subs.forEach((s) => void s.then((fn) => fn()))
  }, [toggle, panelRef])

  const siblings = () => (target ? windows.filter((w) => groupKeyOf(w) === groupKeyOf(target)) : [])

  function udaanMenuItems(): ShellMenuItemDef[] {
    return [
      { label: 'About Udaan', onSelect: () => void openApp('settings', { section: 'system' }) },
      { label: undefined },
      { label: 'System Settings…', onSelect: () => void openApp('settings') },
      { label: 'Wallpaper…', onSelect: () => void emit('launcher:wallpaper') },
      { label: 'Widgets…', onSelect: () => void openApp('settings', { section: 'widgets' }) },
      { label: undefined },
      { label: 'Lock Screen', onSelect: () => void emit('launcher:lock') },
      { label: undefined },
      { label: 'Sleep', onSelect: power('sleep') },
      { label: 'Restart…', onSelect: power('restart') },
      { label: 'Shut Down…', onSelect: power('shut-down') },
      { label: 'Log Out', onSelect: power('sign-out') },
    ]
  }

  function appMenuItems(): ShellMenuItemDef[] {
    const all = siblings()
    return [
      { label: `Hide ${appName}`, disabled: !all.length, onSelect: () => all.forEach((w) => void shell.minimize(w.handle)) },
      { label: 'Hide Others', disabled: !target, onSelect: () => windows.filter((w) => target && groupKeyOf(w) !== groupKeyOf(target)).forEach((w) => void shell.minimize(w.handle)) },
      { label: 'Show All', onSelect: () => windows.filter((w) => w.isMinimized).forEach((w) => void shell.focus(w.handle)) },
      { label: undefined },
      { label: `Quit ${appName}`, disabled: !all.length, onSelect: () => all.forEach((w) => void shell.close(w.handle)) },
    ]
  }

  function windowMenuItems(): ShellMenuItemDef[] {
    const h = target?.handle
    const act = (fn: (handle: number) => unknown) => () => h && void fn(h)
    const onScreen = windows.filter((w) => !w.isMinimized)
    const centreAll = async () => {
      for (const w of onScreen) await snap(w.handle, CENTRED).catch(() => {})
      playSound('switch')
    }
    return [
      { label: 'Minimize', disabled: !h, onSelect: act(shell.minimize) },
      { label: 'Zoom', disabled: !h, onSelect: act(shell.toggleMaximize) },
      { label: undefined },
      { label: 'Tile Left', disabled: !h, onSelect: act((x) => snap(x, { x: 0, y: 0, w: 0.5, h: 1 })) },
      { label: 'Tile Right', disabled: !h, onSelect: act((x) => snap(x, { x: 0.5, y: 0, w: 0.5, h: 1 })) },
      { label: 'Tile Top', disabled: !h, onSelect: act((x) => snap(x, { x: 0, y: 0, w: 1, h: 0.5 })) },
      { label: 'Tile Bottom', disabled: !h, onSelect: act((x) => snap(x, { x: 0, y: 0.5, w: 1, h: 0.5 })) },
      { label: 'Center', disabled: !h, onSelect: act((x) => snap(x, { x: 0.15, y: 0.1, w: 0.7, h: 0.8 })) },
      { label: 'Centre All Windows', disabled: !onScreen.length, onSelect: () => void centreAll() },
      { label: undefined },
      { label: 'Bring All to Front', disabled: !h, onSelect: () => siblings().forEach((w) => void shell.focus(w.handle)) },
      { label: 'Show All Windows', onSelect: () => void emit('launcher:expose', { title: 'All windows', handles: null }) },
    ]
  }

  function goMenuItems(): ShellMenuItemDef[] {
    const go = (dir: () => Promise<string>) => () => void dir().then((p) => invoke('installed_apps_launch', { path: p }))
    return [
      { label: 'Desktop', onSelect: go(desktopDir) },
      { label: 'Documents', onSelect: go(documentDir) },
      { label: 'Downloads', onSelect: go(downloadDir) },
      { label: 'Home', onSelect: go(homeDir) },
      { label: undefined },
      { label: 'Recycle Bin', onSelect: () => void invoke('installed_apps_launch', { path: 'shell:RecycleBinFolder' }) },
      { label: 'Control Panel', onSelect: () => void invoke('installed_apps_launch', { path: 'shell:ControlPanelFolder' }) },
    ]
  }

  function helpMenuItems(): ShellMenuItemDef[] {
    return [
      { label: 'Udaan Tips', onSelect: () => void emit('launcher:tips') },
      { label: 'Keyboard Shortcuts', onSelect: () => void openApp('settings', { section: 'keyboard' }) },
    ]
  }

  const date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString(undefined, { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', second: showSeconds ? '2-digit' : undefined, hour12: !clock24 })
  const tap = reduced ? undefined : { scale: 0.94 }

  return (
    <div
      // The material class provides the real blurred glass; see os.css.
      className="os-menubar-material os-sheen relative flex h-screen w-screen select-none items-center justify-between px-2 text-[var(--os-text)]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── Left: Udaan menu and the focused app's menus ─────────────── */}
      <div className="flex min-w-0 items-center gap-0.5">
        <StatusButton aria-label="Udaan menu" onClick={(e) => openMenu(e, udaanMenuItems())} className="px-2.5" whileTap={tap} transition={springs.snap}>
          <StartGlyph size={16} />
        </StatusButton>
        {/* The app name animates when focus moves between apps, so the bar
            visibly tracks what you are working in rather than silently
            swapping a word. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={appName} {...(reduced ? {} : valueChange)} className="shrink-0">
            <StatusButton onClick={(e) => openMenu(e, appMenuItems())} className="font-semibold" whileTap={tap} transition={springs.snap}>
              {appName}
            </StatusButton>
          </motion.div>
        </AnimatePresence>
        <StatusButton onClick={(e) => openMenu(e, windowMenuItems())} whileTap={tap} transition={springs.snap}>Window</StatusButton>
        <StatusButton onClick={(e) => openMenu(e, goMenuItems())} whileTap={tap} transition={springs.snap}>Go</StatusButton>
        <StatusButton onClick={(e) => openMenu(e, helpMenuItems())} whileTap={tap} transition={springs.snap}>Help</StatusButton>
      </div>

      {focusEnabled && <FocusPill />}

      {/* ── Right: status items ──────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-0.5">
        {media && (
          <div className="relative mr-1 flex h-[26px] items-center overflow-hidden rounded-[8px] bg-[var(--os-hover)] pl-1 pr-0.5">
            <StatusButton
              ref={refs.media}
              onClick={() => toggle('media')}
              title={media.artist ? `${media.title} — ${media.artist}` : media.title}
              active={panel === 'media'}
              className="max-w-[300px] gap-2 px-1.5"
              whileTap={tap}
              transition={springs.snap}
            >
              {media.thumbnail ? (
                <Artwork m={media} size={18} radius={4} />
              ) : (
                <span className="flex h-3 items-end gap-[2px]" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={cn('w-[2px] rounded-full bg-current', media.playing ? 'animate-[eq_0.9s_ease-in-out_infinite]' : 'h-1')} style={{ animationDelay: `${i * 0.15}s`, height: media.playing ? undefined : 4 }} />
                  ))}
                </span>
              )}
              <span className="truncate">
                <span className="font-medium">{media.title}</span>
                {media.artist && <span className="text-[var(--os-text-dim)]"> · {media.artist}</span>}
              </span>
            </StatusButton>
            <StatusButton aria-label={media.playing ? 'Pause' : 'Play'} onClick={() => void mediaCommand('play-pause')} className="w-[24px] justify-center px-0" whileTap={tap} transition={springs.snap}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
                <path d={media.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l11-6.5z'} />
              </svg>
            </StatusButton>
            <StatusButton aria-label="Next" disabled={!media.canNext} onClick={() => void mediaCommand('next')} className="w-[24px] justify-center px-0 disabled:opacity-30" whileTap={tap} transition={springs.snap}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
                <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
              </svg>
            </StatusButton>
            <span className="mx-0.5 h-3.5 w-px bg-[var(--os-separator)]" aria-hidden />
            <StatusButton aria-label="Open DJ board" title="Mix what's playing in the DJ board" onClick={openLiveDj} className="gap-1 px-1.5 text-[12px] font-semibold" whileTap={tap} transition={springs.snap}>
              <svg viewBox="0 0 24 24" width="14" height="14" {...ICON} aria-hidden>
                <circle cx="12" cy="12" r="8.5" />
                <circle cx="12" cy="12" r="2.2" />
                <path d="M12 3.5v3M20.5 12h-3" />
              </svg>
              DJ
            </StatusButton>
            {media.durationMs != null && positionMs != null && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-[var(--os-separator)]" aria-hidden>
                <motion.span
                  className="block h-full bg-[var(--color-accent)]"
                  animate={{ width: `${Math.min(100, (positionMs / media.durationMs) * 100)}%` }}
                  transition={{ duration: 0.5, ease: 'linear' }}
                />
              </span>
            )}
          </div>
        )}

        {battery?.hasBattery && (
          <span className="flex h-[26px] items-center gap-1.5 rounded-[7px] px-2 text-[13px]" title={`Battery ${battery.percent}%${battery.isCharging ? ', charging' : ''}`}>
            <span className="tabular-nums">{battery.percent}%</span>
            <BatteryGlyph size={13} percent={battery.percent} charging={battery.isCharging} />
          </span>
        )}

        <StatusButton ref={refs.edgelight} aria-label="Edge light" title="Edge light" onClick={() => toggle('edgelight')} active={panel === 'edgelight'} className={cn('px-1.5', edgeOn && 'text-[var(--color-accent)]')} whileTap={tap} transition={springs.snap}>
          <svg viewBox="0 0 24 24" width="17" height="17" {...ICON} aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M7 15v-2M10 15V9M13 15v-4M16 15v-3" />
          </svg>
        </StatusButton>

        <StatusButton ref={refs.layouts} aria-label="Arrange windows" title="Arrange windows" onClick={() => toggle('layouts')} active={panel === 'layouts'} className="px-1.5" whileTap={tap} transition={springs.snap}>
          <svg viewBox="0 0 24 24" width="17" height="17" {...ICON} aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M12 4v16M3 12h9" />
          </svg>
        </StatusButton>

        <StatusButton ref={refs.network} aria-label="Network" title={network?.connected === false ? 'Offline' : network?.kind === 'wifi' ? `Wi-Fi${network.signal != null ? ` ${network.signal}%` : ''}` : 'Network'} onClick={() => toggle('network')} active={panel === 'network'} className="px-1.5" whileTap={tap} transition={springs.snap}>
          <NetworkIcon s={network} />
        </StatusButton>

        <StatusButton
          ref={refs.sound}
          aria-label="Sound"
          title={`Volume ${Math.round((volume?.level ?? 0) * 100)}%${volume?.muted ? ' (muted)' : ''} — scroll to change, middle-click to mute`}
          onClick={() => toggle('sound')}
          active={panel === 'sound'}
          className="px-1.5"
          whileTap={tap}
          transition={springs.snap}
          onWheel={(e) => {
            const level = Math.min(1, Math.max(0, Math.round(((volume?.level ?? 0) - Math.sign(e.deltaY) * 0.04) * 100) / 100))
            void invoke('shell_set_volume', { level, muted: false })
          }}
          onAuxClick={(e) => {
            if (e.button === 1) void invoke('shell_set_volume', { level: null, muted: !volume?.muted })
          }}
        >
          <SoundIcon level={volume?.level ?? 1} muted={!!volume?.muted} />
        </StatusButton>

        <StatusButton aria-label="DJ board" title="DJ board — mix and shape what's playing" onClick={openLiveDj} className="px-1.5" whileTap={tap} transition={springs.snap}>
          <svg viewBox="0 0 24 24" width="17" height="17" {...ICON} aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="2.2" />
            <path d="M12 3.5v3M20.5 12h-3" />
          </svg>
        </StatusButton>

        <StatusButton ref={refs['notifications-panel']} aria-label={unread ? `${unread} notifications` : 'Notifications'} onClick={() => toggle('notifications-panel')} active={panel === 'notifications-panel'} className="relative px-1.5" whileTap={tap} transition={springs.snap}>
          <svg viewBox="0 0 24 24" width="17" height="17" {...ICON} aria-hidden>
            <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
            <path d="M10 20.5a2 2 0 0 0 4 0" />
          </svg>
          {/* The badge arrives with one soft overshoot: a count that simply
              blinks into existence is easy to miss. */}
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                {...(reduced ? {} : badgePop)}
                className="absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--color-accent)] px-[3px] text-[9px] font-bold leading-none text-[var(--color-accent-contrast)]"
              >
                {unread > 9 ? '9+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </StatusButton>

        <StatusButton ref={refs.calendar} aria-label={`${date} ${time}`} onClick={() => toggle('calendar')} active={panel === 'calendar'} className="gap-2.5 font-medium tabular-nums" whileTap={tap} transition={springs.snap}>
          <span>{date}</span>
          <span>{time}</span>
        </StatusButton>
      </div>
    </div>
  )
}
