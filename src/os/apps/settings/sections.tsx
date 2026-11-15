import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { usePref } from '@/os/kernel/prefs'
import { APP_DEFS, APP_IDS, type AppId } from '@/os/kernel/registry'
import { usePoll } from '@/os/kernel/poll'
import { changePin, loadPinConfig, resetPin } from '@/os/kernel/lockPin'
import { launchApp } from '@/integrations/installed-apps/client'
import { listProviders, setProvider, testProvider, type ProviderInfo } from '@/integrations/omniroute/client'
import { Button, Field } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { CinemaCanvas, type CinemaKind } from '@/os/cinema/CinemaCanvas'
import { SAVERS } from '@/os/cinema/scenes'
import { fittedWallpaperSrc } from '@/app/wallpapers'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { ActionButton, Group, Row, Segmented, Stack, Switch } from './ui'

/* ── Lock screen & screensaver ─────────────────────────────────── */

const DELAYS = [
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 1800, label: '30 min' },
]

function PinChanger() {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [length, setLength] = useState<number | null>(null)
  const reset = () => (setCur(''), setNext(''), setAgain(''))

  const submit = async () => {
    if (next !== again) return setMsg({ ok: false, text: 'The new PIN and its confirmation do not match.' })
    const r = await changePin(cur, next)
    if (r === 'wrong-current') return setMsg({ ok: false, text: 'The current PIN is not right.' })
    if (r === 'invalid') return setMsg({ ok: false, text: 'Use 4 to 8 digits, numbers only.' })
    reset()
    setOpen(false)
    setLength(next.length)
    setMsg({ ok: true, text: 'PIN changed. Udaan Lock will ask for it from now on.' })
  }

  return (
    <>
      <Row title="Lock PIN" description={length ? `${length} digits` : 'Numbers only, 4 to 8 digits. Asked for on the lock screen.'}>
        <ActionButton
          onClick={() => {
            setOpen((o) => !o)
            setMsg(null)
            void loadPinConfig().then((c) => setLength(c.length))
          }}
        >
          {open ? 'Cancel' : 'Change PIN…'}
        </ActionButton>
      </Row>
      {open && (
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          <button
            type="button"
            className="self-start text-[12px] text-(--u-accent) hover:underline"
            onClick={async () => {
              if (!next || next.length < 4 || next !== again) return setMsg({ ok: false, text: 'Forgot it? Type the new PIN below twice, then press this again.' })
              if ((await resetPin(next)) === 'ok') {
                reset()
                setOpen(false)
                setLength(next.length)
                setMsg({ ok: true, text: 'PIN reset. Udaan Lock will ask for the new one.' })
              }
            }}
          >
            I forgot my current PIN
          </button>
          <Field type="password" inputMode="numeric" autoComplete="off" placeholder="Current PIN" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <Field type="password" inputMode="numeric" autoComplete="off" placeholder="New PIN (4 to 8 digits)" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <Field type="password" inputMode="numeric" autoComplete="off" placeholder="Repeat new PIN" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          <Button variant="primary" className="self-start" disabled={!cur || next.length < 4} onClick={() => void submit()}>
            Save new PIN
          </Button>
        </div>
      )}
      {msg && <p className={cn('px-4 pb-3 text-[12px]', msg.ok ? 'text-(--u-ok)' : 'text-(--u-danger)')}>{msg.text}</p>}
    </>
  )
}


/** A miniature of what the saver looks like. The pictures use your actual wallpaper. */
function SaverPreview({ id, hover }: { id: string; hover: boolean }) {
  const { wallpaperId } = useWallpaper()
  const [src, setSrc] = useState('')
  useEffect(() => {
    let off = false
    void fittedWallpaperSrc(wallpaperId).then((u) => !off && setSrc(u))
    return () => {
      off = true
    }
  }, [wallpaperId])
  const pic = (style?: React.CSSProperties) => (src ? <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={style} /> : <span className="absolute inset-0 bg-(--u-wash-on)" />)
  if (id === 'aurora' || id === 'flow' || id === 'daylight') return <CinemaCanvas kind={id as CinemaKind} still={!hover} scale={0.25} fps={20} />
  if (id === 'clock')
    return (
      <>
        {pic()}
        <span className="absolute bottom-1.5 left-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-white/60 bg-black/30">
          <span className="h-3 w-px origin-bottom -translate-y-1.5 rotate-[20deg] bg-white" />
        </span>
        <span className="absolute bottom-2 left-10 text-[13px] font-extralight tabular-nums text-white">10:09</span>
      </>
    )
  if (id === 'veil')
    return (
      <>
        {pic({ filter: 'blur(5px) brightness(0.75)', transform: 'scale(1.1)' })}
        <span className="absolute inset-0 flex items-center justify-center text-[26px] font-thin tabular-nums text-white">10:09</span>
      </>
    )
  if (id === 'reel') return <>{pic({ transform: hover ? 'scale(1.12)' : 'scale(1)', transition: 'transform 8s linear' })}</>
  if (id === 'minimal') return <span className="absolute left-[22%] top-[34%] text-[15px] font-thin tabular-nums text-white/85">10:09</span>
  return (
    <span className="absolute inset-0 grid grid-cols-3">
      {['#1c54d6', '#0096cd', '#e26228', '#5c38c8', '#222', '#111'].map((c, i) => (
        <span key={i} style={{ background: c, opacity: 0.8 }} />
      ))}
    </span>
  )
}

function SaverTile({ id, name, blurb, on, onPick }: { id: string; name: string; blurb: string; on: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button type="button" aria-pressed={on} onClick={onPick} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} className={cn('u-tile items-stretch gap-1.5 p-1.5 text-left', on && 'bg-(--u-wash-on) shadow-[inset_0_0_0_2px_var(--u-accent)]')}>
      <span className="relative block aspect-video overflow-hidden rounded-[8px] bg-black shadow-[inset_0_0_0_1px_var(--u-edge)]">
        <SaverPreview id={id} hover={hover} />
      </span>
      <span className="px-0.5">
        <span className="block text-[12.5px] font-medium">{name}</span>
        <span className="block truncate text-[11px] text-(--u-ink-3)">{blurb}</span>
      </span>
    </button>
  )
}

function SaverPicker() {
  const [scene, setScene] = usePref('screensaver.scene')
  return (
    <div className="grid grid-cols-4 gap-2 p-3">
      {SAVERS.map((a) => (
        <SaverTile key={a.id} id={a.id} name={a.name} blurb={a.blurb} on={scene === a.id} onPick={() => void setScene(a.id)} />
      ))}
    </div>
  )
}

export function LockSection() {
  const [lockAfter, setLockAfter] = usePref('lock.afterScreensaver')
  const [delay, setDelay] = usePref('screensaver.idleSeconds')
  return (
    <Stack>
      <Group title="Lock screen" footer="Udaan Lock covers the desktop with a PIN. It is a courtesy lock for passers-by, not a replacement for your Windows password.">
        <Row title="Lock now" description="Also on the dock menu and Start's power menu.">
          <ActionButton onClick={() => void emit('launcher:lock')}>Lock</ActionButton>
        </Row>
        <PinChanger />
      </Group>
      <Group title="Screensaver" footer="Hover a scene to see it move. They slow down by themselves on a busy PC.">
        <SaverPicker />
        <Row stack title="Start after" description="How long the PC sits untouched before the clock screensaver appears. It never starts over a full-screen app, a show or music.">
          <Segmented value={delay} options={DELAYS} onChange={(v) => void setDelay(v)} />
        </Row>
        <Row title="Lock when it ends" description="Ask for the PIN when you wake the PC from the screensaver.">
          <Switch checked={lockAfter} onChange={(v) => void setLockAfter(v)} label="Lock when the screensaver ends" />
        </Row>
        <Row title="Preview">
          <ActionButton onClick={() => void emit('launcher:screensaver')}>Start screensaver</ActionButton>
        </Row>
      </Group>
    </Stack>
  )
}

/* ── Live system and engine ────────────────────────────────────── */

interface Load {
  cpu: number
  memoryUsed: number
  memoryTotal: number
  uptime: number
}
interface Tier {
  tier: 'tight' | 'normal' | 'roomy'
  totalMb: number
  availMb: number
  onBattery: boolean
  batteryPercent: number | null
}
interface Service {
  name: string
  state: string
  restarts: number
}

const gb = (b: number) => (b / 1024 ** 3).toFixed(1)
const upFmt = (s: number) => {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

function Meter({ value, label, detail }: { value: number; label: string; detail: string }) {
  const hot = value > 0.85
  return (
    <Row stack title={label}>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-(--u-wash-press)">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, value * 100)}%`, background: hot ? 'var(--u-danger)' : 'var(--u-ink)' }} />
        </div>
        <span className="w-28 text-right text-[12px] tabular-nums text-(--u-ink-2)">{detail}</span>
      </div>
    </Row>
  )
}

const TIER_TEXT = {
  tight: 'Tight: Udaan keeps effects light and skips keeping apps warm.',
  normal: 'Normal: everything on, apps are opened on demand.',
  roomy: 'Roomy: Udaan keeps your most-used apps warm for instant opening.',
} as const

export function PerformanceGroup() {
  const [load, setLoad] = useState<Load | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
  const [services, setServices] = useState<Service[]>([])
  // Polls only while this window is visible.
  usePoll(() => {
    void invoke<Load>('shell_system_load').then(setLoad, () => {})
    void invoke<Tier>('engine_tier').then(setTier, () => {})
    void invoke<Service[]>('engine_health').then(setServices, () => {})
  }, 2500)

  const bad = services.filter((s) => s.state !== 'running')
  return (
    <>
      <Group title="Live">
        <Meter label="Processor" value={(load?.cpu ?? 0) / 100} detail={load ? `${Math.round(load.cpu)}%` : '…'} />
        <Meter label="Memory" value={load ? load.memoryUsed / Math.max(1, load.memoryTotal) : 0} detail={load ? `${gb(load.memoryUsed)} / ${gb(load.memoryTotal)} GB` : '…'} />
        <Row title="Running for" description="Since this PC last started.">
          <span className="text-[13px] tabular-nums text-(--u-ink-2)">{load ? upFmt(load.uptime) : '…'}</span>
        </Row>
      </Group>
      <Group title="Memory mode" footer="Udaan watches free memory and scales itself: effects, warm apps and animation all follow it.">
        <Row title={tier ? tier.tier[0].toUpperCase() + tier.tier.slice(1) : 'Checking…'} description={tier ? `${TIER_TEXT[tier.tier]} ${Math.round(tier.availMb)} MB free of ${Math.round(tier.totalMb)} MB.` : undefined} />
      </Group>
      <Group title="Engine" footer={bad.length ? 'A service that stopped is restarted automatically.' : 'Every background service is running.'}>
        {services.length === 0 ? (
          <Row title="Checking…" />
        ) : (
          services.map((s) => (
            <Row key={s.name} title={s.name} description={s.restarts ? `Restarted ${s.restarts} time${s.restarts === 1 ? '' : 's'}` : undefined}>
              <span className={cn('text-[12px] font-medium', s.state === 'running' ? 'text-(--u-ok)' : 'text-(--u-danger)')}>{s.state}</span>
            </Row>
          ))
        )}
      </Group>
    </>
  )
}

/* ── Appearance extras ─────────────────────────────────────────── */

const ACCENTS = [
  { value: '#3072f0', label: 'Blue' },
  { value: '#8a5cf0', label: 'Violet' },
  { value: '#e0508a', label: 'Pink' },
  { value: '#f0703a', label: 'Orange' },
  { value: '#2fb46b', label: 'Green' },
  { value: '#8b8d94', label: 'Graphite' },
]

export function AppearanceExtras() {
  const [accent, setAccent] = usePref('ui.accent')
  const [opaque, setOpaque] = usePref('ui.opaque')
  const [motionOff, setMotionOff] = usePref('motion.off')
  return (
    <Stack>
      <Group title="Accent colour" footer="Used for what is active or live: the focused dock dot, switches, selections.">
        <div className="flex flex-wrap items-center gap-3 px-4 py-4">
          {ACCENTS.map((a) => (
            <button key={a.value} type="button" aria-label={a.label} aria-pressed={accent === a.value} title={a.label} onClick={() => void setAccent(a.value)} className={cn('h-7 w-7 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/25%)]', accent === a.value && 'ring-2 ring-(--u-ink) ring-offset-2 ring-offset-(--u-m-solid)')} style={{ background: a.value }} />
          ))}
        </div>
      </Group>
      <Group title="Materials">
        <Row title="Solid surfaces" description="Turns glass into solid charcoal. Lighter on a slow PC, and easier to read over busy wallpapers.">
          <Switch checked={opaque} onChange={(v) => void setOpaque(v)} label="Solid surfaces" />
        </Row>
        <Row title="Reduce motion" description="Replaces springs and slides with simple fades.">
          <Switch checked={motionOff} onChange={(v) => void setMotionOff(v)} label="Reduce motion" />
        </Row>
      </Group>
    </Stack>
  )
}

/* ── Startup & apps ────────────────────────────────────────────── */

function useIdList(pref: 'apps.warm' | 'apps.startup') {
  const [raw, setRaw] = usePref(pref)
  let ids: string[] = []
  try {
    ids = JSON.parse(raw) as string[]
  } catch {
    /* none */
  }
  const toggle = (id: string, on: boolean) => void setRaw(JSON.stringify(on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)))
  return { ids, toggle }
}

export function StartupSection() {
  const warm = useIdList('apps.warm')
  const startup = useIdList('apps.startup')
  const apps = APP_IDS.filter((id: AppId) => id !== 'settings')
  return (
    <Stack>
      <Group title="Open when Udaan starts" footer="These apps open by themselves after sign-in.">
        {apps.map((id) => (
          <Row key={id} title={APP_DEFS[id].name}>
            <Switch checked={startup.ids.includes(id)} onChange={(v) => startup.toggle(id, v)} label={`Open ${APP_DEFS[id].name} at startup`} />
          </Row>
        ))}
      </Group>
      <Group title="Keep ready for instant opening" footer="A kept-ready app waits in the background, which opens it at once but uses about 85 MB of memory. Udaan skips this on its own when memory is low.">
        {apps.map((id) => (
          <Row key={id} title={APP_DEFS[id].name}>
            <Switch checked={warm.ids.includes(id)} onChange={(v) => warm.toggle(id, v)} label={`Keep ${APP_DEFS[id].name} ready`} />
          </Row>
        ))}
      </Group>
    </Stack>
  )
}

/* ── Power & performance ───────────────────────────────────────── */

const PROFILES = [
  { value: 'eco', label: 'Eco' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'performance', label: 'Performance' },
]
const PROFILE_TEXT: Record<string, string> = {
  eco: 'No animation and no blur. Solid surfaces. The lightest on the processor, memory and battery.',
  balanced: 'Smooth animation and glass, scaled down by itself when the PC is busy.',
  performance: 'Everything on, always: full animation, blur and kept-ready apps.',
}

export function PowerSection() {
  const [profile, setProfile] = usePref('power.profile')
  return (
    <Stack>
      <Group title="Profile" footer={PROFILE_TEXT[profile] ?? ''}>
        <Row stack title="How much should Udaan do for looks?" description="One switch for animation, blur and background work.">
          <Segmented value={profile} options={PROFILES} onChange={(v) => void setProfile(v)} />
        </Row>
      </Group>
      <PerformanceGroup />
    </Stack>
  )
}

/* ── Privacy & security ────────────────────────────────────────── */

export function PrivacySection() {
  const [previews, setPreviews] = usePref('notifications.previews')
  const [lockAfter, setLockAfter] = usePref('lock.afterScreensaver')
  const [cleared, setCleared] = useState(false)
  return (
    <Stack>
      <Group title="On screen">
        <Row title="Show message text in banners" description="Off: banners only say who a notification is from, so nothing private shows over your work.">
          <Switch checked={previews} onChange={(v) => void setPreviews(v)} label="Show message text in banners" />
        </Row>
        <Row title="Lock when the screensaver ends" description="Ask for your PIN when you wake the PC.">
          <Switch checked={lockAfter} onChange={(v) => void setLockAfter(v)} label="Lock when the screensaver ends" />
        </Row>
      </Group>
      <Group title="History" footer="Removes what Udaan remembers on this PC: pinned-and-recent lists in Start and wallpaper choices history. Your files and apps are untouched.">
        <Row title="Clear Start history" description={cleared ? 'Cleared.' : 'Forgets which apps you open most.'}>
          <ActionButton
            danger
            onClick={() => {
              try {
                localStorage.removeItem('udaan-start-pins-v3')
              } catch {
                /* nothing to clear */
              }
              void invoke('search_clear_history').catch(() => {})
              setCleared(true)
            }}
          >
            Clear
          </ActionButton>
        </Row>
      </Group>
    </Stack>
  )
}

/* ── AI ────────────────────────────────────────────────────────── */

const STATE_LABEL: Record<ProviderInfo['state'], string> = { ok: 'Working', resting: 'Resting after an error', failing: 'Failing', idle: 'Not used yet' }

function ProviderRow({ p, onChange }: { p: ProviderInfo; onChange: () => void }) {
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      const ms = await testProvider(p.id)
      setResult({ ok: true, text: `Answered in ${(ms / 1000).toFixed(1)} s` })
    } catch (e) {
      setResult({ ok: false, text: String(e).replace(/^Every AI provider failed\. /, '').slice(0, 160) })
    } finally {
      setTesting(false)
      onChange()
    }
  }
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', p.state === 'ok' ? 'bg-(--u-ok)' : p.state === 'failing' || p.state === 'resting' ? 'bg-(--u-danger)' : 'bg-(--u-ink-3)')} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">{p.name}</p>
          <p className="text-[11.5px] text-(--u-ink-3)">{p.needsKey && !p.hasKey ? 'Needs a free key' : STATE_LABEL[p.state]}{p.lastError ? `: ${p.lastError}` : ''}</p>
        </div>
        <ActionButton disabled={testing || (p.needsKey && !p.hasKey)} onClick={() => void test()}>
          {testing ? 'Testing…' : 'Test'}
        </ActionButton>
        <Switch checked={p.enabled} onChange={(v) => void setProvider(p.id, { enabled: v }).then(onChange)} label={`Use ${p.name}`} />
      </div>
      {p.needsKey && (
        <div className="flex items-center gap-2">
          <Field type="password" autoComplete="off" placeholder={p.hasKey ? 'Key saved. Paste a new one to replace it' : 'Paste your free API key'} value={key} onChange={(e) => setKey(e.target.value)} />
          <ActionButton disabled={!key.trim()} onClick={() => void setProvider(p.id, { key }).then(() => (setKey(''), onChange()))}>
            Save
          </ActionButton>
          {p.signup && <ActionButton onClick={() => void launchApp(p.signup)}>Get a key</ActionButton>}
        </div>
      )}
      {result && <p className={cn('text-[12px]', result.ok ? 'text-(--u-ok)' : 'text-(--u-danger)')}>{result.text}</p>}
    </div>
  )
}

export function AiSection() {
  const [list, setList] = useState<ProviderInfo[]>([])
  const load = () => void listProviders().then(setList, () => {})
  useEffect(load, [])
  return (
    <Stack>
      <Group title="How Udaan gets its answers" footer="Chat, OmniFind and the daily brief all use this list from top to bottom. If one fails, the next one answers, and a provider that failed rests for a while. The Claude CLI is never used, so it never spends your tokens. Keys stay on this PC.">
        {list.length === 0 && <Row title="Loading…" />}
        {list.map((p) => (
          <ProviderRow key={p.id} p={p} onChange={load} />
        ))}
      </Group>
    </Stack>
  )
}
