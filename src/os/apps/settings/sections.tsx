import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { usePref } from '@/os/kernel/prefs'
import { usePoll } from '@/os/kernel/poll'
import { changePin, loadPinConfig } from '@/os/kernel/lockPin'
import { Button, Field } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
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
      <Group title="Screensaver">
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
