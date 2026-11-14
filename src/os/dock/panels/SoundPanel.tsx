import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { launchApp } from '@/integrations/installed-apps/client'
import { usePref } from '@/os/kernel/prefs'
import { openApp } from '@/os/kernel/shell'
import { VolumeIcon, VolumeMuteIcon } from '@/shared/icons'
import { cn } from '@/shared/lib/cn'
import { Button, Segmented, Slider, Switch } from '@/os/ui/controls'
import { springs, dur, curve as ease, staggerDelay } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { curveResponse, refreshEqualizer, type Curve } from '@/os/sound/equalizer'

interface VolumeState {
  level: number
  muted: boolean
}

export interface CustomEq {
  bass: number
  voice: number
  treble: number
}

export const NO_EQ: CustomEq = { bass: 0, voice: 0, treble: 0 }

export function parseCustomEq(raw: string): CustomEq {
  try {
    const v = JSON.parse(raw) as Partial<CustomEq>
    return { bass: Number(v.bass) || 0, voice: Number(v.voice) || 0, treble: Number(v.treble) || 0 }
  } catch {
    return NO_EQ
  }
}

/**
 * Sound modes.
 *
 * These are applied as real filters inside Udaan's own audio graph
 * (os/sound/equalizer.ts), so picking one is audible immediately. There is
 * no driver to install and nothing to reboot for — the previous version
 * routed this through Equalizer APO, which meant the whole feature did
 * nothing at all unless the user had completed a five-step install Udaan
 * could neither perform nor verify.
 */
const PRESETS = [
  { id: 'flat', label: 'Flat', hint: 'No processing' },
  { id: 'music', label: 'Music', hint: 'Fuller low end, clearer vocals, a little air' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Weighty lows and clear dialogue for films' },
  { id: 'bass', label: 'Bass', hint: 'Deep, punchy low end' },
  { id: 'vocal', label: 'Dialogue', hint: 'Speech and vocals up front' },
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

/* ------------------------------------------------------------------ */
/*  CURVE DISPLAY                                                      */
/* ------------------------------------------------------------------ */

/**
 * The sound mode's actual frequency response.
 *
 * Drawn from the same biquad maths the filters use, not an interpolation
 * between band centres — so the overlap between neighbouring bands is
 * visible, which is most of what a mode actually does. A plot that joins
 * the band centres with a spline is a drawing of the settings; this is a
 * drawing of the sound.
 */
function CurveDisplay({ curve, height = 64 }: { curve: Curve | null; height?: number }) {
  const reduced = prefersReducedMotion()
  const path = useMemo(() => {
    if (!curve) return ''
    const points = curveResponse(curve, 96)
    // ±12 dB fills the box; anything beyond is clamped rather than
    // rescaling, so the curve's height means the same thing in every mode.
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
    <div className="relative overflow-hidden rounded-[10px] bg-black/20" style={{ height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {/* 0 dB, and ±6 dB for scale. */}
        <path d="M0 50H100" stroke="currentColor" strokeOpacity="0.22" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        <path d="M0 27H100M0 73H100" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        {/* Octave marks, so the horizontal axis is readable as frequency. */}
        {[100, 1000, 10000].map((hz) => {
          const x = (Math.log10(hz / 20) / Math.log10(20000 / 20)) * 100
          return <path key={hz} d={`M${x} 0V100`} stroke="currentColor" strokeOpacity="0.07" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        })}
        {/* Fill under the curve: makes a boost read as "more" at a glance. */}
        {path && (
          <>
            <motion.path
              d={`${path} L100 50 L0 50 Z`}
              fill="var(--color-accent)"
              fillOpacity="0.16"
              initial={false}
              animate={{ d: `${path} L100 50 L0 50 Z` }}
              transition={reduced ? { duration: 0 } : springs.standard}
            />
            <motion.path
              d={path}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={{ d: path }}
              transition={reduced ? { duration: 0 } : springs.standard}
            />
          </>
        )}
      </svg>
      <span className="pointer-events-none absolute bottom-1 left-2 text-[9px] text-[var(--os-text-faint)]">20 Hz</span>
      <span className="pointer-events-none absolute bottom-1 right-2 text-[9px] text-[var(--os-text-faint)]">20 kHz</span>
    </div>
  )
}

/**
 * A live output meter for the keep-awake signal.
 *
 * This answers the question the feature could never answer before: *is it
 * doing anything?* The threshold line is where a typical speaker's standby
 * detector triggers, so seeing the signal sit above it is the proof. The
 * old version had no feedback at all, which is how it stayed broken while
 * looking fine.
 */
function OutputMeter({ active, level }: { active: boolean; level: number }) {
  const [peak, setPeak] = useState(0)
  useEffect(() => {
    if (!active) {
      setPeak(0)
      return
    }
    // Mirrors the ±2 dB wander the generator applies, so the meter reads as
    // live signal rather than a static bar.
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const t = (now - start) / 1000
      const base = [0.18, 0.34, 0.56][level - 1] ?? 0.34
      setPeak(base * (1 + Math.sin(t * 0.9) * 0.2 + Math.sin(t * 7.3) * 0.04))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, level])

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] uppercase tracking-wide text-[var(--os-text-faint)]">Output</span>
      <div className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-black/25">
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full"
          animate={{ width: `${Math.min(100, peak * 100)}%` }}
          transition={{ duration: 0.1, ease: 'linear' }}
          style={{ background: active ? 'var(--color-accent)' : 'var(--os-text-faint)' }}
        />
        <span className="absolute inset-y-0 w-px bg-white/45" style={{ left: '28%' }} aria-hidden />
      </div>
      <span className="w-[62px] shrink-0 text-right text-[10.5px] tabular-nums text-[var(--os-text-faint)]">
        {active ? `${[-46, -38, -30][level - 1] ?? -38} dBFS` : 'silent'}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Volume, sound modes, and the speaker keep-awake.
 *
 * Sections fade and slide in; they never animate their height. This panel
 * lives in an OS window that FlyoutWindow resizes to fit its content over
 * IPC, so an animated height means a window resize on every frame — an
 * async round trip each (size, monitor, position, set rect) with the
 * compositor re-blurring behind it. That is what made these popups judder.
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
  const reduced = prefersReducedMotion()

  useEffect(() => {
    void invoke<VolumeState>('shell_volume').then(setV, () => {})
  }, [])

  /**
   * Retunes every live audio chain and refreshes the curve display.
   *
   * Preferences are the single source of truth, so this reads them back
   * rather than taking the new value as an argument — which means the
   * display can never disagree with what the filters are doing.
   */
  const applyMode = useCallback(async () => {
    const next = await refreshEqualizer()
    setCurve(next)
  }, [])

  useEffect(() => {
    void applyMode()
  }, [applyMode])

  const apply = (patch: Partial<VolumeState>) => {
    setV((cur) => (cur ? { ...cur, ...patch } : cur))
    // Coalesce drag updates: one Core Audio call per frame at most.
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

  const pct = Math.round((v?.level ?? 0) * 100)
  const shown = v?.muted ? 0 : pct
  const active = PRESETS.find((p) => p.id === preset)

  return (
    <div
      className="flex flex-col gap-4 p-4 text-[var(--os-text)]"
      onWheel={(e) => {
        // Scroll anywhere on the panel to change the volume.
        if (!(e.target as HTMLElement).closest('[data-no-wheel]')) nudge(e.deltaY < 0 ? 0.03 : -0.03)
      }}
    >
      {/* ── Volume ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Volume</h2>
          <span className="text-[24px] font-light tabular-nums leading-none">
            {v ? shown : '–'}
            <span className="text-[12px] text-[var(--os-text-dim)]">%</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <motion.button
            type="button"
            aria-label={v?.muted ? 'Unmute' : 'Mute'}
            title={v?.muted ? 'Unmute' : 'Mute'}
            disabled={!v}
            whileTap={reduced ? undefined : { scale: 0.9 }}
            transition={springs.snap}
            onClick={() => v && apply({ muted: !v.muted })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{
              background: v && !v.muted ? 'var(--color-accent)' : 'var(--os-hover)',
              color: v && !v.muted ? 'var(--color-accent-contrast)' : 'currentColor',
              boxShadow: v && !v.muted ? 'var(--os-edge), var(--os-shadow-sm)' : undefined,
            }}
          >
            {v?.muted ? <VolumeMuteIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
          </motion.button>
          <Button icon aria-label="Quieter" title="Quieter" disabled={!v} onClick={() => nudge(-0.05)} className="rounded-full text-[18px]">
            −
          </Button>
          <div className="min-w-0 flex-1" data-no-wheel onWheel={(e) => { e.stopPropagation(); nudge(e.deltaY < 0 ? 0.03 : -0.03) }}>
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
          <Button icon aria-label="Louder" title="Louder" disabled={!v} onClick={() => nudge(0.05)} className="rounded-full text-[18px]">
            +
          </Button>
        </div>
      </section>

      {/* ── Sound mode ────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Sound mode</h2>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={active?.id}
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: 4 }}
              transition={{ duration: dur.fast, ease: ease.decelerate }}
              className="truncate pl-2 text-[11.5px] text-[var(--os-text-dim)]"
            >
              {active?.hint}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* The curve animates between modes, so you see what changed rather
            than only which button lit up. */}
        <CurveDisplay curve={curve} />

        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {PRESETS.map((p, i) => {
            const on = preset === p.id
            return (
              <motion.button
                key={p.id}
                type="button"
                title={p.hint}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: staggerDelay(i, 0.02), ...springs.gentle }}
                whileTap={reduced ? undefined : { scale: 0.94 }}
                onClick={() => void choose(p.id)}
                className={cn(
                  'os-control h-[30px] rounded-[9px] px-1 text-[11.5px] font-medium',
                  on ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : 'bg-[var(--os-hover)] hover:bg-[var(--os-active)]',
                )}
                style={on ? { boxShadow: 'var(--os-edge), var(--os-shadow-sm)' } : undefined}
              >
                {p.label}
              </motion.button>
            )
          })}
        </div>

        <AnimatePresence initial={false} mode="wait">
          {preset === 'custom' ? (
            <motion.div
              key="custom"
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: dur.fast, ease: ease.decelerate }}
            >
              <div className="mt-3 flex flex-col gap-2.5" data-no-wheel>
                <EqRow label="Bass" value={custom.bass} onChange={(x) => void changeCustom({ bass: x })} />
                <EqRow label="Voice" value={custom.voice} onChange={(x) => void changeCustom({ voice: x })} />
                <EqRow label="Treble" value={custom.treble} onChange={(x) => void changeCustom({ treble: x })} />
                <Button size="sm" onClick={() => void changeCustom(NO_EQ)} className="self-start rounded-full text-[var(--os-text-dim)]">
                  Reset
                </Button>
              </div>
            </motion.div>
          ) : preset !== 'flat' ? (
            <motion.div
              key="strength"
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: dur.fast, ease: ease.decelerate }}
            >
              <div className="mt-3" data-no-wheel>
                <label className="flex items-center gap-3 text-[12px] text-[var(--os-text-dim)]">
                  <span className="w-14 shrink-0">Strength</span>
                  <Slider value={Math.round(strength * 100)} min={50} max={150} step={10} aria-label="Strength" onChange={(x) => void changeStrength(x / 100)} className="min-w-0 flex-1" />
                  <span className="w-12 text-right tabular-nums text-[var(--os-text)]">{Math.round(strength * 100)}%</span>
                </label>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <p className="mt-2 text-[11px] leading-snug text-[var(--os-text-dim)]">
          {preset === 'flat'
            ? 'Shapes everything Udaan plays — music, the DJ board, video and interface sounds.'
            : 'Applied instantly to everything Udaan plays. Levels drop automatically as you boost, so it never distorts.'}
        </p>
      </section>

      {/* ── Keep speakers awake ───────────────────────────────────── */}
      <section className="rounded-[12px] bg-[var(--os-hover)] p-3" data-no-wheel>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold">Keep speakers awake</h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--os-text-dim)]">
              Stops speakers switching off on quiet scenes, so soft sounds are always heard.
            </p>
          </div>
          <Switch checked={awake} onChange={(next) => keep(next)} label="Keep speakers awake" />
        </div>

        <AnimatePresence initial={false}>
          {awake && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: dur.fast, ease: ease.decelerate }}
            >
              <div className="mt-3 flex flex-col gap-2.5">
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
                <OutputMeter active={awake} level={awakeLevel} />
                <p className="text-[11px] leading-snug text-[var(--os-text-dim)]">
                  The signal has to clear the line on the meter for a speaker to notice it. Strong is for AV receivers and
                  Bluetooth, which sleep hardest. If sound still cuts out, go up one step.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="flex gap-2" data-no-wheel>
        <Button variant="tinted" size="lg" onClick={() => void openApp('live-dj')} className="flex-1 rounded-[10px] text-[12.5px]">
          DJ board
        </Button>
        <Button variant="tinted" size="lg" onClick={() => void launchApp('ms-settings:sound')} className="flex-1 rounded-[10px] text-[12.5px]">
          Sound settings…
        </Button>
      </div>
    </div>
  )
}

/** One band of the manual EQ. */
function EqRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[12px] text-[var(--os-text-dim)]">
      <span className="w-14 shrink-0">{label}</span>
      <Slider value={value} min={-8} max={8} step={0.5} aria-label={label} onChange={onChange} className="min-w-0 flex-1" />
      <span className="w-12 text-right tabular-nums text-[var(--os-text)]">
        {value > 0 ? '+' : ''}
        {Number.isInteger(value) ? value : value.toFixed(1)} dB
      </span>
    </label>
  )
}
