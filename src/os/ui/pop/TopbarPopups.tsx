import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Segmented, Slider, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { PopIcon, SignalBars, type PopIconName } from './icons'
import { Surface } from './Surface'
import { SAMPLE_EVENTS, SAMPLE_NETWORKS, SOUND_PRESETS } from './samples'

/**
 * THE TOP-BAR POPUPS. One family: the same card (340 px wide, 24 px radius) and the same header (a round icon, a
 * title, what the popup is about). Controls are large and forgiving.
 *
 * Each popup is a controlled VIEW (`NetworkView`, `SoundView`...) that takes plain data and callbacks. The real OS
 * feeds them from the engine (os/dock/popups/Connected.tsx); the design gallery wraps them in demo state
 * (`NetworkPopup`...). A view never talks to the engine itself.
 */
export const POP_W = 340

export function PopHeader({ icon, title, sub, right }: { icon: PopIconName; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 pb-1 pt-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.12]">
        <PopIcon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[16px] font-semibold leading-tight">{title}</h2>
        {sub && <p className="truncate text-[12px] text-(--u-ink-3)">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

function FooterLink({ children, icon = 'sliders', onClick }: { children: ReactNode; icon?: PopIconName; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="pop-row mx-2 mb-2 mt-1 text-[13px] text-(--u-ink-2)" style={{ width: 'calc(100% - 16px)' }}>
      <PopIcon name={icon} size={16} />
      {children}
      <PopIcon name="chevron" size={14} className="ml-auto opacity-60" />
    </button>
  )
}

/* ── Network ───────────────────────────────────────────────────────── */

export interface NetworkData {
  connected: boolean
  kind: 'wifi' | 'ethernet' | 'other' | 'none'
  name?: string | null
  /** 0 to 100. */
  signal?: number | null
  adapter?: string | null
  ipv4?: string | null
  speedMbps?: number | null
}

function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" title="Click to copy" className="min-w-0 truncate text-right tabular-nums hover:text-white" onClick={() => void navigator.clipboard?.writeText(value).then(() => (setDone(true), setTimeout(() => setDone(false), 1200)))}>
      {done ? 'Copied' : value}
    </button>
  )
}

const quality = (s: number) => (s >= 75 ? 'Excellent' : s >= 50 ? 'Good' : s >= 25 ? 'Fair' : 'Weak')

export function NetworkView({ data, radio, onSettings, onWifi }: { data: NetworkData | null; radio?: { on: boolean; set: (v: boolean) => void } | null; onSettings?: () => void; onWifi?: () => void }) {
  const wifi = data?.kind === 'wifi'
  const title = !data ? 'Checking…' : data.connected ? (wifi ? 'Wi-Fi' : data.kind === 'ethernet' ? 'Ethernet' : 'Network') : 'Network'
  const sub = !data ? '' : data.connected ? `Connected${data.name ? ` to ${data.name}` : ''}` : 'Not connected'
  const rows: [string, ReactNode][] = []
  if (data?.connected) {
    if (data.adapter) rows.push(['Adapter', <span key="a" className="block truncate text-right">{data.adapter}</span>])
    if (data.ipv4) rows.push(['IP address', <CopyValue key="ip" value={data.ipv4} />])
    if (data.speedMbps) rows.push(['Link speed', <span key="s" className="block text-right tabular-nums">{data.speedMbps >= 1000 ? `${data.speedMbps / 1000} Gbps` : `${data.speedMbps} Mbps`}</span>])
  }
  return (
    <Surface radius={24} className="pop-in" style={{ width: POP_W }}>
      <PopHeader icon={wifi || !data ? 'wifi' : 'monitor'} title={title} sub={sub} right={radio ? <Switch checked={radio.on} onChange={radio.set} label="Wi-Fi" /> : undefined} />
      <div className="px-4 pb-1 pt-3">
        <div className="flex items-center gap-3 rounded-[16px] bg-white/[0.09] p-3">
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-full', data?.connected ? 'bg-(--u-accent,#3072f0) text-white' : 'bg-white/10')}>
            <PopIcon name={wifi || !data ? 'wifi' : 'monitor'} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold leading-tight">{data?.connected ? (data.name ?? (wifi ? 'Wi-Fi' : data.kind === 'ethernet' ? 'Ethernet' : 'Network')) : 'No network connection'}</p>
            <p className="text-[12px] text-(--u-ink-3)">{data?.connected ? 'Online' : 'Check your cable or Wi-Fi'}</p>
          </div>
          {data?.connected && <span className="h-2.5 w-2.5 rounded-full bg-[#30d158]" aria-label="Online" />}
        </div>
        {data?.connected && data.signal != null && (
          <div className="mt-2 flex items-center gap-3 rounded-[14px] bg-white/[0.07] px-3.5 py-2.5">
            <SignalBars level={Math.max(1, Math.ceil((data.signal / 100) * 4))} size={18} />
            <span className="text-[13px] font-medium">{quality(data.signal)}</span>
            <span className="ml-auto text-[12.5px] tabular-nums text-(--u-ink-3)">{data.signal}%</span>
          </div>
        )}
        {rows.length > 0 && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[14px] bg-white/[0.07] px-3.5 py-3 text-[12.5px]">
            {rows.map(([k, v]) => (
              <div key={k} className="col-span-2 grid grid-cols-subgrid"><dt className="text-(--u-ink-3)">{k}</dt><dd className="min-w-0">{v}</dd></div>
            ))}
          </dl>
        )}
      </div>
      {wifi && <FooterLink icon="wifi" onClick={onWifi}>Wi-Fi networks…</FooterLink>}
      <FooterLink icon="sliders" onClick={onSettings}>Network settings…</FooterLink>
    </Surface>
  )
}

/** The design gallery's network popup: a pretend list of nearby networks you can join. */
export function NetworkPopup() {
  const [on, setOn] = useState(true)
  const [pick, setPick] = useState<string | null>(null)
  const [joined, setJoined] = useState('Home')
  const current = SAMPLE_NETWORKS.find((n) => n.name === joined)
  return (
    <Surface radius={24} className="pop-in" style={{ width: POP_W }}>
      <PopHeader icon="wifi" title="Wi-Fi" sub={on ? (current ? `Connected to ${current.name}` : 'Not connected') : 'Off'} right={<Switch checked={on} onChange={setOn} label="Wi-Fi" />} />
      <div className={cn('px-2 pb-1 pt-2 transition-opacity', !on && 'pointer-events-none opacity-30')}>
        {current && (
          <div className="mx-2 mb-2 flex items-center gap-3 rounded-[16px] bg-white/[0.09] p-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--u-accent,#3072f0) text-white"><PopIcon name="wifi" size={20} /></span>
            <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold leading-tight">{current.name}</p><p className="text-[12px] text-(--u-ink-3)">{current.detail ?? 'Connected'} · Secured</p></div>
            <button type="button" className="pop-btn" onClick={() => setJoined('')}>Disconnect</button>
          </div>
        )}
        <p className="pop-label px-3 pb-1 pt-1">Nearby networks</p>
        {SAMPLE_NETWORKS.filter((n) => n.name !== joined).map((n) => (
          <div key={n.name}>
            <button type="button" className="pop-row w-full" onClick={() => setPick(pick === n.name ? null : n.name)}>
              <span className="flex w-5 justify-center opacity-90"><SignalBars level={n.level} /></span>
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{n.name}</span>
              {n.secured && <PopIcon name="lock" size={14} className="opacity-60" />}
            </button>
            {pick === n.name && (
              <div className="pop-in mx-2 mb-1 flex items-center gap-2 rounded-[12px] bg-white/[0.07] p-2">
                {n.secured && <input type="password" placeholder="Password" className="h-8 min-w-0 flex-1 rounded-[9px] bg-black/25 px-3 text-[13px] outline-none placeholder:text-(--u-ink-3) focus:ring-1 focus:ring-white/30" />}
                <button type="button" className="pop-btn pop-btn--accent" onClick={() => (setJoined(n.name), setPick(null))}>Connect</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <FooterLink icon="sliders">Network settings…</FooterLink>
    </Surface>
  )
}

/* ── Sound ─────────────────────────────────────────────────────────── */

/** Bass, low-mid, mid, high-mid and treble gain per mode, in dB (the gallery's pretend curve). */
const CURVES: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0], Music: [4, 1, -1, 2, 4], Cinematic: [5, 2, 0, 3, 4], Bass: [8, 4, 0, 0, 1], Dialogue: [-3, 0, 5, 4, 1], Night: [-4, -1, 1, 0, -3], Clarity: [-2, -1, 2, 5, 6], Custom: [2, 0, 1, 0, 2],
}

/** The sound mode's response. `db` is a finely sampled curve from the real equalizer; `gains` is a few bands. */
function EqCurve({ db, gains }: { db?: number[] | null; gains?: number[] }) {
  const w = 300
  const h = 52
  const pts = db && db.length > 1
    ? db.map((g, i) => [(i / (db.length - 1)) * w, h / 2 - (Math.max(-12, Math.min(12, g)) / 12) * (h / 2 - 5)] as const)
    : (gains ?? [0, 0, 0, 0, 0]).map((g, i, a) => [10 + (i * (w - 20)) / (a.length - 1), h / 2 - (g / 10) * (h / 2 - 6)] as const)
  const smooth = !db
  const d = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : smooth ? `S${(pts[i - 1][0] + x) / 2},${pts[i - 1][1]} ${x},${y}` : `L${x},${y}`)).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[52px] w-full" aria-hidden>
      <defs><linearGradient id="eqfade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.22" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="currentColor" strokeOpacity="0.14" strokeDasharray="3 4" />
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#eqfade)" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export interface SoundViewProps {
  level: number // 0 to 100
  muted: boolean
  onLevel: (v: number) => void
  onMute: () => void
  presets: { id: string; label: string }[]
  preset: string
  onPreset: (id: string) => void
  /** The real response curve in dB, when the engine has one. */
  curve?: number[] | null
  gains?: number[]
  custom?: { bass: number; voice: number; treble: number }
  onCustom?: (p: Partial<{ bass: number; voice: number; treble: number }>) => void
  awake: boolean
  onAwake: (v: boolean) => void
  awakeLevel: string
  onAwakeLevel: (v: string) => void
  onSettings?: () => void
  showOutput?: boolean
}

export function SoundView(p: SoundViewProps) {
  const shown = p.muted ? 0 : p.level
  const flat = p.preset === 'flat'
  return (
    <Surface radius={24} className="pop-in" style={{ width: POP_W }} onWheel={(e) => p.onLevel(Math.max(0, Math.min(100, p.level + (e.deltaY < 0 ? 3 : -3))))}>
      <PopHeader icon={p.muted ? 'mute' : 'volume'} title="Sound" sub="Volume and sound mode" right={p.showOutput ? <button type="button" className="pop-btn">Output <PopIcon name="down" size={12} /></button> : undefined} />
      <div className="flex items-center gap-3 px-4 pb-3 pt-3">
        <button type="button" aria-label={p.muted ? 'Unmute' : 'Mute'} aria-pressed={p.muted} className="pop-iconbtn h-10 w-10 bg-white/[0.12]" onClick={p.onMute}>
          <PopIcon name={p.muted || p.level === 0 ? 'mute' : 'volume'} size={20} />
        </button>
        <Slider aria-label="Volume" value={shown} min={0} max={100} step={1} onChange={p.onLevel} className="flex-1" />
        <span className="w-10 text-right text-[22px] font-light tabular-nums">{shown}</span>
      </div>

      <div className="mx-4 rounded-[16px] bg-white/[0.07] p-3">
        <div className="flex items-baseline justify-between">
          <p className="pop-label">Sound mode</p>
          <p className="text-[11.5px] text-(--u-ink-3)">{flat ? 'No processing' : 'Shapes everything Udaan plays'}</p>
        </div>
        <div className="mt-1 text-(--u-ink)"><EqCurve db={p.curve} gains={p.gains} /></div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {p.presets.map((x) => (
            <button key={x.id} type="button" aria-pressed={p.preset === x.id} className="pop-chip" onClick={() => p.onPreset(x.id)}>{x.label}</button>
          ))}
        </div>
        {p.preset === 'custom' && p.custom && p.onCustom && (
          <div className="pop-in mt-3 flex flex-col gap-2.5">
            {(['bass', 'voice', 'treble'] as const).map((k) => (
              <label key={k} className="flex items-center gap-3 text-[12.5px]">
                <span className="w-12 capitalize text-(--u-ink-2)">{k}</span>
                <Slider aria-label={k} value={p.custom![k]} min={-10} max={10} step={1} onChange={(v) => p.onCustom!({ [k]: v })} className="flex-1" />
                <span className="w-9 text-right tabular-nums text-(--u-ink-3)">{p.custom![k] > 0 ? '+' : ''}{p.custom![k]} dB</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mx-4 mb-3 mt-2.5 rounded-[16px] bg-white/[0.07] p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium leading-tight">Keep speakers awake</p>
            <p className="text-[11.5px] leading-snug text-(--u-ink-3)">Stops speakers switching off on quiet scenes.</p>
          </div>
          <Switch checked={p.awake} onChange={p.onAwake} label="Keep speakers awake" />
        </div>
        {p.awake && (
          <div className="pop-in mt-2.5">
            <Segmented value={p.awakeLevel} options={[{ value: '1', label: 'Gentle' }, { value: '2', label: 'Normal' }, { value: '3', label: 'Strong' }]} onChange={p.onAwakeLevel} />
          </div>
        )}
      </div>
      <FooterLink onClick={p.onSettings}>Sound settings…</FooterLink>
    </Surface>
  )
}

export function SoundPopup() {
  const [vol, setVol] = useState(62)
  const [muted, setMuted] = useState(false)
  const [mode, setMode] = useState('flat')
  const [awake, setAwake] = useState(true)
  const [level, setLevel] = useState('2')
  const [custom, setCustom] = useState({ bass: 2, voice: 0, treble: 2 })
  const presets = SOUND_PRESETS.map((l) => ({ id: l.toLowerCase(), label: l }))
  return (
    <SoundView
      level={vol}
      muted={muted}
      onLevel={(v) => (setMuted(false), setVol(v))}
      onMute={() => setMuted((m) => !m)}
      presets={presets}
      preset={mode}
      onPreset={setMode}
      gains={CURVES[mode.charAt(0).toUpperCase() + mode.slice(1)]}
      custom={custom}
      onCustom={(p) => setCustom((c) => ({ ...c, ...p }))}
      awake={awake}
      onAwake={setAwake}
      awakeLevel={level}
      onAwakeLevel={setLevel}
      showOutput
    />
  )
}

/* ── Media ─────────────────────────────────────────────────────────── */

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export interface MediaViewData {
  title: string
  artist?: string | null
  album?: string | null
  source?: string | null
  playing: boolean
  canNext: boolean
  canPrevious: boolean
  canSeek: boolean
  /** Seconds, or null when unknown. */
  duration: number | null
  /** Artwork, drawn by the caller. */
  art?: ReactNode
}

export function MediaView({ media, position, onCommand, onSeek, onOpen }: { media: MediaViewData | null; position: number; onCommand: (c: 'play-pause' | 'next' | 'previous') => void; onSeek?: (s: number) => void; onOpen?: () => void }) {
  if (!media) {
    return (
      <Surface radius={24} className="pop-in" style={{ width: POP_W }}>
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.09]"><PopIcon name="volume" size={26} strokeWidth={1.5} /></span>
          <p className="text-[15px] font-medium">Nothing is playing</p>
          <p className="text-[12.5px] text-(--u-ink-3)">Start music or a video and its controls will appear here.</p>
        </div>
      </Surface>
    )
  }
  const total = media.duration
  return (
    <Surface radius={24} className="pop-in" style={{ width: POP_W }}>
      <div className="flex gap-4 px-4 pb-1 pt-4">
        <div className="relative h-[92px] w-[92px] shrink-0 overflow-hidden rounded-[16px] shadow-[0_4px_14px_rgb(0_0_0/.4)]">{media.art}</div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="pop-label">Now playing</p>
          <p className="mt-0.5 truncate text-[17px] font-semibold leading-tight">{media.title}</p>
          {media.artist && <p className="truncate text-[13px] text-(--u-ink-2)">{media.artist}</p>}
          {media.album && <p className="mt-1 truncate text-[11.5px] text-(--u-ink-3)">{media.album}</p>}
        </div>
      </div>
      {total ? (
        <div className="px-4 pt-3">
          <Slider aria-label="Position" value={Math.min(position, total)} min={0} max={total} step={1} disabled={!media.canSeek || !onSeek} onChange={(v) => onSeek?.(v)} />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-(--u-ink-3)"><span>{fmt(position)}</span><span>-{fmt(Math.max(0, total - position))}</span></div>
        </div>
      ) : <div className="h-3" />}
      <div className="flex items-center justify-center gap-5 px-4 pb-3 pt-1">
        <button type="button" aria-label="Previous" disabled={!media.canPrevious} className="pop-iconbtn h-10 w-10 disabled:opacity-30" onClick={() => onCommand('previous')}><PopIcon name="prev" size={22} /></button>
        <button type="button" aria-label={media.playing ? 'Pause' : 'Play'} className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white text-[#17181b] shadow-[0_4px_14px_rgb(0_0_0/.4)] transition-transform active:scale-95" onClick={() => onCommand('play-pause')}>
          <PopIcon name={media.playing ? 'pause' : 'play'} size={24} />
        </button>
        <button type="button" aria-label="Next" disabled={!media.canNext} className="pop-iconbtn h-10 w-10 disabled:opacity-30" onClick={() => onCommand('next')}><PopIcon name="next" size={22} /></button>
      </div>
      {media.source && (
        <div className="mx-4 mb-4 flex items-center gap-2.5 rounded-[14px] bg-white/[0.07] px-3 py-2">
          <PopIcon name="volume" size={16} className="opacity-70" />
          <span className="truncate text-[12px] text-(--u-ink-2)">Playing from <b className="font-semibold text-(--u-ink)">{media.source}</b></span>
          {onOpen && <button type="button" className="pop-btn ml-auto" style={{ height: 24 }} onClick={onOpen}>Open</button>}
        </div>
      )}
    </Surface>
  )
}

export function MediaPopup() {
  const total = 214
  const [pos, setPos] = useState(87)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setPos((p) => (p + 1 > total ? 0 : p + 1)), 1000)
    return () => clearInterval(t)
  }, [playing])
  const art = (
    <div className="absolute inset-0" style={{ background: 'linear-gradient(145deg,#ff6a88 0%,#8a3ffc 60%,#2b1b6b 100%)' }}>
      <span aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgb(255_255_255/.5),transparent_55%)]" />
    </div>
  )
  return (
    <MediaView
      media={{ title: 'Late Night Drive', artist: 'Neon Harbour', album: 'Midnight Signals · 2025', source: 'Music', playing, canNext: true, canPrevious: true, canSeek: true, duration: total, art }}
      position={pos}
      onCommand={(c) => (c === 'play-pause' ? setPlaying((p) => !p) : setPos(0))}
      onSeek={setPos}
      onOpen={() => {}}
    />
  )
}

/* ── Calendar ──────────────────────────────────────────────────────── */

export interface CalEvent { time: string; title: string; place?: string; tint: string; done?: boolean }
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function CalendarView({ events, onOpen }: { events: Record<string, CalEvent[]>; onOpen?: () => void }) {
  const today = useMemo(() => new Date(), [])
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [sel, setSel] = useState(isoOf(today))
  const cells = useMemo(() => {
    const first = (month.getDay() + 6) % 7 // Monday first
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    return [...Array(first).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)] as number[]
  }, [month])
  const dayIso = (d: number) => isoOf(new Date(month.getFullYear(), month.getMonth(), d))
  const step = (d: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + d, 1))
  const list = events[sel] ?? []
  const isToday = sel === isoOf(today)
  const selDate = new Date(`${sel}T12:00`)
  return (
    <Surface radius={24} className="pop-in" style={{ width: POP_W }}>
      <div className="flex items-end gap-3 px-5 pb-1 pt-4">
        <span className="text-[56px] font-extralight leading-none tracking-tight tabular-nums">{today.getDate()}</span>
        <div className="pb-1.5">
          <p className="text-[15px] font-semibold leading-tight">{today.toLocaleDateString(undefined, { weekday: 'long' })}</p>
          <p className="text-[12px] text-(--u-ink-3)">{today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
      <div className="px-3 pt-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <p className="text-[13px] font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
          <div className="flex">
            <button type="button" aria-label="Previous month" className="pop-iconbtn h-7 w-7" onClick={() => step(-1)}><PopIcon name="chevron" size={14} style={{ transform: 'scaleX(-1)' }} /></button>
            <button type="button" aria-label="Next month" className="pop-iconbtn h-7 w-7" onClick={() => step(1)}><PopIcon name="chevron" size={14} /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[10.5px] font-semibold uppercase tracking-wide text-(--u-ink-3)">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="py-1">{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5 text-center text-[13px]">
          {cells.map((d, i) => {
            if (!d) return <span key={i} />
            const id = dayIso(d)
            const todayCell = id === isoOf(today)
            return (
              <button key={i} type="button" onClick={() => setSel(id)} className="relative mx-auto flex h-9 w-9 items-center justify-center rounded-full tabular-nums transition-colors hover:bg-white/10" style={todayCell ? { background: 'var(--u-accent,#3072f0)', color: '#fff', fontWeight: 600 } : id === sel ? { background: 'rgb(255 255 255 / .16)' } : undefined}>
                {d}
                {(events[id]?.length ?? 0) > 0 && !todayCell && <span className="absolute bottom-1 h-[4px] w-[4px] rounded-full bg-white/60" />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mx-4 mt-2 rounded-[16px] bg-white/[0.07] p-1.5">
        <p className="pop-label px-2.5 pb-1 pt-1.5">{isToday ? 'Today' : selDate.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
        {list.length === 0 && <p className="px-2.5 pb-2 pt-0.5 text-[12.5px] text-(--u-ink-3)">Nothing planned.</p>}
        {list.slice(0, 5).map((e, i) => (
          <div key={`${e.time}${i}`} className="flex items-center gap-3 rounded-[10px] px-2.5 py-1.5" style={{ opacity: e.done ? 0.5 : 1 }}>
            <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: e.tint }} />
            <span className="w-11 shrink-0 text-[12px] tabular-nums text-(--u-ink-2)">{e.time}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{e.title}{e.place && <span className="font-normal text-(--u-ink-3)"> · {e.place}</span>}</span>
          </div>
        ))}
        {list.length > 5 && <p className="px-2.5 pb-1.5 text-[11.5px] text-(--u-ink-3)">+{list.length - 5} more</p>}
      </div>
      <FooterLink icon="calendar" onClick={onOpen}>Open Calendar</FooterLink>
    </Surface>
  )
}

export function CalendarPopup() {
  const events = useMemo(() => ({ [isoOf(new Date())]: SAMPLE_EVENTS.map((e) => ({ ...e })) }), [])
  return <CalendarView events={events} />
}
