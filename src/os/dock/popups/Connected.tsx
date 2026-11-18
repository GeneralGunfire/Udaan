import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { dismissNotification, listNotifications, markNotificationRead, onNotificationsChanged, type Notification } from '@/integrations/notifications/client'
import { launchApp } from '@/integrations/installed-apps/client'
import { setWifiRadioEnabled, wifiDetails, type WifiDetails } from '@/integrations/quick-settings/client'
import { listEvents } from '@/integrations/schedule/client'
import type { ScheduleEvent } from '@/integrations/schedule/types'
import { CATEGORY_COLOUR } from '@/os/launcher/MyDay'
import { usePoll } from '@/os/kernel/poll'
import { usePref } from '@/os/kernel/prefs'
import { openApp, shell } from '@/os/kernel/shell'
import { curveResponse, refreshEqualizer, type Curve } from '@/os/sound/equalizer'
import { playSound } from '@/os/sound/sounds'
import { NotificationIcon, notificationSource, windowsExtra } from '@/os/ui/NotificationIcon'
import { toastError } from '@/os/ui/toasts'
import { usePopMenu } from '@/os/ui/pop/Menu'
import { NotificationCenter } from '@/os/ui/pop/Notifications'
import type { Note } from '@/os/ui/pop/samples'
import { CalendarView, MediaView, NetworkView, SoundView, type CalEvent, type NetworkData } from '@/os/ui/pop/TopbarPopups'
import { LayoutsView, type LayoutWindow } from '@/os/ui/pop/LayoutsView'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { Artwork, mediaCommand, seekMedia, sourceName } from '@/os/dock/panels/MediaPanel'
import { useNowPlaying } from '@/os/dock/panels/useNowPlaying'

/**
 * The top-bar popups, connected to the engine: each one reads real data and sends real commands, and draws it with
 * the pop kit's views. This is the only place the popup designs meet the OS.
 */

/* ── Network ───────────────────────────────────────────────────────── */

export function NetworkConnected() {
  const [s, setS] = useState<NetworkData | null>(null)
  const [wifi, setWifi] = useState<WifiDetails | null>(null)
  usePoll(() => void invoke<NetworkData>('shell_network_status').then(setS, () => {}), 3000)
  useEffect(() => {
    void wifiDetails().then(setWifi, () => {})
  }, [])
  const radio = wifi?.hasAdapter
    ? {
        on: wifi.radioOn,
        set: (v: boolean) =>
          void setWifiRadioEnabled(v).then(
            () => setWifi((w) => (w ? { ...w, radioOn: v } : w)),
            (err) => toastError('Couldn’t change Wi-Fi', err),
          ),
      }
    : null
  return <NetworkView data={s} radio={radio} onSettings={() => void launchApp('ms-settings:network')} onWifi={() => void launchApp('ms-settings:network-wifi')} />
}

/* ── Sound ─────────────────────────────────────────────────────────── */

const PRESETS = [
  { id: 'flat', label: 'Flat' },
  { id: 'music', label: 'Music' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'bass', label: 'Bass' },
  { id: 'vocal', label: 'Dialogue' },
  { id: 'night', label: 'Night' },
  { id: 'clarity', label: 'Clarity' },
  { id: 'custom', label: 'Custom' },
]

interface VolumeState {
  level: number
  muted: boolean
}

export function SoundConnected() {
  const [v, setV] = useState<VolumeState>({ level: 0, muted: false })
  const [curve, setCurve] = useState<Curve | null>(null)
  const [preset, setPreset] = usePref('sound.preset')
  const [customRaw, setCustomRaw] = usePref('sound.custom')
  const [awake, setAwake] = usePref('sound.keepAwake')
  const [awakeLevel, setAwakeLevel] = usePref('sound.keepAwakeLevel')
  let custom = { bass: 0, voice: 0, treble: 0 }
  try {
    const c = JSON.parse(customRaw) as Partial<typeof custom>
    custom = { bass: Number(c.bass) || 0, voice: Number(c.voice) || 0, treble: Number(c.treble) || 0 }
  } catch {
    /* flat */
  }

  useEffect(() => {
    void invoke<VolumeState>('shell_volume').then(setV, () => {})
  }, [])
  // Preferences are the single source of truth: retune every live audio chain and redraw the curve from them.
  const applyMode = useCallback(async () => setCurve(await refreshEqualizer()), [])
  useEffect(() => {
    void applyMode()
  }, [applyMode])

  const setVolume = (patch: Partial<VolumeState>) => {
    setV((cur) => ({ ...cur, ...patch }))
    void invoke<VolumeState>('shell_set_volume', { level: patch.level ?? null, muted: patch.muted ?? null }).catch(() => {})
  }
  const db = useMemo(() => (curve ? curveResponse(curve, 96).map((p) => p.db) : null), [curve])

  return (
    <SoundView
      level={Math.round(v.level * 100)}
      muted={v.muted}
      onLevel={(n) => setVolume({ level: n / 100, muted: false })}
      onMute={() => setVolume({ muted: !v.muted })}
      presets={PRESETS}
      preset={preset}
      onPreset={(id) => void setPreset(id).then(applyMode)}
      curve={db}
      custom={custom}
      onCustom={(p) => void setCustomRaw(JSON.stringify({ ...custom, ...p })).then(applyMode)}
      awake={awake}
      onAwake={(on) => {
        void setAwake(on)
        void invoke('speaker_keepalive_set', { enabled: on, level: awakeLevel }).catch(() => {})
      }}
      awakeLevel={String(awakeLevel)}
      onAwakeLevel={(l) => {
        void setAwakeLevel(Number(l))
        void invoke('speaker_keepalive_set', { enabled: awake, level: Number(l) }).catch(() => {})
      }}
      onSettings={() => void openApp('settings', { section: 'sound' })}
    />
  )
}

/* ── Media ─────────────────────────────────────────────────────────── */

export function MediaConnected() {
  const { media: m, loaded, positionMs, pin } = useNowPlaying(1000)
  if (!loaded) return null
  return (
    <MediaView
      media={
        m && {
          title: m.title,
          artist: m.artist,
          album: m.album,
          source: sourceName(m.source),
          playing: m.playing,
          canNext: m.canNext,
          canPrevious: m.canPrevious,
          canSeek: !!m.canSeek,
          duration: m.durationMs ? Math.round(m.durationMs / 1000) : null,
          art: <Artwork m={m} size={92} radius={16} />,
        }
      }
      position={Math.round((positionMs ?? 0) / 1000)}
      onCommand={(c) => void mediaCommand(c)}
      onSeek={(s) => {
        pin(s * 1000)
        void seekMedia(s * 1000)
      }}
    />
  )
}

/* ── Calendar ──────────────────────────────────────────────────────── */

export function CalendarConnected({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  useEffect(() => {
    void listEvents().then(setEvents, () => setEvents([]))
  }, [])
  const byDay = useMemo(() => {
    const out: Record<string, CalEvent[]> = {}
    for (const e of [...events].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))) {
      if (!e.date) continue
      ;(out[e.date] ??= []).push({ time: e.allDay || !e.startTime ? 'All day' : e.startTime, title: e.title, tint: CATEGORY_COLOUR[e.category], done: e.status === 'done' })
    }
    return out
  }, [events])
  return (
    <CalendarView
      events={byDay}
      onOpen={() => {
        void openApp('calendar')
        onClose()
      }}
    />
  )
}

/* ── Layouts ───────────────────────────────────────────────────────── */

const windowIcons = new Map<number, string | null>()
/** An external window's own icon, fetched once per window. */
function WindowIcon({ handle }: { handle: number }) {
  const [src, setSrc] = useState(windowIcons.get(handle) ?? null)
  useEffect(() => {
    if (windowIcons.has(handle)) return
    void shell.windowIcons([handle]).then(
      (r) => {
        windowIcons.set(handle, r[handle] ?? null)
        setSrc(r[handle] ?? null)
      },
      () => {},
    )
  }, [handle])
  return src ? <img src={src} alt="" className="h-5 w-5" /> : <span className="h-5 w-5 rounded bg-white/15" />
}

const LAYOUT_STORE = 'layouts.last'

export function LayoutsConnected({ onDone }: { onDone: () => void }) {
  const [windows, setWindows] = useState<LayoutWindow[]>([])
  const [ratio] = useState(() => {
    try {
      return (JSON.parse(localStorage.getItem(LAYOUT_STORE) ?? 'null') as { ratio?: number } | null)?.ratio ?? 0.5
    } catch {
      return 0.5
    }
  })
  useEffect(() => {
    void shell.snapshot().then(
      (s) => {
        // The front window first, then the rest, so "Auto-fill" does the obvious thing.
        const list = [...s.windows.filter((w) => w.handle === s.foreground), ...s.windows.filter((w) => w.handle !== s.foreground)]
        setWindows(list.map((w) => ({ handle: w.handle, title: w.title || w.processName, icon: w.appId ? <AppIcon appId={w.appId} size={20} /> : <WindowIcon handle={w.handle} /> })))
      },
      () => {},
    )
  }, [])
  return (
    <LayoutsView
      windows={windows}
      ratio={ratio}
      onArrange={async (zones, assigned, layout, r) => {
        // Back to front, so the first space's window ends up on top.
        const pairs = zones.map((z, i) => [z, assigned[i]] as const).filter(([, w]) => w)
        for (const [zone, win] of [...pairs].reverse()) {
          await invoke('shell_snap_window', { handle: win!.handle, zone }).catch(() => {})
          await shell.focus(win!.handle).catch(() => {})
        }
        try {
          localStorage.setItem(LAYOUT_STORE, JSON.stringify({ id: layout.id, ratio: r }))
        } catch {
          /* storage unavailable */
        }
        playSound('switch')
        onDone()
      }}
    />
  )
}

/* ── Notification Center ───────────────────────────────────────────── */

const rel = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** An engine notification as the pop kit draws it. */
export function toNote(n: Notification): Note {
  return {
    id: n.id,
    app: notificationSource(n),
    title: n.title,
    body: n.body || undefined,
    time: rel(n.createdAt),
    kind: /critical|error|fail/i.test(n.kind) ? 'critical' : 'normal',
    actions: n.actionLabel ? [n.actionLabel] : undefined,
    unread: !n.readAt,
    renderIcon: (size) => <NotificationIcon n={n} size={size} />,
  }
}

/** Opens what a notification points at: a Windows app's own launch target, otherwise the Udaan app it came from. */
export function openNotification(n: Notification) {
  void markNotificationRead(n.id).catch(() => {})
  const extra = windowsExtra(n)
  if (extra?.launch) void launchApp(extra.launch)
}

export function useMuteApp() {
  const [raw, setRaw] = usePref('notifications.muted')
  return (app: string) => {
    let list: string[] = []
    try {
      list = JSON.parse(raw) as string[]
    } catch {
      /* none */
    }
    if (!list.includes(app)) void setRaw(JSON.stringify([...list, app]))
  }
}

export function NotificationsConnected({ onClose, sheet }: { onClose: () => void; sheet: boolean }) {
  const [items, setItems] = useState<Notification[]>([])
  const [dnd, setDnd] = usePref('notifications.dnd')
  const { open, node } = usePopMenu()
  const mute = useMuteApp()
  const reload = useCallback(() => void listNotifications(false, 80).then(setItems, () => setItems([])), [])
  useEffect(() => {
    reload()
    const un = onNotificationsChanged(reload)
    return () => void un.then((f) => f())
  }, [reload])

  const notes = useMemo(() => items.map(toNote), [items])
  const find = (id: string) => items.find((n) => n.id === id)

  return (
    <>
      <NotificationCenter
        notes={notes}
        dnd={dnd}
        onDnd={(v) => void setDnd(v)}
        // The full-height sheet fills its window; the regular popup is the standard 340 px panel and scrolls past 560 px.
        height={sheet ? '100%' : undefined}
        width={sheet ? 392 : 340}
        maxHeight={sheet ? undefined : 560}
        onSettings={() => void openApp('settings', { section: 'notifications' })}
        onChange={(next) => {
          // Whatever the list lost was dismissed.
          const keep = new Set(next.map((n) => n.id))
          void Promise.all(items.filter((n) => !keep.has(n.id)).map((n) => dismissNotification(n.id))).then(reload)
        }}
        onOpen={(n) => {
          const full = find(n.id)
          if (full) openNotification(full)
          reload()
        }}
        onAction={(n) => {
          const full = find(n.id)
          if (full) openNotification(full)
          reload()
        }}
        onMenu={(e, n) => {
          const full = find(n.id)
          if (!full) return
          open(e, [
            { label: 'Open', icon: 'external', onSelect: () => (openNotification(full), reload()) },
            { label: full.readAt ? 'Already read' : 'Mark as read', icon: 'check', disabled: !!full.readAt, onSelect: () => void markNotificationRead(full.id).then(reload) },
            { type: 'sep' },
            { label: 'Dismiss', icon: 'x', onSelect: () => void dismissNotification(full.id).then(reload) },
            { label: `Clear all from ${n.app}`, icon: 'trash', onSelect: () => void Promise.all(items.filter((x) => notificationSource(x) === n.app).map((x) => dismissNotification(x.id))).then(reload) },
            { type: 'sep' },
            { label: `Mute ${n.app}`, icon: 'bell', onSelect: () => mute(n.app) },
            { label: 'Notification settings…', icon: 'sliders', onSelect: () => (void openApp('settings', { section: 'notifications' }), onClose()) },
          ])
        }}
      />
      {node}
    </>
  )
}
