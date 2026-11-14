import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { launchApp } from '@/integrations/installed-apps/client'
import { usePref } from '@/os/kernel/prefs'
import { openApp } from '@/os/kernel/shell'
import { VolumeIcon, VolumeMuteIcon } from '@/shared/icons'
import { Button, Segmented, Slider, Switch } from '@/os/ui/controls'
import { curveResponse, refreshEqualizer, type Curve } from '@/os/sound/equalizer'

interface VolumeState {
  level: number
  muted: boolean
}

interface CustomEq {
  bass: number
  voice: number
  treble: number
}

const NO_EQ: CustomEq = { bass: 0, voice: 0, treble: 0 }

function parseCustomEq(raw: string): CustomEq {
  try {
    const v = JSON.parse(raw) as Partial<CustomEq>
    return { bass: Number(v.bass) || 0, voice: Number(v.voice) || 0, treble: Number(v.treble) || 0 }
  } catch {
    return NO_EQ
  }
}

/** Sound modes: real filters inside Udaan's own audio graph (os/sound/equalizer.ts). */
const PRESETS = [
  { id: 'flat', label: 'Flat', hint: 'No processing' },
  { id: 'music', label: 'Music', hint: 'Fuller low end, clearer vocals, a little air' },
  { id: 'cinematic', label: 'Cinema', hint: 'Weighty lows and clear dialogue for films' },
  { id: 'bass', label: 'Bass', hint: 'Deep, punchy low end' },
  { id: 'vocal', label: 'Voice', hint: 'Speech and vocals up front' },
  { id: 'night', label: 'Night', hint: 'Softer lows and highs for late listening' },
  { id: 'clarity', label: 'Clarity', hint: 'Brighter, more detail' },
  { id: 'custom', label: 'Custom', hint: 'Set bass, voice and treble yourself' },
] as const

const AWAKE_LEVELS = [
  { value: '1' as const, label: 'Gentle' },
  { value: '2' as const, label: 'Normal' },
  { value: '3' as const, label: 'Strong' },
]

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** The mode's actual frequency response, drawn from the same biquad maths the filters use. */
function CurveDisplay({ curve }: { curve: Curve | null }) {
  const path = useMemo(() => {
    if (!curve) return ''
    const points = curveResponse(curve, 96)
    const RANGE = 12
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * 100
        const y = 50 - (Math.max(-RANGE, Math.min(RANGE, p.db)) / RANGE) * 46
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')
  }, [curve])

  return (
    <div className="relative h-14 overflow-hidden rounded-[10px] bg-(--u-wash-hover) shadow-[inset_0_0_0_1px_var(--u-edge)]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <path d="M0 50H100" stroke="currentColor" strokeOpacity="0.2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {[100, 1000, 10000].map((hz) => {
          const x = (Math.log10(hz / 20) / Math.log10(20000 / 20)) * 100
          return <path key={hz} d={`M${x} 0V100`} stroke="currentColor" strokeOpacity="0.07" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        })}
        {path && (
          <>
            <path d={`${path} L100 50 L0 50 Z`} fill="var(--u-accent)" fillOpacity="0.16" />
            <path d={path} fill="none" stroke="var(--u-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <span className="pointer-events-none absolute bottom-0.5 left-2 text-[9px] text-(--u-ink-3)">20 Hz</span>
      <span className="pointer-events-none absolute bottom-0.5 right-2 text-[9px] text-(--u-ink-3)">20 kHz</span>
    </div>
  )
}

/**
 * Volume, sound modes, speaker keep-awake.
 *
 * A calm vertical stack: one big volume control, one mode picker, one
 * optional detail row, one setting card, two footer actions. No per-item
 * entrance animations: the popup itself animates once, and the host window
 * follows the card's size, so nothing inside animates its height.
 */
export function SoundPanel() {
  const [v, setV] = useState<VolumeState | null>(null)
  const [curve, setCurve] = useState<Curve | null>(null)
  const [preset, setPreset] = usePref('sound.preset')
  const [strength, setStrength] = usePref('sound.strength')
  const [customRaw, setCustomRaw] = usePref('sound.custom')
  const [awake, setAwake] = usePref('sound.keepAwake')
  const [awakeLevel, setAwakeLevel] = usePref('sound.keepAwakeLevel')
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)
  const custom = parseCustomEq(customRaw)

  useEffect(() => {
    void invoke<VolumeState>('shell_volume').then(setV, () => {})
  }, [])

  const applyMode = useCallback(async () => setCurve(await refreshEqualizer()), [])
  useEffect(() => {
    void applyMode()
  }, [applyMode])

  const apply = (patch: Partial<VolumeState>) => {
    setV((cur) => (cur ? { ...cur, ...patch } : cur))
    clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      void invoke<VolumeState>('shell_set_volume', { level: patch.level ?? null, muted: patch.muted ?? null }).catch(() => {})
    }, 16)
  }
  const nudge = (delta: number) => v && apply({ level: clamp01(Math.round((v.level + delta) * 100) / 100), muted: false })

  const choose = async (id: string) => {
    await setPreset(id)
    void applyMode()
  }
  const changeStrength = async (s: number) => {
    await setStrength(s)
    void applyMode()
  }
  const changeCustom = async (patch: Partial<CustomEq>) => {
    await setCustomRaw(JSON.stringify({ ...custom, ...patch }))
    void applyMode()
  }
  const keep = (on: boolean, level = awakeLevel) => {
    void setAwake(on)
    void invoke('speaker_keepalive_set', { enabled: on, level }).catch(() => {})
  }

  const shown = v?.muted ? 0 : Math.round((v?.level ?? 0) * 100)
  const active = PRESETS.find((p) => p.id === preset)
  const stop = (e: React.WheelEvent) => e.stopPropagation()

  return (
    <div className="flex flex-col gap-5 p-4" onWheel={(e) => nudge(e.deltaY < 0 ? 0.03 : -0.03)}>
      {/* Volume */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="u-label">Volume</h2>
          <span className="text-[26px] font-light leading-none tabular-nums">
            {v ? shown : '–'}
            <span className="ml-0.5 text-[12px] text-(--u-ink-3)">%</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            icon
            variant={v?.muted ? 'ghost' : 'tinted'}
            aria-label={v?.muted ? 'Unmute' : 'Mute'}
            aria-pressed={!!v?.muted}
            disabled={!v}
            onClick={() => v && apply({ muted: !v.muted })}
            className="h-9 w-9 rounded-full"
          >
            {v?.muted ? <VolumeMuteIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
          </Button>
          <Slider
            value={shown}
            min={0}
            max={100}
            step={1}
            disabled={!v}
            aria-label="Volume"
            onChange={(x) => apply({ level: x / 100, ...(v?.muted ? { muted: false } : {}) })}
          />
        </div>
      </section>

      {/* Sound mode */}
      <section onWheel={stop}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="u-label">Sound mode</h2>
          <span className="truncate text-[11.5px] text-(--u-ink-3)">{active?.hint}</span>
        </div>
        <CurveDisplay curve={curve} />
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant={preset === p.id ? 'primary' : 'tinted'}
              size="sm"
              title={p.hint}
              aria-pressed={preset === p.id}
              onClick={() => void choose(p.id)}
              className="px-1"
            >
              {p.label}
            </Button>
          ))}
        </div>

        {preset === 'custom' ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <EqRow label="Bass" value={custom.bass} onChange={(x) => void changeCustom({ bass: x })} />
            <EqRow label="Voice" value={custom.voice} onChange={(x) => void changeCustom({ voice: x })} />
            <EqRow label="Treble" value={custom.treble} onChange={(x) => void changeCustom({ treble: x })} />
            <Button size="sm" onClick={() => void changeCustom(NO_EQ)} className="self-start">
              Reset
            </Button>
          </div>
        ) : preset !== 'flat' ? (
          <label className="mt-3 flex items-center gap-3 text-[12px] text-(--u-ink-2)">
            <span className="w-14 shrink-0">Strength</span>
            <Slider value={Math.round(strength * 100)} min={50} max={150} step={10} aria-label="Strength" onChange={(x) => void changeStrength(x / 100)} />
            <span className="w-10 text-right tabular-nums text-(--u-ink)">{Math.round(strength * 100)}%</span>
          </label>
        ) : null}
        <p className="mt-2.5 text-[11px] leading-snug text-(--u-ink-3)">
          {preset === 'flat' ? 'Shapes everything Udaan plays: music, the DJ board, video and interface sounds.' : 'Applied instantly to everything Udaan plays. Levels drop as you boost, so it never distorts.'}
        </p>
      </section>

      {/* Keep speakers awake */}
      <section className="u-surface--card flex flex-col gap-3 p-3" onWheel={stop}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-medium">Keep speakers awake</h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-(--u-ink-3)">Stops speakers switching off on quiet scenes.</p>
          </div>
          <Switch checked={awake} onChange={(next) => keep(next)} label="Keep speakers awake" />
        </div>
        {awake && (
          <Segmented
            value={String(awakeLevel) as '1' | '2' | '3'}
            options={AWAKE_LEVELS}
            onChange={(next) => {
              const level = Number(next)
              void setAwakeLevel(level)
              keep(true, level)
            }}
            className="w-full [&>button]:flex-1"
          />
        )}
      </section>

      <div className="flex gap-2" onWheel={stop}>
        <Button variant="tinted" onClick={() => void openApp('live-dj')} className="flex-1">
          DJ board
        </Button>
        <Button variant="tinted" onClick={() => void launchApp('ms-settings:sound')} className="flex-1">
          Sound settings…
        </Button>
      </div>
    </div>
  )
}

function EqRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[12px] text-(--u-ink-2)">
      <span className="w-14 shrink-0">{label}</span>
      <Slider value={value} min={-8} max={8} step={0.5} aria-label={label} onChange={onChange} />
      <span className="w-14 text-right tabular-nums text-(--u-ink)">
        {value > 0 ? '+' : ''}
        {Number.isInteger(value) ? value : value.toFixed(1)} dB
      </span>
    </label>
  )
}
